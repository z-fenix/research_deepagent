"""具名子 Agent 委派边界（禁用 deepagents 默认 general-purpose 子 Agent）。

覆盖两件事：
1. task 工具描述的 "Available agent types" 列表只暴露 prd-agent / bdd-agent /
   sdd-agent 三个具名阶段子 Agent，编排者无法委派给默认附加的
   general-purpose 子 Agent（经 HarnessProfile 关闭）；
2. build_deep_agent 返回的图仍然可构建（冒烟）。
"""

import itertools

import pytest
from langchain_core.language_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

NAMED_SUBAGENTS = ("prd-agent", "bdd-agent", "sdd-agent")


class _FakeToolChatModel(GenericFakeChatModel):
    """GenericFakeChatModel 默认未实现 bind_tools，测试中绑定请求原样返回自身。

    _get_ls_params 报告与 init_chat_model 产物一致的 ls_provider（即
    agent_module.MODEL_PROVIDER），否则 deepagents 的 harness profile 查找
    无法命中 agent.py 注册的配置，测试将无法反映真实图构建行为。
    """

    provider: str = ""

    def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
        return self

    def _get_ls_params(self):  # noqa: ANN202
        return {"ls_provider": self.provider, "ls_model_name": "fake"}


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
def built_graph(monkeypatch, tmp_path):
    monkeypatch.setenv("DOCS_WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    import importlib

    import research_deepagent.agent as agent_module

    importlib.reload(agent_module)
    graph = agent_module.build_deep_agent(
        model=_make_fake_model(agent_module.MODEL_PROVIDER),
        backend=agent_module.create_backend(root=tmp_path / "workspace"),
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
