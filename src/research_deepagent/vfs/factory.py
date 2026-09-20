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
