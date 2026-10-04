# 开发文档：SDD 阶段异步委派（AsyncSubAgent / 异步任务五工具）

> 对应《Deep Agents》第 6 章「异步子 Agent」。本文面向本仓库的开发者，
> 说明 SDD 阶段从同步 `task` 委派改造为异步委派（AsyncSubAgent + 独立图）
> 的接线方式、设计决策、门禁语义变化、测试与扩展点。同步委派与上下文
> 隔离的基础见 `subagents.md`（第 5 章）；sdd 独立图上挂载的 Skills 见
> `skills.md`（第 7 章）。

## 1. 能力概述

SDD 是流水线中**耗时最长**的阶段：逐用户故事产出 `sdd/sdd-US-*.md`（一故事
一份设计文档）加 `sdd/traceability.md` 追溯矩阵，每份文档还要走
`validate_traceability` 校验与最多 3 轮修复循环。同步 `task` 委派下，编排者
（和用户）必须阻塞等待这整段长程工作结束才能继续对话。

异步化后，编排者用 `start_async_task` 把 SDD 阶段丢到后台执行，**启动后立即
汇报 task_id 并结束回合**；用户在等待期间可以继续对话——这就是
AsyncSubAgentMiddleware 提供的五把「遥控器」：

| 工具 | 作用 |
|---|---|
| `start_async_task` | 启动异步任务（委派 sdd-agent 后台执行） |
| `check_async_task` | 查询任务状态、回收结构化结果（SddPhaseReport） |
| `update_async_task` | 向运行中的任务追加指令（用户修改意见） |
| `cancel_async_task` | 取消任务 |
| `list_async_tasks` | 列出全部异步任务 |

五个异步任务记录保存在编排者图 state 的 `async_tasks` 通道
（`AsyncSubAgentState`），与 `messages` / `todos` 分开。前端为五个工具
配置了统一的卡片标签（`frontend/src/components/tools/registry.ts:9`，
`tool-card--async`）。

## 2. 设计决策

| 决策 | 理由 |
|---|---|
| 只异步化 SDD，PRD / BDD 保持同步 `task` | SDD 逐故事产出耗时最长（每故事一份文档 + 校验修复循环），异步化收益最大；PRD / BDD 产出在委派当回合内即可回收、紧跟着做门禁汇报，本流程里用户确认后才进入下一阶段，同步等待点天然存在，异步化不省时间反而把一次门禁汇报拆成多回合 |
| sdd 独立图 + `langgraph.json` 注册（键 `sdd-agent`，`langgraph.json:7`） | AsyncSubAgent 委派的对象是「远端图」（`graph_id` 即远端 assistant ID），不是进程内 spec 字典，所以 SDD 阶段必须独立成图注册。本仓库用单进程 `langgraph dev` 部署，`research` 与 `sdd-agent` 两个图在同一 ASGI 进程内：AsyncSubAgent 不传 `url` 时走进程内 ASGI 传输，无需额外网络配置。部署进程本就加载 `agent.py`，`sdd_graph.py` 复用其 `model` 与 `WORKSPACE_ROOT`，导入幂等 |
| `response_format=SddPhaseReport` 放在 sdd 图顶层（`sdd_graph.py:40`）而非 AsyncSubAgent 字段 | deepagents 0.7.13 的 `AsyncSubAgent` TypedDict 只有 `name` / `description` / `graph_id` / `url` / `headers` 字段，**没有 `response_format`**——结构化阶段报告只能由被委派的图自己产出。注意回传形态与同步子 Agent 不同（实证，见 4.2）：独立图顶层 `response_format` 的结果以 state 的 **`structured_response`** 键承载解析后的 `SddPhaseReport` 实例，最终 AIMessage 是模型原始文本透传；同步子 Agent 则是 ToolMessage 里的 `model_dump_json()` 规范化 JSON |
| 混挂分流机制：`"graph_id" in spec` 识别 | 同一个 `subagents=[...]` 列表里同步 dict 与 `AsyncSubAgent` 混挂（`agent.py:315`）；`create_deep_agent` 装配时按 spec 是否带 `graph_id` 分流——带则装配 AsyncSubAgentMiddleware（五工具 + `async_tasks` state），不带仍走同步 `task` 工具。识别是鸭子式的：`prd_agent` / `bdd_agent` 字典不带 `graph_id` 即保持同步 |
| `skills=["/skills/"]` 无条件挂载 + 缺目录仅告警（`agent.py:322` / `sdd_graph.py:41`） | deepagents 0.7.13 实证：SkillsMiddleware 对缺失源目录仅 `logger.warning` 并记入私有 `skills_load_errors` state，构建与调用均不抛异常。因此接线（`agent.py`，先落）与种子内容（`workspace/skills/`，后落）可以解耦，运行期删掉 skills 目录也不会弄挂图。详见 `skills.md` |

## 3. 门禁语义变化

改造前后流程对比：

```
改造前（SDD 同步）：
  需求 → task(prd-agent) → 门禁汇报 → 用户确认
      → task(bdd-agent) → 门禁汇报 → 用户确认
      → task(sdd-agent) ──阻塞等待全部设计+校验+修复──▶ 门禁汇报 → 用户确认

改造后（SDD 异步）：
  需求 → task(prd-agent) → 门禁汇报 → 用户确认
      → task(bdd-agent) → 门禁汇报 → 用户确认
      → start_async_task(subagent_type="sdd-agent")
           → 立即汇报 task_id → 结束回合
           （等待期间用户可继续对话：check 查进度 / update 追加指令 / cancel 取消）
      → check 到 success → 校验产物（sdd-US-*.md / traceability.md）
           → project_state.md（phase=done, gate=awaiting）+ todos
           → 门禁汇报 → 用户确认 → done
```

SDD 启动后 `todos` / `project_state.md` 的推进方式：

- 启动即结束回合，`todos` 中 SDD 各项（每故事一项）保持 `in_progress`——
  规划纪律要求置 `completed` 前必须有验收产物，此时产物尚未产生；
- `project_state.md` 停留在 SDD 进行时现场（上一次门禁汇报写入的
  `gate=awaiting`，用户确认后写 `gate=approved` 并委派）；
- `check` 到 success 后，按流程第 4 步（`prompts.py:79`）一次性推进：
  校验产物 → `phase=done, gate=awaiting` → 更新 todos → 门禁汇报 →
  等待用户确认。

编排者的「异步纪律」写在 `ORCHESTRATOR_INSTRUCTIONS` 的
「## 异步纪律（async task）」一节（`prompts.py:57`），四条约定各有测试契约
钉住（`tests/test_async_sdd.py:181`
`test_orchestrator_prompt_declares_async_discipline`，关键词与提示词文字
严格一致）：

| 异步纪律约定 | 对应断言 |
|---|---|
| 不主动轮询：无用户提问不调用 `check_async_task` | `"不主动轮询"` + ``"无用户提问不调用 `check_async_task`"`` |
| 报告进度前必须先调 `check_async_task` / `list_async_tasks`，不引用对话历史中的旧状态 | 两条关键词断言，防「凭记忆报进度」 |
| 始终使用完整 task_id，不截断、不缩写、不改写 | `"始终使用完整 task_id"` + `"不截断、不缩写、不改写"` |
| 用户要求修订时用 `update_async_task` 向同一任务注入新指令 | `"update_async_task"` + `"向同一任务注入新指令"` |

该测试还锚定了节顺序：`## 委派纪律（task）` < `## 异步纪律（async task）`
< `## 流程`；配套的
`test_orchestrator_prompt_declares_delegation_conventions`
（`tests/test_subagent_delegation.py:300`）截取「委派纪律」节做负断言——
该节只允许 `prd-agent` / `bdd-agent`，**不得**再出现 `sdd-agent`（防止
同步/异步边界在提示词层回潮）。

## 4. 关键文件

| 文件 | 职责 |
|---|---|
| `src/research_deepagent/agent.py` | `sdd_async_agent = AsyncSubAgent(name="sdd-agent", ..., graph_id="sdd-agent", url=SDD_AGENT_URL)`（`agent.py:223`，HTTP 自指 agentseek 端点）；`build_deep_agent` 默认 subagents 混挂 `[prd_agent, bdd_agent, sdd_async_agent]`（`agent.py:315`） |
| `src/research_deepagent/sdd_graph.py` | sdd 独立图：`build_sdd_graph`（`sdd_graph.py:28`）以 `system_prompt=SDD_AGENT_INSTRUCTIONS` + `tools=[validate_traceability]` + 顶层 `response_format=SddPhaseReport`（`:40`）构建；模块级 `graph`（`:45`）即注册目标 |
| `langgraph.json` | `graphs` 注册 `"sdd-agent": "./src/research_deepagent/sdd_graph.py:graph"`（`:7`），与 `research` 同部署 |
| `src/research_deepagent/prompts.py` | 编排者委派纪律（`:48`，第一条限定同步 task 只指 prd/bdd、SDD 走异步）、异步纪律（`:57`）、流程第 4 步（`:79`） |
| `src/research_deepagent/schemas.py` | `SddPhaseReport`（`schemas.py:59`）——结构化阶段报告契约，字段与 `SDD_AGENT_INSTRUCTIONS` 的「完成标准」一节同步 |
| `frontend/src/components/tools/registry.ts` | 五个 async 工具的卡片标签（`:9`-`:13`，`tool-card--async`） |
| `scripts/async_smoke.py` | 手动冒烟脚本（见 §5） |
| `tests/test_async_sdd.py` | 本能力的接线 / 纪律 / 结构化回传验证（7 用例） |

### 4.1 测试：`tests/test_async_sdd.py`

| 用例 | 验证点 |
|---|---|
| `test_langgraph_json_registers_research_and_sdd_agent` | langgraph.json 可解析，恰好注册 `research` 与 `sdd-agent` 两图，路径逐字断言 |
| `test_sdd_graph_builds_with_fake_model_and_tmp_backend` | fake 模型 + 临时 memory backend 冒烟构建 sdd 独立图；模块级 `graph` 随导入成功构建 |
| `test_sdd_graph_returns_structured_sdd_phase_report` | 顶层 `response_format` 接线：`result["structured_response"]` 为 `SddPhaseReport` 实例、各字段正确；最终 AIMessage 为原始文本透传（非 `model_dump_json()`） |
| `test_orchestrator_exposes_five_async_task_tools` | 编排者 tool node 的 `tools_by_name` 含全部五个 async 工具 |
| `test_orchestrator_state_schema_declares_async_tasks` | 图 state schema 含 `async_tasks` 注解（`AsyncSubAgentState`） |
| `test_sdd_async_subagent_spec` | spec 为 AsyncSubAgent：`name`/`graph_id` 均为 `"sdd-agent"`、无 `url`、描述含「后台异步执行」与 `check_async_task`；prd/bdd 字典不含 `graph_id`（仍同步） |
| `test_orchestrator_prompt_declares_async_discipline` | 异步纪律四约定 + 节顺序锚定（见 §3） |

同步侧的配套修订在 `tests/test_subagent_delegation.py`：
`NAMED_SUBAGENTS = ("prd-agent", "bdd-agent")`（`:32`），
`test_task_tool_exposes_only_named_subagents` 断言 `sdd-agent` **不在**同步
task 的「Available agent types」列表（`:110`），委派纪律节的负断言见
`test_orchestrator_prompt_declares_delegation_conventions`（`:317`-`:324`）。

运行：

```bash
uv run pytest tests/test_async_sdd.py -q   # 单独运行（7 passed）
uv run pytest tests/ -q                    # 全量（201 passed, 1 warning）
```

唯一 warning 是基线内已知的 `google/genai` DeprecationWarning，与本能力无关。
fake 模型脚本的适配要点（`_get_ls_params` provider 直通、
`model_name="gpt-4.1-mini"` 走 ProviderStrategy 等）与第 5 章
`subagents.md` §5.2 相同，此处不重复。

### 4.2 结构化回传的两种形态（实证）

| | 同步子 Agent（prd/bdd） | 异步 sdd 独立图 |
|---|---|---|
| `response_format` 声明位置 | 子 Agent spec 字典 | 被委派图的顶层 |
| 结果载体 | `task` 工具的 ToolMessage | 图 state 的 `structured_response` 键 |
| 内容形态 | `model_dump_json()` 规范化 JSON | Pydantic 实例；最终 AIMessage 为模型原始文本透传 |
| 测试 | `test_task_toolmessage_carries_parseable_phase_report` | `test_sdd_graph_returns_structured_sdd_phase_report` |

## 5. 冒烟脚本：`scripts/async_smoke.py`

手动验证脚本（不进 CI、不属于 pytest 套件），对本地 `langgraph dev` 服务
连续执行四步交互，覆盖 start / check / update / 回收解析四条路径。

前置条件：

- 仓库根目录存在可用的 `.env`（`langgraph.json` 已声明 `"env": "./.env"`）；
- 服务已启动：`uv run langgraph dev --n-jobs-per-worker 4`
  （默认监听 `http://127.0.0.1:2024`）。

用法：`uv run python scripts/async_smoke.py`（可 `--url` /
`--assistant-id`（默认 `research`）/ `--poll-interval`（默认 30s）/
`--poll-timeout`（默认 900s）覆盖）。

| 步骤 | 交互 | 预期 |
|---|---|---|
| a. 启动 | 请编排者把 SDD 任务交给 sdd-agent 异步处理，只报 task_id 不等待 | 回复非空；首轮耗时打印，超过 120s（`FIRST_RUN_MAX_SECONDS`，`async_smoke.py:36`）仅告警「疑似阻塞」；task_id 候选用宽松正则（UUID 或含 "task" 的 token）打印供人工确认，**不做硬编码断言** |
| b. 查进度 | 请编排者查询该任务当前进度 | 回复基于 `check_async_task` 实时状态，非对话历史 |
| c. 追加指令 | 请编排者注入补充约束（测试用例需覆盖异常登录路径） | `update_async_task` 注入同一任务，回复当前状态 |
| d. 轮询回收 | 脚本侧每 `poll_interval` 轮询一次，要求编排者 check 并原样输出回收的 SddPhaseReport JSON | `SddPhaseReport.model_validate_json` 解析成功并打印；解析位置先试原始回复、再试从自由文本中 `raw_decode` 出的 JSON 对象（容忍模型包裹叙述）；超时仅告警并给出 thread id，不抛异常 |

## 6. 扩展指南

- **新增第二个异步阶段**（如 BDD 异步化）：四步——
  1. 新建独立图模块（模式照抄 `sdd_graph.py`：`build_<x>_graph` + 模块级
     `graph` + 顶层 `response_format`），在 `langgraph.json` 注册键；
  2. `agent.py` 把该阶段 spec 字典换成 `AsyncSubAgent(name=..., graph_id=...)`
     并留在默认 subagents 列表（混挂分流自动生效）；
  3. `prompts.py` 改流程对应步骤 + 异步纪律节按需扩展；
  4. 同步侧契约测试（`NAMED_SUBAGENTS`、委派纪律节负断言）同步修订。
- **恢复 SDD 同步委派**：把 `sdd_async_agent` 换回带 `response_format` 的
  spec 字典并从 `langgraph.json` 移除 `sdd-agent` 键。
  `test_task_tool_exposes_only_named_subagents` /
  `test_task_tool_listing_has_no_other_subagents` /
  `test_langgraph_json_registers_research_and_sdd_agent` 会失败作为提醒；
  确属有意为之需同步修订这些断言与异步纪律节。
- **ASGI 进程内传输在本运行时不可用（2026-10-04 实证）**：`url=None` 时
  `get_client` 走进程内 ASGI 传输，但 agentseek dev 不是 langgraph-api
  服务器，不向 langgraph_sdk 注册 ASGI app——httpx ASGI transport 拿到
  `app=None`，`start_async_task` 即报
  `TypeError: 'NoneType' object is not callable`（调用栈：
  `httpx/_transports/asgi.py` → `await self.app(...)`）。同步 `invoke`
  另有"ASGI 需异步入口"的 ValueError（上游拦截为工具结果）。
- **现行方案：HTTP 传输自指**：`sdd_async_agent` 显式携带
  `url=SDD_AGENT_URL`（`agent.py:222`，默认 `http://127.0.0.1:2024`，
  `AGENTSEEK_API_URL` 可覆盖），与前端连的是同一个 Agent Protocol 端点。
  代价与观察点：HTTP 自指要求服务端能**并发**处理 supervisor run 与
  sdd run——若 agentseek 串行执行会表现为启动超时，届时需调整其 worker
  配置或改回同步委派。
- **跨进程 / 远端部署**：`url=` 指向任意 Agent Protocol 兼容服务即可把
  sdd 图拆到独立进程，仓库代码无需其他改动——`graph_id` 仍为远端注册的
  图键。

## 7. 故障排查

| 症状 | 排查方向 |
|---|---|
| `start_async_task` 报 `'NoneType' object is not callable` | ASGI 传输未禁用：`sdd_async_agent`（agent.py:223）必须带 `url`（agentseek 非 langgraph-api，进程内 ASGI 的 app 为 None）；`AGENTSEEK_API_URL` 是否指向 agentseek 实际端口 |
| 同步 task 工具列表里出现 `sdd-agent` | 混挂识别失效：检查 `agent.py:223` 的 `sdd_async_agent` 是否仍是 `AsyncSubAgent` 且带 `graph_id`（改成普通 dict 即回同步列表）；契约测试 `test_task_tool_exposes_only_named_subagents` 失败即提示 |
| 编排者不结束回合、阻塞等待 SDD 完成 | 流程第 4 步或异步纪律节被改弱：`test_orchestrator_prompt_declares_async_discipline` / `test_orchestrator_prompt_declares_delegation_conventions`（分节锚定）失败即提示漂移；改措辞需同步改断言 |
| `start_async_task` 报远端图不存在 | `langgraph.json` 是否仍注册 `sdd-agent`（`test_langgraph_json_registers_research_and_sdd_agent`）；`langgraph dev` 是否已重启加载新注册的图 |
| `check_async_task` 回收不到结构化报告 | sdd 图顶层 `response_format=SddPhaseReport`（`sdd_graph.py:40`）是否被移除（缺失则 `structured_response` 不产出）；`SddPhaseReport` 字段与 `SDD_AGENT_INSTRUCTIONS`「完成标准」一节是否漂移 |
| 编排者凭旧对话报任务进度 | 异步纪律第 2 条被弱化（「不引用对话历史中的旧状态」）；跑 `test_orchestrator_prompt_declares_async_discipline` 核对关键词 |
| 冒烟脚本首轮耗时超过 120s | 脚本仅告警不失败；确认编排者是否真的调用了 `start_async_task` 而非同步等待（看工具调用记录），以及模型侧是否有异常重试 |
| 五个 async 工具在前端显示为 `Tool: <name>` 兜底 | `frontend/src/components/tools/registry.ts` 的五个条目被删；registry 是唯一分支点，勿在 `ToolCallCard` 内加分支 |
