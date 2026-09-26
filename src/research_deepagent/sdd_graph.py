"""Standalone SDD graph, served as the `sdd-agent` remote graph.

This module registers the SDD phase as an independently served LangGraph
(graph key `sdd-agent` in langgraph.json). The orchestrator delegates to it
remotely via AsyncSubAgent(graph_id="sdd-agent") — dispatched within the same
ASGI deployment, so the serving process already loads agent.py and this
module's import of agent is idempotent.

`response_format=SddPhaseReport` is declared here, at the top level of the
standalone graph: deepagents' AsyncSubAgent spec carries no response_format
field, so the structured phase report can only be produced by the remote
graph itself (its final shape is surfaced as `structured_response` in the
graph state, unlike the sub-agent ToolMessage normalization of the in-process
sub-agents).
"""

from __future__ import annotations

from deepagents import create_deep_agent

from research_deepagent.agent import WORKSPACE_ROOT, model
from research_deepagent.prompts import SDD_AGENT_INSTRUCTIONS
from research_deepagent.schemas import SddPhaseReport
from research_deepagent.validators.lc_tools import validate_traceability
from research_deepagent.vfs import create_backend


def build_sdd_graph(model, *, backend):
    """Assemble the standalone SDD graph; injectable model/backend for tests.

    skills=["/skills/"] 挂载 VFS workspace 的 skills 目录（对应磁盘上的
    <WORKSPACE_ROOT>/skills/<name>/SKILL.md）；目录缺失仅告警不报错
    （deepagents 0.7.13 实证）。
    """
    return create_deep_agent(
        model=model,
        system_prompt=SDD_AGENT_INSTRUCTIONS,
        tools=[validate_traceability],
        backend=backend,
        response_format=SddPhaseReport,
        skills=["/skills/"],
    )


graph = build_sdd_graph(model=model, backend=create_backend(root=WORKSPACE_ROOT))
