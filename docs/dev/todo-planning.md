# 开发文档：任务规划与分解（write_todos / TodoListMiddleware）

> 对应《Deep Agents》第 4 章「任务规划与分解」。本文面向本仓库的开发者，
> 说明规划能力在 PRD→BDD→SDD 文档生成流水线中的接线方式、数据流、
> 纪律约定、测试与扩展点。

## 1. 能力概述

Orchestrator 在接到需求后，通过 `write_todos` 工具把流水线拆解为任务清单，
并在阶段推进时实时更新状态。清单保存在 Agent State 的 `todos` 字段中，
前端 `TodoDock` 组件实时渲染进度。

设计决策（与第 4 章一致）：

| 决策 | 理由 |
|---|---|
| 规划只在 Orchestrator 层启用 | 三个具名 sub-agent 有独立 Middleware 栈，不追踪共享清单；阶段内的执行细节由各自提示词保证 |
| 图不自带 Checkpointer | 持久化由 AgentSeek 平台（`agentseek-api`）按 `thread_id` 注入；图自身保持可嵌入 |
| `completed` 只作为模型写入的进度标记 | 任务质量由校验器（`validate_user_stories` / `validate_traceability`）与人工门禁另行把关，清单全勾 ≠ 产物合格 |
| `TodoListMiddleware` 显式传入 | deepagents v0.7 不再默认安装；是否启用由应用决定 |

## 2. 架构与数据流

```
用户需求
   │
   ▼
Orchestrator（create_deep_agent + TodoListMiddleware）
   │  1. 开场 write_todos 建立 PRD/BDD/SDD 三项计划
   │  2. 委派 prd-agent → 门禁 → bdd-agent → 门禁 → sdd-agent
   │  3. 每次推进同步更新 todos 状态
   ▼
Agent State["todos"]  ──stream(values)──▶  前端 useAgentStream
   │                                        └─ TodoDock 折叠面板
   └─（平台 Checkpointer 按 thread_id 持久化，跨回合接续）
```

关键文件：

| 文件 | 职责 |
|---|---|
| `src/research_deepagent/agent.py` | `build_deep_agent()` 组装 `TodoListMiddleware` |
| `src/research_deepagent/prompts.py` | Orchestrator 提示词中的规划纪律一节 |
| `tests/test_todos_planning.py` | 规划能力的接线与行为验证 |
| `tests/conftest.py` | 测试环境隔离（禁用 LangSmith 追踪） |
| `frontend/src/lib/stream.ts` | 从 stream `values` 中提取 `todos` |
| `frontend/src/components/todo/TodoDock.tsx` | 可折叠进度面板 |

## 3. 后端实现

### 3.1 Middleware 接线

`build_deep_agent()`（`src/research_deepagent/agent.py:177`）：

```python
def build_deep_agent(model, *, backend, subagents=None):
    """Assemble the orchestrator graph; injectable model/backend for tests.

    TodoListMiddleware provides write_todos + todos state for planning;
    planning itself stays at the orchestrator level (named sub-agents keep
    their own middleware stacks and do not track the shared todo list).
    """
    return create_deep_agent(
        model=model,
        tools=[],
        system_prompt=ORCHESTRATOR_INSTRUCTIONS,
        subagents=subagents if subagents is not None else [prd_agent, bdd_agent, sdd_agent],
        backend=backend,
        middleware=[TodoListMiddleware()],
    )
```

注入后 Agent 获得：

1. `write_todos` 工具 —— 创建/更新任务清单；
2. `todos` 状态字段 —— 与 `messages` 分开保存，默认的对话总结不会删除它；
3. LangChain 内置的规划指导提示词（叠加在 `ORCHESTRATOR_INSTRUCTIONS` 之上）。

`model` 与 `backend` 均可注入，测试用 fake 模型与临时目录 Backend 替换真实依赖。

### 3.2 todos 数据结构

每个条目：

```python
{"content": "SDD 阶段：US-001 登录接口设计", "status": "pending"}
```

三种状态：`pending`（待办）→ `in_progress`（进行中）→ `completed`（完成）。
状态机由提示词纪律约束（见下），框架不强制执行。

### 3.3 Orchestrator 提示词纪律

`ORCHESTRATOR_INSTRUCTIONS` 中的「任务规划（write_todos）」一节
（`src/research_deepagent/prompts.py:40`）：

- **实时更新**：开场建立 todos 后，随阶段推进同步更新；
- **分解粒度挂钩验收产物**：PRD、BDD 阶段各一项；SDD 阶段**每条用户故事一项**
  （SDD 产出物是 `sdd/sdd-US-xxx.md`，一故事一文件，todo 粒度与其对齐）；
- **状态流转纪律**：同一时刻**恰好一个** `in_progress`；置 `completed` 前必须有
  对应验收产物已写入（`brainstorm.md` / `prd.md` / `user_stories.md` /
  `sdd-US-*.md` / `traceability.md`）且通过对应门禁。

这些约束写入提示词是因为 `write_todos` 只是普通工具，框架不会校验状态语义；
纪律由模型在推理时遵守，偏离时通过人工门禁兜底。

### 3.4 与 project_state.md 的分工

| 状态载体 | 生命周期 | 用途 |
|---|---|---|
| `todos`（State） | 单次会话内实时进度，前端展示 | UI 协议：当前步骤与完成百分比 |
| `project_state.md`（VFS） | 跨回合、跨会话的阶段现场 | 恢复现场：`phase` 指示下一步，`gate` 指示门禁状态 |

两者必须保持一致（提示词已要求）；`project_state.md` 是权威来源，`todos`
是展示层投影。

## 4. 前端实现

### 4.1 数据提取

`frontend/src/lib/stream.ts` 从 LangGraph stream 的 `values` 通道提取：

```ts
type StreamState = { messages: Message[]; todos?: TodoItem[] };
const todos = Array.isArray(stream.values?.todos) ? stream.values.todos : [];
```

`useAgentStream` 对外暴露 `{ rows, todos, isLoading, error, submit, stop, threadId, openThread }`。

### 4.2 TodoDock 组件

`frontend/src/components/todo/TodoDock.tsx`：

- `todos.length === 0` 时不渲染；
- 折叠态显示 `Research plan · n/m · pct%`（completed 计数与百分比）；
- 展开态渲染 `ol.todo-list`，每项按 status 着色
  （`--completed` / `--in_progress` / `--pending`）；
- 列表 key 为 `content-index`，content 相同的多条目不会冲突。

## 5. 测试

### 5.1 后端：`tests/test_todos_planning.py`

| 用例 | 验证点 |
|---|---|
| `test_build_deep_agent_exposes_todos_in_state_schema` | 图 state schema 含 `todos` 注解 |
| `test_write_todos_call_persists_into_state` | fake 模型发起 `write_todos` 调用后，payload 原样落入 `result["todos"]` |
| `test_graph_has_no_own_checkpointer` | 图自身 `checkpointer is None`（持久化归平台） |
| `test_orchestrator_prompt_declares_planning_conventions` | 提示词包含分解粒度、状态纪律、产物证据、`project_state.md` 关键约定 |

测试技术要点：

- `_FakeToolChatModel` 继承 `GenericFakeChatModel` 并补上 `bind_tools`
  （默认实现未绑定工具，测试中绑定请求原样返回自身）；
- 消息迭代器用 `itertools.repeat(final_message)` 无限供给最终回答——
  工具调用回合结束后图收到无工具调用的回复即停止，尾部不会真的被消费；
- `built_graph` fixture `monkeypatch` 掉 `DOCS_WORKSPACE_DIR` 并 reload
  `agent_module`，用 `tmp_path` 隔离磁盘 Backend。

运行：

```bash
uv run pytest tests/test_todos_planning.py -q   # 单独运行
uv run pytest tests/ -q                          # 全量（181 passed）
```

### 5.2 前端

```bash
cd frontend && npm test -- --run    # 45 passed，含 todos 提取与 TodoDock 渲染
```

### 5.3 测试环境隔离（重要）

`tests/conftest.py` 在 `load_dotenv()` 运行**之前**设置
`LANGSMITH_TRACING=false` / `LANGCHAIN_TRACING_V2=false`。
项目 `.env` 中的 `LANGSMITH_TRACING=true` 会被 `agent.py` 的
`load_dotenv()` 带进测试进程，每次模型调用都向 `api.smith.langchain.com`
上报（测试环境不可达），导致模型节点卡死、内存膨胀、最终 OOM 崩掉
WSL VM。`load_dotenv()` 默认不覆盖已有环境变量，pytest 先加载
conftest 再导入测试模块的顺序正好满足前置条件。

## 6. 运行时与部署

- **持久化**：图自身不配 Checkpointer。部署到 `agentseek-api` 时由平台按
  `thread_id` 注入持久化 Checkpointer，多次调用间 `todos` 自动接续；
  本地直接 `agentseek-api dev` 运行同理。只加 `TodoListMiddleware`
  **不会**自动接续上次运行的状态。
- **子 Agent**：`subagents=[...]` 声明的三个具名 sub-agent 不读取、不更新
  主 Agent 的清单。若未来某 sub-agent 需要独立规划，必须在其 spec 的
  middleware 栈中另行启用 `TodoListMiddleware`，且其清单存于子 Agent
  自己的 state。
- **上下文压缩协同**：`todos` 与消息历史分开保存，默认对话总结不会删除
  它，长任务压缩后 Agent 仍能据此恢复整体进度。

## 7. 扩展指南

- **自定义规划提示词**：`TodoListMiddleware(system_prompt="...")` 可替换
  LangChain 内置的规划指导；本仓库当前未传，纪律全部写在自己的
  `ORCHESTRATOR_INSTRUCTIONS` 中，两处叠加生效。
- **自定义工具描述**：`TodoListMiddleware(tool_description="...")` 可改写
  `write_todos` 的工具 schema 描述。
- **同名实例替换**：若通过 `middleware=[TodoListMiddleware(custom...)]`
  传入与默认栈同名的实例，是**原位置完整替换**，不会按字段合并新旧配置，
  替换后需重新验证行为。
- **修改分解粒度**：同步改两处——`prompts.py` 的规划一节（运行时行为）与
  `test_orchestrator_prompt_declares_planning_conventions` 的断言（契约），
  两处必须一致，否则测试失败即提示漂移。

## 8. 故障排查

| 症状 | 排查方向 |
|---|---|
| 前端看不到进度面板 | `stream.values.todos` 是否为空数组 → 检查 `TodoListMiddleware` 是否在 `middleware=[...]` 中；TodoDock 在 `todos.length === 0` 时不渲染 |
| todos 状态停滞在 `in_progress` | 模型未按纪律更新；查工具调用记录中最后一次 `write_todos` 的 payload，而非只看 UI |
| 清单全 completed 但产物缺失 | 属预期内的模型偏差：`completed` 只是进度标记，质量以校验器 + 门禁为准；必要时人工要求 Orchestrator 修正 |
| 跨回合 todos 丢失 | Checkpointer 未按 `thread_id` 注入，或两次调用用了不同 `thread_id` |
| 测试进程卡死 / OOM | 确认 `tests/conftest.py` 存在且未被绕过（不能在导入 `research_deepagent.agent` 之后再设环境变量） |
