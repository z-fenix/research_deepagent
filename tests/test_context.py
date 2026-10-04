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


def test_resolve_user_id_identity_none_falls_back():
    """identity 为 None（如本地 runtime 未注入用户）时回退，不得返回 None。"""
    rt = SimpleNamespace(server_info=SimpleNamespace(user=SimpleNamespace(identity=None)))
    assert resolve_user_id(rt) == "local-user"


def test_resolve_user_id_identity_empty_falls_back():
    """identity 为空串会违反 StoreBackend namespace 校验，必须回退。"""
    rt = SimpleNamespace(server_info=SimpleNamespace(user=SimpleNamespace(identity="")))
    assert resolve_user_id(rt) == "local-user"


def test_resolve_user_id_identity_non_string_falls_back():
    """identity 为非字符串（脏数据）时回退，不得把 123 拼进 namespace。"""
    rt = SimpleNamespace(server_info=SimpleNamespace(user=SimpleNamespace(identity=123)))
    assert resolve_user_id(rt) == "local-user"


def test_resolve_user_id_valid_identity_still_wins():
    """合法非空字符串 identity 仍优先于 context。"""
    rt = SimpleNamespace(
        server_info=SimpleNamespace(user=SimpleNamespace(identity="u-9")),
        context=PipelineContext(user_id="u-context"),
    )
    assert resolve_user_id(rt) == "u-9"


def test_resolve_assistant_id_falls_back_to_constant():
    rt = SimpleNamespace(server_info=None)
    assert resolve_assistant_id(rt) == ASSISTANT_ID_FALLBACK == "research"
