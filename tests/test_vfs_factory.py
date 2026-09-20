"""后端工厂与 DOCS_BACKEND 切换测试。"""

import pytest
from research_deepagent.vfs.engine import DiskEngine, MemoryEngine, SqliteEngine
from research_deepagent.vfs.factory import create_backend
from research_deepagent.vfs.vfs import VirtualFileSystem


def test_default_is_disk(tmp_path, monkeypatch):
    monkeypatch.delenv("DOCS_BACKEND", raising=False)
    backend = create_backend(root=tmp_path)
    assert isinstance(backend, VirtualFileSystem)
    assert isinstance(backend.engine, DiskEngine)


def test_memory_backend(tmp_path):
    backend = create_backend("memory", root=tmp_path)
    assert isinstance(backend.engine, MemoryEngine)


def test_sqlite_backend_uses_env_path(tmp_path, monkeypatch):
    monkeypatch.setenv("DOCS_BACKEND", "sqlite")
    monkeypatch.setenv("DOCS_SQLITE_PATH", str(tmp_path / "custom.sqlite3"))
    backend = create_backend(root=tmp_path)
    assert isinstance(backend.engine, SqliteEngine)
    assert (tmp_path / "custom.sqlite3").exists()


def test_sqlite_backend_persists(tmp_path):
    create_backend("sqlite", root=tmp_path).write("/a.md", "persisted")
    again = create_backend("sqlite", root=tmp_path)
    assert again.read("/a.md").file_data["content"] == "persisted"


def test_disk_backend_default_sqlite_path_unused(tmp_path, monkeypatch):
    monkeypatch.delenv("DOCS_SQLITE_PATH", raising=False)
    backend = create_backend("disk", root=tmp_path)
    backend.write("/a.md", "on disk")
    assert (tmp_path / "a.md").read_text(encoding="utf-8") == "on disk"


def test_unknown_backend_raises(tmp_path):
    with pytest.raises(ValueError):
        create_backend("redis", root=tmp_path)
