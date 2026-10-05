"""SDD 独立图 + langgraph.json 注册（task06：SDD 阶段转 Async Subagent）。

覆盖六件事：
1. langgraph.json 可解析，且同时注册 research 与 sdd-agent 两个图；
2. sdd 独立图可构建（fake 模型注入 + 临时 backend，冒烟）；
3. fake 模型返回 SddPhaseReport JSON 时，顶层 response_format 接线生效。
   已在 .venv 实证最终形态：图状态以 ``structured_response`` 承载
   SddPhaseReport 实例，最终 AIMessage 为模型原始文本透传——与子 Agent
   经 ToolMessage 的 model_dump_json() 规范化回传形态不同。
4. 编排者的 tool node 暴露五个 async task 工具（SDD 转异步委派）；
5. 编排者图 state schema 含 ``async_tasks`` 注解（AsyncSubAgentState）；
6. ORCHESTRATOR_INSTRUCTIONS 声明异步纪律关键约定（关键词与提示词
   文字严格一致，风格同 planning/delegation 契约测试）。
   编排器 fake 模型与 fixture 复用 tests/test_subagent_delegation.py（命名稳定）。
"""

import importlib
import itertools
import json
from pathlib import Path

import pytest
from langchain_core.language_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from research_deepagent.prompts import ORCHESTRATOR_INSTRUCTIONS
from research_deepagent.schemas import SddPhaseReport

from tests.test_subagent_delegation import built_agent_module, built_graph

REPO_ROOT = Path(__file__).resolve().parents[1]
LANGGRAPH_JSON = REPO_ROOT / "langgraph.json"


class _FakeToolChatModel(GenericFakeChatModel):
    """沿用 tests/test_subagent_delegation.py 的 fake 模式（理由见彼处 docstring）。

    bind_tools 原样返回自身；_get_ls_params 报告与 init_chat_model 产物一致的
    ls_provider（即 agent_module.MODEL_PROVIDER）；model_name 与项目默认模型
    一致（gpt-4.1-mini），保持结构化返回路径与真实运行时一致。
    """

    provider: str = ""
    model_name: str = "gpt-4.1-mini"

    def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
        return self

    def _get_ls_params(self, **kwargs):  # noqa: ANN001, ANN202
        return {"ls_provider": self.provider, "ls_model_name": self.model_name}


@pytest.fixture()
def sdd_graph_module(monkeypatch, tmp_path):
    """隔离环境变量后导入 sdd_graph 模块（其内部会导入 agent 模块）。"""
    monkeypatch.setenv("DOCS_WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    import research_deepagent.sdd_graph as sdd_graph_module

    importlib.reload(sdd_graph_module)
    return sdd_graph_module


def _make_fake_model(provider: str) -> _FakeToolChatModel:
    return _FakeToolChatModel(
        provider=provider,
        messages=iter([AIMessage(content="SDD 阶段完成。")]),
    )


def test_langgraph_json_registers_research_and_sdd_agent():
    config = json.loads(LANGGRAPH_JSON.read_text(encoding="utf-8"))
    graphs = config["graphs"]
    assert set(graphs) == {"research", "sdd-agent"}
    assert graphs["research"] == "./src/research_deepagent/agent.py:graph"
    assert graphs["sdd-agent"] == "./src/research_deepagent/sdd_graph.py:graph"


def test_sdd_graph_builds_with_fake_model_and_tmp_backend(sdd_graph_module, tmp_path):
    import research_deepagent.agent as agent_module

    graph = sdd_graph_module.build_sdd_graph(
        model=_make_fake_model(agent_module.MODEL_PROVIDER),
        backend=sdd_graph_module.create_backend(
            name="memory", root=tmp_path / "workspace"
        ),
    )
    # 冒烟：图可构建且具备基本的模型/工具节点结构
    assert {"model", "tools"} <= set(graph.builder.nodes)
    # langgraph.json 注册的模块级 graph（复用 agent.model 与 WORKSPACE_ROOT）
    # 亦随导入成功构建
    assert sdd_graph_module.graph is not None


def test_sdd_graph_returns_structured_sdd_phase_report(sdd_graph_module, tmp_path):
    """顶层 response_format 接线验证。

    fake 模型返回 SddPhaseReport JSON 时，图状态以 structured_response 承载
    解析后的 SddPhaseReport 实例；最终 AIMessage 为模型原始文本透传（非
    model_dump_json() 规范化重序列化）——与子 Agent ToolMessage 回传形态
    不同，已在 .venv 实证。
    """
    import research_deepagent.agent as agent_module

    scripted_report = (
        '{"sdd_files": ["demo/sdd/sdd-1.md", "demo/sdd/traceability.md"],'
        ' "test_case_count": 3,'
        ' "test_cases_by_type": {"unit": 2, "integration": 1},'
        ' "validation_summary": "✅ 追溯完整",'
        ' "unresolved_violations": []}'
    )
    model = _FakeToolChatModel(
        provider=agent_module.MODEL_PROVIDER,
        messages=iter(itertools.repeat(AIMessage(content=scripted_report))),
    )
    graph = sdd_graph_module.build_sdd_graph(
        model=model,
        backend=sdd_graph_module.create_backend(
            name="memory", root=tmp_path / "workspace"
        ),
    )

    result = graph.invoke(
        {"messages": [{"role": "user", "content": "SDD 阶段，slug=demo"}]}
    )

    report = result["structured_response"]
    assert isinstance(report, SddPhaseReport)
    assert report.sdd_files == ["demo/sdd/sdd-1.md", "demo/sdd/traceability.md"]
    assert report.test_case_count == 3
    assert report.test_cases_by_type == {"unit": 2, "integration": 1}
    assert report.validation_summary == "✅ 追溯完整"
    assert report.unresolved_violations == []
    # 最终 AIMessage 为原始文本透传（非规范化重序列化）
    assert result["messages"][-1].content == scripted_report


ASYNC_TASK_TOOLS = (
    "start_async_task",
    "check_async_task",
    "update_async_task",
    "cancel_async_task",
    "list_async_tasks",
)


def test_orchestrator_exposes_five_async_task_tools(built_graph):
    """SDD 转异步委派：编排者 tool node 暴露五个 async task 工具。"""
    _, graph = built_graph
    tools_by_name = graph.builder.nodes["tools"].runnable.tools_by_name
    for name in ASYNC_TASK_TOOLS:
        assert name in tools_by_name


def test_orchestrator_state_schema_declares_async_tasks(built_graph):
    """AsyncSubAgentMiddleware 挂载后，图 state schema 含 async_tasks 注解。"""
    _, graph = built_graph
    assert "async_tasks" in graph.builder.state_schema.__annotations__


def test_sdd_async_subagent_spec(built_agent_module):
    """默认 subagents 中的 sdd 条目为 AsyncSubAgent（graph_id + HTTP url）。

    create_deep_agent 按 ``"graph_id" in spec`` 识别异步条目。url 必填：
    agentseek dev 不是 langgraph-api 服务器，ASGI 进程内传输拿到的 app 为
    None（2026-10-04 实测 "'NoneType' object is not callable"），必须走
    HTTP 传输自指 agentseek 自身的 Agent Protocol 端点。
    """
    agent_module, _ = built_agent_module
    spec = agent_module.sdd_async_agent
    assert spec["name"] == "sdd-agent"
    assert spec["graph_id"] == "sdd-agent"
    assert spec["url"] == "http://127.0.0.1:2024"
    assert "后台异步执行" in spec["description"]
    assert "check_async_task" in spec["description"]
    # 同步 prd/bdd 字典不携带 graph_id（仍走同步 task 工具）
    assert "graph_id" not in agent_module.prd_agent
    assert "graph_id" not in agent_module.bdd_agent


def test_sdd_agent_url_env_override(monkeypatch):
    """AGENTSEEK_API_URL 覆盖 sdd-agent 的自指端点（端口/主机可配）。"""
    import importlib

    import research_deepagent.agent as agent_module

    monkeypatch.setenv("AGENTSEEK_API_URL", "http://127.0.0.1:9999")
    reloaded = importlib.reload(agent_module)
    assert reloaded.sdd_async_agent["url"] == "http://127.0.0.1:9999"
    importlib.reload(agent_module)  # 还原，避免影响后续测试


def test_orchestrator_prompt_declares_async_discipline():
    """ORCHESTRATOR_INSTRUCTIONS 声明异步委派与异步纪律关键约定。"""
    # 流程 SDD 段：SDD 阶段通过 start_async_task 后台执行，启动后立即
    # 汇报 task_id 并结束回合
    assert 'start_async_task(subagent_type="sdd-agent")' in ORCHESTRATOR_INSTRUCTIONS
    assert "task_id" in ORCHESTRATOR_INSTRUCTIONS
    assert "结束回合" in ORCHESTRATOR_INSTRUCTIONS
    # check 到 success 后校验产物、更新 project_state.md 与 todos、门禁汇报
    assert "sdd-US-*.md" in ORCHESTRATOR_INSTRUCTIONS
    assert "traceability.md" in ORCHESTRATOR_INSTRUCTIONS
    assert "phase=done" in ORCHESTRATOR_INSTRUCTIONS
    assert "gate=awaiting" in ORCHESTRATOR_INSTRUCTIONS
    # 新增「异步纪律（async task）」一节，紧跟「委派纪律（task）」之后
    assert "## 异步纪律（async task）" in ORCHESTRATOR_INSTRUCTIONS
    assert (
        ORCHESTRATOR_INSTRUCTIONS.index("## 委派纪律（task）")
        < ORCHESTRATOR_INSTRUCTIONS.index("## 异步纪律（async task）")
        < ORCHESTRATOR_INSTRUCTIONS.index("## 流程")
    )
    # 不主动轮询：无用户提问不调用 check_async_task
    assert "不主动轮询" in ORCHESTRATOR_INSTRUCTIONS
    assert "无用户提问不调用 `check_async_task`" in ORCHESTRATOR_INSTRUCTIONS
    # 报告进度前必须先调用 check_async_task / list_async_tasks
    assert "`check_async_task` / `list_async_tasks`" in ORCHESTRATOR_INSTRUCTIONS
    assert "不引用对话历史中的旧状态" in ORCHESTRATOR_INSTRUCTIONS
    # 始终使用完整 task_id，不截断、不缩写、不改写
    assert "始终使用完整 task_id" in ORCHESTRATOR_INSTRUCTIONS
    assert "不截断、不缩写、不改写" in ORCHESTRATOR_INSTRUCTIONS
    # 修订意见经 update_async_task 注入同一任务
    assert "update_async_task" in ORCHESTRATOR_INSTRUCTIONS
    assert "向同一任务注入新指令" in ORCHESTRATOR_INSTRUCTIONS
