"""VirtualFileSystem grep/glob/upload/download 语义（三引擎参数化）。"""

import pytest


@pytest.fixture()
def seeded(vfs):
    vfs.write("/d1/prd.md", "REQ-001 登录\nREQ-002 注销\n")
    vfs.write("/d1/bdd.md", "覆盖 REQ-001 的场景\n")
    vfs.write("/d2/notes.txt", "REQ-003 备注\n")
    return vfs


def test_grep_literal_across_files(seeded):
    result = seeded.grep("REQ-001")
    assert result.error is None
    hits = {(m["path"], m["line"]) for m in result.matches}
    assert hits == {("/d1/prd.md", 1), ("/d1/bdd.md", 1)}


def test_grep_is_literal_not_regex(seeded):
    result = seeded.grep("REQ-0(01")
    assert result.error is None
    assert result.matches == []


def test_grep_path_filter(seeded):
    result = seeded.grep("REQ-", path="/d2")
    assert result.error is None
    assert {m["path"] for m in result.matches} == {"/d2/notes.txt"}


def test_grep_glob_filter(seeded):
    result = seeded.grep("REQ-", glob="*.md")
    assert result.error is None
    assert {m["path"] for m in result.matches} == {"/d1/prd.md", "/d1/bdd.md"}


def test_grep_max_count_truncates(seeded):
    result = seeded.grep("REQ-", max_count=1)
    assert result.error is None
    assert len(result.matches) == 1
    assert result.truncated is True


def test_glob_basename_matches_any_depth(seeded):
    result = seeded.glob("*.md", "/")
    assert result.error is None
    assert {m["path"] for m in result.matches} == {"/d1/prd.md", "/d1/bdd.md"}


def test_glob_recursive_pattern(seeded):
    result = seeded.glob("**/*.txt", "/")
    assert result.error is None
    assert {m["path"] for m in result.matches} == {"/d2/notes.txt"}


def test_glob_no_matches(seeded):
    result = seeded.glob("*.py", "/")
    assert result.error is None
    assert result.matches == []


def test_glob_refused_pattern_reports_error(seeded):
    # `..` 段是 glob 契约明确拒绝的模式（见 BackendProtocol.glob 文档）
    result = seeded.glob("../*.md")
    assert result.error is not None


def test_upload_download_roundtrip(vfs):
    responses = vfs.upload_files([("/u/a.txt", b"hello")])
    assert responses[0].error is None
    downloads = vfs.download_files(["/u/a.txt"])
    assert downloads[0].error is None
    assert downloads[0].content == b"hello"


def test_upload_overwrites(vfs):
    vfs.upload_files([("/u/a.txt", b"v1")])
    vfs.upload_files([("/u/a.txt", b"v2")])
    assert vfs.download_files(["/u/a.txt"])[0].content == b"v2"


def test_download_missing_reports_file_not_found(vfs):
    downloads = vfs.download_files(["/nope.txt"])
    assert downloads[0].content is None
    assert downloads[0].error == "file_not_found"


def test_upload_invalid_path_reports_invalid_path(vfs):
    responses = vfs.upload_files([("a/../evil.txt", b"x")])
    assert responses[0].error == "invalid_path"


def test_upload_non_utf8_reports_unsupported(vfs):
    responses = vfs.upload_files([("/u/bin.txt", b"\xff\xfe\x00")])
    assert responses[0].error == "unsupported_content_encoding"


def test_download_invalid_path_reports_invalid_path(vfs):
    downloads = vfs.download_files(["a/../evil.txt"])
    assert downloads[0].error == "invalid_path"
