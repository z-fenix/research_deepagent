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
