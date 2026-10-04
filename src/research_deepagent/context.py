"""Runtime identity resolution for memory namespaces.

Deployment runtimes (LangSmith / agentseek) expose the signed-in user and
assistant through ``rt.server_info``; local/self-hosted runs fall back to the
invocation ``context`` (context_schema) and finally to constants.
"""
from dataclasses import dataclass

ASSISTANT_ID_FALLBACK = "research"


@dataclass(frozen=True)
class PipelineContext:
    user_id: str = "local-user"


def resolve_user_id(rt) -> str:
    server_info = getattr(rt, "server_info", None)
    user = getattr(server_info, "user", None) if server_info is not None else None
    if user is not None:
        return user.identity
    ctx = getattr(rt, "context", None)
    return getattr(ctx, "user_id", None) or "local-user"


def resolve_assistant_id(rt) -> str:
    server_info = getattr(rt, "server_info", None)
    assistant_id = getattr(server_info, "assistant_id", None) if server_info is not None else None
    return assistant_id or ASSISTANT_ID_FALLBACK
