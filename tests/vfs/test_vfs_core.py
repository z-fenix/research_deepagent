"""VirtualFileSystem 写/读/编辑语义（三引擎参数化）。"""

import pytest
from research_deepagent.vfs.engine import DiskEngine, MemoryEngine, SqliteEngine
from research_deepagent.vfs.vfs import VirtualFileSystem


FIVE_LINES = "l1\nl2\nl3\nl4\nl5\n"


def test_write_then_read_roundtrip(vfs):
    result = vfs.write("/docs/prd.md", "# PRD\nline2\n")
    assert result.error is None
    assert result.path == "/docs/prd.md"
    read = vfs.read("/docs/prd.md")
    assert read.error is None
    assert read.file_data["content"] == "# PRD\nline2\n"
    assert read.total_lines == 2
    assert read.start_line == 1 and read.end_line == 2
    assert read.next_offset is None


def test_read_missing_reports_error(vfs):
    read = vfs.read("/nope.md")
    assert read.error is not None
    assert "not found" in read.error


def test_read_pagination_window(vfs):
    vfs.write("/f.md", FIVE_LINES)
    window = vfs.read("/f.md", offset=2, limit=2)
    assert window.error is None
    assert window.file_data["content"] == "l3\nl4\n"
    assert window.start_line == 3 and window.end_line == 4
    assert window.next_offset == 4
    assert window.total_lines == 5


def test_read_offset_beyond_end_reports_error(vfs):
    vfs.write("/f.md", FIVE_LINES)
    window = vfs.read("/f.md", offset=99, limit=2)
    assert window.error is not None
    assert "exceeds file length" in window.error
    assert window.file_data is None


def test_read_degenerate_bounds_clamped(vfs):
    vfs.write("/f.md", FIVE_LINES)
    window = vfs.read("/f.md", offset=-5, limit=2)
    assert window.error is None
    assert window.file_data["content"] == "l1\nl2\n"
    zero = vfs.read("/f.md", limit=0)
    assert zero.error is None
    assert zero.no_lines_requested is True


@pytest.fixture(params=["memory", "sqlite"])
def vfs_persistent(request, tmp_path):
    """created_at 覆盖稳定性仅对元数据内置存储的引擎成立；disk 由 os.stat 派生。"""
    if request.param == "memory":
        return VirtualFileSystem(MemoryEngine())
    return VirtualFileSystem(SqliteEngine(tmp_path / "test.sqlite3"))


def test_write_overwrite_preserves_created_at(vfs_persistent):
    vfs_persistent.write("/f.md", "v1")
    first = vfs_persistent.read("/f.md").file_data
    vfs_persistent.write("/f.md", "v2")
    second = vfs_persistent.read("/f.md").file_data
    assert second["content"] == "v2"
    assert second["created_at"] == first["created_at"]
    assert second["modified_at"] >= first["modified_at"]


def test_write_overwrite_disk_content(tmp_path):
    vfs = VirtualFileSystem(DiskEngine(tmp_path / "root"))
    vfs.write("/f.md", "v1")
    vfs.write("/f.md", "v2")
    assert vfs.read("/f.md").file_data["content"] == "v2"


def test_edit_unique_replacement(vfs):
    vfs.write("/f.md", "foo bar\n")
    result = vfs.edit("/f.md", "bar", "baz")
    assert result.error is None
    assert result.occurrences == 1
    assert vfs.read("/f.md").file_data["content"] == "foo baz\n"


def test_edit_non_unique_fails_without_replace_all(vfs):
    vfs.write("/f.md", "a-a\n")
    result = vfs.edit("/f.md", "a", "b")
    assert result.error is not None
    assert result.occurrences is None
    assert vfs.read("/f.md").file_data["content"] == "a-a\n"


def test_edit_replace_all(vfs):
    vfs.write("/f.md", "a-a\n")
    result = vfs.edit("/f.md", "a", "b", replace_all=True)
    assert result.error is None
    assert result.occurrences == 2
    assert vfs.read("/f.md").file_data["content"] == "b-b\n"


def test_edit_missing_file_reports_error(vfs):
    result = vfs.edit("/nope.md", "a", "b")
    assert result.error is not None
    assert "not found" in result.error


def test_write_rejects_traversal(vfs):
    result = vfs.write("a/../evil.md", "x")
    assert result.error is not None
    assert vfs.read("/evil.md").error is not None


def test_write_normalizes_relative_path(vfs):
    result = vfs.write("docs/x.md", "content")
    assert result.error is None
    assert result.path == "/docs/x.md"
    assert vfs.read("/docs/x.md").error is None
