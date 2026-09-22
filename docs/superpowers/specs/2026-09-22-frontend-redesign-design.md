# 前端重构设计：按 deepseek-harness 优化视觉体系、交互与代码架构

日期：2026-09-22
状态：已确认（用户逐节批准）

## 背景与目标

本项目前端是单页 React 应用（`frontend/src/`：App.tsx + TodoList / ToolCallCard /
ThinkingBlock + 430 行 styles.css），颜色硬编码，深浅色仅跟随系统。参考
deepseek-harness（dsh）Web 客户端的设计体系（`packages/client/ui-theme` 等），
对前端做三方面重构：

1. **视觉设计体系**：引入 dsh 式 design token 体系（static 调色板 → 语义 alias
   → 组件消费），三态主题（light/dark/system），字号阶梯，elevation 分层阴影，
   corner-shape 渐进增强，统一滚动条。
2. **交互与组件体验**：Composer 升级（textarea 自动增高、Enter 发送、IME 保护、
   Stop 中断）、字号设置、会话历史侧栏；现有聊天 / todo / 工具卡 / 流式体验做精。
3. **代码架构**：拆分为 theme / lib / components 分层目录，App.tsx 仅做外壳组装。

**非目标**：不引入 dsh 的插件化注册表架构（仅工具卡片保留最低限度注册表）；
不改后端；不加聊天以外的业务功能。

## 技术决策

- 架构方案：方案 A（分层目录 + 主题子系统 + 工具卡片注册表），用户已确认。
- 新依赖：`@langchain/langgraph-sdk`（threads 列表，现为传递依赖，需显式声明）；
  `clsx`。其余状态管理用 React Context + hooks，不引入状态库。
- 停止能力：`@langchain/react` 的 `useStream` 已提供 `stop()`（已在
  node_modules 类型中核实），无需后端改动。

## 目录结构

```
frontend/src/
├── theme/
│   ├── tokens.css        # static 调色板（light/dark 两套）+ --app-* 语义 alias
│   ├── prefs.ts          # 主题/字号读写纯函数（与 index.html 内联片段同步）
│   └── ThemeProvider.tsx # 三态主题 + 字号 12–17px，Context + localStorage
├── lib/
│   ├── messages.ts       # buildRows / PLAN_MARKERS / messageText 纯函数 + 类型
│   ├── threads.ts        # useThreads()：threads.search 封装（列表/刷新/切换）
│   └── stream.ts         # useAgentStream()：useStream 封装，暴露统一接口
├── components/
│   ├── shell/            # Sidebar（会话列表 + 新建会话 + 外观入口）、MainLayout
│   ├── chat/             # MessageList、Message、ThinkingBlock、ActivityCard
│   ├── tools/            # ToolCallCard + toolRegistry
│   ├── todo/             # TodoDock（原 TodoList）
│   └── composer/         # Composer
└── App.tsx               # 外壳组装，目标 <100 行
```

## A. 布局与页面结构

- 桌面端：左侧栏 260px（可折叠）+ 主区。
  - 侧栏：顶部产品名 + 「新建会话」按钮 → 会话列表（最近 20 条，`threads.search`
    按 `updated_at` 倒序；每项显示更新时间与 thread id 前 8 位）→ 底部「外观」
    入口（主题/字号设置弹层）。
  - 主区：顶部细 header，含当前会话「复制链接」按钮（吸收现有 thread-banner
    职责，banner 组件删除）；消息流居中 max-width 820px；底部居中浮动卡片式
    composer（dsh 风格，替代全宽贴边条）。
- TodoDock：固定在 composer 上方，可折叠；折叠态仅显示进度摘要
  （如 `2/3 · 66%`），展开态为现有面板内容。
- 移动端（≤768px）：侧栏变抽屉，汉堡按钮唤出。

## B. 主题 token 体系

- `theme/tokens.css` 两层结构：
  - **static 调色板**：采用 dsh `design-platform.css` 同款色系——
    neutral-bluish 中性阶、deepseek blue 品牌阶（主色 `rgb(65,118,230)`）、
    green/amber/red 状态阶。light 挂 `:root`，dark 挂 `body[data-theme="dark"]`。
  - **alias 语义 token**：`--app-bg-base/layer-1/layer-2`、`--app-border-l1..l4`、
    `--app-label-primary/secondary/tertiary/caption`、
    `--app-state-success/warn/error`、`--app-shadow-lv1/lv2`、
    `--app-radius-sm/md/lg`、`--app-content-font-size`。
    组件 CSS 只允许消费 alias，禁止硬编码颜色。
- 字号阶梯（dsh 同款）：正文 `--app-content-font-size` 12–17px（默认 14），
  标题按 −1/−2 派生层级；设置弹层提供步进器。
- elevation：0.5px hairline 描边 + 两层 soft shadow 的分层阴影（移植 dsh
  elevation token 公式）。
- 渐进增强：`corner-shape` 超椭圆圆角（`@supports` 包裹的精简版）+ 统一
  滚动条样式（alias token 驱动）。
- 三态主题：`light / dark / system`。`index.html` 内联一段原生 JS 片段（约
  10 行）在首帧前读写 localStorage 并设置 `data-theme` 与
  `--app-content-font-size`（system 解析 `prefers-color-scheme`），杜绝闪白。
  内联片段无法 import TS，故 `theme/prefs.ts` 保存同一读写逻辑的纯函数版本
  供 ThemeProvider 使用，片段顶部注释指向 prefs.ts，二者一致性由
  prefs.ts 单测覆盖；`theme/` 目录不再单列 bootstrap.ts。

## C. 数据流与状态

```
index.html bootstrap ──▶ data-theme / font-size（首帧前，防闪白）
ThemeProvider（Context）──▶ { mode, setMode, fontSize, setFontSize }
useAgentStream()（lib/stream.ts）──▶ 封装 useStream：
    messages → buildRows（lib/messages.ts 纯函数）→ rows
    对外仅暴露 rows / todos / isLoading / error / submit / stop / threadId
useThreads()（lib/threads.ts）──▶ langgraph-sdk Client().threads.search()
    { threads, loading, refresh, switchThread }
    切换 thread 复用 useStream 的 threadId 切换，并同步 ?thread= URL 参数
```

- `buildRows` / `PLAN_MARKERS` / `messageText` 逻辑原样迁入 `lib/messages.ts`，
  行为不变；迁移前先为现有行为补单测（先测后迁）。
- thread URL 逻辑保持：首条消息后 `?thread=` 写入地址栏，刷新可恢复会话。

## D. 组件与交互细节

- **Composer**：textarea 自动增高（1→8 行封顶）；Enter 发送、Shift+Enter 换行；
  IME `compositionstart/end` 期间 Enter 不发送（dsh 同款细节）；`isLoading`
  时发送按钮变为 Stop，调用 `stream.stop()`；禁用态与现有逻辑一致。
- **工具卡片注册表**（最低限度）：`toolRegistry: Record<string, { label, className }>`，
  `task` → "Sub-agent: research-agent" 专属样式，未注册工具走默认卡片；
  `ToolCallCard` 的 details/summary 折叠与 pending→done 自动收起逻辑不变。
- **ThinkingBlock / ActivityCard / TodoDock**：结构保留，样式 token 化重写。
- **无障碍**：现有 `aria-label` / `aria-live` 全部保留；新增抽屉与弹层的
  焦点管理使用原生元素（dialog/details），不引入 headless UI 库。

## E. 测试与验收

- 迁移现有 `App.test.tsx`、`ToolCallCard.test.tsx` 至新目录结构，断言不变。
- 新增单测：
  - `lib/messages.ts`：human / ai prose / plan-like / tool 配对各消息形态；
  - `ThemeProvider`：三态切换、localStorage 持久化、字号边界（12/17）；
  - `Composer`：Enter 发送、Shift+Enter 换行、IME 组合期不发送、loading 时
    Stop 按钮出现且可点击；
  - `useThreads`：mock langgraph-sdk，验证列表加载与 switchThread。
- 验收标准：`npm run test` 与 `npm run build` 全绿；README 冒烟流程
  （PRD→BDD→SDD 门禁演示）交互行为不变；亮/暗/跟随系统三种模式下无闪白、
  无对比度回退。

## 实施顺序（概要）

1. token 体系 + ThemeProvider + bootstrap（含消息组件样式 token 化）
2. lib 层拆分（messages 先补测试再迁移；stream / threads 封装）
3. 布局外壳（Sidebar / MainLayout / header / TodoDock 位置调整）
4. Composer 升级（textarea / IME / Stop）
5. 工具卡片注册表与样式精修
6. 全量测试与构建验收
