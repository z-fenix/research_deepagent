"""PRD→BDD→SDD document-generation graph, served by `agentseek-api dev`.

Pure deepagents + LangChain. The orchestrator delegates the PRD/BDD phases to
two sync sub-agents via the `task` tool; the SDD phase is delegated to a
standalone graph through AsyncSubAgent (in-process ASGI transport, five
remote-control tools). Documents land under DOCS_WORKSPACE_DIR via the
pluggable VFS backends (DOCS_BACKEND, default disk).
"""

from __future__ import annotations

import os
import warnings
from datetime import datetime  # noqa: F401 - kept per SDD brief head
from pathlib import Path

from deepagents import AsyncSubAgent, create_deep_agent
from deepagents.backends import CompositeBackend, StoreBackend
from deepagents.backends.utils import create_file_data  # noqa: F401 - re-exported for tests
from deepagents.profiles import (
    GeneralPurposeSubagentProfile,
    HarnessProfile,
    register_harness_profile,
)
from dotenv import load_dotenv
from langchain.agents.middleware import TodoListMiddleware
from langchain.chat_models import init_chat_model

from research_deepagent.context import (
    PipelineContext,
    resolve_assistant_id,
    resolve_user_id,
)
from research_deepagent.prompts import (
    BDD_AGENT_INSTRUCTIONS,
    ORCHESTRATOR_INSTRUCTIONS,
    PRD_AGENT_INSTRUCTIONS,
)
from research_deepagent.store import default_store
from research_deepagent.schemas import (
    BddPhaseReport,
    PrdPhaseReport,
)
from research_deepagent.tools import request_phase_approval, tavily_search
from research_deepagent.validators.lc_tools import (
    validate_user_stories,
)
from research_deepagent.vfs import create_backend

# PENCLI_MCP_URL is read at mcp_tools import time, so .env must be loaded
# before the import below (controller-mandated import order).
load_dotenv()

from research_deepagent.mcp_tools import load_pencli_tools  # noqa: E402

SUPPORTED_MODEL_PROVIDERS = {
    "openai": "openai",
    "anthropic": "anthropic",
    "google": "google_genai",
    "google_genai": "google_genai",
    "gemini": "google_genai",
}


def _nonempty_env(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    value = value.strip()
    return value or None


def _normalize_provider(provider: str) -> str:
    normalized = provider.strip().replace("-", "_").lower()
    if normalized in SUPPORTED_MODEL_PROVIDERS:
        return SUPPORTED_MODEL_PROVIDERS[normalized]
    supported = ", ".join(sorted({"openai", "anthropic", "google_genai"}))
    raise ValueError(
        f"Unsupported AGENTSEEK_MODEL_PROVIDER={provider!r}. "
        f"Expected one of: {supported}."
    )


def _split_prefixed_model(model_name: str) -> tuple[str | None, str]:
    if ":" not in model_name:
        return None, model_name
    provider_candidate, bare_model = model_name.split(":", maxsplit=1)
    try:
        normalized_provider = _normalize_provider(provider_candidate)
    except ValueError:
        return None, model_name
    return normalized_provider, bare_model


DEFAULT_MODEL_RAW = (
    os.getenv("AGENTSEEK_MODEL")
    or os.getenv("DEEPAGENTS_MODEL")
    or os.getenv("BUB_MODEL")
    or "gpt-4.1-mini"
)
DEFAULT_MODEL_PROVIDER_RAW = os.getenv("AGENTSEEK_MODEL_PROVIDER")
DEFAULT_MODEL_PROVIDER_DEFAULT = "openai"

prefixed_model_provider, DEFAULT_MODEL = _split_prefixed_model(DEFAULT_MODEL_RAW)
if DEFAULT_MODEL_PROVIDER_RAW:
    MODEL_PROVIDER = _normalize_provider(DEFAULT_MODEL_PROVIDER_RAW)
    if prefixed_model_provider and prefixed_model_provider != MODEL_PROVIDER:
        raise ValueError(
            "AGENTSEEK_MODEL provider prefix does not match AGENTSEEK_MODEL_PROVIDER: "
            f"{DEFAULT_MODEL_RAW!r} vs {DEFAULT_MODEL_PROVIDER_RAW!r}."
        )
else:
    MODEL_PROVIDER = prefixed_model_provider or _normalize_provider(DEFAULT_MODEL_PROVIDER_DEFAULT)

# Some OpenAI-compatible gateways can pause for longer than LangChain OpenAI's
# default 120s chunk gap while streaming a large tool-call payload.
_stream_chunk_timeout_env = os.getenv("LANGCHAIN_OPENAI_STREAM_CHUNK_TIMEOUT_S")
STREAM_CHUNK_TIMEOUT_S: float | None = 300.0
if _stream_chunk_timeout_env not in (None, ""):
    try:
        _parsed_timeout = float(_stream_chunk_timeout_env)
    except ValueError:
        warnings.warn(
            "Ignoring invalid LANGCHAIN_OPENAI_STREAM_CHUNK_TIMEOUT_S value; "
            "using the default 300s timeout instead.",
            stacklevel=2,
        )
    else:
        STREAM_CHUNK_TIMEOUT_S = None if _parsed_timeout <= 0 else _parsed_timeout

MODEL_INIT_KWARGS: dict[str, object] = {
    "model": DEFAULT_MODEL,
    "model_provider": MODEL_PROVIDER,
}
if MODEL_PROVIDER == "openai":
    if _nonempty_env("OPENAI_API_KEY"):
        MODEL_INIT_KWARGS["api_key"] = _nonempty_env("OPENAI_API_KEY")
    if _nonempty_env("OPENAI_API_BASE"):
        MODEL_INIT_KWARGS["base_url"] = _nonempty_env("OPENAI_API_BASE")
    MODEL_INIT_KWARGS["stream_chunk_timeout"] = STREAM_CHUNK_TIMEOUT_S
elif MODEL_PROVIDER == "anthropic":
    if _nonempty_env("ANTHROPIC_API_KEY"):
        MODEL_INIT_KWARGS["api_key"] = _nonempty_env("ANTHROPIC_API_KEY")
    if _nonempty_env("ANTHROPIC_API_URL"):
        MODEL_INIT_KWARGS["base_url"] = _nonempty_env("ANTHROPIC_API_URL")
elif MODEL_PROVIDER == "google_genai":
    if _nonempty_env("GOOGLE_API_KEY"):
        MODEL_INIT_KWARGS["api_key"] = _nonempty_env("GOOGLE_API_KEY")
    if _nonempty_env("GOOGLE_API_BASE"):
        MODEL_INIT_KWARGS["base_url"] = _nonempty_env("GOOGLE_API_BASE")

model = init_chat_model(**MODEL_INIT_KWARGS)

# Disable deepagents' auto-added default `general-purpose` subagent so the
# orchestrator can only delegate to the named phase sub-agents below.
# Registration is global and additive (re-registration on test reload merges
# idempotently), keyed by the resolved model provider.
register_harness_profile(
    MODEL_PROVIDER,
    HarnessProfile(general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False)),
)

WORKSPACE_ROOT = Path(os.getenv("DOCS_WORKSPACE_DIR", "./workspace")).resolve()
WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)

pencli_tools = load_pencli_tools()
if pencli_tools:
    print(f"[agent] pencli MCP tools loaded: {[t.name for t in pencli_tools]}")
else:
    print("[agent] running without pencli MCP tools (degraded)")

# 门禁工具：HITL respond-only 中断（真实结果由人工 respond 决策提供）。
# Task 4 的提示词契约引用此常量。
GATE_TOOL = "request_phase_approval"


def _build_interrupt_on() -> dict:
    """中断配置：门禁工具 respond-only；pencli 敏感工具与 delete 需人工 approve/reject。

    pencli 工具名构建时从 pencli_tools 动态取（MCP 不可用即降级模式下该段为空）。
    """
    cfg = {
        GATE_TOOL: {"allowed_decisions": ["respond"]},
        "delete": {"allowed_decisions": ["approve", "reject"]},
    }
    for tool in pencli_tools:
        cfg[tool.name] = {"allowed_decisions": ["approve", "reject"]}
    return cfg

prd_agent = {
    "name": "prd-agent",
    "description": (
        "PRD 阶段 sub-agent：根据用户需求做头脑风暴并产出正式 PRD。"
        "委派时必须提供项目 slug 和用户需求（或修改意见）。"
    ),
    "system_prompt": PRD_AGENT_INSTRUCTIONS,
    "response_format": PrdPhaseReport,
    "tools": [tavily_search, *pencli_tools],
}

bdd_agent = {
    "name": "bdd-agent",
    "description": (
        "BDD 阶段 sub-agent：依据已确认的 PRD 产出严格闭合的用户故事并用"
        "校验器强制闭合规则。委派时必须提供项目 slug。"
    ),
    "system_prompt": BDD_AGENT_INSTRUCTIONS,
    "response_format": BddPhaseReport,
    "tools": [validate_user_stories],
}

# SDD 阶段改为异步委派：AsyncSubAgent 条目由 create_deep_agent 按
# "graph_id" in spec 识别并分流到 AsyncSubAgentMiddleware（五个 async task
# 工具）。graph_id 指向 Task 1 注册的独立 sdd 图（langgraph.json 键
# "sdd-agent"，模块 research_deepagent.sdd_graph，其顶层声明
# response_format=SddPhaseReport）；不传 url 走 ASGI 进程内传输（同部署）。
sdd_async_agent = AsyncSubAgent(
    name="sdd-agent",
    description=(
        "SDD 阶段 sub-agent：依据已确认的 BDD 用户故事逐条产出系统设计文档"
        "与追溯矩阵并用校验器检查。委派时必须提供项目 slug。"
        "后台异步执行，产出经 check_async_task 回收。"
    ),
    graph_id="sdd-agent",
)


def _cap_recursion(graph, default_limit: int = 100):
    """Cap the graph's default recursion depth.

    deepagents/langchain 把默认 recursion_limit 硬编码为 9999:假模型或失控
    循环会近乎无限迭代(每步还全量序列化历史),曾把 WSL 吃到全局 OOM(见
    docs/WSL-排查与迁移经验.md 事件三/四)。调用方显式传入的
    config["recursion_limit"] 不受影响。
    """
    def _with_limit(config):
        config = dict(config) if config else {}
        config.setdefault("recursion_limit", default_limit)
        return config

    _orig_invoke = graph.invoke
    _orig_stream = graph.stream

    def invoke(input, config=None, **kwargs):
        return _orig_invoke(input, config=_with_limit(config), **kwargs)

    def stream(input, config=None, **kwargs):
        return _orig_stream(input, config=_with_limit(config), **kwargs)

    graph.invoke = invoke
    graph.stream = stream
    return graph


def _memory_routes() -> dict[str, StoreBackend]:
    """Dual-scope memory routes over the orchestrator's default backend.

    CompositeBackend strips the matched `/memories/<scope>/` prefix, so
    StoreBackend sees keys relative to the scope (e.g. `/preferences.md`).
    Namespace factories resolve identity from the invocation runtime
    (server_info first, context_schema fallback) via research_deepagent.context.
    """
    return {
        "/memories/agent/": StoreBackend(
            namespace=lambda rt: (resolve_assistant_id(rt), "memories"),
        ),
        "/memories/user/": StoreBackend(
            namespace=lambda rt: (resolve_user_id(rt), "memories"),
        ),
    }


MEMORY_SOURCES = ["/memories/agent/AGENTS.md", "/memories/user/preferences.md"]


def build_deep_agent(model, *, backend, subagents=None, store=None, checkpointer=None):
    """Assemble the orchestrator graph; injectable model/backend for tests.

    TodoListMiddleware provides write_todos + todos state for planning;
    planning itself stays at the orchestrator level (named sub-agents keep
    their own middleware stacks and do not track the shared todo list).
    skills=["/skills/"] mounts the workspace skills directory (content lands
    in Task 3); a missing directory only logs a warning (verified empirically
    against deepagents 0.7.13).

    Long-term memory: `backend` is wrapped in a CompositeBackend routing
    `/memories/agent/` (assistant-scoped, shared across users) and
    `/memories/user/` (user_id-scoped) to a StoreBackend; MemoryMiddleware
    loads MEMORY_SOURCES into the system prompt each run (missing files are
    skipped). `store` is the LangGraph BaseStore backing those namespaces;
    when omitted, a persistent local default is built via
    `research_deepagent.store.default_store` — the serving runtime (agentseek
    dev) does NOT inject a store, and `get_store()` returning None used to
    crash every run inside MemoryMiddleware.before_agent
    (AttributeError "'NoneType' object has no attribute 'get'").
    `context_schema=PipelineContext` lets callers scope per-user via
    `graph.invoke(..., context=PipelineContext(user_id=...))`.

    `checkpointer` is a test-only passthrough to `create_deep_agent` (default
    None: production leaves checkpointing to the platform, which injects its
    own). Empirically required for HITL resume — `Command(resume=...)` raises
    "Cannot use Command(resume=...) without checkpointer" on a bare graph.
    """
    return create_deep_agent(
        model=model,
        tools=[request_phase_approval],
        system_prompt=ORCHESTRATOR_INSTRUCTIONS,
        subagents=subagents if subagents is not None else [prd_agent, bdd_agent, sdd_async_agent],
        backend=CompositeBackend(default=backend, routes=_memory_routes()),
        context_schema=PipelineContext,
        store=store if store is not None else default_store(),
        memory=MEMORY_SOURCES,
        interrupt_on=_build_interrupt_on(),
        middleware=[TodoListMiddleware()],
        skills=["/skills/"],
        checkpointer=checkpointer,
    )
    return _cap_recursion(graph)


graph = build_deep_agent(model=model, backend=create_backend(root=WORKSPACE_ROOT))
