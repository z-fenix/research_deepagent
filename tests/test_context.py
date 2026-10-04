"""运行时身份解析的单元测试（server_info 优先、context 回退）。"""
from types import SimpleNamespace

from research_deepagent.context import (
    ASSISTANT_ID_FALLBACK,
    PipelineContext,
    resolve_assistant_id,
    resolve_user_id,
)


def test_resolve_user_id_prefers_server_info():
    rt = SimpleNamespace(server_info=SimpleNamespace(user=SimpleNamespace(identity="u-1")))
    assert resolve_user_id(rt) == "u-1"


def test_resolve_user_id_falls_back_to_context():
    rt = SimpleNamespace(server_info=None, context=PipelineContext(user_id="u-2"))
    assert resolve_user_id(rt) == "u-2"


def test_resolve_user_id_defaults_to_local_user():
    rt = SimpleNamespace(server_info=None, context=None)
    assert resolve_user_id(rt) == "local-user"


def test_resolve_assistant_id_falls_back_to_constant():
    rt = SimpleNamespace(server_info=None)
    assert resolve_assistant_id(rt) == ASSISTANT_ID_FALLBACK == "research"
