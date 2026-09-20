"""MemoryEngine 单元测试。"""

from deepagents.backends.protocol import FileData

from research_deepagent.vfs.engine import MemoryEngine


def _fd(content: str) -> FileData:
    return FileData(content=content, encoding="utf-8", created_at="t0", modified_at="t1")


def test_get_missing_returns_none():
    engine = MemoryEngine()
    assert engine.get("/a.md") is None


def test_put_get_roundtrip():
    engine = MemoryEngine()
    engine.put("/a.md", _fd("hello"))
    assert engine.get("/a.md")["content"] == "hello"


def test_put_overwrites():
    engine = MemoryEngine()
    engine.put("/a.md", _fd("v1"))
    engine.put("/a.md", _fd("v2"))
    assert engine.get("/a.md")["content"] == "v2"


def test_delete_missing_is_noop():
    engine = MemoryEngine()
    engine.delete("/nope.md")  # 不抛异常


def test_delete_removes():
    engine = MemoryEngine()
    engine.put("/a.md", _fd("x"))
    engine.delete("/a.md")
    assert engine.get("/a.md") is None


def test_keys_sorted_with_prefix():
    engine = MemoryEngine()
    engine.put("/d/b.md", _fd("x"))
    engine.put("/d/a.md", _fd("x"))
    engine.put("/x.md", _fd("x"))
    assert engine.keys("/d/") == ["/d/a.md", "/d/b.md"]
    assert engine.keys() == ["/d/a.md", "/d/b.md", "/x.md"]


def test_put_stores_copy():
    engine = MemoryEngine()
    fd = _fd("hello")
    engine.put("/a.md", fd)
    fd["content"] = "changed"
    assert engine.get("/a.md")["content"] == "hello"
