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
