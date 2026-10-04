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
    identity = getattr(user, "identity", None) if user is not None else None
    # StoreBackend 校验 namespace 组件须匹配 ^[A-Za-z0-9\-_.@+:~]+$；
    # 畸形 identity 必须回退而不是让每次运行都崩。不要静默清洗：
    # 不同用户塌缩进同一 namespace 比可见的回退更糟。
    if isinstance(identity, str) and identity:
        return identity
    ctx = getattr(rt, "context", None)
    return getattr(ctx, "user_id", None) or "local-user"


def resolve_assistant_id(rt) -> str:
    server_info = getattr(rt, "server_info", None)
    assistant_id = getattr(server_info, "assistant_id", None) if server_info is not None else None
    # 同 resolve_user_id：只接受非空字符串，畸形值回退常量。
    if isinstance(assistant_id, str) and assistant_id:
        return assistant_id
    return ASSISTANT_ID_FALLBACK
