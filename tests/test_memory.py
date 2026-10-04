"""双层长期记忆的路由与隔离验证。

- /memories/user/ 按 user_id 隔离：A 的偏好不注入 B 的 system prompt；
- /memories/agent/ 跨用户共享：AGENTS.md 内容对所有用户注入；
- 缺失记忆文件跳过不报错；
- store 经 build_deep_agent(store=...) 透传给图（种子内容出现在
  system prompt 即证明路由与透传同时生效）。

路由映射（.venv 实证，deepagents 0.7.13）：CompositeBackend 命中
`/memories/<scope>/` 前缀后剥离前缀并保证剩余路径以 "/" 开头，故
`/memories/user/preferences.md` 对应 StoreBackend key `/preferences.md`，
namespace 为 `(user_id, "memories")`。
"""

import itertools

import pytest
from langchain_core.messages import AIMessage, SystemMessage
from langgraph.store.memory import InMemoryStore

from research_deepagent.context import PipelineContext
from tests.test_subagent_delegation import _FakeToolChatModel

PREF_A = "# 用户偏好\n- 代码注释用中文"
AGENTS_MD = "# Agent 指令\n- 汇报用中文"


class _SystemCapturingChatModel(_FakeToolChatModel):
    """在 _FakeToolChatModel 之上捕获每回合收到的 system message 文本。

    实现同 tests/test_skills.py 已实证的版本：pydantic 字段声明（而非运行时
    属性赋值，否则 GenericFakeChatModel 拒绝未知属性）+ _generate 覆写。
    """

    captured_system_texts: list[str] = []

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):  # noqa: ANN001, ANN003, ANN202
        for message in messages:
            if isinstance(message, SystemMessage):
                self.captured_system_texts.append(_text_blocks(message))
        return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)


def _text_blocks(message) -> str:  # noqa: ANN001
    """拼出 system message 的纯文本（内容可能是 str 或 text block 列表）。"""
    if isinstance(message.content, str):
        return message.content
    return "\n".join(
        block.get("text", "") for block in message.content if isinstance(block, dict)
    )


@pytest.fixture()
def memory_module(monkeypatch, tmp_path):
    """隔离环境变量并 reload agent 模块（模式同 built_agent_module）。"""
    monkeypatch.setenv("DOCS_WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    import importlib

    import research_deepagent.agent as agent_module

    importlib.reload(agent_module)
    return agent_module, tmp_path / "workspace"


def _seeded_store(agent_module):
    store = InMemoryStore()
    # CompositeBackend 剥离 /memories/<scope>/ 前缀 → Store key 为相对路径
    store.put(
        ("local-user", "memories"),
        "/preferences.md",
        agent_module.create_file_data(PREF_A),
    )
    store.put(
        ("research", "memories"),
        "/AGENTS.md",
        agent_module.create_file_data(AGENTS_MD),
    )
    return store


def _build(memory_module, store):
    agent_module, workspace = memory_module
    model = _SystemCapturingChatModel(
        provider=agent_module.MODEL_PROVIDER,
        messages=iter(itertools.repeat(AIMessage(content="好的。"))),
    )
    graph = agent_module.build_deep_agent(
        model=model,
        backend=agent_module.create_backend(root=workspace),
        store=store,
    )
    return graph, model


def test_user_memory_scoped_by_user_id(memory_module):
    """① A 的偏好注入 A 的 system prompt；② 换 user-b 后不注入；③ AGENTS.md 双共享。"""
    agent_module, _ = memory_module
    graph, model = _build(memory_module, _seeded_store(agent_module))

    graph.invoke(
        {"messages": [{"role": "user", "content": "你好"}]},
        context=PipelineContext(user_id="local-user"),
    )
    assert model.captured_system_texts, "fake 模型应至少收到一回合 system message"
    system_text_a = model.captured_system_texts[0]
    assert "代码注释用中文" in system_text_a  # 用户级记忆按 user_id 注入
    assert "汇报用中文" in system_text_a  # agent 级记忆对 A 注入

    graph.invoke(
        {"messages": [{"role": "user", "content": "你好"}]},
        context=PipelineContext(user_id="user-b"),
    )
    system_text_b = model.captured_system_texts[1]
    assert "代码注释用中文" not in system_text_b  # A 的偏好不泄漏给 B（隔离）
    assert "汇报用中文" in system_text_b  # agent 级记忆对 B 同样注入


def test_missing_memory_files_are_skipped(memory_module):
    """④ store 中无记忆文件时不报错（file_not_found 被跳过）。"""
    graph, model = _build(memory_module, InMemoryStore())

    result = graph.invoke(
        {"messages": [{"role": "user", "content": "你好"}]},
        context=PipelineContext(user_id="local-user"),
    )
    assert result["messages"][-1].content == "好的。"
    assert model.captured_system_texts
    system_text = model.captured_system_texts[0]
    assert "代码注释用中文" not in system_text
    assert "汇报用中文" not in system_text


def test_store_passthrough_to_graph(memory_module):
    """store= 透传给图执行上下文：种子内容只经 StoreBackend 路由可达。"""
    agent_module, _ = memory_module
    store = _seeded_store(agent_module)
    graph, model = _build(memory_module, store)

    graph.invoke(
        {"messages": [{"role": "user", "content": "你好"}]},
        context=PipelineContext(user_id="local-user"),
    )
    system_text = model.captured_system_texts[0]
    # memory= 的两个来源都来自 store（default backend 为空磁盘 workspace）
    assert "/memories/user/preferences.md" in system_text
    assert "/memories/agent/AGENTS.md" in system_text
    assert PREF_A in system_text
    assert AGENTS_MD in system_text


def test_build_without_explicit_store_does_not_crash(monkeypatch, tmp_path):
    """回归（2026-10-04 生产事故）：store=None 曾在 MemoryMiddleware.before_agent
    崩溃（AttributeError NoneType.get）——生产接线不得依赖运行时注入 store。"""
    monkeypatch.setenv("DOCS_WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("AGENTSEEK_STORE_PATH", str(tmp_path / "store.db"))
    import importlib

    import research_deepagent.agent as agent_module

    importlib.reload(agent_module)
    model = _SystemCapturingChatModel(messages=iter([AIMessage(content="好的。")]))
    # 生产原样接线：不传 store（修复前此处触发 NoneType.get）
    graph = agent_module.build_deep_agent(
        model=model,
        backend=agent_module.create_backend(root=tmp_path / "workspace"),
    )
    # 预置默认 store（与 build_deep_agent 内部打开的是同一文件）
    seed = agent_module.default_store()
    seed.setup()
    seed.put(("local-user", "memories"), "/preferences.md",
             {"content": "# 用户偏好\n- 代码注释用中文", "encoding": "utf-8"})

    result = graph.invoke(
        {"messages": [{"role": "user", "content": "你好"}]},
        context=PipelineContext(user_id="local-user"),
    )
    assert result["messages"][-1].content == "好的。"
    system_text = "\n".join(model.captured_system_texts)
    assert "代码注释用中文" in system_text  # 默认 store 中的预置偏好已注入
