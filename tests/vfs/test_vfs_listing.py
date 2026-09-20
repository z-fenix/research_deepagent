"""VirtualFileSystem ls/delete 语义（三引擎参数化）。"""


def _seed(vfs):
    vfs.write("/a.md", "root file")
    vfs.write("/d/b.md", "nested")
    vfs.write("/d/sub/c.md", "deep")


def test_ls_lists_files_and_subdirs(vfs):
    _seed(vfs)
    root = vfs.ls("/")
    paths = {entry["path"] for entry in root.entries}
    assert paths == {"/a.md", "/d/"}
    by_path = {entry["path"]: entry for entry in root.entries}
    assert by_path["/a.md"]["is_dir"] is False
    assert by_path["/a.md"]["size"] == len("root file")
    assert by_path["/d/"]["is_dir"] is True


def test_ls_subdirectory(vfs):
    _seed(vfs)
    d = vfs.ls("/d")
    paths = {entry["path"] for entry in d.entries}
    assert paths == {"/d/b.md", "/d/sub/"}


def test_ls_missing_dir_returns_empty(vfs):
    result = vfs.ls("/nope")
    assert result.error is None
    assert result.entries == []


def test_ls_rejects_traversal(vfs):
    result = vfs.ls("a/../b")
    assert result.error is not None


def test_delete_file(vfs):
    _seed(vfs)
    result = vfs.delete("/a.md")
    assert result.error is None
    assert result.path == "/a.md"
    assert vfs.read("/a.md").error is not None


def test_delete_directory_recursive(vfs):
    _seed(vfs)
    result = vfs.delete("/d")
    assert result.error is None
    assert vfs.read("/d/b.md").error is not None
    assert vfs.read("/d/sub/c.md").error is not None
    assert vfs.read("/a.md").error is None  # 其他文件不受影响


def test_delete_missing_reports_error(vfs):
    result = vfs.delete("/nope.md")
    assert result.error is not None
    assert "not found" in result.error
