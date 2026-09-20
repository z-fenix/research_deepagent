"""DiskEngine 单元测试。"""

import pytest
from deepagents.backends.protocol import FileData

from research_deepagent.vfs.engine import DiskEngine


def _fd(content: str) -> FileData:
    return FileData(content=content, encoding="utf-8", created_at="t0", modified_at="t1")


@pytest.fixture()
def engine(tmp_path):
    return DiskEngine(tmp_path / "root")


def test_roundtrip(engine):
    assert engine.get("/a.md") is None
    engine.put("/a.md", _fd("hello"))
    file_data = engine.get("/a.md")
    assert file_data["content"] == "hello"
    assert file_data["encoding"] == "utf-8"
    assert file_data["modified_at"]  # 来自 stat，非空


def test_put_creates_parent_dirs(engine, tmp_path):
    engine.put("/deep/nested/dir/a.md", _fd("x"))
    assert (tmp_path / "root" / "deep" / "nested" / "dir" / "a.md").read_text(
        encoding="utf-8"
    ) == "x"


def test_put_overwrites(engine):
    engine.put("/a.md", _fd("v1"))
    engine.put("/a.md", _fd("v2"))
    assert engine.get("/a.md")["content"] == "v2"


def test_delete_missing_is_noop(engine):
    engine.delete("/nope.md")


def test_keys_sorted_with_prefix(engine):
    engine.put("/d/b.md", _fd("x"))
    engine.put("/d/a.md", _fd("x"))
    engine.put("/x.md", _fd("x"))
    assert engine.keys("/d/") == ["/d/a.md", "/d/b.md"]
    assert engine.keys() == ["/d/a.md", "/d/b.md", "/x.md"]


def test_keys_uses_virtual_path_string_order(engine):
    # M1：Path 分量序与字符串序不同（"/d.md" < "/d/a.md"），keys() 须按
    # 虚拟路径字符串序返回，与 memory/sqlite 引擎一致。
    engine.put("/d.md", _fd("x"))
    engine.put("/d/a.md", _fd("x"))
    assert engine.keys() == ["/d.md", "/d/a.md"]


def test_path_escape_rejected(engine, tmp_path):
    with pytest.raises(ValueError):
        engine.get("/../outside.md")
    with pytest.raises(ValueError):
        engine.put("/../outside.md", _fd("evil"))


def test_directory_read_returns_none(engine):
    engine.put("/d/a.md", _fd("x"))
    assert engine.get("/d") is None
