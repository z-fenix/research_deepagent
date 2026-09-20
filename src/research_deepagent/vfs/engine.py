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
