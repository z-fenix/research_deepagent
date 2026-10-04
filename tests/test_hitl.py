"""HITL 接线验证：门禁工具触发中断、敏感工具配置、降级模式。

中断呈现形态（.venv 实证，deepagents 0.7.13 + langgraph）：invoke 结果
含 `result["__interrupt__"]`——`langgraph.types.Interrupt` 的 list，
其 `.value` 为 dict，含 `action_requests`（name/args/description）与
`review_configs`（action_name/allowed_decisions）。
"""

import itertools

import pytest
from langchain_core.messages import AIMessage
from langgraph.store.memory import InMemoryStore

from tests.test_subagent_delegation import _FakeToolChatModel


def _gate_call_model(provider: str) -> _FakeToolChatModel:
    gate_call = AIMessage(
        content="PRD 已完成，请求门禁审批。",
        tool_calls=[{
            "name": "request_phase_approval",
            "args": {"phase": "prd", "summary": "3 条需求"},
            "id": "call_gate_1",
            "type": "tool_call",
        }],
    )
    final = AIMessage(content="等待门禁结果。")
    return _FakeToolChatModel(
        provider=provider,
        messages=iter(itertools.chain([gate_call], itertools.repeat(final))),
    )


@pytest.fixture()
def hitl_graph(monkeypatch, tmp_path):
    monkeypatch.setenv("DOCS_WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    import importlib

    import research_deepagent.agent as agent_module

    importlib.reload(agent_module)
    graph = agent_module.build_deep_agent(
        model=_gate_call_model(agent_module.MODEL_PROVIDER),
        backend=agent_module.create_backend(root=tmp_path / "workspace"),
        # 双层记忆路由需要 BaseStore（生产由平台注入，测试显式传入空 store）
        store=InMemoryStore(),
    )
    return agent_module, graph


def test_gate_tool_triggers_interrupt(hitl_graph):
    _, graph = hitl_graph
    result = graph.invoke({"messages": [{"role": "user", "content": "开始 PRD 阶段"}]})
    # 形态实证：result["__interrupt__"] 为 Interrupt list，value 是 dict
    assert "__interrupt__" in result
    interrupts = result["__interrupt__"]
    assert interrupts, "门禁工具调用应产生中断"
    value = interrupts[0].value
    # 内容断言：action request 即门禁工具，allowed_decisions 仅 respond
    request = value["action_requests"][0]
    assert request["name"] == "request_phase_approval"
    assert request["args"] == {"phase": "prd", "summary": "3 条需求"}
    config = value["review_configs"][0]
    assert config["allowed_decisions"] == ["respond"]
    # 门禁无副作用：工具未真正执行，不产生 ToolMessage 结果
    assert all(
        getattr(msg, "type", None) != "tool" or getattr(msg, "name", "") != "request_phase_approval"
        for msg in result["messages"]
    )


def test_interrupt_on_includes_sensitive_tools(hitl_graph):
    agent_module, _ = hitl_graph
    cfg = agent_module._build_interrupt_on()
    assert cfg["request_phase_approval"] == {"allowed_decisions": ["respond"]}
    assert cfg["delete"] == {"allowed_decisions": ["approve", "reject"]}
    for tool in agent_module.pencli_tools:
        assert cfg[tool.name] == {"allowed_decisions": ["approve", "reject"]}


def test_degraded_mode_without_pencli(monkeypatch, tmp_path):
    # pencli_tools 为空（MCP 不可用）时不报错、不含 pencli 条目
    monkeypatch.setenv("DOCS_WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    import importlib

    import research_deepagent.agent as agent_module

    importlib.reload(agent_module)
    agent_module.pencli_tools = []
    assert not [k for k in agent_module._build_interrupt_on() if k.startswith("pencli")]
