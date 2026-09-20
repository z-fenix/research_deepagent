"""SqliteEngine 单元测试。"""

import threading

import pytest
from deepagents.backends.protocol import FileData

from research_deepagent.vfs.engine import SqliteEngine


def _fd(content: str) -> FileData:
    return FileData(content=content, encoding="utf-8", created_at="t0", modified_at="t1")


@pytest.fixture()
def db_path(tmp_path):
    return tmp_path / "test.sqlite3"


def test_roundtrip(db_path):
    engine = SqliteEngine(db_path)
    assert engine.get("/a.md") is None
    engine.put("/a.md", _fd("hello"))
    assert engine.get("/a.md")["content"] == "hello"
    assert engine.get("/a.md")["created_at"] == "t0"


def test_put_overwrites(db_path):
    engine = SqliteEngine(db_path)
    engine.put("/a.md", _fd("v1"))
    engine.put("/a.md", _fd("v2"))
    assert engine.get("/a.md")["content"] == "v2"


def test_delete_missing_is_noop(db_path):
    engine = SqliteEngine(db_path)
    engine.delete("/nope.md")


def test_keys_sorted_with_prefix(db_path):
    engine = SqliteEngine(db_path)
    engine.put("/d/b.md", _fd("x"))
    engine.put("/d/a.md", _fd("x"))
    engine.put("/x.md", _fd("x"))
    assert engine.keys("/d/") == ["/d/a.md", "/d/b.md"]
    assert engine.keys() == ["/d/a.md", "/d/b.md", "/x.md"]


def test_persistence_across_connections(db_path):
    engine1 = SqliteEngine(db_path)
    engine1.put("/a.md", _fd("persisted"))
    engine2 = SqliteEngine(db_path)
    assert engine2.get("/a.md")["content"] == "persisted"


def test_concurrent_writes(db_path):
    engine = SqliteEngine(db_path)

    def write(i: int) -> None:
        engine.put(f"/f{i}.md", _fd(f"content-{i}"))

    threads = [threading.Thread(target=write, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(engine.keys()) == 8
