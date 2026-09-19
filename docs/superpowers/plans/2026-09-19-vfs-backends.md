# 自研 VFS 与存储后端实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自研一套虚拟文件系统（`VirtualFileSystem`）与三种存储引擎（内存/SQLite/磁盘），对齐 deepagents `BackendProtocol`，接入主 Agent 流程（`DOCS_BACKEND` 开关），并以文件工具微基准产出三种后端的对比实验报告。

**Architecture:** 引擎/语义分层。`StorageEngine`（极简 KV 接口：get/put/delete/keys）由三个后端实现；`VirtualFileSystem(BackendProtocol)` 把 deepagents 全部文件语义（路径校验、read 分页、edit 唯一性、grep/glob、递归 delete、批量 upload/download）实现一次并委托引擎。大量语义复用 `deepagents.backends.utils` 的现成函数（`StateBackend` 即此模式的上游参照）。

**Tech Stack:** Python 3.12、deepagents>=0.5.3（`backends.protocol` + `backends.utils`）、sqlite3（标准库）、pytest。

**Spec:** `docs/superpowers/specs/2026-09-19-vfs-backends-design.md`

## Global Constraints

- 所有命令在 WSL 内执行：`wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /home/zhang/workplace/research_deepagent && <命令>"`（`.venv` 是 Linux 环境）。
- 不新增任何第三方依赖（sqlite3 是标准库）。
- 公开 VFS 方法不得向外抛异常：一切失败经 `WriteResult.error` / `EditResult.error` / `ReadResult.error` / `LsResult.error` / `GrepResult.error` / `GlobResult.error` / `DeleteResult.error` / `FileUploadResponse.error` / `FileDownloadResponse.error` 返回。
- 错误字符串与上游 `StateBackend` 保持一致：读缺失 `File '<path>' not found`；编辑缺失 `Error: File '<path>' not found`；删除缺失 `Error: File '<path>' not found`。
- 二进制内容不支持（spec YAGNI）：`upload_files` 收到非 utf-8 bytes 时报 `unsupported_content_encoding`，不落 base64。
- 测试用例通过 `tests/vfs/conftest.py` 的参数化 fixture 跑遍三种引擎。
- 每个 Task 结束 `git commit`（Windows 侧 git 已配置 safe.directory；提交信息用 conventional commits）。

---

### Task 1: StorageEngine 接口 + MemoryEngine

**Files:**
- Create: `src/research_deepagent/vfs/__init__.py`（临时为空，Task 7 填充导出）
- Create: `src/research_deepagent/vfs/engine.py`
- Test: `tests/vfs/__init__.py`（空）、`tests/vfs/test_memory_engine.py`

**Interfaces:**
- Consumes: `deepagents.backends.protocol.FileData`（TypedDict：content/encoding/created_at/modified_at）。
- Produces: `StorageEngine` 抽象基类，四个抽象方法：
  - `get(path: str) -> FileData | None`
  - `put(path: str, file_data: FileData) -> None`
  - `delete(path: str) -> None`（路径不存在时静默）
  - `keys(prefix: str = "") -> list[str]`（排序返回）
  以及 `MemoryEngine(StorageEngine)`。后续所有任务按此签名使用。

- [ ] **Step 1: 写失败测试**

`tests/vfs/test_memory_engine.py`：

```python
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
```

- [ ] **Step 2: 运行确认失败**

Run: `wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /home/zhang/workplace/research_deepagent && uv run pytest tests/vfs/test_memory_engine.py -q"`
Expected: FAIL，`ModuleNotFoundError: No module named 'research_deepagent.vfs'`

- [ ] **Step 3: 最小实现**

`src/research_deepagent/vfs/__init__.py`：空文件。

`src/research_deepagent/vfs/engine.py`：

```python
"""极简存储引擎接口：路径 -> FileData 的 KV 存储，不含任何文件语义。"""

from __future__ import annotations

import abc

from deepagents.backends.protocol import FileData


class StorageEngine(abc.ABC):
    """键值存储抽象：key 为以 ``/`` 开头的虚拟绝对路径，value 为 ``FileData``。

    文件语义（分页、编辑、搜索等）全部位于
    ``research_deepagent.vfs.vfs.VirtualFileSystem``；引擎只负责存取与枚举。
    """

    @abc.abstractmethod
    def get(self, path: str) -> FileData | None:
        """返回路径对应的 ``FileData``，不存在返回 ``None``。"""

    @abc.abstractmethod
    def put(self, path: str, file_data: FileData) -> None:
        """写入或整体覆盖。"""

    @abc.abstractmethod
    def delete(self, path: str) -> None:
        """删除单个 key；不存在时静默。"""

    @abc.abstractmethod
    def keys(self, prefix: str = "") -> list[str]:
        """按前缀枚举路径，排序返回。"""


class MemoryEngine(StorageEngine):
    """进程内 dict 存储，无持久化。"""

    def __init__(self) -> None:
        self._files: dict[str, FileData] = {}

    def get(self, path: str) -> FileData | None:
        file_data = self._files.get(path)
        return dict(file_data) if file_data is not None else None

    def put(self, path: str, file_data: FileData) -> None:
        self._files[path] = dict(file_data)

    def delete(self, path: str) -> None:
        self._files.pop(path, None)

    def keys(self, prefix: str = "") -> list[str]:
        return sorted(k for k in self._files if k.startswith(prefix))
```

- [ ] **Step 4: 运行确认通过**

Run: 同 Step 2。
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add src/research_deepagent/vfs tests/vfs
git commit -m "feat(vfs): add StorageEngine interface and MemoryEngine"
```

---

### Task 2: SqliteEngine

**Files:**
- Modify: `src/research_deepagent/vfs/engine.py`（追加 `SqliteEngine`）
- Test: `tests/vfs/test_sqlite_engine.py`

**Interfaces:**
- Consumes: `StorageEngine`（Task 1 签名）。
- Produces: `SqliteEngine(db_path: str | Path)`——单文件 SQLite、WAL 模式、`check_same_thread=False` + `threading.Lock` 串行化。表结构 `files(path TEXT PRIMARY KEY, content TEXT NOT NULL, encoding TEXT NOT NULL, created_at TEXT NOT NULL, modified_at TEXT NOT NULL)`。

- [ ] **Step 1: 写失败测试**

`tests/vfs/test_sqlite_engine.py`：

```python
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
```

- [ ] **Step 2: 运行确认失败**

Run: `wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /home/zhang/workplace/research_deepagent && uv run pytest tests/vfs/test_sqlite_engine.py -q"`
Expected: FAIL，`ImportError: cannot import name 'SqliteEngine'`

- [ ] **Step 3: 最小实现**

在 `src/research_deepagent/vfs/engine.py` 顶部 import 区追加：

```python
import sqlite3
import threading
from pathlib import Path
```

文件末尾追加：

```python
class SqliteEngine(StorageEngine):
    """单文件 SQLite 持久化存储（WAL），线程安全。"""

    def __init__(self, db_path: str | Path) -> None:
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS files ("
            "path TEXT PRIMARY KEY, "
            "content TEXT NOT NULL, "
            "encoding TEXT NOT NULL, "
            "created_at TEXT NOT NULL, "
            "modified_at TEXT NOT NULL)"
        )
        self._conn.commit()

    def get(self, path: str) -> FileData | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT content, encoding, created_at, modified_at FROM files WHERE path = ?",
                (path,),
            ).fetchone()
        if row is None:
            return None
        return FileData(
            content=row[0], encoding=row[1], created_at=row[2], modified_at=row[3]
        )

    def put(self, path: str, file_data: FileData) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO files"
                " (path, content, encoding, created_at, modified_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (
                    path,
                    file_data["content"],
                    file_data.get("encoding", "utf-8"),
                    file_data.get("created_at", ""),
                    file_data.get("modified_at", ""),
                ),
            )
            self._conn.commit()

    def delete(self, path: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM files WHERE path = ?", (path,))
            self._conn.commit()

    def keys(self, prefix: str = "") -> list[str]:
        with self._lock:
            rows = self._conn.execute("SELECT path FROM files ORDER BY path").fetchall()
        return [row[0] for row in rows if row[0].startswith(prefix)]
```

- [ ] **Step 4: 运行确认通过**

Run: 同 Step 2。
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add src/research_deepagent/vfs/engine.py tests/vfs/test_sqlite_engine.py
git commit -m "feat(vfs): add SqliteEngine with WAL persistence and thread lock"
```

---

### Task 3: DiskEngine

**Files:**
- Modify: `src/research_deepagent/vfs/engine.py`（追加 `DiskEngine`）
- Test: `tests/vfs/test_disk_engine.py`

**Interfaces:**
- Consumes: `StorageEngine`（Task 1 签名）。
- Produces: `DiskEngine(root: Path)`——虚拟路径映射为 `<root>/<path>` 下的普通文件（与 `FilesystemBackend` 落盘格式兼容）；metadata（created_at/modified_at）从 `os.stat` 派生；路径逃逸 root 时抛 `ValueError`。

- [ ] **Step 1: 写失败测试**

`tests/vfs/test_disk_engine.py`：

```python
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


def test_path_escape_rejected(engine, tmp_path):
    with pytest.raises(ValueError):
        engine.get("/../outside.md")
    with pytest.raises(ValueError):
        engine.put("/../outside.md", _fd("evil"))


def test_directory_read_returns_none(engine):
    engine.put("/d/a.md", _fd("x"))
    assert engine.get("/d") is None
```

- [ ] **Step 2: 运行确认失败**

Run: `wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /home/zhang/workplace/research_deepagent && uv run pytest tests/vfs/test_disk_engine.py -q"`
Expected: FAIL，`ImportError: cannot import name 'DiskEngine'`

- [ ] **Step 3: 最小实现**

在 `src/research_deepagent/vfs/engine.py` 顶部 import 区追加：

```python
from datetime import UTC, datetime
```

文件末尾追加：

```python
class DiskEngine(StorageEngine):
    """真实目录树存储：虚拟路径映射为 ``<root>/<path>`` 下的普通文件。

    落盘格式与 deepagents ``FilesystemBackend`` 兼容（普通文本文件），
    时间戳从 ``os.stat`` 派生。
    """

    def __init__(self, root: Path) -> None:
        self._root = Path(root).resolve()
        self._root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, path: str) -> Path:
        full = (self._root / path.lstrip("/")).resolve()
        if not full.is_relative_to(self._root):
            msg = f"Path escapes root: {path}"
            raise ValueError(msg)
        return full

    def get(self, path: str) -> FileData | None:
        target = self._resolve(path)
        if not target.is_file():
            return None
        stat = target.stat()
        return FileData(
            content=target.read_text(encoding="utf-8"),
            encoding="utf-8",
            created_at=datetime.fromtimestamp(stat.st_ctime, tz=UTC).isoformat(),
            modified_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
        )

    def put(self, path: str, file_data: FileData) -> None:
        target = self._resolve(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(file_data["content"], encoding="utf-8")

    def delete(self, path: str) -> None:
        target = self._resolve(path)
        target.unlink(missing_ok=True)

    def keys(self, prefix: str = "") -> list[str]:
        out: list[str] = []
        for candidate in sorted(self._root.rglob("*")):
            if candidate.is_file():
                vpath = "/" + candidate.relative_to(self._root).as_posix()
                if vpath.startswith(prefix):
                    out.append(vpath)
        return out
```

- [ ] **Step 4: 运行确认通过**

Run: 同 Step 2。
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add src/research_deepagent/vfs/engine.py tests/vfs/test_disk_engine.py
git commit -m "feat(vfs): add DiskEngine backed by real directory tree"
```

---

### Task 4: VirtualFileSystem — write/read/edit 与路径校验

**Files:**
- Create: `src/research_deepagent/vfs/vfs.py`
- Test: `tests/vfs/conftest.py`、`tests/vfs/test_vfs_core.py`

**Interfaces:**
- Consumes: `StorageEngine`（Task 1）；`deepagents.backends.utils` 的 `create_file_data` / `update_file_data` / `slice_read_response` / `perform_string_replacement` / `validate_path`；`deepagents.backends.protocol` 的结果 dataclass。
- Produces: `VirtualFileSystem(engine: StorageEngine)`，公开属性 `engine`；本任务实现 `write` / `read` / `edit` 三个方法并建立 `_validate` 与 `_snapshot` 辅助。签名与 `BackendProtocol` 一致：
  - `write(file_path: str, content: str) -> WriteResult`
  - `read(file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult`
  - `edit(file_path: str, old_string: str, new_string: str, replace_all: bool = False) -> EditResult`

- [ ] **Step 1: 写参数化 fixture 与失败测试**

`tests/vfs/conftest.py`：

```python
"""把同一组协议一致性用例跑遍三种引擎的参数化 fixture。"""

import pytest
from research_deepagent.vfs.engine import DiskEngine, MemoryEngine, SqliteEngine
from research_deepagent.vfs.vfs import VirtualFileSystem


@pytest.fixture(params=["memory", "sqlite", "disk"])
def vfs(request, tmp_path):
    if request.param == "memory":
        return VirtualFileSystem(MemoryEngine())
    if request.param == "sqlite":
        return VirtualFileSystem(SqliteEngine(tmp_path / "test.sqlite3"))
    return VirtualFileSystem(DiskEngine(tmp_path / "root"))
```

`tests/vfs/test_vfs_core.py`：

```python
"""VirtualFileSystem 写/读/编辑语义（三引擎参数化）。"""


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
    assert read.next_offset == 2


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


def test_read_offset_beyond_end_gives_empty_window(vfs):
    vfs.write("/f.md", FIVE_LINES)
    window = vfs.read("/f.md", offset=99, limit=2)
    assert window.error is None
    assert window.file_data["content"] == ""


def test_read_degenerate_bounds_clamped(vfs):
    vfs.write("/f.md", FIVE_LINES)
    window = vfs.read("/f.md", offset=-5, limit=2)
    assert window.error is None
    assert window.file_data["content"] == "l1\nl2\n"
    zero = vfs.read("/f.md", limit=0)
    assert zero.error is None
    assert zero.no_lines_requested is True


def test_write_overwrite_preserves_created_at(vfs):
    vfs.write("/f.md", "v1")
    first = vfs.read("/f.md").file_data
    vfs.write("/f.md", "v2")
    second = vfs.read("/f.md").file_data
    assert second["content"] == "v2"
    assert second["created_at"] == first["created_at"]
    assert second["modified_at"] >= first["modified_at"]


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
```

- [ ] **Step 2: 运行确认失败**

Run: `wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /home/zhang/workplace/research_deepagent && uv run pytest tests/vfs/test_vfs_core.py -q"`
Expected: FAIL，`ModuleNotFoundError: No module named 'research_deepagent.vfs.vfs'`

- [ ] **Step 3: 最小实现**

`src/research_deepagent/vfs/vfs.py`：

```python
"""VirtualFileSystem：deepagents BackendProtocol 语义的一次性实现。

文件语义（路径校验、分页读、字符串编辑等）全部在此实现，存储委托给
可插拔的 ``StorageEngine``。语义函数尽量复用 ``deepagents.backends.utils``
（与上游 ``StateBackend`` 同源），保证与库内置后端行为一致。
"""

from __future__ import annotations

from deepagents.backends.protocol import (
    BackendProtocol,
    EditResult,
    FileData,
    ReadResult,
    WriteResult,
)
from deepagents.backends.utils import (
    create_file_data,
    perform_string_replacement,
    slice_read_response,
    update_file_data,
    validate_path,
)

from research_deepagent.vfs.engine import StorageEngine


class VirtualFileSystem(BackendProtocol):
    """在任意 ``StorageEngine`` 之上提供 deepagents 文件语义。"""

    def __init__(self, engine: StorageEngine) -> None:
        self.engine = engine

    # ------------------------------------------------------------------
    # 内部辅助
    # ------------------------------------------------------------------

    def _validate(self, path: str) -> str:
        """规范化路径（``/`` 开头、拒 ``..``）；失败抛 ``ValueError``。"""
        return validate_path(path)

    def _snapshot(self) -> dict[str, FileData]:
        """当前全部文件快照，供 grep/glob 等全量扫描语义使用。"""
        files: dict[str, FileData] = {}
        for key in self.engine.keys():
            file_data = self.engine.get(key)
            if file_data is not None:
                files[key] = file_data
        return files

    # ------------------------------------------------------------------
    # 写 / 读 / 编辑
    # ------------------------------------------------------------------

    def write(self, file_path: str, content: str) -> WriteResult:
        try:
            file_path = self._validate(file_path)
        except ValueError as exc:
            return WriteResult(error=str(exc))
        existing = self.engine.get(file_path)
        new_file_data = (
            update_file_data(existing, content)
            if existing is not None
            else create_file_data(content)
        )
        self.engine.put(file_path, new_file_data)
        return WriteResult(path=file_path)

    def read(
        self,
        file_path: str,
        offset: int = 0,
        limit: int = 2000,
    ) -> ReadResult:
        try:
            file_path = self._validate(file_path)
        except ValueError as exc:
            return ReadResult(error=str(exc))
        file_data = self.engine.get(file_path)
        if file_data is None:
            return ReadResult(error=f"File '{file_path}' not found")
        return slice_read_response(file_data, offset, limit)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,  # noqa: FBT001, FBT002
    ) -> EditResult:
        try:
            file_path = self._validate(file_path)
        except ValueError as exc:
            return EditResult(error=str(exc))
        file_data = self.engine.get(file_path)
        if file_data is None:
            return EditResult(error=f"Error: File '{file_path}' not found")
        result = perform_string_replacement(
            file_data["content"], old_string, new_string, replace_all
        )
        if isinstance(result, str):
            return EditResult(error=result)
        new_content, occurrences = result
        self.engine.put(file_path, update_file_data(file_data, new_content))
        return EditResult(path=file_path, occurrences=int(occurrences))
```

- [ ] **Step 4: 运行确认通过**

Run: 同 Step 2。
Expected: 36 passed（12 条用例 × 3 引擎参数化）

- [ ] **Step 5: Commit**

```bash
git add src/research_deepagent/vfs/vfs.py tests/vfs/conftest.py tests/vfs/test_vfs_core.py
git commit -m "feat(vfs): add VirtualFileSystem write/read/edit over StorageEngine"
```

---

### Task 5: VirtualFileSystem — ls 与递归 delete

**Files:**
- Modify: `src/research_deepagent/vfs/vfs.py`（追加 `ls` / `delete`）
- Test: `tests/vfs/test_vfs_listing.py`

**Interfaces:**
- Consumes: `VirtualFileSystem`（Task 4）、`StorageEngine.keys`；`deepagents.backends.protocol` 的 `LsResult` / `DeleteResult` / `FileInfo`。
- Produces: `ls(path: str) -> LsResult`（列直接子项，目录项路径带尾部 `/` 且 `is_dir=True`）、`delete(file_path: str) -> DeleteResult`（精确路径 + 前缀递归）。

- [ ] **Step 1: 写失败测试**

`tests/vfs/test_vfs_listing.py`：

```python
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
```

- [ ] **Step 2: 运行确认失败**

Run: `wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /home/zhang/workplace/research_deepagent && uv run pytest tests/vfs/test_vfs_listing.py -q"`
Expected: FAIL，`AttributeError: 'VirtualFileSystem' object has no attribute 'ls'`（`BackendProtocol.ls` 默认抛 `NotImplementedError`）

- [ ] **Step 3: 最小实现**

在 `src/research_deepagent/vfs/vfs.py` 的 protocol import 块中加入 `DeleteResult`、`FileInfo`、`LsResult`，并在类内追加（放在 `edit` 之后）：

```python
    # ------------------------------------------------------------------
    # 列目录 / 删除
    # ------------------------------------------------------------------

    def ls(self, path: str) -> LsResult:
        try:
            normalized = self._validate(path)
        except ValueError as exc:
            return LsResult(error=str(exc))
        prefix = normalized if normalized.endswith("/") else normalized + "/"
        infos: list[FileInfo] = []
        subdirs: set[str] = set()
        for key in self.engine.keys(prefix):
            relative = key[len(prefix):]
            if "/" in relative:
                subdirs.add(prefix + relative.split("/")[0] + "/")
                continue
            file_data = self.engine.get(key)
            infos.append(
                {
                    "path": key,
                    "is_dir": False,
                    "size": len(file_data["content"]) if file_data else 0,
                    "modified_at": file_data.get("modified_at", "") if file_data else "",
                }
            )
        infos.extend(
            {"path": subdir, "is_dir": True, "size": 0, "modified_at": ""}
            for subdir in sorted(subdirs)
        )
        infos.sort(key=lambda entry: entry.get("path", ""))
        return LsResult(entries=infos)

    def delete(self, file_path: str) -> DeleteResult:
        try:
            file_path = self._validate(file_path)
        except ValueError as exc:
            return DeleteResult(error=str(exc))
        base = file_path.rstrip("/")
        prefix = base + "/"
        to_delete = [
            key for key in self.engine.keys() if key == base or key.startswith(prefix)
        ]
        if not to_delete:
            return DeleteResult(error=f"Error: File '{file_path}' not found")
        for key in to_delete:
            self.engine.delete(key)
        return DeleteResult(path=file_path)
```

- [ ] **Step 4: 运行确认通过**

Run: 同 Step 2。
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add src/research_deepagent/vfs/vfs.py tests/vfs/test_vfs_listing.py
git commit -m "feat(vfs): add ls and recursive delete to VirtualFileSystem"
```

---

### Task 6: VirtualFileSystem — grep / glob / upload / download

**Files:**
- Modify: `src/research_deepagent/vfs/vfs.py`（追加四个方法）
- Test: `tests/vfs/test_vfs_search.py`

**Interfaces:**
- Consumes: `deepagents.backends.utils` 的 `grep_matches_from_files` / `_glob_search_files` / `InvalidGlobPatternError` / `create_file_data` / `update_file_data`；`_snapshot()`（Task 4）。
- Produces:
  - `grep(pattern, path=None, glob=None, *, max_count=None) -> GrepResult`（字面量匹配）
  - `glob(pattern, path=None) -> GlobResult`
  - `upload_files(files: list[tuple[str, bytes]]) -> list[FileUploadResponse]`
  - `download_files(paths: list[str]) -> list[FileDownloadResponse]`

- [ ] **Step 1: 写失败测试**

`tests/vfs/test_vfs_search.py`：

```python
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
```

- [ ] **Step 2: 运行确认失败**

Run: `wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /home/zhang/workplace/research_deepagent && uv run pytest tests/vfs/test_vfs_search.py -q"`
Expected: FAIL，`AttributeError: ... no attribute 'grep'`

- [ ] **Step 3: 最小实现**

在 `src/research_deepagent/vfs/vfs.py` 顶部补充 import：

```python
from deepagents.backends.protocol import (
    BackendProtocol,
    DeleteResult,
    EditResult,
    FileData,
    FileDownloadResponse,
    FileUploadResponse,
    GlobResult,
    GrepResult,
    LsResult,
    ReadResult,
    WriteResult,
)
from deepagents.backends.utils import (
    InvalidGlobPatternError,
    _glob_search_files,
    create_file_data,
    grep_matches_from_files,
    perform_string_replacement,
    slice_read_response,
    update_file_data,
    validate_path,
)
```

类内追加（放在 `delete` 之后）：

```python
    # ------------------------------------------------------------------
    # 搜索
    # ------------------------------------------------------------------

    def grep(
        self,
        pattern: str,
        path: str | None = None,
        glob: str | None = None,
        *,
        max_count: int | None = None,
    ) -> GrepResult:
        return grep_matches_from_files(
            self._snapshot(),
            pattern,
            path if path is not None else "/",
            glob,
            max_count=max_count,
        )

    def glob(self, pattern: str, path: str | None = None) -> GlobResult:
        try:
            result = _glob_search_files(self._snapshot(), pattern, path)
        except InvalidGlobPatternError as exc:
            return GlobResult(error=str(exc))
        if result == "No files found":
            return GlobResult(matches=[])
        infos = []
        for matched_path in result.split("\n"):
            file_data = self.engine.get(matched_path)
            infos.append(
                {
                    "path": matched_path,
                    "is_dir": False,
                    "size": len(file_data["content"]) if file_data else 0,
                    "modified_at": file_data.get("modified_at", "") if file_data else "",
                }
            )
        return GlobResult(matches=infos)

    # ------------------------------------------------------------------
    # 批量上传 / 下载
    # ------------------------------------------------------------------

    def upload_files(
        self, files: list[tuple[str, bytes]]
    ) -> list[FileUploadResponse]:
        responses: list[FileUploadResponse] = []
        for path, content in files:
            try:
                file_path = self._validate(path)
            except ValueError:
                responses.append(FileUploadResponse(path=path, error="invalid_path"))
                continue
            try:
                text = content.decode("utf-8")
            except UnicodeDecodeError:
                responses.append(
                    FileUploadResponse(path=path, error="unsupported_content_encoding")
                )
                continue
            existing = self.engine.get(file_path)
            file_data = (
                update_file_data(existing, text)
                if existing is not None
                else create_file_data(text)
            )
            self.engine.put(file_path, file_data)
            responses.append(FileUploadResponse(path=path, error=None))
        return responses

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        responses: list[FileDownloadResponse] = []
        for path in paths:
            try:
                file_path = self._validate(path)
            except ValueError:
                responses.append(
                    FileDownloadResponse(path=path, content=None, error="invalid_path")
                )
                continue
            file_data = self.engine.get(file_path)
            if file_data is None:
                responses.append(
                    FileDownloadResponse(
                        path=path, content=None, error="file_not_found"
                    )
                )
                continue
            responses.append(
                FileDownloadResponse(
                    path=path,
                    content=file_data["content"].encode("utf-8"),
                    error=None,
                )
            )
        return responses
```

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /home/zhang/workplace/research_deepagent && uv run pytest tests/ -q"`
Expected: 全部通过（含既有 validator/graph 测试）

- [ ] **Step 5: Commit**

```bash
git add src/research_deepagent/vfs/vfs.py tests/vfs/test_vfs_search.py
git commit -m "feat(vfs): add grep/glob/upload/download to VirtualFileSystem"
```

---

### Task 7: 后端工厂 + 主流程接入 + 文档

**Files:**
- Create: `src/research_deepagent/vfs/factory.py`
- Modify: `src/research_deepagent/vfs/__init__.py`
- Modify: `src/research_deepagent/agent.py:16`（删 `FilesystemBackend` import）、`src/research_deepagent/agent.py:181`（backend 构造）
- Modify: `README.md`（环境变量表）、`.env.example`
- Test: `tests/test_vfs_factory.py`

**Interfaces:**
- Consumes: `VirtualFileSystem` 与三引擎（Task 1-4）。
- Produces: `create_backend(name: str | None = None, root: Path | None = None) -> BackendProtocol`：
  - `name` 为 `None` 时读环境变量 `DOCS_BACKEND`（默认 `"disk"`）
  - `"memory"` → `VirtualFileSystem(MemoryEngine())`
  - `"sqlite"` → `VirtualFileSystem(SqliteEngine(Path(os.getenv("DOCS_SQLITE_PATH", str(root / ".vfs.sqlite3")))))`
  - `"disk"` → `VirtualFileSystem(DiskEngine(root))`
  - 未知名称 `raise ValueError`（fail fast，区别于文件操作的软错误）
  - `root` 为 `None` 时读 `DOCS_WORKSPACE_DIR`（默认 `./workspace`）并 resolve
  `agent.py` 的 `graph` 使用 `backend=create_backend(root=WORKSPACE_ROOT)`。

- [ ] **Step 1: 写失败测试**

`tests/test_vfs_factory.py`：

```python
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
```

- [ ] **Step 2: 运行确认失败**

Run: `wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /home/zhang/workplace/research_deepagent && uv run pytest tests/test_vfs_factory.py -q"`
Expected: FAIL，`ModuleNotFoundError: No module named 'research_deepagent.vfs.factory'`

- [ ] **Step 3: 实现工厂并接入 agent.py**

`src/research_deepagent/vfs/factory.py`：

```python
"""按名称构造自研 VFS 后端的工厂。"""

from __future__ import annotations

import os
from pathlib import Path

from deepagents.backends.protocol import BackendProtocol

from research_deepagent.vfs.engine import DiskEngine, MemoryEngine, SqliteEngine
from research_deepagent.vfs.vfs import VirtualFileSystem

KNOWN_BACKENDS = ("memory", "sqlite", "disk")


def create_backend(
    name: str | None = None, root: Path | None = None
) -> BackendProtocol:
    """构造自研后端。

    Args:
        name: ``memory`` / ``sqlite`` / ``disk``；``None`` 时读
            ``DOCS_BACKEND`` 环境变量，默认 ``disk``。
        root: 工作区根目录；``None`` 时读 ``DOCS_WORKSPACE_DIR``（默认
            ``./workspace``）并 resolve。

    Raises:
        ValueError: 未知后端名称（fail fast）。
    """
    backend_name = (name if name is not None else os.getenv("DOCS_BACKEND", "disk")).strip().lower()
    root_dir = (
        root
        if root is not None
        else Path(os.getenv("DOCS_WORKSPACE_DIR", "./workspace"))
    ).resolve()

    if backend_name == "memory":
        return VirtualFileSystem(MemoryEngine())
    if backend_name == "sqlite":
        db_path = Path(
            os.getenv("DOCS_SQLITE_PATH", str(root_dir / ".vfs.sqlite3"))
        )
        return VirtualFileSystem(SqliteEngine(db_path))
    if backend_name == "disk":
        return VirtualFileSystem(DiskEngine(root_dir))
    supported = ", ".join(KNOWN_BACKENDS)
    msg = f"Unknown DOCS_BACKEND={backend_name!r}. Expected one of: {supported}."
    raise ValueError(msg)
```

`src/research_deepagent/vfs/__init__.py`：

```python
"""自研虚拟文件系统：引擎 + deepagents BackendProtocol 适配层。"""

from research_deepagent.vfs.engine import DiskEngine, MemoryEngine, SqliteEngine, StorageEngine
from research_deepagent.vfs.factory import create_backend
from research_deepagent.vfs.vfs import VirtualFileSystem

__all__ = [
    "DiskEngine",
    "MemoryEngine",
    "SqliteEngine",
    "StorageEngine",
    "VirtualFileSystem",
    "create_backend",
]
```

`src/research_deepagent/agent.py` 两处修改：

1. 第 16 行 `from deepagents.backends import FilesystemBackend` 删除，在
   `from research_deepagent.tools import tavily_search` 一行旁加：
   ```python
   from research_deepagent.vfs import create_backend
   ```
2. 第 181 行：
   ```python
       backend=FilesystemBackend(root_dir=WORKSPACE_ROOT),
   ```
   改为：
   ```python
       backend=create_backend(root=WORKSPACE_ROOT),
   ```

`README.md` 环境变量表追加两行：

```markdown
| `DOCS_BACKEND` | 文档存储后端：`memory` / `sqlite` / `disk`，默认 `disk` |
| `DOCS_SQLITE_PATH` | `sqlite` 后端的数据库文件路径，默认 `<DOCS_WORKSPACE_DIR>/.vfs.sqlite3` |
```

`.env.example` 末尾追加：

```text

# --- 文档存储后端（自研 VFS） ---
# DOCS_BACKEND=disk           # memory / sqlite / disk，默认 disk
# DOCS_SQLITE_PATH=           # sqlite 后端数据库文件，默认 <DOCS_WORKSPACE_DIR>/.vfs.sqlite3
```

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /home/zhang/workplace/research_deepagent && uv run pytest tests/ -q"`
Expected: 全部通过（含 `test_graph_build.py`，它验证 agent.py 模块可导入且图可构建）

- [ ] **Step 5: Commit**

```bash
git add src/research_deepagent/vfs src/research_deepagent/agent.py README.md .env.example tests/test_vfs_factory.py
git commit -m "feat(vfs): wire create_backend factory into agent with DOCS_BACKEND switch"
```

---

### Task 8: 微基准对比实验 + 报告

**Files:**
- Create: `benchmarks/__init__.py`（空）
- Create: `benchmarks/vfs_benchmark.py`
- Create（脚本产物）: `trace/vfs-benchmark-results.csv`、`trace/vfs-benchmark-report.md`

**Interfaces:**
- Consumes: `create_backend(name, root)`（Task 7）；`VirtualFileSystem` 全部文件方法（Task 4-6）。
- Produces: 可重复执行的实验入口 `uv run python -m benchmarks.vfs_benchmark`；两个 trace 产物。场景矩阵 = 文件大小 {small≈1KB, medium≈50KB, large≈500KB} × 操作 {write, read, edit, grep, glob, ls} × 后端 {memory, sqlite, disk}；每操作 20 轮取中位数与 P95；正确性闸门先行（断言失败即抛 `AssertionError` 终止，不产出报告）。

- [ ] **Step 1: 编写基准脚本**

`benchmarks/__init__.py`：空文件。

`benchmarks/vfs_benchmark.py`：

```python
"""自研 VFS 三种存储后端的文件工具微基准。

运行::

    uv run python -m benchmarks.vfs_benchmark

产物：

- ``trace/vfs-benchmark-results.csv``：原始计时数据
- ``trace/vfs-benchmark-report.md``：对比表格与结论

实验设计（对应 spec 2026-09-19）：

- 场景矩阵：文件大小 {small, medium, large} x 操作 {write, read, edit, grep,
  glob, ls} x 后端 {memory, sqlite, disk}
- 每操作先预热 1 轮（不计入），再计时 ``ROUNDS`` 轮，报告中位数与 P95
- 正确性闸门：每个 (后端, 大小) 组合先跑断言集，失败即终止且不产出报告
"""

from __future__ import annotations

import csv
import statistics
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

from research_deepagent.vfs import create_backend

ROUNDS = 20
FILE_COUNT = 20
SIZES = {"small": 1_000, "medium": 50_000, "large": 500_000}
BACKEND_NAMES = ("memory", "sqlite", "disk")
TRACE_DIR = Path("trace")


def _make_content(size: int, index: int) -> str:
    """构造约 ``size`` 字符的确定性文档，内含每文件唯一的编辑锚点。"""
    lines: list[str] = []
    total = 0
    i = 0
    while total < size:
        line = f"line {i:06d} file {index:03d} sentinel lorem ipsum dolor sit amet\n"
        lines.append(line)
        total += len(line)
        i += 1
    lines[index % len(lines)] = f"unique-anchor-{index:03d}\n"
    return "".join(lines)


def _populate(backend, size: int) -> dict[str, str]:
    """写入 FILE_COUNT 个文件，返回 {路径: 编辑锚点}。"""
    anchors: dict[str, str] = {}
    for index in range(FILE_COUNT):
        path = f"/d{index % 4}/f{index:03d}.md"
        assert backend.write(path, _make_content(size, index)).error is None
        anchors[path] = f"unique-anchor-{index:03d}"
    return anchors


def _timed(setup, op) -> list[float]:
    """预热 1 轮后计时 ROUNDS 轮 op() 的耗时（秒）。"""
    setup()
    op()
    samples: list[float] = []
    for _ in range(ROUNDS):
        setup()
        start = time.perf_counter()
        op()
        samples.append(time.perf_counter() - start)
    return samples


def _p95(samples: list[float]) -> float:
    ordered = sorted(samples)
    return ordered[min(len(ordered) - 1, int(0.95 * (len(ordered) - 1)))]


def _check_correctness(backend, size: int) -> None:
    """正确性闸门：任一断言失败即抛 AssertionError。"""
    path = "/checks/c.md"
    content = _make_content(size, 0)
    assert backend.write(path, content).error is None

    read = backend.read(path)
    assert read.error is None
    assert read.file_data["content"] == content
    assert read.total_lines == len(content.rstrip("\n").split("\n"))

    window = backend.read(path, offset=2, limit=3)
    assert window.error is None
    assert window.start_line == 3 and window.end_line == 5
    assert window.next_offset == 5

    anchor = "unique-anchor-000"
    edit = backend.edit(path, anchor, "edited-anchor")
    assert edit.error is None and edit.occurrences == 1
    assert backend.edit(path, anchor, "x").error is not None  # 锚点已消耗

    grep = backend.grep("sentinel")
    assert grep.error is None and grep.matches
    assert backend.grep("sentinel", max_count=1).truncated is True

    globbed = backend.glob("**/*.md")
    assert globbed.error is None
    assert any(m["path"] == path for m in globbed.matches)

    listed = backend.ls("/")
    assert listed.error is None and listed.entries

    assert backend.delete(path).error is None
    assert backend.read(path).error is not None


def _bench_operations(backend, name: str, size: int) -> list[dict[str, object]]:
    anchors = _populate(backend, size)
    target_path = "/d0/f000.md"
    target_content = _make_content(size, 0)
    anchor = anchors[target_path]

    def reset_target() -> None:
        backend.delete(target_path)  # 首轮不存在，忽略 DeleteResult.error

    scenarios = {
        "write": (reset_target, lambda: backend.write(target_path, target_content)),
        "read": (lambda: None, lambda: backend.read(target_path)),
        "edit": (
            lambda: backend.write(target_path, target_content),
            lambda: backend.edit(target_path, anchor, "edited-anchor"),
        ),
        "grep": (lambda: None, lambda: backend.grep("sentinel")),
        "glob": (lambda: None, lambda: backend.glob("**/*.md")),
        "ls": (lambda: None, lambda: backend.ls("/")),
    }

    rows: list[dict[str, object]] = []
    for op_name, (setup, op) in scenarios.items():
        samples = _timed(setup, op)
        rows.append(
            {
                "backend": name,
                "size": size,
                "op": op_name,
                "median_ms": statistics.median(samples) * 1000,
                "p95_ms": _p95(samples) * 1000,
            }
        )
    return rows


def main() -> None:
    TRACE_DIR.mkdir(exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="vfs-bench-"))
    rows: list[dict[str, object]] = []

    for name in BACKEND_NAMES:
        for size_name, size in SIZES.items():
            root = tmp / f"{name}-{size_name}"
            root.mkdir(parents=True, exist_ok=True)
            backend = create_backend(name, root=root)
            _check_correctness(backend, size)  # 正确性闸门
            rows.extend(_bench_operations(backend, name, size))

    _write_csv(rows)
    _write_report(rows)
    print(f"Benchmark complete: {len(rows)} rows -> trace/vfs-benchmark-results.csv")


def _write_csv(rows: list[dict[str, object]]) -> None:
    with (TRACE_DIR / "vfs-benchmark-results.csv").open(
        "w", newline="", encoding="utf-8"
    ) as handle:
        writer = csv.DictWriter(
            handle, fieldnames=["backend", "size", "op", "median_ms", "p95_ms"]
        )
        writer.writeheader()
        writer.writerows(rows)


def _write_report(rows: list[dict[str, object]]) -> None:
    size_names = {1_000: "small(~1KB)", 50_000: "medium(~50KB)", 500_000: "large(~500KB)"}
    lines = [
        "# 自研 VFS 存储后端微基准报告",
        "",
        f"生成时间：{datetime.now(UTC).isoformat()}",
        "",
        f"方法：文件数 {FILE_COUNT}，每操作预热 1 轮 + 计时 {ROUNDS} 轮，"
        "报告中位数与 P95；每个 (后端, 大小) 组合先通过正确性闸门。",
        "",
        "| backend | size | op | median (ms) | p95 (ms) |",
        "|---|---|---|---|---|",
    ]
    for row in rows:
        lines.append(
            f"| {row['backend']} | {size_names[row['size']]} | {row['op']} "
            f"| {row['median_ms']:.3f} | {row['p95_ms']:.3f} |"
        )

    lines += ["", "## 结论", ""]
    scenes: dict[tuple[int, str], list[dict[str, object]]] = {}
    for row in rows:
        scenes.setdefault((row["size"], row["op"]), []).append(row)
    for (size, op), candidates in sorted(scenes.items()):
        fastest = min(candidates, key=lambda r: r["median_ms"])
        lines.append(
            f"- {size_names[size]} / {op}：最快 {fastest['backend']}"
            f"（中位数 {fastest['median_ms']:.3f} ms）"
        )
    lines += [
        "",
        "预期模式：memory 无 IO 开销最快；disk 受文件系统调用主导；"
        "sqlite 每次写提交事务，写放大最明显，但 grep/glob 等枚举类操作"
        "与 disk 同受全量 keys() 扫描主导。具体数字以上表为准。",
    ]

    (TRACE_DIR / "vfs-benchmark-report.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 运行实验**

Run: `wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /home/zhang/workplace/research_deepagent && uv run python -m benchmarks.vfs_benchmark"`
Expected: 退出码 0，打印 `Benchmark complete: 54 rows ...`（3 后端 × 3 大小 × 6 操作），`trace/` 下生成两个文件。

- [ ] **Step 3: 检查产物**

Run: `wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /home/zhang/workplace/research_deepagent && head -20 trace/vfs-benchmark-report.md && wc -l trace/vfs-benchmark-results.csv"`
Expected: 报告含标题、方法说明与表格表头；CSV 55 行（表头 + 54 数据行）。

- [ ] **Step 4: 全量回归**

Run: `wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /home/zhang/workplace/research_deepagent && uv run pytest tests/ -q"`
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add benchmarks trace/vfs-benchmark-results.csv trace/vfs-benchmark-report.md
git commit -m "feat(bench): add VFS backend micro-benchmark with comparison report"
```

---

## 完成定义

- [ ] `uv run pytest tests/ -q` 全绿（含三引擎参数化的协议一致性用例）
- [ ] `agent.py` 经 `DOCS_BACKEND` 可在 memory/sqlite/disk 间切换，默认 `disk` 与原 `FilesystemBackend` 行为等价（普通文件落盘 `workspace/`）
- [ ] `uv run python -m benchmarks.vfs_benchmark` 可重复运行并刷新 `trace/` 下报告与 CSV
- [ ] README / `.env.example` 记录新环境变量
