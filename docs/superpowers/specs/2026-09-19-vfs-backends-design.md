# 自研虚拟文件系统与存储后端设计

日期：2026-09-19
状态：已与用户确认设计方向，待实施

## 背景与目标

本项目是基于 deepagents 0.5.x 的 PRD→BDD→SDD 文档生成 Agent。deepagents 提供
`BackendProtocol`（ls/read/write/edit/grep/glob/upload/download）作为 VFS 抽象，
文件工具运行在该协议之上；`agent.py` 目前直接使用库自带的 `FilesystemBackend`。

目标：

1. 自研一套虚拟文件系统（VFS）与至少两种存储后端，对齐 deepagents 的
   `BackendProtocol`，使 deepagents 文件工具可直接运行在自研后端上。
2. 以文件工具微基准完成至少两种后端的对比实验，产出实验报告。
3. 通过环境变量开关接入主 Agent 流程，可在后端间切换。

经确认的决策：

- **自研后端**（不直接对比库内置后端），共三种：内存、SQLite、磁盘。
- **对比实验**为文件工具微基准（延迟/吞吐/正确性），不做端到端 Agent 实验。
- **接入主流程**：`agent.py` 增加 `DOCS_BACKEND` 环境变量开关。

## 架构（引擎/语义分层）

核心思想：文件语义只实现一次，存储由可插拔引擎承担。

```
deepagents 文件工具 (ls/read_file/write_file/edit_file/glob/grep)
        │
        ▼
VirtualFileSystem (实现 deepagents BackendProtocol)
        │  全部文件语义：路径规范化、read 分页、edit 唯一性、
        │  grep 字面量匹配、glob、递归 delete、批量 upload/download
        ▼
StorageEngine (自研极简 KV 接口)
   ├── MemoryEngine   dict
   ├── SqliteEngine   单文件 SQLite
   └── DiskEngine     真实目录树
```

- 备选方案「每个后端独立实现 BackendProtocol」被否决：十余个方法 × 三份实现，
  语义漂移风险高、维护成本大。
- `StorageEngine` 只负责「路径 → 文本内容」的存储与枚举，不含任何文件语义。

## 组件设计

新模块 `src/research_deepagent/vfs/`：

### `engine.py` — 存储引擎接口

`StorageEngine` ABC，四个方法：

- `get(path: str) -> str | None`：读取文件内容，不存在返回 `None`。
- `put(path: str, content: str) -> None`：写入或覆盖。
- `delete(path: str) -> None`：删除（不存在则静默）。
- `keys(prefix: str = "") -> list[str]`：按前缀枚举所有路径，排序返回。

实现：

- `MemoryEngine`：`dict[str, str]`，无持久化，进程内可见。
- `SqliteEngine`：单文件 SQLite；表 `files(path TEXT PRIMARY KEY, content TEXT,
  created_at TEXT, modified_at TEXT)`；开启 WAL；`check_same_thread=False`
  配合 `threading.Lock` 串行化访问（deepagents 可能在线程池调用）。
- `DiskEngine`：真实目录树；路径映射为 `<root>/<path>` 下的普通文件；metadata
  （size/modified_at）从 `os.stat` 取。落盘格式与 `FilesystemBackend` 兼容
  （即普通文件），现有 `workspace/` 内容不受影响。

### `vfs.py` — VirtualFileSystem（BackendProtocol 适配层）

继承 `deepagents.backends.protocol.BackendProtocol`，实现全部文件操作：

- **路径规范化**：必须以 `/` 开头；拒绝 `..` 段与空段；磁盘映射时剥离前导 `/`。
- **read**：分页语义对齐 protocol——支持 `offset`/`limit`，负 `offset` 从首行
  读，非正 `limit` 返回空窗口（`no_lines_requested`）；返回 `ReadResult` 并
  正确设置 `start_line`/`end_line`/`total_lines`/`next_offset`。
- **write**：创建或整体覆盖；返回 `WriteResult(path=...)`。
- **edit**：`old_string` 唯一匹配才替换；非唯一且未指定 `replace_all` 报错；
  找不到报错；返回 `EditResult(path=..., occurrences=...)`。
- **delete**：精确路径 + 按前缀递归删除（目录语义）。
- **ls**：列目录直接子项（文件与目录），`LsResult(entries=[FileInfo...])`，
  `FileInfo` 含 `path`/`is_dir`/`size`/`modified_at`（引擎能提供则提供）。
- **grep**：字面量子串匹配（非正则），可选 `path` 限定目录、`glob` 过滤文件、
  `max_count` 截断（截断置 `truncated=True`）；返回 `GrepResult(matches=...)`。
- **glob**：`*`/`**`/`?`/`[abc]`/`{a,b}` 语义，无 `/` 的模式按 basename 在任意
  深度匹配；只返回普通文件；返回 `GlobResult`。
- **upload_files / download_files**：批量按序返回
  `FileUploadResponse`/`FileDownloadResponse`，逐文件报告
  `file_not_found`/`invalid_path` 等标准错误。

### `factory.py` — 后端工厂

`create_backend(name: str, root: Path) -> BackendProtocol`：

- `"memory"` → `VirtualFileSystem(MemoryEngine())`
- `"sqlite"` → `VirtualFileSystem(SqliteEngine(db_path))`
- `"disk"`（默认）→ `VirtualFileSystem(DiskEngine(root))`
- 未知名称抛 `ValueError`。

## 主流程接入

`agent.py`：

```python
from research_deepagent.vfs import create_backend

backend = create_backend(os.getenv("DOCS_BACKEND", "disk"), WORKSPACE_ROOT)
graph = create_deep_agent(..., backend=backend)
```

新增环境变量（写入 README 与 `.env.example`）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `DOCS_BACKEND` | `disk` | `memory` / `sqlite` / `disk` |
| `DOCS_SQLITE_PATH` | `<WORKSPACE_ROOT>/.vfs.sqlite3` | `sqlite` 后端的数据库文件路径 |

`memory` 后端仅用于实验与测试（文档不落盘，进程结束即失）；默认 `disk` 保持
现有行为等价。

## 对比实验

`benchmarks/vfs_benchmark.py`，运行方式 `uv run python -m benchmarks.vfs_benchmark`
（`benchmarks/` 放在仓库根，不进安装包）。

**场景矩阵**：文件大小 {小 ~1KB, 中 ~50KB, 大 ~500KB} × 操作 {write, read, edit,
grep, glob, ls} × 后端 {memory, sqlite, disk}。

**计时方法**：每场景预热 1 次，随后 20 轮计时取中位数与 P95；
`time.perf_counter` 计时；每轮操作间重建或清理状态以保证独立（write 前删除目标
文件，edit 使用固定可唯一匹配的锚点）。

**正确性闸门**：计时前先对每个后端跑断言集——写读一致、edit 唯一性语义、grep
命中数、glob 结果集、read 分页边界。任何断言失败，该后端该项记 `FAIL`，不参与
性能对比。

**输出**：

- `trace/vfs-benchmark-report.md`：对比表格（后端 × 操作 × 大小，中位数与
  P95）+ 正确性结果 + 简短结论。
- `trace/vfs-benchmark-results.csv`：原始计时数据。

## 测试（TDD）

`tests/vfs/`：

- `conftest.py` 提供参数化 fixture，把**同一组协议一致性用例**跑遍三个引擎
  （用 tmp_path 提供 sqlite/disk 的落盘位置）。用例覆盖：路径校验（`..`、
  非 `/` 开头）、write/read 往返、read 分页（offset/limit/负值/超界）、edit
  唯一匹配与 `replace_all`、grep 字面量与 `max_count`、glob 各通配符语义、
  递归 delete、`upload_files`/`download_files` 错误码。预计约 30 条。
- `tests/test_vfs_factory.py`：工厂与 `DOCS_BACKEND` 切换；`agent.py` 模块在
  `DOCS_BACKEND=memory/sqlite` 下可正常构建图（沿用 `test_graph_build.py` 的
  mock 模型方式）。

## 错误处理

全部对齐 protocol 错误语义：`file_not_found`、`permission_denied`、
`is_directory`、`invalid_path`。文件操作不抛异常穿透到 agent——错误通过
`WriteResult.error`/`EditResult.error`/`ReadResult.error` 等结构化字段返回，
模型可读并自纠。`SqliteEngine` 的连接错误在工厂创建时即暴露（fail fast），
运行期读写异常包装为 `invalid_path` 之外的 backend-specific 错误字符串。

## 明确不做（YAGNI）

- 不做二进制文件内容支持（deepagents 文档生成场景全为文本；`upload_files`
  按 protocol 仍接受 bytes，统一按 utf-8 解码失败时报 backend 错误）。
- 不做端到端 Agent 对比实验。
- 不做并发压力测试（微基准为单线程顺序负载；SQLite 线程安全由锁保证并经
  单测覆盖）。
- 不替换或删除 `FilesystemBackend` 的使用历史；`FilesystemBackend` 不再被
  `agent.py` 引用，但库本身不受影响。
