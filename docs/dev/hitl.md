# 开发文档：人工门禁与敏感工具审批（HITL 中断）

> 对应《Deep Agents》第 9 章「Human-in-the-Loop」。本文面向本仓库的开发者，
> 说明阶段门禁（方案 A：respond 即门禁）与敏感工具审批在 PRD→BDD→SDD
> 流水线中的中断协议、决策矩阵、前端审批流、风险与故障排查。

## 1. 能力概述

两类人工介入点，共用同一 HITL 中断协议（`interrupt_on` →
`HumanInTheLoopMiddleware`）：

- **阶段门禁**：PRD/BDD/SDD 阶段产出后，编排者调用无副作用的
  `request_phase_approval(phase, summary)` 工具 → 回合真实挂起（interrupt），
  人工以 `respond` 决策回复；回复原文成为该工具的结果，编排者据此解析
  approved / revise。取代旧版「结束回合等下一条消息」的提示词式门禁。
- **敏感工具审批**：内置 `delete` 与 `pencli_*` MCP 工具调用前中断，人工
  以 approve / reject 放行或拒绝。

## 2. 门禁协议（方案 A：respond 即门禁）

门禁工具（`src/research_deepagent/tools.py:97`）：

```python
@tool
def request_phase_approval(phase: str, summary: str) -> str:
    """请求人工门禁审批；本工具无副作用，真实结果由 HITL 的 respond 决策提供。"""
    return f"[门禁待决] {phase}: {summary}"
```

一次往返的数据流（spec §5）：

```
编排者完成 PRD → 汇报摘要 → 调 request_phase_approval("prd", "...")
  → HumanInTheLoopMiddleware 中断（run 挂起，turn 结束）
  → 前端 ApprovalDock 渲染 respond 文本框
  → 用户输入"同意"或"把 REQ-003 改成…" → Command(resume={"decisions":[…]}) 提交
  → 工具结果 = 用户原文 → 编排者解析 approved/revise
  → 写 Gate Log / 更新 project_state.md / todos → 推进或重做
```

恢复后的解析规则（`ORCHESTRATOR_INSTRUCTIONS` 流程第 3 步，
`src/research_deepagent/prompts.py:87`）：

- 含「同意 / 批准 / 通过 / approve」等**肯定语义** → `gate=approved`，回复
  原文记入 Gate Log，推进下一阶段；
- 其他内容一律视为修订意见（`gate=revise`）：意见原文传给当前阶段
  sub-agent 重做；**否定语义注意**：「不同意删除」这类含否定词的回复按
  revise 处理，不因出现"同意"二字误判；
- 敏感工具被 reject 时：如实向用户上报裁决与原因，**不重试**同一调用
  （prompts.py:93）。

## 3. 决策类型使用矩阵

HITL 协议支持 approve / edit / reject / respond 四种决策，本仓库的用法：

| 决策 | 使用场景 | 配置在哪些工具上 | 语义 |
|---|---|---|---|
| `respond` | 阶段门禁（`request_phase_approval`） | `{"allowed_decisions": ["respond"]}`（respond-only） | `message` 成为工具的"成功结果"原文；语义解析交给编排者提示词 |
| `approve` | 敏感工具放行 | `delete`、`pencli_*`：`{"allowed_decisions": ["approve", "reject"]}` | 直接执行被拦截的工具调用 |
| `reject` | 敏感工具拒绝 | 同上 | 需带 `message`（拒绝原因），回传给编排者上报 |
| `edit` | **本期不做（defer）** | 未配置、UI 不渲染 | 协议保留；后端可按 deepagents 文档扩展 |

中断配置由 `_build_interrupt_on()`（`src/research_deepagent/agent.py:176`）
构建，门禁工具名常量 `GATE_TOOL`（agent.py:173）：

```python
{
    "request_phase_approval": {"allowed_decisions": ["respond"]},
    "delete": {"allowed_decisions": ["approve", "reject"]},
    **{t.name: {"allowed_decisions": ["approve", "reject"]} for t in pencli_tools},
}
```

- pencli 工具名**构建时动态**从 `pencli_tools` 取（agent.py:165 加载）：
  MCP 不可用的降级模式下该段为空、构建不报错
  （`test_degraded_mode_without_pencli`）；
- deepagents 还会把 `FilesystemPermission(mode="interrupt")` 规则自动生成
  的中断配置与用户 `interrupt_on` **合并**（用户配置优先，deepagents
  `middleware/_fs_interrupt.py`）——若未来给文件系统工具配 interrupt 权限，
  与上表并存。

## 4. 中断数据形态（实证）

`graph.invoke` 的返回中，中断以 `result["__interrupt__"]` 呈现——
`langgraph.types.Interrupt` 的列表，其 `.value` 为 dict：

```python
{
    "action_requests": [{"name": "request_phase_approval",
                         "args": {"phase": "prd", "summary": "3 条需求"},
                         "description": ...}],
    "review_configs": [{"action_name": "request_phase_approval",
                        "allowed_decisions": ["respond"]}],
}
```

（deepagents 0.7.13 + langgraph 实证，见 `tests/test_hitl.py` 模块
docstring 与 `test_gate_tool_triggers_interrupt`。）

## 5. 前端审批流

| 环节 | 位置 | 说明 |
|---|---|---|
| 中断提取 | `frontend/src/lib/stream.ts:40` `extractPendingApproval` | 接受 snake_case（后端原始）与 camelCase（SDK 别名）双键名；非中断值返回 null |
| 状态暴露 | `stream.ts:144` | `useAgentStream` 返回 `pendingApproval: {actionRequests, reviewConfigs} \| null` 与 `approvalError` |
| 卡片渲染 | `frontend/src/components/approval/ApprovalDock.tsx:123` | 按 `allowed_decisions` 分支：全 respond → 门禁卡（标题「阶段门禁」，respond 文本框+提交）；含 approve/reject → 敏感操作卡（批准 / 拒绝+意见输入）；`pendingApproval == null` 不渲染 |
| 决策提交 | `stream.ts:146` `submitApproval` | 决策数组与 actionRequests **顺序一一对应**；经 SDK `stream.submit(null, { command: { resume: { decisions } } })` 走既有 run 通道（POST `/threads/{id}/runs/stream`） |
| 未决守卫 | `frontend/src/App.tsx:69` | `pendingApproval != null` 时 Composer 传 `disabled`（`frontend/src/components/composer/Composer.tsx:31` 直接拦截提交）——审批未决时用户不能绕过卡片发消息 |
| 错误态 | `stream.ts:151` | 提交失败（含通道拒绝 Command）经 onError/异常落入 `approvalError` 并在 ApprovalDock 中展示，**不静默吞错** |

注意：`edit` 决策本期不做——ApprovalDock 不渲染 edit 控件（spec §8 defer）。

## 6. 拒绝反馈约定

- `reject` 决策**必须带 `message`**（前端强制：拒绝原因输入为空不能提交，
  `ApprovalDock.tsx` 的 reject 分支）；
- 编排者提示词要求敏感工具被拒时**如实上报人工裁决与原因、不重试同一
  调用**（prompts.py:93-94）；测试钉住关键词（`tests/test_hitl.py:101`
  `test_orchestrator_prompt_declares_gate_flow`）。

## 7. 风险与边界

| 风险 | 现状与缓解 |
|---|---|
| 「同意」文本解析误判（方案 A 的已知代价） | 解析由模型按提示词关键词执行，接线层只保证原文无损回传（`test_gate_resume_with_approve` / `test_gate_resume_with_revision` 断言 ToolMessage == 原文）。缓解：提示词列举关键词 + 否定语义示例、Gate Log 留原文可审计；升级路径见 §8 方案 B |
| 中断期间用户绕过审批发消息 | 前端 composer 禁用（App.tsx）；**服务端无强约束**（LangGraph 行为：新消息会排队/开启新 run），跨端接入时需自行加守卫 |
| agentseek run 通道拒绝 `Command` 输入 | 源码层面成立：langgraph_sdk 0.4.4 把 `command`（含 `{"resume": ...}`）原样放进 run 提交负载（`langgraph_sdk/_async/runs.py`）；**真实往返以 `scripts/async_smoke.py` 步骤 e 的运行结果为准**（PASS = 通道可用，脚本 docstring 记录了验证状态）。同属部署门禁：平台 store 注入（记忆层依赖）亦为验证待定，部署前以 `scripts/async_smoke.py` 步骤 a + e 一并实证，详见 memory.md §5 |

## 8. 扩展指南（方案 B 升级路径）

「同意」文本解析的根治方案是把门禁决策**结构化**：

1. 门禁工具改为结构化决策（如 `respond` 的 message 约定为固定 token
   `approved` / `revise:<意见>`，或新增专用审批工具参数）；
2. 前端门禁卡把自由文本框改为「批准 / 修订意见」两个控件，提交的
   decisions 形态随之改变；
3. 提示词第 3 步的语义解析段删除或简化。

协议侧无需新机制——`Command(resume={"decisions": [...]})` 本就支持任意
JSON 决策对象；改动集中在提示词契约（`tests/test_hitl.py` 的 prompt 断言）
与前端卡片。

其余扩展：新增敏感工具→在 `_build_interrupt_on()` 加条目；启用 edit 决策
UI→ApprovalDock 加分支并放开 spec §8 的 defer。

## 9. 测试

### 9.1 后端：`tests/test_hitl.py`（7 条）

| 用例 | 验证点 |
|---|---|
| `test_gate_tool_triggers_interrupt` | 门禁调用产生 `result["__interrupt__"]`；action_requests[0] 为门禁工具、review_configs 仅 respond；门禁无副作用（未产生 ToolMessage） |
| `test_interrupt_on_includes_sensitive_tools` | interrupt_on 含 delete 与全部 pencli 工具的 approve/reject 配置 |
| `test_degraded_mode_without_pencli` | `pencli_tools = []` 时不报错、无 pencli 条目 |
| `test_orchestrator_prompt_declares_gate_flow` | 门禁流程 / 同意→approved、其余→revise+意见原文 / 否定语义示例 / 拒绝不重试 的提示词契约 |
| `test_orchestrator_prompt_declares_memory_conventions` | 记忆写入约定契约（edit_file / 保留 / 两路径），见 memory.md §4.4 |
| `test_gate_resume_with_approve` | `Command(resume={"decisions":[{"type":"respond","message":"同意，继续"}]})` 后：门禁 ToolMessage 内容 == 原文，图正常结束、无残留中断 |
| `test_gate_resume_with_revision` | 修订意见原文逐字回传（接线层不解析语义） |

测试技术要点：恢复路径**必须**有 checkpointer——不带 checkpointer 的图上
`Command(resume=...)` 抛 "Cannot use Command(resume=...) without
checkpointer"（实证）；测试经 `build_deep_agent(..., checkpointer=InMemorySaver())`
显式注入，生产路径由平台按 `thread_id` 注入（`build_deep_agent` 的
`checkpointer` 为测试透传参数，默认 None，agent.py:249 docstring）。

### 9.2 前端

| 用例（文件） | 验证点 |
|---|---|
| `stream.test.tsx`：提取与双键名、resume 提交、失败不吞错 | `extractPendingApproval` snake/camel 双形态、`submitApproval` 的 command 负载、`approvalError` |
| `ApprovalDock.test.tsx`：门禁 respond 卡、敏感 approve/reject 卡、空态、拒绝原因 | 按 allowed_decisions 渲染与决策组装 |
| `Composer.test.tsx`：disabled 拦截 | 未决守卫的组件半边（接线在 App.tsx） |

```bash
uv run pytest tests/ -q          # 后端全量 215 passed, 1 warning（已知 google/genai DeprecationWarning）
cd frontend && npm test -- --run # 前端全量 64 passed（10 个文件）
uv run python scripts/async_smoke.py   # 冒烟：异步链路 + 门禁往返（步骤 e，人工执行）
```

## 10. 故障排查

| 症状 | 排查方向 |
|---|---|
| 门禁中断未出现（run 直接跑完或报错） | ① `interrupt_on` 是否仍含 `request_phase_approval`（agent.py:176，`test_interrupt_on_includes_sensitive_tools` 邻近配置断言可快速复跑）；② 工具名大小写/改名（`GATE_TOOL` 常量与 tools.py 注册名必须一致）；③ pencli 条目是动态名，降级模式下本就没有；④ 模型没调门禁工具——查提示词流程第 2 步是否被改动 |
| 恢复失败 / 恢复后仍中断 | ① checkpointer 缺失：裸图 `Command(resume=...)` 必抛错（生产靠平台注入；本地复现用 `build_deep_agent(checkpointer=InMemorySaver())`）；② `thread_id` 不一致：resume 必须发到产生中断的同一 thread；③ command 形态：`{"resume": {"decisions": [...]}}`，决策数组与 action_requests 顺序一一对应、type 拼写精确（respond/approve/reject） |
| 审批卡不渲染 | ① `extractPendingApproval` 返回 null：中断 value 缺 `action_requests`/`actionRequests`（双键名兼容见 stream.ts:40），或 requests 数组为空；② `pendingApproval` 未传到 `ApprovalDock`（App.tsx 接线）；③ 卡片在 `actionRequests.length === 0` 时也不渲染（属预期） |
| 提交审批后前端报错 | `approvalError` 有展示即通道拒绝——按 §7 第三行的冒烟结论定位：确认 agentseek 版本接受 `command.resume` 负载，或决策数组长度与 action_requests 不匹配 |
| 门禁通过但编排者按 revise 处理（或反之） | 解析属模型行为：检查提示词第 3 步关键词表与否定语义说明是否被改动（契约测试 `test_orchestrator_prompt_declares_gate_flow` 失败即漂移）；Gate Log 中核对实际收到的原文 |
