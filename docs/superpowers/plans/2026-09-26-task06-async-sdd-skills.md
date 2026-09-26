# task06 实施计划：SDD 阶段异步化 + Skills（第 6、7 章合并落地）

> Spec：对话中确认的 task06 设计（2026-09-26）。对应《Deep Agents》第 6 章
> 「异步子 Agent」与第 7 章「Skills」。核心变更：SDD 阶段从同步委派改为
> Async Subagent（ASGI 同部署，五把遥控器），门禁语义重设计；Skills 以
> VFS workspace 形态落地（workspace/skills/，Agent 可写）。

## 已实证的接口事实（设计期确认，实现者可直接引用）

- deepagents 0.7.13 的 `create_deep_agent(subagents=[...])` 对每个 spec 按
  **`"graph_id" in spec`** 识别为 `AsyncSubAgent`，分流到
  `AsyncSubAgentMiddleware(async_subagents=[...])`，其余走同步
  `SubAgentMiddleware`——同步字典与异步条目可混挂。
- `AsyncSubAgent` 字段：必填 `name` / `description` / `graph_id`，可选
  `url` / `headers`；不传 `url` 走 ASGI 进程内传输（同部署）。
- 五个工具：`start_async_task` / `check_async_task` / `update_async_task` /
  `cancel_async_task` / `list_async_tasks`；任务元数据存于 state 的
  **`async_tasks`** channel（`AsyncSubAgentState`，含 `_tasks_reducer`）。
- `AsyncSubAgent` 本身没有 `response_format` 字段——异步子 Agent 的结构化
  返回由**被注册的子图**在顶层 `create_deep_agent(response_format=...)` 声明。

## Global Constraints

- TDD：先写测试再实现；pytest 测试不得触发真实模型调用与真实网络/服务
  （fake 模型沿用 `tests/test_subagent_delegation.py` 模式）；ASGI 真实调用链
  由冒烟脚本覆盖，不进 pytest。
- 图（含新的 sdd 独立图）不自带 Checkpointer——持久化归 agentseek-api /
  langgraph dev 平台按 thread_id 注入。
- 不修改 `research_deepagent/validators/`。
- prompts.py 分节冻结：被校验器解析的格式段永不动；Task 2 只改
  `ORCHESTRATOR_INSTRUCTIONS`（流程第 4 步 SDD 段 + 新增异步纪律约定）。
- deepagents 0.7.13 / langchain>=1.0；框架内省断言先在 `.venv` 实证再落笔。
- 全量测试保持通过（后端基线 189 passed；前端基线见 registry.test.ts 所在套件）。
- 提交信息用 conventional commits；提示词中文、代码风格与现有一致。

## Task 1: SDD 独立图 + langgraph.json 注册

1. 新文件 `src/research_deepagent/sdd_graph.py`：
   - 复用 `research_deepagent.agent` 的 `model`、`WORKSPACE_ROOT`（部署进程
     本就会加载 agent.py，导入幂等；`create_backend` 从
     `research_deepagent.vfs` 导入）；
   - `graph = create_deep_agent(model=model, system_prompt=SDD_AGENT_INSTRUCTIONS,
     tools=[validate_traceability], backend=create_backend(root=WORKSPACE_ROOT),
     response_format=SddPhaseReport)`；
   - 模块 docstring 说明：该图作为 Async Subagent 的远端 graph 注册，ASGI
     同部署调用；`response_format` 在此层声明（AsyncSubAgent 无此字段）。
2. `langgraph.json`：`graphs` 增加键 `"sdd-agent"` 指向
   `./src/research_deepagent/sdd_graph.py:graph`。
3. `tests/test_async_sdd.py`（新）：
   - langgraph.json 可解析且注册 `research` + `sdd-agent` 两个图；
   - sdd 独立图可构建（冒烟）；
   - fake 模型返回 `SddPhaseReport` JSON 时，图的最终输出为结构化
     `model_dump_json()`（接线验证，形态须先在 .venv 实证顶层
     response_format 的最终消息形态）。
4. `uv run pytest tests/test_async_sdd.py tests/ -q` 全绿。

**提交**：`feat(agent): standalone sdd graph for async delegation`

## Task 2: Orchestrator 异步接线 + 提示词异步纪律

1. `src/research_deepagent/agent.py`：
   - 删除同步 `sdd_agent` 字典；
   - `build_deep_agent` 默认 subagents 改为
     `[prd_agent, bdd_agent, AsyncSubAgent(name="sdd-agent",
     description=<沿用原 sdd-agent 描述并注明后台执行>, graph_id="sdd-agent")]`；
   - Orchestrator 增加 `skills=["/skills/"]`（本任务先接线，内容 Task 3 落地，
     空目录不报错——须实证）。
2. `src/research_deepagent/prompts.py` 的 `ORCHESTRATOR_INSTRUCTIONS`：
   - 流程第 4 步（SDD 完成）改写：SDD 通过 `start_async_task` 后台执行，
     启动后立即向用户汇报 task_id 并结束回合；check 到 success 后校验产物、
     更新 project_state.md 与 todos、门禁汇报；
   - 新增「异步纪律（async task）」一节：不主动轮询（无用户提问不 check）；
     报告进度前必须 check_async_task / list_async_tasks，不引用对话历史旧状态；
     始终使用完整 task_id 不截断改写；修订意见用 update_async_task 注入同一任务。
3. 测试修订与新增（`tests/test_subagent_delegation.py` + `tests/test_async_sdd.py`）：
   - 修订 task05 断言：同步 `task` 工具列表只含 `prd-agent` / `bdd-agent`
     （不再含 sdd-agent）；
   - 新增：五个 async 工具存在于 tool node；state schema 含 `async_tasks`；
   - 新增：提示词含异步纪律关键约定（关键词与提示词文字严格一致）。
4. 全量 pytest 全绿。

**提交**：`feat(agent): delegate sdd phase via async subagent with discipline prompt`

## Task 3: Skills（VFS workspace 形态）

1. 新增 `workspace/skills/sdd-quality-checklist/SKILL.md`：
   - frontmatter：`name: sdd-quality-checklist`、`description`（中文、具体
     触发条件：撰写或审查 SDD 文档时使用）；
   - 正文：SDD 写作质量清单（边界定义完备性、接口/数据契约、校验规则与
     @exception 场景对应、测试用例可判定 pass 标准），**advisory 性质**，
     不复述校验器解析的强制格式，控制在 100 行内。
2. `src/research_deepagent/sdd_graph.py`：加 `skills=["/skills/"]`。
3. `tests/test_skills.py`（新）：
   - skills 目录扫描约定（fixture 在临时 workspace 建 skills 子目录）；
   - 元数据注入：fake 模型捕获 system message，断言含 skill 的 name 与
     description（Level 1 渐进披露）；
   - 正文按需读取：脚本化 fake 模型 `read_file("/skills/sdd-quality-checklist/SKILL.md")`
     → 断言工具结果含正文内容（Level 2）。
4. 全量 pytest 全绿（含 task05/06 全部既有测试）。

**提交**：`feat(agent): mount workspace skills for orchestrator and sdd graph`

## Task 4: 前端卡片 + 冒烟脚本

1. `frontend/src/components/tools/registry.ts`：为五个 async 工具加
   label/className（中文 label，样式类复用/新增 tool-card--async 一类）；
   同步更新 `registry.test.ts`。
2. `scripts/async_smoke.py`（新，不进 pytest）：对照第 6 章最小验证方案改写为
   本仓库形态——`langgraph dev` 启动后用 langgraph_sdk 验证：start 立即返回
   task_id（不阻塞）→ check running/success → update 注入约束 → 最终 check
   success 且结果可被 `SddPhaseReport.model_validate_json` 解析。
3. `cd frontend && npm test -- --run` 全绿。

**提交**：`feat(frontend): async tool cards and async smoke script`

## Task 5: 开发文档两篇

1. `docs/dev/async-subagents.md`（第 6 章）：SDD 异步化的运行模型与门禁语义
   变化、sdd 独立图与 langgraph.json 注册、五工具行为、async_tasks channel、
   异步纪律提示词、冒烟脚本用法、故障排查（对齐第 6 章排查表 + 本仓库实证）。
2. `docs/dev/skills.md`（第 7 章）：VFS workspace Skills 形态、渐进式披露
   三级加载在本仓库的路径、种子 skill 说明、Agent 可写意味着什么（渐进式
   披露的记忆）、扩展指南（如何加第二个 skill）、故障排查。
3. 所有 file:line 引用逐一 Read 核实；运行 `uv run pytest tests/ -q` 取最终
   通过数写入文档。
4. 全量 pytest 全绿。

**提交**：`docs: add development guides for async subagents and skills`

## 任务间关系（预检扫描）

| 任务对 | 共享面 | 结论 |
|---|---|---|
| T1→T2 | sdd graph（T1 建，T2 的 AsyncSubAgent.graph_id 指向它）+ agent.py | T2 依赖 T1 的图文件存在 |
| T2→T3 | agent.py / sdd_graph.py（T3 加 skills 参数）；test_subagent_delegation.py | T2 修订 task05 断言后 T3 再追加 skills 测试 |
| T1/T3 | sdd_graph.py 的 skills 参数归 T3，T1 不加 | 文件两任务先后编辑，顺序执行无冲突 |
| T4 | registry.ts / scripts/，与后端解耦 | 仅依赖 T2 的工具名事实（已实证） |
| T5 | 消费最终形态 | 最后执行 |

自洽性：T1 的顶层 response_format 最终消息形态、T2 的空 skills 目录行为、
T3 的元数据注入断言路径均为实现期须实证的假设（已写入各任务）。
