"""具名子 Agent 委派边界（禁用 deepagents 默认 general-purpose 子 Agent）。

覆盖三件事：
1. task 工具描述的 "Available agent types" 列表只暴露 prd-agent / bdd-agent
   两个具名阶段子 Agent（sdd-agent 已转异步委派，不再走同步 task 工具），
   编排者无法委派给默认附加的 general-purpose 子 Agent（经 HarnessProfile 关闭）；
2. build_deep_agent 返回的图仍然可构建（冒烟）；
3. prd/bdd 子 Agent 声明 response_format，task 工具的 ToolMessage 回传可被
   对应 Pydantic 模型解析的结构化阶段报告（sdd 的 SddPhaseReport 由 sdd 独立图
   顶层声明，见 tests/test_async_sdd.py）。
"""

import itertools

import pytest
from langchain_core.language_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.store.memory import InMemoryStore

from research_deepagent.prompts import (
    BDD_AGENT_INSTRUCTIONS,
    ORCHESTRATOR_INSTRUCTIONS,
    PRD_AGENT_INSTRUCTIONS,
    SDD_AGENT_INSTRUCTIONS,
)
from research_deepagent.schemas import (
    BddPhaseReport,
    PrdPhaseReport,
)

# 同步 task 工具只暴露 PRD / BDD 两个阶段子 Agent；SDD 转异步委派
# （AsyncSubAgent，见 tests/test_async_sdd.py）
NAMED_SUBAGENTS = ("prd-agent", "bdd-agent")


class _FakeToolChatModel(GenericFakeChatModel):
    """GenericFakeChatModel 默认未实现 bind_tools，测试中绑定请求原样返回自身。

    _get_ls_params 报告与 init_chat_model 产物一致的 ls_provider（即
    agent_module.MODEL_PROVIDER），否则 deepagents 的 harness profile 查找
    无法命中 agent.py 注册的配置，测试将无法反映真实图构建行为。

    model_name 与项目默认模型一致（gpt-4.1-mini）：langchain 的 AutoStrategy
    依模型名回退规则选择 ProviderStrategy（原生结构化输出），与真实图运行时
    的结构化返回路径保持一致；不设置则退化为 ToolStrategy，脚本化行为不同。
    """

    provider: str = ""
    model_name: str = "gpt-4.1-mini"

    def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
        return self

    def _get_ls_params(self, **kwargs):  # noqa: ANN001, ANN202
        return {"ls_provider": self.provider, "ls_model_name": self.model_name}


def _make_fake_model(provider: str) -> GenericFakeChatModel:
    final_message = AIMessage(content="已收到，开始执行。")
    return _FakeToolChatModel(
        provider=provider,
        messages=iter(itertools.repeat(final_message)),
    )


def _available_agent_types_section(task_description: str) -> str:
    """截取 task 工具描述中 "Available agent types" 列表段（子 Agent 清单）。

    列表段之后是静态使用说明，其中会无条件提及 "general-purpose" 字样
    （与是否暴露该子 Agent 无关），因此断言必须限定在列表段内。
    """
    start = task_description.index("Available agent types")
    end = task_description.index("Specify subagent_type", start)
    return task_description[start:end]


@pytest.fixture()
def built_agent_module(monkeypatch, tmp_path):
    """隔离环境变量并 reload agent 模块，返回 (agent_module, workspace 路径)。"""
    monkeypatch.setenv("DOCS_WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    import importlib

    import research_deepagent.agent as agent_module

    importlib.reload(agent_module)
    return agent_module, tmp_path / "workspace"


@pytest.fixture()
def built_graph(built_agent_module):
    agent_module, workspace = built_agent_module
    graph = agent_module.build_deep_agent(
        model=_make_fake_model(agent_module.MODEL_PROVIDER),
        backend=agent_module.create_backend(root=workspace),
        # 双层记忆路由需要 BaseStore（生产由平台注入，测试显式传入空 store，
        # 记忆文件缺失时被 MemoryMiddleware 跳过）
        store=InMemoryStore(),
    )
    return agent_module, graph


def _task_tool_description(graph) -> str:
    tools_node = graph.builder.nodes["tools"].runnable
    return tools_node.tools_by_name["task"].description


def test_task_tool_exposes_only_named_subagents(built_graph):
    _, graph = built_graph
    listing = _available_agent_types_section(_task_tool_description(graph))
    for name in NAMED_SUBAGENTS:
        assert f"- {name}:" in listing
    # sdd-agent 已转异步委派（start_async_task），不再出现在同步 task 列表
    assert "sdd-agent" not in listing
    # 默认附加的 general-purpose 子 Agent 已被 HarnessProfile 关闭
    assert "general-purpose" not in listing


def test_task_tool_listing_has_no_other_subagents(built_graph):
    _, graph = built_graph
    listing = _available_agent_types_section(_task_tool_description(graph))
    bullets = [line for line in listing.splitlines() if line.startswith("- ")]
    assert len(bullets) == len(NAMED_SUBAGENTS)


def test_build_deep_agent_still_builds_graph(built_graph):
    agent_module, graph = built_graph
    # 冒烟：图可构建且具备基本的模型/工具节点结构
    assert {"model", "tools"} <= set(graph.builder.nodes)
    assert agent_module.graph is not None


def test_subagent_specs_declare_phase_report_response_format(built_graph):
    agent_module, _ = built_graph
    assert agent_module.prd_agent["response_format"] is PrdPhaseReport
    assert agent_module.bdd_agent["response_format"] is BddPhaseReport


def test_task_toolmessage_carries_parseable_phase_report(built_agent_module):
    """委派 prd-agent 后，task 的 ToolMessage 内容可被 PrdPhaseReport 解析。

    子 Agent 的最终回复按非 schema 字段序 + 带空格脚本化：若 response_format
    接线生效，deepagents 会把结构化响应以 model_dump_json() 规范化回传
    （紧凑、字段序按 schemas.py 定义）；若未接线则退化为原始文本透传，
    断言即失败。
    """
    agent_module, workspace = built_agent_module
    scripted_report = (
        '{"prd_path": "demo/prd/prd.md",'
        ' "direction": "面向中小团队的轻量看板",'
        ' "open_questions": [],'
        ' "brainstorm_path": "demo/prd/brainstorm.md",'
        ' "requirements": [{"priority": "P0", "title": "登录", "id": "REQ-001"}],'
        ' "glossary_terms": 2}'
    )
    model = _FakeToolChatModel(
        provider=agent_module.MODEL_PROVIDER,
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "task",
                            "args": {
                                "subagent_type": "prd-agent",
                                "description": "做 PRD，slug=demo",
                            },
                            "id": "call_task_1",
                            "type": "tool_call",
                        }
                    ],
                ),
                AIMessage(content=scripted_report),
                AIMessage(content="PRD 阶段完成，等待确认。"),
            ]
        ),
    )
    graph = agent_module.build_deep_agent(
        model=model,
        backend=agent_module.create_backend(root=workspace),
        store=InMemoryStore(),
    )

    result = graph.invoke(
        {"messages": [{"role": "user", "content": "新需求，slug=demo"}]}
    )

    tool_messages = [m for m in result["messages"] if isinstance(m, ToolMessage)]
    assert len(tool_messages) == 1
    content = tool_messages[0].content
    report = PrdPhaseReport.model_validate_json(content)
    assert report.direction == "面向中小团队的轻量看板"
    assert [req.id for req in report.requirements] == ["REQ-001"]
    # 结构化回传（规范化重序列化），而非子 Agent 原始文本透传
    assert content == report.model_dump_json()


def test_subagent_prompts_declare_schema_fields():
    # PRD 完成标准声明 PrdPhaseReport 关键字段
    assert "direction" in PRD_AGENT_INSTRUCTIONS
    assert "glossary_terms" in PRD_AGENT_INSTRUCTIONS
    # BDD 完成标准声明 BddPhaseReport 关键字段与 unresolved_violations 语义
    assert "scenario_count" in BDD_AGENT_INSTRUCTIONS
    assert "unresolved_violations" in BDD_AGENT_INSTRUCTIONS
    # SDD 完成标准声明 SddPhaseReport 关键字段
    assert "test_cases_by_type" in SDD_AGENT_INSTRUCTIONS
    assert "unresolved_violations" in SDD_AGENT_INSTRUCTIONS


def test_subagent_intermediate_tool_calls_stay_out_of_orchestrator_context(
    built_agent_module,
):
    """Context Quarantine：子 Agent 的中间工具调用不泄漏进主图上下文。

    脚本：编排者发起 task(subagent_type="prd-agent") → 子 Agent 内部先调用
    write_file 写一个临时文件 → 子 Agent 返回结构化 JSON → 编排者收尾。
    断言：
    a. 主图 result 的 messages 中不存在 write_file 的 AIMessage / ToolMessage
       （子 Agent 的中间调用未泄漏）；
    b. 该文件确实写入 VFS backend（隔离的是上下文，不是存储）；
    c. 主图恰好一条 task 对应的 ToolMessage，且内容可被 PrdPhaseReport 解析。
    """
    agent_module, workspace = built_agent_module
    scripted_report = (
        '{"direction": "面向个人知识管理的工作台",'
        ' "requirements": [{"priority": "P0", "title": "收藏", "id": "REQ-001"}],'
        ' "glossary_terms": 1,'
        ' "open_questions": [],'
        ' "brainstorm_path": "demo/prd/brainstorm.md",'
        ' "prd_path": "demo/prd/prd.md"}'
    )
    brainstorm_content = "# 头脑风暴\n\n方向 A：面向个人知识管理的工作台\n"
    model = _FakeToolChatModel(
        provider=agent_module.MODEL_PROVIDER,
        messages=iter(
            [
                # 编排者：委派 prd-agent
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "task",
                            "args": {
                                "subagent_type": "prd-agent",
                                "description": "做 PRD，slug=demo",
                            },
                            "id": "call_task_1",
                            "type": "tool_call",
                        }
                    ],
                ),
                # 子 Agent（隔离上下文）：中间工具调用 write_file
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "write_file",
                            "args": {
                                "file_path": "demo/prd/brainstorm.md",
                                "content": brainstorm_content,
                            },
                            "id": "call_write_1",
                            "type": "tool_call",
                        }
                    ],
                ),
                # 子 Agent：结构化最终报告
                AIMessage(content=scripted_report),
                # 编排者：收尾
                AIMessage(content="PRD 阶段完成，等待确认。"),
            ]
        ),
    )
    backend = agent_module.create_backend(root=workspace)
    graph = agent_module.build_deep_agent(
        model=model, backend=backend, store=InMemoryStore()
    )

    result = graph.invoke(
        {"messages": [{"role": "user", "content": "新需求，slug=demo"}]}
    )

    # a. 子 Agent 的中间 write_file 调用未泄漏进主图上下文
    for message in result["messages"]:
        if isinstance(message, AIMessage):
            called_names = [tc["name"] for tc in (message.tool_calls or [])]
            assert "write_file" not in called_names
        elif isinstance(message, ToolMessage):
            assert message.name != "write_file"
    # 无论 name 字段如何，主图上下文里不能多出任何子 Agent 内部的工具结果
    all_tool_messages = [m for m in result["messages"] if isinstance(m, ToolMessage)]
    assert len(all_tool_messages) == 1

    # b. 隔离的是上下文，不是存储：文件确实写入 VFS backend
    read_result = backend.read("/demo/prd/brainstorm.md")
    assert not read_result.error
    assert read_result.file_data["content"] == brainstorm_content

    # c. 主图恰好一条 task 对应的 ToolMessage，且为结构化阶段报告
    assert len(task_messages := [m for m in all_tool_messages if m.name == "task"]) == 1
    report = PrdPhaseReport.model_validate_json(task_messages[0].content)
    assert report.direction == "面向个人知识管理的工作台"
    assert task_messages[0].content == report.model_dump_json()


def test_orchestrator_prompt_declares_delegation_conventions():
    # 只通过 task 工具委派给具名子 Agent，绝不自行撰写阶段文档
    assert "task" in ORCHESTRATOR_INSTRUCTIONS
    assert "prd-agent" in ORCHESTRATOR_INSTRUCTIONS
    assert "bdd-agent" in ORCHESTRATOR_INSTRUCTIONS
    assert "sdd-agent" in ORCHESTRATOR_INSTRUCTIONS
    assert "绝不自行撰写阶段文档" in ORCHESTRATOR_INSTRUCTIONS
    # 委派消息必须自带完整上下文
    assert "完整上下文" in ORCHESTRATOR_INSTRUCTIONS
    assert "用户意见原文" in ORCHESTRATOR_INSTRUCTIONS
    # 子 Agent 在隔离上下文中工作，编排者只消费其返回的（结构化）摘要
    assert "隔离上下文" in ORCHESTRATOR_INSTRUCTIONS
    assert "结构化" in ORCHESTRATOR_INSTRUCTIONS
    assert "不复述" in ORCHESTRATOR_INSTRUCTIONS

    # SDD 转异步委派后，「委派纪律（task）」一节只允许同步 task 工具
    # 指向 prd-agent / bdd-agent（须钉住新现实，防止旧文本回潮）
    delegation_section = ORCHESTRATOR_INSTRUCTIONS[
        ORCHESTRATOR_INSTRUCTIONS.index("## 委派纪律（task）"):
        ORCHESTRATOR_INSTRUCTIONS.index("## 异步纪律（async task）")
    ]
    assert "`prd-agent` / `bdd-agent`" in delegation_section
    assert "sdd-agent" not in delegation_section
    assert "SDD 阶段走异步委派" in delegation_section
    assert "start_async_task" in delegation_section
