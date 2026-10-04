# 开发文档：双层长期记忆（/memories/agent/ · /memories/user/）

> 对应《Deep Agents》第 8 章「长期记忆」。本文面向本仓库的开发者，说明
> 双层跨对话记忆（Agent 级 + 用户级）在 PRD→BDD→SDD 文档生成流水线中的
> 接线方式、namespace 设计、写入约定、测试与故障排查。

## 1. 能力概述

Orchestrator 拥有双层跨对话记忆，每次运行由 `MemoryMiddleware` 把记忆文件
注入 system prompt：

- **Agent 级**（`/memories/agent/AGENTS.md`）：跨用户共享，存放「以后都
  这样做」的自我改进指令；
- **用户级**（`/memories/user/preferences.md`）：按 `user_id` 隔离，存放
  当前用户的个人偏好。

两类记忆都落在 LangGraph `BaseStore`（跨 thread 持久化），经
`CompositeBackend` 路由从统一文件系统路径 `/memories/<scope>/...` 读写，
Agent 无感知地用既有 `read_file` / `write_file` / `edit_file` 工具访问。

## 2. 设计决策

| 决策 | 理由 |
|---|---|
| `CompositeBackend(default=backend, routes=...)` 包裹原 backend，而非替换 | 阶段文档仍走原 VFS workspace backend（memory / sqlite / disk，见 `src/research_deepagent/vfs/factory.py`）；只有 `/memories/<scope>/` 前缀命中才路由到 StoreBackend，两个存储面互不干扰 |
| `store` 参数不传（生产路径），平台注入 | `StoreBackend(store=None)` 在调用时经 `get_store()` 从 LangGraph 执行上下文取 store（deepagents `backends/store.py` 的 `StoreBackend._get_store`）；agentseek / `langgraph dev` 按部署配置注入，图自身保持可嵌入（模式同 todo-planning 的 Checkpointer 约定） |
| 缺失记忆文件跳过、不自动创建 | deepagents `MemoryMiddleware` 对 `file_not_found` 直接跳过（首个运行不报错）；首用文件由 Agent 按提示词约定用 `write_file` 创建（见 4.4），框架不预写空模板 |
| 身份解析 `server_info` 优先、`context` 兜底 | 部署运行时（agentseek）经 `rt.server_info` 暴露登录用户与 assistant；本地/测试无 server_info，用 `context=PipelineContext(user_id=...)` 显式注入；最终兜底常量。本期前端不传身份，统一落 `local-user`，隔离结构就位、多用户只差身份注入 |
| 不引 Postgres 依赖 | PostgresStore 属部署侧升级（见 §5），仓库代码面保持 `BaseStore` 抽象即可 |

## 3. 架构与数据流

```
system prompt 注入（每次运行）
   MemoryMiddleware(sources=["/memories/agent/AGENTS.md",
                             "/memories/user/preferences.md"])
   │  read_file 走 CompositeBackend → 命中 /memories/<scope>/ 前缀
   ▼
CompositeBackend
   ├─ /memories/agent/… ──▶ StoreBackend(namespace=(assistant_id, "memories"))
   ├─ /memories/user/…  ──▶ StoreBackend(namespace=(user_id, "memories"))
   └─ 其余路径          ──▶ default backend（VFS workspace，原样）

读写同一张路由表：Agent 用 edit_file 追加偏好 → StoreBackend
   → BaseStore.put((user_id, "memories"), "/preferences.md", …)
   → 下次运行（任意 thread）注入新 system prompt
```

关键文件：

| 文件 | 职责 |
|---|---|
| `src/research_deepagent/context.py` | `PipelineContext` / `resolve_user_id` / `resolve_assistant_id`（身份解析） |
| `src/research_deepagent/agent.py` | `_memory_routes()`（agent.py:227）、`MEMORY_SOURCES`（agent.py:245）、`build_deep_agent(store=...)` 接线（agent.py:248） |
| `src/research_deepagent/prompts.py` | 「长期记忆（memory）」写入约定一节（prompts.py:64） |
| `tests/test_memory.py` | 路由隔离、缺失文件跳过、store 透传的行为验证 |
| `tests/test_context.py` | 身份解析优先级与兜底常量 |

## 4. 后端实现

### 4.1 双层 namespace 路由

`_memory_routes()`（`src/research_deepagent/agent.py:227`）：

| 路由前缀 | namespace | `memory=` 注入文件 | 语义 |
|---|---|---|---|
| `/memories/agent/` | `(assistant_id, "memories")` | `/memories/agent/AGENTS.md`（agent.py:245） | Agent 级，跨用户共享，自我改进指令 |
| `/memories/user/` | `(resolve_user_id(rt), "memories")` | `/memories/user/preferences.md` | 用户级，按 `user_id` 隔离，个人偏好 |

两个关键形态（`.venv` 实证，deepagents 0.7.13）：

- **前缀剥离**：CompositeBackend 命中 `/memories/<scope>/` 后剥离前缀并
  保证剩余路径以 `/` 开头，故 `store` 里的 key 是相对路径
  `/AGENTS.md`、`/preferences.md`（`tests/test_memory.py` 模块 docstring）；
- **注入形态**：`create_deep_agent(memory=[...])` 构造
  `MemoryMiddleware(backend, sources=memory, add_cache_control=True)`
  （deepagents `graph.py:910`）；每次运行把源文件内容（含路径标题）注入
  system prompt——预置内容出现在 system 文本即证明路由与透传同时生效
  （`test_store_passthrough_to_graph`）。

### 4.2 身份解析（`src/research_deepagent/context.py`）

| 函数 | 解析顺序 | 兜底 |
|---|---|---|
| `resolve_user_id(rt)`（context.py:17） | `rt.server_info.user.identity` → `rt.context.user_id` | `"local-user"` |
| `resolve_assistant_id(rt)`（context.py:30） | `rt.server_info.assistant_id` | `ASSISTANT_ID_FALLBACK = "research"`（context.py:9，即 langgraph.json 的 graph 键名） |

调用侧：`build_deep_agent` 给 `create_deep_agent` 传
`context_schema=PipelineContext`（agent.py:277），调用方用
`graph.invoke(..., context=PipelineContext(user_id="user-b"))` 切换用户。
namespace 工厂在 StoreBackend 内部拿到运行时后调用上述函数，因此**同一条
路由对不同请求解析出不同 namespace**，隔离由解析结果保证。

### 4.3 缺失文件行为

`MemoryMiddleware` 加载 `sources` 时对 `file_not_found` 跳过、不报错、不
注入（`tests/test_memory.py:119`
`test_missing_memory_files_are_skipped`）。因此：

- 全新部署（store 为空）第一次运行即可正常启动，system prompt 显示
  「(No memory loaded)」；
- 记忆文件**不会**被框架自动创建——首条写入由 Agent 按提示词约定发起。

### 4.4 写入约定（提示词契约）

`ORCHESTRATOR_INSTRUCTIONS` 的「长期记忆（memory）」一节
（`src/research_deepagent/prompts.py:64`）约定：

- **读**：启动注入的偏好/指令即当前记忆，无需主动读取；
- **写**：用户明确要求记住时，先读目标文件，再用 `edit_file` 追加或修订、
  **保留其他既有条目，禁止用 `write_file` 整体覆盖既有记忆**；文件尚不存在
  时才可用 `write_file` 创建；写入成功后才向用户确认；
- **写到哪**：Agent 级指令（「以后都这样做」）→ AGENTS.md；个人偏好 →
  preferences.md；**不另建记忆文件**。

契约由 `test_orchestrator_prompt_declares_memory_conventions`
（`tests/test_hitl.py:116`）钉住：改措辞需同步改断言，否则测试失败即提示
契约漂移。

## 5. 运行时与部署

- **本地开发（store 注入：验证待定，部署门禁）**：`uv run langgraph dev` /
  `agentseek` 运行时**预期**由平台注入 store，记忆方可跨 thread 持久化；
  该假设尚未实证——若运行时未注入 store，`get_store()` 返回 None，
  `MemoryMiddleware` 会在每次运行时抛错。**部署门禁**：部署前在真实运行时
  （`langgraph dev` / agentseek）跑 `scripts/async_smoke.py`（步骤 a + e，
  见脚本 docstring）实证；若未注入，先在部署配置中配置 store。单测用
  `build_deep_agent(store=InMemoryStore())` 显式传入（`InMemoryStore` 需要
  `store.put` 预置，格式 `create_file_data(content)`，见
  `tests/test_memory.py` 的 `_seeded_store`）。
- **无 store 直接调 StoreBackend 会崩**：`get_store()` 抛出
  RuntimeError（要求在图执行上下文内或显式传 store）——生产路径不会发生
  （`create_deep_agent` 总在图上下文中执行中间件），裸调后端做实验时注意。
- **PostgresStore 升级路径**（不引依赖）：把平台侧注入的 store 从内存实现
  换成 LangGraph 自带的 `langgraph.store.postgres.PostgresStore`（部署配置
  层面，通常在 agentseek / langgraph-platform 的 store 配置或自定义
  server 装配中指定连接串）。仓库代码无需改动——`build_deep_agent(store=)`
  与 StoreBackend 都只依赖 `BaseStore` 抽象；换库后同一 namespace 数据
  原样迁移即可获得真正的跨进程持久化。

## 6. 测试

### 6.1 `tests/test_context.py`（8 条）

| 用例 | 验证点 |
|---|---|
| `test_resolve_user_id_prefers_server_info` | server_info.user.identity 优先 |
| `test_resolve_user_id_falls_back_to_context` | 无 server_info 时回退 `context.user_id` |
| `test_resolve_user_id_defaults_to_local_user` | 两者皆无 → `"local-user"` |
| `test_resolve_assistant_id_falls_back_to_constant` | assistant_id 兜底常量 `"research"` |

### 6.2 `tests/test_memory.py`（3 条）

| 用例 | 验证点 |
|---|---|
| `test_user_memory_scoped_by_user_id` | A 的偏好注入 A 的 system prompt；换 `user_id="user-b"` 后不注入（隔离）；AGENTS.md 对两个用户都注入（agent 级共享） |
| `test_missing_memory_files_are_skipped` | 空 store 不报错、不注入 |
| `test_store_passthrough_to_graph` | `store=` 透传生效：种子内容经路由出现在 system prompt |

测试技术要点：捕获 system prompt 的 `_SystemCapturingChatModel` 沿用
`tests/test_skills.py` 已实证的实现（pydantic 字段声明 + `_generate`
覆写）；预置用 `store.put((scope, "memories"), "/<file>", create_file_data(...))`。

### 6.3 运行

```bash
uv run pytest tests/test_context.py tests/test_memory.py -q   # 单独运行（11 passed）
uv run pytest tests/ -q                                       # 全量（219 passed, 1 warning）
```

唯一 warning 是基线内已知的 `google/genai` DeprecationWarning，与本能力无关。

## 7. 扩展指南

- **新增记忆文件**（如 `/memories/agent/style.md`）：三处同步——
  `MEMORY_SOURCES`（agent.py:245）加路径、`prompts.py`「长期记忆」一节写
  清何时读写它、`test_orchestrator_prompt_declares_memory_conventions` 的
  断言同步（契约测试即漂移提醒）。
- **新增第三个 scope**（如组织级 `/policies/`）：在 `_memory_routes()`
  加一条路由（namespace 工厂返回 `(assistant_id, "policies")` 等），并在
  `memory=` 列表中加源文件；只读语义靠提示词约定（本期不做，见 spec §8）。
- **接入真实用户身份**：前端/网关把登录态传给平台后，
  `resolve_user_id` 的 server_info 分支自动生效，无需改代码；本地调试用
  `invoke(..., context=PipelineContext(user_id=...))`。

## 8. 故障排查

| 症状 | 排查方向 |
|---|---|
| 偏好未注入 system prompt | ① 预置/写入是否落对了 namespace 与 key：`(user_id, "memories")` + `/preferences.md`（注意前缀剥离，key 不含 `/memories/user/`）；② `memory=` 路径与路由前缀是否一致（agent.py:245）；③ 身份解析结果：当前请求的 `user_id` 是什么（server_info 优先，本地走 context，缺省 `local-user`）——用 `PipelineContext(user_id=...)` 对齐预置的 namespace |
| 偏好对别的用户可见（隔离失效） | namespace 解析错位：两个请求实际解析出同一 `user_id`（例如都落了 `local-user` 兜底），或路由前缀写错走到了 default backend；对照 `test_user_memory_scoped_by_user_id` 的预置方式复查 |
| 记忆被整体覆盖、旧条目丢失 | Agent 违反写入约定用了 `write_file`：检查 `ORCHESTRATOR_INSTRUCTIONS` 的「长期记忆」一节是否被改动（契约测试 `test_orchestrator_prompt_declares_memory_conventions` 失败即漂移）；必要时从 store 侧恢复数据 |
| 启动即崩，报 "StoreBackend must be used inside a LangGraph graph execution" | StoreBackend 拿不到 store：确认生产路径经 `build_deep_agent`/`langgraph dev`（平台注入）运行；脚本直调时给 `build_deep_agent(store=...)` 或 `StoreBackend(store=...)` 显式传实例 |
| agent 级指令只对部分用户生效 | 该"指令"被写进了用户级 namespace：提示词约定「以后都这样做」→ AGENTS.md；检查 store 中 `("research", "memories")` 与 `(user_id, "memories")` 各自的文件内容 |
