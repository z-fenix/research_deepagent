# task09 前端 harness 1:1 校正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 按 deepseek-harness 截图校正三处 1:1 偏差：① 侧栏底部固定用户区+滚动会话列表；② Composer 卡片布局（＋/chip/模型名/圆形发送 + turns-steps 指示）；③ Trajectory 入口改为中央 Chat|Trajectory tab，工具栏 Duration/Turns/Calls 三 checkbox + 堆叠耗时条 + role badges。

**Architecture:** 全部为既有组件的布局/交互改造，无新数据面。Trajectory 从右栏面板迁到中央 tab（右栏保留 Sub-agents/Workbench）；Timeline 四模式整合为 Duration checkbox；Ledger 行渲染受 Turns/Calls checkbox 过滤。

**Tech Stack:** 现有栈，零新依赖。

**Spec:** 用户 2026-10-05 三张参照截图（聊天页/Trajectory 页/输入框特写）+ 会话内设计确认（chat 记录）。参照截图要点：
- 侧栏：品牌行（黑底 tag）→ New Session 通栏按钮 → Workspaces 小节头（右三个小图标）→ 滚动会话列表（右侧相对时间 badge）→ 底部固定头像+用户名。
- 中央：会话标题行下 Chat | Trajectory 下划线 tab；Trajectory 工具栏行 = 左 `⏱ Duration ☐ | ⊞ Turns ☐ | ☰ Calls ☐` + 右 Search 框；下方堆叠分段耗时条（灰 Input/蓝 Model/绿 Tools）；Ledger 行左侧彩色 role badge（SYSTEM/USER/CONTEXT 风格）+ 最左 Turn 徽标。
- Composer：大圆角卡片；上行 textarea；下行 ＋ 圆按钮 | Workspace Write chip | 右侧 模型名 High ▾ | 圆形蓝色 ↑ 发送按钮；卡片下方居中 `⏱ 1 turns 1 steps`。

## Global Constraints

- 零新 npm 依赖；现有 143 测试与 tsc -b 全绿不得回退（ApprovalDock 契约、composer 审批禁用守卫不动）。
- 右栏保留 Sub-agents 与 Workbench 两面板；Trajectory 从右栏移除（入口变中央 tab）。
- 装饰性控件必须可感知为禁用：＋ 按钮 disabled + title="Attachments not supported yet"；Workspace Write chip 与模型名/High/chevron 为静态展示（模型名读 `import.meta.env.VITE_MODEL_NAME`，缺省 "gpt-4.1-mini"）。
- Duration 耗时条降级沿用 spec §6：无时间戳按序数均布（与现有 Timeline 降级一致），有则按真实时长比例。
- 现有 `useAgentStream`/`deriveTrajectory` 数据层不动；新统计由现有派生函数计算。
- 分支 task09-frontend-harness-refine；测试命令 `cd frontend && npx vitest run <file>`，提交前全量 vitest + tsc -b。
- UI 文案英文（对齐参照与现状），代码注释可中文。

## Review Focus

1. **审批可达性不回退**：Composer 重排后 disabled 守卫与圆形发送按钮的 disabled 状态必须一致（未决审批时既禁输入也禁圆钮）——Task 2 测试 pin。
2. **中央 tab 切换不丢状态**：Chat↔Trajectory 来回切换不得重建 thread 流/丢失审批未决态——Task 3 测试 pin。
3. **Checkbox 过滤纯函数**：Turns/Calls 关闭时 Ledger 行投影必须同步隐藏对应行且 key 稳定——Task 4 测试 pin。
4. **侧栏底部固定**：会话列表超长滚动时底部用户区不可滚出视野——Task 1 布局结构（flex 布局 + CSS）测试 pin。

---

### Task 1: 侧栏 1:1（品牌 tag / New Session / Workspaces 头 / 滚动列表 / 底部固定用户区）

**Files:**
- Modify: `frontend/src/components/shell/Sidebar.tsx`
- Modify: `frontend/src/styles.css`（.sidebar 系列重排）
- Test: `frontend/src/components/shell/Sidebar.test.tsx`（新建，若无）

**Interfaces:**
- Consumes: 现有 `ThreadSummary`、props（open/onClose/threads/loading/activeThreadId/onSelect/onNewSession/onOpenAppearance）——props 契约不变。
- Produces: 结构改为 `sidebar__brand-row`（品牌名 + 黑底 tag "AGENT"）→ `sidebar__new`（"⊕ New Session"）→ `sidebar__section`（"Workspaces" + 三个装饰小图标按钮，disabled）→ `sidebar__list`（flex:1, overflow-y:auto，item 右侧 `sidebar__item-time` 相对时间：`<60s → "now"`、`<60m → "Xm"`、`<24h → "Xh"`、否则 "Xd"，替换现有 toLocaleString）→ `sidebar__footer`（flex-shrink:0：头像圆点 `sidebar__avatar`（首字母 L）+ "local-user" + 外观设置按钮移入此行）。

- [ ] Step 1 失败测试：render Sidebar → 断言 brand tag 文本 "AGENT"、New Session 按钮名含 "New Session"、"Workspaces" 小节头存在、footer 含 "local-user" 与外观设置按钮、列表项时间显示 "10h" 样式（喂固定 updatedAt）。
- [ ] Step 2 `npx vitest run src/components/shell/Sidebar.test.tsx` FAIL。
- [ ] Step 3 实现：组件结构重排 + 相对时间函数 `relativeTime(iso): string`（导出以便测试）；CSS：`.sidebar{display:flex;flex-direction:column;height:100%}`、`.sidebar__list{flex:1;overflow-y:auto}`、`.sidebar__footer{flex-shrink:0}`。
- [ ] Step 4 测试过 + 全量 vitest + tsc -b。
- [ ] Step 5 Commit `feat(frontend): harness-style sidebar with pinned user footer`。

### Task 2: Composer 卡片布局

**Files:**
- Modify: `frontend/src/components/composer/Composer.tsx`
- Modify: `frontend/src/styles.css`（.composer 卡片化）
- Modify: `frontend/src/App.tsx`（传 turns/steps 统计）
- Test: `frontend/src/components/composer/Composer.test.tsx`（扩充）

**Interfaces:**
- Consumes: 现有 Composer props（isLoading/disabled/onSubmit/onStop）——新增可选 prop `stats?: { turns: number; steps: number }`（App 由 `deriveTrajectory(stream.messages)` 计算：`{ turns: turns.length, steps: total steps }`，useMemo）。
- Produces: 结构 `composer-card`（圆角卡片）> textarea（placeholder "Message or run a task…"）+ `composer-card__row`：`＋` 按钮（disabled，aria-label="Attach files"，title="Attachments not supported yet"）| `composer-card__chip`（"⚙ Workspace Write" 静态 span）| spacer | `composer-card__model`（"{model} High ▾" 静态，model = `import.meta.env.VITE_MODEL_NAME ?? "gpt-4.1-mini"`）| 圆形发送钮 `composer-card__send`（↑ 字符；isLoading → ■ Stop，aria-label 不变 "Send message"/"Stop generation"，disabled 逻辑沿用 `!text.trim() || disabled`）。卡片外下方 `composer-stats`（居中小字 `⏱ {turns} turns {steps} steps`；stats 未传不渲染）。
- 现有 `composer__*` 类名在 styles.css 中的审批守卫相关样式保留语义。

- [ ] Step 1 失败测试：新增断言——＋ 按钮 disabled；chip 文本 "Workspace Write"；模型名渲染 "gpt-4.1-mini"；发送按钮 aria-label "Send message" 且空文本 disabled；stats={{turns:1,steps:2}} 渲染 "1 turns 2 steps"；stats 缺省不渲染统计行；既有 Enter 发送/审批 disabled 用例全部保留通过。
- [ ] Step 2 FAIL → Step 3 实现 → Step 4 全量 + tsc。
- [ ] Step 5 Commit `feat(frontend): card composer with attach chip, model label, and run stats`。

### Task 3: 中央 Chat|Trajectory tab（Trajectory 出右栏）

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/App.test.tsx`（扩充）

**Interfaces:**
- Consumes: 现有 panels/PanelHost（panels 数组去掉 trajectory 项）、trajectory/TrajectoryView（原样复用：`<TrajectoryView turns={deriveTrajectory(stream.messages)} timestamps={stepTimestamps} messages={stream.messages} />`，含现有 stepTimestamps 转换）、Header。
- Produces: 中央列结构 Header → `center-tabs`（role=tablist：Chat / Trajectory 两钮，active 下划线）→ 内容区（activeTab==="chat" ? 现 chat 区块 : TrajectoryView 包在 `<div className="center-trajectory">` 占满中央剩余高度）。state `const [centerTab, setCenterTab] = useState<"chat"|"trajectory">("chat")`（组件内 state，不持久化——参照为会话级视图）。右栏 panels 移除 trajectory 项。stream 状态（threadId/审批）在 tab 切换间保持（chat 区块不卸载流——用条件渲染但 useAgentStream 在 AgentWorkspace 顶层，不受影响）。

- [ ] Step 1 失败测试：默认 Chat 激活（aria-selected）+ Trajectory 内容不可见；点 Trajectory → TrajectoryView 出现（搜 "Timeline mode" toolbar）且右栏无 Trajectory tab（PanelHost 只剩 Sub-agents/Workbench 两 tab）；切回 Chat → 消息列表还在、pendingApproval 未决时 composer 仍禁用（Review Focus 2）。
- [ ] Step 2 FAIL → Step 3 实现 → Step 4 全量 + tsc。
- [ ] Step 5 Commit `feat(frontend): center chat/trajectory tabs replace right-bar trajectory panel`。

### Task 4: Trajectory 工具栏 Duration/Turns/Calls + 堆叠耗时条 + role badges

**Files:**
- Modify: `frontend/src/trajectory/TrajectoryView.tsx`（工具栏重做 + 三 checkbox state + 分段条）
- Modify: `frontend/src/trajectory/Ledger.tsx`（props 增加 `showTurns?: boolean; showCalls?: boolean`，行过滤；role badge）
- Modify: `frontend/src/trajectory/rows.ts`（`flattenTrajectoryRows` 增加选项参数 `{ includeTurnHeaders?: boolean; includeToolRows?: boolean }`，默认 true，纯函数向后兼容）
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/trajectory/rows.test.ts`（扩充）、`frontend/src/trajectory/TrajectoryView.test.tsx`（扩充）

**Interfaces:**
- Consumes: Task 6 派生（`deriveTrajectory`/`cumulativeUsage`）、Task 8 timeline（`buildTimeline(turns, mode, timestamps)`）、现有 stepTimestamps 转换。
- Produces:
  - `TrajectoryView` 顶部工具栏：三 checkbox（label 文本 "Duration"/"Turns"/"Calls"，默认 Duration=on、Turns=on、Calls=on，初始形态与参照一致）+ 右侧现有 search 框。Duration 勾选 → 显示 `duration-bar`（横向堆叠分段条，高 14px，圆角小段；分段数据 = 现有 `buildTimeline(turns, hasTimeData?"duration":"sequence", timestamps)`：human 无格——按 step 渲染段，段色规则 `step.cell.toolBlocks.length>0 ? green : blue`，段间隙灰底由容器背景承担；段宽 = 有时间戳时按 durationMs 占比、否则均分；每段 title="T{turn}S{step} {duration}"）。取消勾选 → 条隐藏（Timeline 组件不再直接渲染，其模式语义并入 Duration checkbox + 分段条；原 Timeline 组件保留导出，TrajectoryView 不再挂载——其测试保留）。
  - `Ledger` props `{ turns, searchMatches?, showTurns = true, showCalls = true }`：`flattenTrajectoryRows(turns, collapsedTurns, collapsedAssistants, { includeTurnHeaders: showTurns, includeToolRows: showCalls })`；`showCalls=false` 时 assistant 行保持。Ledger 行渲染 role badge：turn-header 行左侧 `badge badge--turn`（"T{turn}"），assistant 行 `badge badge--assistant`（"AI"），tool 行 `badge badge--tool`（"TOOL"），human prompt 显示在 turn-header（badge "USER"）。Badge 仅视觉（span），不改 key/匹配逻辑。
  - `flattenTrajectoryRows` 第 4 参可选 options，缺省行为与现签名完全一致（既有 3 参调用与测试不变）。
- [ ] Step 1 失败测试：rows.test——`includeTurnHeaders:false` 无 turn-header 行；`includeToolRows:false` 无 tool 行、assistant 保留；缺省调用输出与现状一致。TrajectoryView.test——三 checkbox 存在且默认全选；取消 Turns → turn header 行消失；取消 Calls → tool 行消失、AI 行保留；Duration 勾选渲染 duration-bar（≥1 段），取消 → 无 duration-bar。
- [ ] Step 2 FAIL → Step 3 实现 → Step 4 全量 vitest + tsc -b。
- [ ] Step 5 Commit `feat(frontend): trajectory toolbar with duration bar, turns/calls filters, and role badges`。

### Task 5（收口）：docs/dev 笔记更新 + 全量验证

**Files:**
- Modify: `docs/dev/trajectory-harness.md`（Trajectory 入口改中央 tab；工具栏 checkbox 语义；Composer 卡片/装饰控件说明；侧栏底部固定区）
- Test: 全量

- [ ] Step 1 更新笔记（改动点如实描述，含降级：无时间戳 → Duration 条按序数均布）。
- [ ] Step 2 全量 vitest + tsc -b + Commit `docs: reflect center tabs, card composer, and sidebar footer in harness guide`。

## 自审记录

- 覆盖用户三点：①→Task 1；②→Task 2；③→Task 3+4。Review Focus 4 条各有 pin 测试。
- 类型一致：Composer.stats、flattenTrajectoryRows 第 4 参 options、Ledger showTurns/showCalls 与 TrajectoryView 传参一致。
- 风险：TrajectoryView 不再挂载 Timeline 组件（其测试保留为组件级回归）；App.tsx Task 2/3 均触碰——Task 2 先行改 Composer 相关行，Task 3 改面板/tab 相关行，文件交叠已按顺序排定。
