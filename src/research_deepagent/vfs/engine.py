"""极简存储引擎接口：路径 -> FileData 的 KV 存储，不含任何文件语义。"""

from __future__ import annotations

import abc
import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path

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
        for candidate in self._root.rglob("*"):
            if candidate.is_file():
                vpath = "/" + candidate.relative_to(self._root).as_posix()
                if vpath.startswith(prefix):
                    out.append(vpath)
        # 按虚拟路径字符串序排序，与 MemoryEngine/SqliteEngine 一致
        # （rglob 的 Path 排序按路径分量比较，与字符串序不同）。
        return sorted(out)
