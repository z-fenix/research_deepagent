# task07 设计 Spec：双层长期记忆 + 门禁真中断化（第 8、9 章企业级落地）

> 状态：待用户终审。对应《Deep Agents》第 8 章「长期记忆」与第 9 章
> 「Human-in-the-Loop」，用户选定企业级全量组合。分支 `task07-memory-hitl`。

## 1. 背景与目标

本仓库是 PRD→BDD→SDD 文档生成 deep agent（deepagents 0.7.13，经
agentseek-api / langgraph dev 托管）。当前两项企业级能力缺失：

1. **记忆**：Agent 无跨对话记忆；用户偏好、Agent 自我改进指令每次对话丢失。
2. **门禁**：PRD/BDD（及 SDD 完成后）的人工门禁是**提示词纪律**——编排者
   "结束回合等待确认"，框架不参与；敏感工具（pencli MCP、workspace delete）
   无审批。

目标：双层长期记忆（Agent 级 + 用户级）+ 门禁真中断化 + 敏感工具审批 +
前端审批 UI。

## 2. 已核实的接口事实（设计依据）

- `create_deep_agent(memory=[...])` → `MemoryMiddleware(backend, sources,
  add_cache_control=True)`；缺失记忆文件被跳过、不自动创建、路径不注入
  （0.7.10+ 行为，第 8 章已述）。
- `create_deep_agent(interrupt_on={...})` → `HumanInTheLoopMiddleware`；
  `FilesystemPermission(mode="interrupt")` 自动生成的中断配置与用户配置
  **合并**（`_merge_fs_interrupt_on`，用户配置优先）。
- `StoreBackend(store=None)` 时经 `get_store()` 从 LangGraph 执行上下文取
  store——平台（agentseek / langgraph dev）注入的 store 直接可用；本地
  测试传 `InMemoryStore`。
- 中断恢复协议：`Command(resume={"decisions": [...]})`，决策类型
  approve / edit / reject / respond（`respond` 的 `message` 成为工具的
  "成功结果"；实现期对 resume 负载形态做一次 .venv 实证）。
- `context_schema` + `invoke(..., context=...)` 传递运行时身份；
  `rt.server_info`（部署端）优先于 `rt.context`（本地兜底）。
- 前端当前**无任何 interrupt 处理**；agentseek run 提交通道对
  `Command` 输入的支持需实现期实证（风险 §10）。

## 3. 架构总览

```
用户消息 ──▶ Orchestrator（create_deep_agent）
              ├─ memory=[agent/AGENTS.md, user/preferences.md]   ← MemoryMiddleware
              ├─ backend=CompositeBackend(default=StateBackend(),
              │     routes={"/memories/agent/": StoreBackend(agent 级 namespace),
              │              "/memories/user/":  StoreBackend(用户级 namespace)})
              ├─ store 不传（平台注入）
              ├─ context_schema=PipelineContext(user_id)
              └─ interrupt_on={request_phase_approval: [respond],
                              pencli_*: [approve, reject],
                              delete: [approve, reject]}
                    │
                    ▼  阶段门禁 / 敏感工具调用
              HumanInTheLoopMiddleware ──interrupt──▶ 前端 ApprovalDock
                    ▲                                    │ 用户决策
                    └──────── Command(resume={decisions}) ┘
```

## 4. 组件设计

### 4.1 用户身份（`src/research_deepagent/context.py`，新）

```python
@dataclass(frozen=True)
class PipelineContext:
    user_id: str = "local-user"
```

身份解析函数 `resolve_user_id(rt)`：`rt.server_info.user.identity` 优先，
`getattr(rt.context, "user_id", "local-user")` 回退（第 8 章兜底模式）。
本期前端不传身份，统一落 `local-user`；隔离结构就位，多用户只差身份注入。

### 4.2 双层记忆（改 `agent.py`）

| 路由 | namespace | 文件 | 语义 |
|---|---|---|---|
| `/memories/agent/` | `(assistant_id, "memories")` | `AGENTS.md` | Agent 级共享，自我改进 |
| `/memories/user/` | `(resolve_user_id(rt), "memories")` | `preferences.md` | 用户级隔离 |

- `memory=["/memories/agent/AGENTS.md", "/memories/user/preferences.md"]`
  （缺失跳过，首用由 Agent 按提示词约定 `write_file` 创建）；
- `store` 参数**不传**（平台注入）；测试经 `store=InMemoryStore()` 显式传入
  并用 `create_file_data` 预置；
- `assistant_id` 的取法：`rt.server_info.assistant_id` 优先，回退常量
  `"research"`（langgraph.json 的 graph 键名）；
- Skills 维持 task06 的 VFS workspace 形态，不迁移；
- 提示词新增「长期记忆（memory）」一节：何时读（启动注入的偏好/指令）、
  何时写（用户明确要求记住时 `edit_file`，保留既有条目，成功后才确认）、
  写到哪个文件（Agent 级指令 → AGENTS.md，用户偏好 → preferences.md，
  不另建文件）。

### 4.3 门禁真中断化（改 `prompts.py`、`agent.py`、`tools.py`）

- 新工具 `request_phase_approval(phase: str, summary: str) -> str`
  （`tools.py`）：无副作用占位工具，docstring 注明"真实结果由人工通过
  HITL respond 决策提供"；
- `interrupt_on`：
  ```python
  {
      "request_phase_approval": {"allowed_decisions": ["respond"]},
      **{name: {"allowed_decisions": ["approve", "reject"]} for name in pencli_tool_names},
      "delete": {"allowed_decisions": ["approve", "reject"]},
  }
  ```
  pencli 工具名在构建时从 `pencli_tools` 动态取（MCP 工具不可用时该段为空）；
- `ORCHESTRATOR_INSTRUCTIONS` 流程重写：
  - 第 2 步（阶段产出后）：汇报摘要 → 调用 `request_phase_approval` →
    **中断暂停**（不再"结束回合等待"）；
  - 第 3 步（恢复后）：从工具结果解析——同意/批准/通过/approve →
    gate=approved 推进；其余内容 → gate=revise，意见原文传给对应阶段重做；
  - `request_phase_approval` 的结果原文记入 Gate Log；
  - 异步纪律、todos 纪律（门禁期间 SDD 项保持 in_progress）、委派纪律不变；
- 敏感工具拒绝反馈：`reject` 需带 message（提示词要求编排者如实上报人工
  裁决，不重试）。

### 4.4 前端审批 UI（改 `frontend/src/`）

- `lib/stream.ts` / `useAgentStream`：从流事件中检测
  `__interrupt__`（LangGraph stream 的中断事件；具体事件形态实现期实证），
  暴露 `pendingApproval: { actionRequests, reviewConfigs } | null`；
- 新组件 `components/approval/ApprovalDock.tsx`：
  - 渲染每个 action request（工具名 + 参数摘要）；
  - 按 `allowed_decisions` 渲染决策控件：approve 按钮 / reject+意见输入 /
    respond 文本框（门禁卡片即 respond 形态，标题按工具名区分
    "阶段门禁"与"敏感操作"）；
  - **edit 决策本期不做**（后端协议支持，UI 显式 defer）；
- 恢复提交：`useAgentStream` 新增 `submitApproval(decisions)`，以同一
  `thread_id` 提交 `Command(resume={"decisions": [...]})`（走既有 run
  提交通道；agentseek 对 Command 输入的支持实现期实证，见 §10）；
- 中断期间输入框禁用或置顶提示（避免用户绕过审批直接发消息——行为：
  中断未决时 composer 只允许通过审批卡提交）。

## 5. 数据流（门禁一次往返）

```
编排者完成 PRD → 汇报摘要 → 调 request_phase_approval("prd", "...")
  → HITL 中断（action_requests=[request_phase_approval(...)]）
  → 前端 ApprovalDock 渲染 respond 文本框
  → 用户输入"同意"或"把 REQ-003 改成…" → Command(resume) 提交
  → 工具结果 = 用户原文 → 编排者解析 approved/revise
  → 写 Gate Log / 更新 project_state.md / todos → 推进或重做
```

## 6. 测试设计

### 后端（`tests/test_memory.py`、`tests/test_hitl.py`，新）

| 用例 | 验证点 |
|---|---|
| memory 路由隔离 | 预置两个用户的 preferences.md，A 的偏好不注入 B 的 system prompt |
| agent 级共享 | 不同 user_id、同 assistant namespace，AGENTS.md 内容均注入 |
| 缺失记忆文件 | 不报错、不注入（对照预置组） |
| 门禁中断 | fake 模型调 `request_phase_approval` → `result.__interrupt__`/interrupts 含 action_requests 与 allowed_decisions=["respond"] |
| 门禁恢复 | `Command(resume={"decisions":[{"type":"respond","message":"同意"}]})` 后编排者解析并推进（Gate Log / project_state 断言） |
| 门禁修订 | respond 为修改意见 → gate=revise，意见原文出现在委派消息 |
| 敏感工具中断 | pencli/delete 的 allowed_decisions 配置存在于 tool node 中间件配置 |
| 提示词契约 | 门禁流程、解析规则、memory 写入约定的关键词与节切片断言（沿用系列风格） |

### 前端（`ApprovalDock.test.tsx` 等）

| 用例 | 验证点 |
|---|---|
| 中断提取 | stream 事件含 `__interrupt__` 时 pendingApproval 非空，否则 null |
| 卡片渲染 | 按 allowed_decisions 渲染对应控件；门禁卡显示 respond 文本框 |
| 恢复提交 | submitApproval 发出的 resume payload 决策数组与 UI 输入一致 |
| 未决守卫 | pendingApproval 非空时 composer 提交被禁用 |

## 7. 文档

- `docs/dev/memory.md`：双层记忆设计、namespace 表、平台注入 store 与
  PostgresStore 升级路径（不引依赖）、身份注入接入点、故障排查。
- `docs/dev/hitl.md`：门禁中断协议（方案 A：respond 即门禁）、决策类型
  在本仓库的使用矩阵、前端审批流、拒绝反馈约定、故障排查。

## 8. 明确不做（defer）

- 组织级只读记忆（`/policies/`）；前端传递真实用户身份；edit 决策 UI；
- PostgresStore 实际接入（文档给升级路径）；后台记忆整合（Cron）；
- Skills 迁移到 Store；用户级记忆的写入门禁（HITL 审批偏好覆盖）。

## 9. 自审清单

- 占位符：无 TBD；实现期实证项已显式标注（resume 负载形态、`__interrupt__`
  事件形态、agentseek Command 输入支持）。
- 一致性：门禁 respond 语义与 §4.4 前端 respond 文本框一致；memory 路由表
  与 memory= 列表一致。
- 范围：单计划可承载（6 个左右任务），无需再分解。
- 歧义：pencli 工具不可用时 interrupt_on 不含其条目（已写明）；`delete`
  指内置 VFS delete 工具（唯一工具名）。

## 10. 风险与边界

| 风险 | 缓解 |
|---|---|
| agentseek run 通道不接受 Command 输入 → 前端无法恢复 | 实现期第一步实证；若不支持，前端恢复改走 SDK 直连（文档记差异），或门禁回退提示词式并保留敏感工具中断 |
| "同意"文本解析误判 | 提示词列举关键词 + Gate Log 留原文可审计；后续可升级方案 B（结构化 resume） |
| 中断期间用户绕过审批发消息 | 前端未决守卫（§4.4）；服务端无强约束（LangGraph 行为），文档注明 |
| fake 模型测试覆盖不了真实 ASGI resume 链路 | 冒烟脚本（沿用 task06 模式）加门禁往返用例，人工验证 |
