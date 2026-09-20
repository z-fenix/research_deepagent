"""C1：DiskEngine IO 异常（OSError / UnicodeDecodeError）不得穿透 VFS 公开方法。

仅针对 disk 引擎：通过 monkeypatch 强制引擎方法抛 IO 异常，隔离真实文件
系统差异，断言各公开方法返回结构化 error 而非抛异常。
"""

import pytest
from research_deepagent.vfs.engine import DiskEngine
from research_deepagent.vfs.vfs import VirtualFileSystem


@pytest.fixture()
def vfs(tmp_path):
    return VirtualFileSystem(DiskEngine(tmp_path / "root"))


def test_write_wraps_oserror(vfs, monkeypatch):
    def boom(self, path, file_data):
        raise OSError("disk on fire")

    monkeypatch.setattr(DiskEngine, "put", boom)
    result = vfs.write("/f.md", "x")
    assert result.error is not None
    assert "Error writing file '/f.md'" in result.error


def test_read_wraps_oserror(vfs, monkeypatch):
    def boom(self, path):
        raise PermissionError("denied")

    monkeypatch.setattr(DiskEngine, "get", boom)
    result = vfs.read("/f.md")
    assert result.error is not None
    assert "Error reading file '/f.md'" in result.error


def test_read_wraps_unicode_decode_error(vfs, monkeypatch):
    def boom(self, path):
        raise UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid start byte")

    monkeypatch.setattr(DiskEngine, "get", boom)
    result = vfs.read("/f.md")
    assert result.error is not None
    assert "Error reading file '/f.md'" in result.error


def test_edit_wraps_oserror(vfs, monkeypatch):
    def boom(self, path):
        raise OSError("disk on fire")

    monkeypatch.setattr(DiskEngine, "get", boom)
    result = vfs.edit("/f.md", "a", "b")
    assert result.error is not None
    assert "Error editing file '/f.md'" in result.error


def test_edit_put_oserror_reports_error(vfs, monkeypatch):
    vfs.write("/f.md", "hello world\n")

    def boom(self, path, file_data):
        raise OSError("disk on fire")

    monkeypatch.setattr(DiskEngine, "put", boom)
    result = vfs.edit("/f.md", "hello", "goodbye")
    assert result.error is not None
    assert "Error editing file '/f.md'" in result.error


def test_write_to_real_directory_reports_error(vfs, tmp_path):
    # 真实场景：disk 根下已存在同名目录（非 monkeypatch）。空目录时
    # keys("/") 前缀检查不触发，由 OSError 包装兜底，同样返回结构化 error。
    (tmp_path / "root" / "d").mkdir()
    result = vfs.write("/d", "y")
    assert result.error is not None
