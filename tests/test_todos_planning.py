"""任务规划能力（TodoListMiddleware）的接线与行为验证。

覆盖三件事：
1. 图构建后 todos 进入状态 schema、write_todos 可被模型调用并写入状态；
2. orchestrator 提示词包含任务规划与分解规范的关键约定；
3. 图不自带 Checkpointer（持久化由 AgentSeek 平台按 thread_id 提供）。
"""

import itertools

import pytest
from langchain_core.language_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from research_deepagent.prompts import ORCHESTRATOR_INSTRUCTIONS

PLANNING_TODO_PAYLOAD = [
    {"content": "PRD 阶段：brainstorm.md 与 prd.md", "status": "in_progress"},
    {"content": "BDD 阶段：user_stories.md", "status": "pending"},
    {"content": "SDD 阶段：逐故事 SDD 与追溯矩阵", "status": "pending"},
]


class _FakeToolChatModel(GenericFakeChatModel):
    """GenericFakeChatModel 默认未实现 bind_tools，测试中绑定请求原样返回自身。"""

    def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
        return self


def _make_fake_model() -> GenericFakeChatModel:
    """第一回合发起 write_todos 调用，第二回合给最终回答。"""
    tool_call_message = AIMessage(
        content="",
        tool_calls=[
            {
                "name": "write_todos",
                "args": {"todos": PLANNING_TODO_PAYLOAD},
                "id": "call_write_todos_1",
                "type": "tool_call",
            }
        ],
    )
    final_message = AIMessage(content="计划已写好，开始执行 PRD 阶段。")
    # _stream 路径会额外拉取消息；工具调用回合结束后图会因收到无工具调用的回复而停止，
    # 因此尾部可安全地无限供给最终回答
    return _FakeToolChatModel(
        messages=iter(
            itertools.chain([tool_call_message], itertools.repeat(final_message))
        )
    )


@pytest.fixture()
def built_graph(monkeypatch, tmp_path):
    monkeypatch.setenv("DOCS_WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    import importlib

    import research_deepagent.agent as agent_module

    importlib.reload(agent_module)
    graph = agent_module.build_deep_agent(
        model=_make_fake_model(),
        backend=agent_module.create_backend(root=tmp_path / "workspace"),
    )
    return agent_module, graph


def test_build_deep_agent_exposes_todos_in_state_schema(built_graph):
    _, graph = built_graph
    annotations = getattr(graph.builder.state_schema, "__annotations__", {})
    assert "todos" in annotations


def test_write_todos_call_persists_into_state(built_graph):
    _, graph = built_graph
    result = graph.invoke(
        {"messages": [{"role": "user", "content": "我想做一个团队任务看板应用"}]}
    )
    assert result["todos"] == PLANNING_TODO_PAYLOAD


def test_graph_has_no_own_checkpointer(built_graph):
    _, graph = built_graph
    # 持久化由 agentseek-api 平台（SEEKDB_EMBED）按 thread_id 注入，图自身不配置
    assert graph.checkpointer is None


def test_orchestrator_prompt_declares_planning_conventions():
    # 分解粒度挂钩验收产物
    assert "write_todos" in ORCHESTRATOR_INSTRUCTIONS
    assert "每条用户故事一项" in ORCHESTRATOR_INSTRUCTIONS
    # 状态流转纪律：同一时刻恰好一个 in_progress，完成需产物证据
    assert "恰好一个" in ORCHESTRATOR_INSTRUCTIONS
    assert "in_progress" in ORCHESTRATOR_INSTRUCTIONS
    assert "产物" in ORCHESTRATOR_INSTRUCTIONS
    # 与 project_state.md 一致
    assert "project_state.md" in ORCHESTRATOR_INSTRUCTIONS
