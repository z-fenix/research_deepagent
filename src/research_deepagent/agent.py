"""PRD→BDD→SDD document-generation graph, served by `agentseek-api dev`.

Pure deepagents + LangChain. The orchestrator delegates to three phase
sub-agents (PRD / BDD / SDD); documents land on the real disk under
DOCS_WORKSPACE_DIR via FilesystemBackend.
"""

from __future__ import annotations

import os
import warnings
from datetime import datetime  # noqa: F401 - kept per SDD brief head
from pathlib import Path

from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend
from dotenv import load_dotenv
from langchain.chat_models import init_chat_model

from research_deepagent.prompts import (
    BDD_AGENT_INSTRUCTIONS,
    ORCHESTRATOR_INSTRUCTIONS,
    PRD_AGENT_INSTRUCTIONS,
    SDD_AGENT_INSTRUCTIONS,
    TASK_DESCRIPTION_PREFIX,
)
from research_deepagent.tools import tavily_search
from research_deepagent.validators.lc_tools import (
    validate_traceability,
    validate_user_stories,
)

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

WORKSPACE_ROOT = Path(os.getenv("DOCS_WORKSPACE_DIR", "./workspace")).resolve()
WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)

pencli_tools = load_pencli_tools()
if pencli_tools:
    print(f"[agent] pencli MCP tools loaded: {[t.name for t in pencli_tools]}")
else:
    print("[agent] running without pencli MCP tools (degraded)")

prd_agent = {
    "name": "prd-agent",
    "description": (
        "PRD 阶段 sub-agent：根据用户需求做头脑风暴并产出正式 PRD。"
        "委派时必须提供项目 slug 和用户需求（或修改意见）。"
    ),
    "system_prompt": PRD_AGENT_INSTRUCTIONS,
    "tools": [tavily_search, *pencli_tools],
}

bdd_agent = {
    "name": "bdd-agent",
    "description": (
        "BDD 阶段 sub-agent：依据已确认的 PRD 产出严格闭合的用户故事并用"
        "校验器强制闭合规则。委派时必须提供项目 slug。"
    ),
    "system_prompt": BDD_AGENT_INSTRUCTIONS,
    "tools": [validate_user_stories],
}

sdd_agent = {
    "name": "sdd-agent",
    "description": (
        "SDD 阶段 sub-agent：依据已确认的 BDD 用户故事逐条产出系统设计文档"
        "与追溯矩阵并用校验器检查。委派时必须提供项目 slug。"
    ),
    "system_prompt": SDD_AGENT_INSTRUCTIONS,
    "tools": [validate_traceability],
}

graph = create_deep_agent(
    model=model,
    tools=[],
    system_prompt=ORCHESTRATOR_INSTRUCTIONS,
    subagents=[prd_agent, bdd_agent, sdd_agent],
    backend=FilesystemBackend(root_dir=WORKSPACE_ROOT),
)
