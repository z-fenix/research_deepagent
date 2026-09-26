"""SDD 独立图 + langgraph.json 注册（task06：SDD 阶段转 Async Subagent）。

覆盖三件事：
1. langgraph.json 可解析，且同时注册 research 与 sdd-agent 两个图；
2. sdd 独立图可构建（fake 模型注入 + 临时 backend，冒烟）；
3. fake 模型返回 SddPhaseReport JSON 时，顶层 response_format 接线生效。
   已在 .venv 实证最终形态：图状态以 ``structured_response`` 承载
   SddPhaseReport 实例，最终 AIMessage 为模型原始文本透传——与子 Agent
   经 ToolMessage 的 model_dump_json() 规范化回传形态不同。
"""

import importlib
import itertools
import json
from pathlib import Path

import pytest
from langchain_core.language_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from research_deepagent.schemas import SddPhaseReport

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
