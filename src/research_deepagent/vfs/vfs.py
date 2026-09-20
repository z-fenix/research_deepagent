"""VirtualFileSystem：deepagents BackendProtocol 语义的一次性实现。

文件语义（路径校验、分页读、字符串编辑等）全部在此实现，存储委托给
可插拔的 ``StorageEngine``。语义函数尽量复用 ``deepagents.backends.utils``
（与上游 ``StateBackend`` 同源），保证与库内置后端行为一致。
"""

from __future__ import annotations

import sqlite3

from deepagents.backends.protocol import (
    BackendProtocol,
    DeleteResult,
    EditResult,
    FileData,
    FileDownloadResponse,
    FileInfo,
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

from research_deepagent.vfs.engine import StorageEngine

# 引擎层可能抛出的 IO/存储异常（如 DiskEngine 的 OSError、SqliteEngine 的
# sqlite3.Error）：VFS 公开方法一律捕获并映射为结构化 error 字段，对齐上游
# FilesystemBackend 的 except (OSError, UnicodeDecodeError) 包装风格。
_ENGINE_ERRORS = (OSError, UnicodeDecodeError, sqlite3.Error, RuntimeError)


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
        """当前全部文件快照，供 grep/glob 等全量扫描语义使用。

        注：keys() 与 get() 两段之间无原子性（TOCTOU）；单用户 agent 场景
        下这是有意取舍，不做加锁快照。
        """
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
        try:
            if self.engine.keys(file_path + "/"):
                # 跨引擎一致：同名目录已存在时返回结构化 error，不静默冲突。
                return WriteResult(error=f"Error: '{file_path}' is a directory")
            existing = self.engine.get(file_path)
            new_file_data = (
                update_file_data(existing, content)
                if existing is not None
                else create_file_data(content)
            )
            self.engine.put(file_path, new_file_data)
        except _ENGINE_ERRORS as exc:
            return WriteResult(error=f"Error writing file '{file_path}': {exc}")
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
        try:
            file_data = self.engine.get(file_path)
        except _ENGINE_ERRORS as exc:
            return ReadResult(error=f"Error reading file '{file_path}': {exc}")
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
        try:
            file_data = self.engine.get(file_path)
        except _ENGINE_ERRORS as exc:
            return EditResult(error=f"Error editing file '{file_path}': {exc}")
        if file_data is None:
            return EditResult(error=f"Error: File '{file_path}' not found")
        result = perform_string_replacement(
            file_data["content"], old_string, new_string, replace_all
        )
        if isinstance(result, str):
            return EditResult(error=result)
        new_content, occurrences = result
        try:
            self.engine.put(file_path, update_file_data(file_data, new_content))
        except _ENGINE_ERRORS as exc:
            return EditResult(error=f"Error editing file '{file_path}': {exc}")
        return EditResult(path=file_path, occurrences=int(occurrences))

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
        try:
            keys = self.engine.keys(prefix)
            for key in keys:
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
                        "modified_at": file_data.get("modified_at", "")
                        if file_data
                        else "",
                    }
                )
        except _ENGINE_ERRORS as exc:
            return LsResult(error=f"Error listing directory '{normalized}': {exc}")
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
        try:
            to_delete = [
                key
                for key in self.engine.keys()
                if key == base or key.startswith(prefix)
            ]
        except _ENGINE_ERRORS as exc:
            return DeleteResult(error=f"Error deleting file '{file_path}': {exc}")
        if not to_delete:
            return DeleteResult(error=f"Error: File '{file_path}' not found")
        try:
            for key in to_delete:
                self.engine.delete(key)
        except _ENGINE_ERRORS as exc:
            return DeleteResult(error=f"Error deleting file '{file_path}': {exc}")
        return DeleteResult(path=file_path)

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
        try:
            return grep_matches_from_files(
                self._snapshot(),
                pattern,
                path if path is not None else "/",
                glob,
                max_count=max_count,
            )
        except _ENGINE_ERRORS as exc:
            return GrepResult(error=f"Error searching files: {exc}")

    def glob(self, pattern: str, path: str | None = None) -> GlobResult:
        try:
            result = _glob_search_files(self._snapshot(), pattern, path)
        except InvalidGlobPatternError as exc:
            return GlobResult(error=str(exc))
        except _ENGINE_ERRORS as exc:
            return GlobResult(error=f"Error searching files: {exc}")
        if result == "No files found":
            return GlobResult(matches=[])
        infos = []
        for matched_path in result.split("\n"):
            try:
                file_data = self.engine.get(matched_path)
            except _ENGINE_ERRORS:
                file_data = None
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
            try:
                existing = self.engine.get(file_path)
                file_data = (
                    update_file_data(existing, text)
                    if existing is not None
                    else create_file_data(text)
                )
                self.engine.put(file_path, file_data)
            except _ENGINE_ERRORS as exc:
                responses.append(
                    FileUploadResponse(
                        path=path, error=f"Error uploading file '{path}': {exc}"
                    )
                )
                continue
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
            try:
                file_data = self.engine.get(file_path)
            except _ENGINE_ERRORS as exc:
                responses.append(
                    FileDownloadResponse(
                        path=path,
                        content=None,
                        error=f"Error downloading file '{path}': {exc}",
                    )
                )
                continue
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
