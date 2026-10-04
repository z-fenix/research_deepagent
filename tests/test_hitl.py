"""HITL 接线验证：门禁工具触发中断、敏感工具配置、降级模式。

中断呈现形态（.venv 实证，deepagents 0.7.13 + langgraph）：invoke 结果
含 `result["__interrupt__"]`——`langgraph.types.Interrupt` 的 list，
其 `.value` 为 dict，含 `action_requests`（name/args/description）与
`review_configs`（action_name/allowed_decisions）。
"""

import itertools

import pytest
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from langgraph.types import Command

from tests.test_subagent_delegation import _FakeToolChatModel


def _gate_then_final_model(provider: str, final_content: str) -> _FakeToolChatModel:
    """回合 1: 门禁工具调用 → (中断) → 回合 2: 恢复后最终回答。

    同一模型实例跨两次 invoke 使用：中断前消费 gate_call，恢复后消费
    final（后续 repeat 兜底，防止意外多轮）。
    """
    gate_call = AIMessage(
        content="PRD 已完成，请求门禁审批。",
        tool_calls=[{
            "name": "request_phase_approval",
            "args": {"phase": "prd", "summary": "3 条需求"},
            "id": "call_gate_1",
            "type": "tool_call",
        }],
    )
    final = AIMessage(content=final_content)
    return _FakeToolChatModel(
        provider=provider,
        messages=iter(itertools.chain([gate_call], itertools.repeat(final))),
    )


def _gate_thread_config() -> dict:
    return {"configurable": {"thread_id": "gate-resume-test"}}


@pytest.fixture()
def hitl_graph(monkeypatch, tmp_path):
    monkeypatch.setenv("DOCS_WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    import importlib

    import research_deepagent.agent as agent_module

    importlib.reload(agent_module)
    graph = agent_module.build_deep_agent(
        model=_gate_then_final_model(agent_module.MODEL_PROVIDER, "门禁已通过，推进 BDD 阶段。"),
        backend=agent_module.create_backend(root=tmp_path / "workspace"),
        # 双层记忆路由需要 BaseStore（生产由平台注入，测试显式传入空 store）
        store=InMemoryStore(),
        # 恢复路径需要 checkpointer（实证：无 checkpointer 时 Command(resume=...)
        # 抛 "Cannot use Command(resume=...) without checkpointer"；生产路径
        # 由平台注入，此处为测试显式注入 InMemorySaver）
        checkpointer=InMemorySaver(),
    )
    return agent_module, graph


def test_gate_tool_triggers_interrupt(hitl_graph):
    _, graph = hitl_graph
    result = graph.invoke(
        {"messages": [{"role": "user", "content": "开始 PRD 阶段"}]},
        _gate_thread_config(),
    )
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


def test_orchestrator_prompt_declares_gate_flow():
    from research_deepagent.prompts import ORCHESTRATOR_INSTRUCTIONS as P
    # 门禁中断：汇报后调用门禁工具并暂停，不再"结束回合等待"
    assert "request_phase_approval" in P
    assert "结束回合等待" not in P.split("## 流程")[1].split("## 汇报要求")[0]
    # 解析规则：同意关键词 → approved；其余 → revise 带原文
    gate_section = P.split("## 流程")[1]
    assert "同意" in gate_section and "revise" in gate_section
    assert "意见原文" in gate_section
    # Review Focus 2：否定语义示例必须按 revise 解析
    assert "不同意删除" in gate_section
    # 拒绝反馈：敏感工具被拒时如实上报不重试
    assert "重试" in gate_section or "重试" in P


def test_orchestrator_prompt_declares_memory_conventions():
    from research_deepagent.prompts import ORCHESTRATOR_INSTRUCTIONS as P
    assert "## 长期记忆（memory）" in P
    assert "/memories/agent/AGENTS.md" in P and "/memories/user/preferences.md" in P
    assert "edit_file" in P and "保留" in P  # 禁止 write_file 整体覆盖既有记忆


def test_degraded_mode_without_pencli(monkeypatch, tmp_path):
    # pencli_tools 为空（MCP 不可用）时不报错、不含 pencli 条目
    monkeypatch.setenv("DOCS_WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    import importlib

    import research_deepagent.agent as agent_module

    importlib.reload(agent_module)
    agent_module.pencli_tools = []
    assert not [k for k in agent_module._build_interrupt_on() if k.startswith("pencli")]


def test_gate_resume_with_approve(hitl_graph):
    _, graph = hitl_graph
    config = _gate_thread_config()
    first = graph.invoke(
        {"messages": [{"role": "user", "content": "开始 PRD 阶段"}]},
        config,
    )
    assert "__interrupt__" in first, "前置条件：门禁工具调用应产生中断"

    resumed = graph.invoke(
        Command(resume={"decisions": [{"type": "respond", "message": "同意，继续"}]}),
        config,
    )
    # 1) 人工批复原文无损回传：request_phase_approval 的 ToolMessage 内容
    #    == respond 消息原文（恢复接线只搬运文本，同意/revise 的语义解析
    #    是编排者模型的事，见 orchestrator prompt）
    tool_messages = [
        msg for msg in resumed["messages"]
        if getattr(msg, "type", None) == "tool"
        and getattr(msg, "name", "") == "request_phase_approval"
    ]
    assert len(tool_messages) == 1
    assert tool_messages[0].content == "同意，继续"
    # 2) 图正常结束：恢复后消费回合 2 的最终 AIMessage，且不再有待决中断
    assert any(
        isinstance(msg, AIMessage) and msg.content == "门禁已通过，推进 BDD 阶段。"
        for msg in resumed["messages"]
    )
    assert "__interrupt__" not in resumed


def test_gate_resume_with_revision(hitl_graph):
    _, graph = hitl_graph
    config = _gate_thread_config()
    first = graph.invoke(
        {"messages": [{"role": "user", "content": "开始 PRD 阶段"}]},
        config,
    )
    assert "__interrupt__" in first, "前置条件：门禁工具调用应产生中断"

    revision = "把 REQ-003 的优先级改成 P1"
    resumed = graph.invoke(
        Command(resume={"decisions": [{"type": "respond", "message": revision}]}),
        config,
    )
    # 意见原文逐字回传（接线层只验证无损；不因消息不含"同意"二字而走
    # approved 路径——解析为 revise 属模型行为）
    tool_messages = [
        msg for msg in resumed["messages"]
        if getattr(msg, "type", None) == "tool"
        and getattr(msg, "name", "") == "request_phase_approval"
    ]
    assert len(tool_messages) == 1
    assert tool_messages[0].content == revision
    assert "__interrupt__" not in resumed
