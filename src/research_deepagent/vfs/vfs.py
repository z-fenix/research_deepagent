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
