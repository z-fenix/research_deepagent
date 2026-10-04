# task08 deepseek-harness 风格前端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `frontend/` 自栈重写 deepseek-harness 风格前端：一期三栏框架 + 右栏面板域（子 agent 对话 tab / Trajectory 占位 / Todos+审批），二期 Trajectory 全套（派生 / Ledger / Timeline / Toolbar）。

**Architecture:** 三栏 grid 框架（侧栏|中央对话|右栏面板轨道）+ 右栏 tab 注册表；子 agent tab 数据源为父图 state `async_tasks`（含 thread_id），懒连接第二个 `useStream(assistantId:"sdd-agent")`；Trajectory 从主线程 messages 纯函数派生 turn/step/cell，Ledger 用 @tanstack/react-virtual 虚拟行。

**Tech Stack:** React 18 + Vite + @langchain/langgraph-sdk（现有）；新增唯一依赖 @tanstack/react-virtual；vitest jsdom（现有）。

**Spec:** `docs/superpowers/specs/2026-10-04-task08-frontend-harness-design.md`

## Global Constraints

- 列常量逐字采用参照值：`CENTER_MIN=400`、`SIDEBAR_MIN=264`、`SIDEBAR_MAX=420`、`SIDEBAR_DEFAULT=280`、`SIDEBAR_COLLAPSED=56`、`SIDEBAR_AUTO_COLLAPSE=1024`、`RIGHTBAR_MIN=300`、`RIGHTBAR_DEFAULT_RATIO=0.45`、`RIGHTBAR_MAX_RATIO=0.7`。
- 列求解语义：右栏先收缩、再失去轨道，之后中央才允许低于最小值；侧栏不参与让位（spec §2.1）。
- 不搬参照代码；不移植 dockkit/slots；pane 树拖拽重排明确不做（spec §9）。
- 唯一新增 npm 依赖：`@tanstack/react-virtual`（^3）。其余用现有依赖。
- 数据层契约不变：`lib/stream.ts` 的 `extractPendingApproval`/`submitApproval`/`ApprovalDecision` 签名不动；ApprovalDock/TodoDock 组件 API 不动。
- 子 agent 对话 tab 只读（无 composer）；懒连接（激活才建 useStream，卸载即断）。
- 任务 `status` 变为 `"running"` 时自动打开右栏并激活子 agent tab，每任务只自动激活一次。
- 降级规则：无时间戳 → Timeline 耗时/真实时间模式禁用；无 usage → 请求头隐藏 usage 列；`async_tasks` 空 → 空态说明（spec §6）。
- 所有前端测试命令形如 `cd frontend && npx vitest run <file>`（package.json `test` 脚本已带 `--environment jsdom`）。
- 工作分支 `task08-frontend-harness`，从 master 切出；每任务至少一个 commit。
- 用户界面文案为英文（与现有 UI 一致：如 "Research plan"），代码注释可中文。

## Review Focus

1. **拖拽基线回跳**：拖动被 clamp 的列时宽度必须以按下时刻的渲染宽度为基线，不得跳回存储偏好值——Task 2 `useFrameLayout` 测试 pin。
2. **右栏挤压顺序**：视口不足时必须右栏先缩、再失轨、中央最后低于 400px——Task 1 `computeColumns` 边界测试 pin。
3. **任务重复自动激活**：同一 sdd 任务多次 status 刷新不得重复触发右栏自动打开/抢焦点——Task 4 已通告集合测试 pin。
4. **流式 partial 行数抖动**：Ledger 在 partial assistant 追加时行数不得增长（并入当前 step cell），否则虚拟窗口抖动——Task 6 派生测试 pin。
5. **审批契约不回退**：ApprovalDock 迁入右栏后，未决时 composer 禁用与决策复位行为必须原样保留——Task 5 集成测试 pin。

---

### Task 1: 列几何 layout/columns.ts

**Files:**
- Create: `frontend/src/layout/columns.ts`
- Test: `frontend/src/layout/columns.test.ts`

**Interfaces:**
- Consumes: 无（纯函数，零依赖）。
- Produces: 常量 `CENTER_MIN, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_DEFAULT, SIDEBAR_COLLAPSED, SIDEBAR_AUTO_COLLAPSE, RIGHTBAR_MIN, RIGHTBAR_MAX_RATIO, RIGHTBAR_DEFAULT_RATIO`；`type Columns { sidebar: number; center: number; rightbar: number }`；`clampWidth(px, min, max): number`；`computeColumns(viewport, sidebar, rightbar, collapsedWidth = SIDEBAR_COLLAPSED): Columns`。Task 2 消费全部。

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/layout/columns.test.ts
import { describe, expect, it } from "vitest";
import {
  CENTER_MIN,
  RIGHTBAR_DEFAULT_RATIO,
  RIGHTBAR_MIN,
  SIDEBAR_COLLAPSED,
  SIDEBAR_DEFAULT,
  clampWidth,
  computeColumns,
} from "./columns";

describe("clampWidth", () => {
  it("clamps into range and rounds", () => {
    expect(clampWidth(10, 264, 420)).toBe(264);
    expect(clampWidth(999, 264, 420)).toBe(420);
    expect(clampWidth(300.6, 264, 420)).toBe(301);
  });
});

describe("computeColumns", () => {
  it("gives defaults an unconstrained frame", () => {
    const cols = computeColumns(1600, SIDEBAR_DEFAULT, 1600 * RIGHTBAR_DEFAULT_RATIO);
    expect(cols.sidebar).toBe(280);
    expect(cols.rightbar).toBe(720);
    expect(cols.center).toBe(600);
  });

  it("shrinks the rightbar to the available space before losing its track", () => {
    // available = 1024 - 280 - 400 = 344 ≥ RIGHTBAR_MIN → 轨道保住，右栏被压到 344
    const cols = computeColumns(1024, 280, 2000);
    expect(cols.rightbar).toBe(344);
    expect(cols.center).toBe(CENTER_MIN);
  });

  it("drops the rightbar track when the center minimum cannot be met", () => {
    // available = 700 - 280 - 400 = 20 < 300 → 轨道归零，中央拿走剩余
    const cols = computeColumns(700, 280, 2000);
    expect(cols.rightbar).toBe(0);
    expect(cols.center).toBe(420);
  });

  it("caps the rightbar at 70% of the viewport", () => {
    const cols = computeColumns(2000, 280, 2000);
    expect(cols.rightbar).toBe(1320); // available=1320 < 1400(上限)
    const wide = computeColumns(3000, 280, 3000);
    expect(wide.rightbar).toBe(Math.min(3000 - 280 - 400, 3000 * 0.7));
  });

  it("collapses the sidebar to the icon rail at 0", () => {
    const cols = computeColumns(1200, 0, 0);
    expect(cols.sidebar).toBe(SIDEBAR_COLLAPSED);
    expect(cols.center).toBe(1200 - SIDEBAR_COLLAPSED);
  });

  it("clamps sidebar preference into 264..420", () => {
    expect(computeColumns(1600, 100, 0).sidebar).toBe(264);
    expect(computeColumns(1600, 1000, 0).sidebar).toBe(420);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/layout/columns.test.ts`
Expected: FAIL — "Cannot find module './columns'"

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/layout/columns.ts
// 三栏几何：常量与求解语义逐字对齐参照项目 ui-layout/src/client/columns.ts:11-59
// （spec §2.1）。右栏先收缩、再失去轨道，之后中央才允许低于最小值；侧栏不让位。

/** 中央列在右栏打开时受保护的最小宽度。 */
export const CENTER_MIN = 400;
/** 侧栏拖拽下限。 */
export const SIDEBAR_MIN = 264;
/** 侧栏拖拽上限。 */
export const SIDEBAR_MAX = 420;
/** 侧栏默认宽度。 */
export const SIDEBAR_DEFAULT = 280;
/** 侧栏收起后的图标栏宽度。 */
export const SIDEBAR_COLLAPSED = 56;
/** 低于该视口宽度时侧栏自动收起。 */
export const SIDEBAR_AUTO_COLLAPSE = 1024;
/** 右栏拖拽下限。 */
export const RIGHTBAR_MIN = 300;
/** 右栏最大宽度占框架比例。 */
export const RIGHTBAR_MAX_RATIO = 0.7;
/** 右栏首开偏好占框架比例。 */
export const RIGHTBAR_DEFAULT_RATIO = 0.45;

/** 一次列求解的解析结果。 */
export type Columns = { sidebar: number; center: number; rightbar: number };

/** 把宽度 clamp 进 [min, max] 并取整。 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)));
}

/**
 * 求解一次三栏宽度。
 * @param viewport 框架可用宽度 px。
 * @param sidebar 侧栏偏好（0 = 收起为图标栏）。
 * @param rightbar 右栏请求宽度（0 = 无轨道）。
 * @param collapsedWidth 侧栏收起时的轨道宽度。
 */
export function computeColumns(
  viewport: number,
  sidebar: number,
  rightbar: number,
  collapsedWidth: number = SIDEBAR_COLLAPSED,
): Columns {
  const s = sidebar === 0 ? collapsedWidth : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX);
  const available = viewport - s - CENTER_MIN;
  const r =
    rightbar === 0 || available < RIGHTBAR_MIN
      ? 0
      : Math.min(available, clampWidth(rightbar, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO));
  return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/layout/columns.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/layout/columns.ts frontend/src/layout/columns.test.ts
git commit -m "feat(frontend): three-column geometry solver with reference constants"
```

---

### Task 2: 框架布局状态与三栏骨架 layout/AppFrame

**Files:**
- Create: `frontend/src/layout/useFrameLayout.ts`
- Create: `frontend/src/layout/AppFrame.tsx`
- Modify: `frontend/src/styles.css`（追加 `/* harness frame */` 段，见 Step 5）
- Test: `frontend/src/layout/useFrameLayout.test.tsx`
- Test: `frontend/src/layout/AppFrame.test.tsx`

**Interfaces:**
- Consumes: Task 1 全部导出。
- Produces:
  - `type FrameLayoutState { viewport: number; sidebarPref: number; rightbarPref: number | null; narrowExpanded: boolean; sidebarCollapsed: boolean; rightbarTrack: boolean; cols: Columns }`
  - `useFrameLayout(frameRef: RefObject<HTMLDivElement | null>): { layout: FrameLayoutState; actions: { setSidebar(px: number): void; setRightbar(px: number): void; toggleSidebar(): void; openRightbar(defaultViewport: number): void; closeRightbar(): void; setNarrowExpanded(v: boolean): void } }`
  - `AppFrame({ layout, actions, sidebar, center, rightbar }: AppFrameProps): JSX.Element` — sidebar/center/rightbar 为 render 内容；Task 5 消费。
  - 持久化键：`harness.sidebar`、`harness.rightbar`（localStorage，读写失败静默降级为默认值）。

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/layout/useFrameLayout.test.tsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useRef } from "react";
import {
  RIGHTBAR_DEFAULT_RATIO,
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_COLLAPSED,
  useFrameLayout,
} from "./useFrameLayout";

function setup(initialViewport = 1600) {
  const ref = { current: document.createElement("div") };
  // 模拟 ResizeObserver 报告的框架宽度
  const hook = renderHook(() => useFrameLayout(ref), { initialProps: initialViewport });
  return { ref, ...hook };
}

beforeEach(() => localStorage.clear());

describe("useFrameLayout", () => {
  it("starts with reference defaults", () => {
    const { result } = setup(1600);
    expect(result.current.layout.sidebarPref).toBe(280);
    expect(result.current.layout.rightbarTrack).toBe(false);
    expect(result.current.layout.cols.sidebar).toBe(280);
  });

  it("persists sidebar and rightbar preferences across remounts", () => {
    const first = setup(1600);
    act(() => first.result.current.actions.setSidebar(360));
    act(() => first.result.current.actions.openRightbar(1600));
    expect(localStorage.getItem("harness.sidebar")).toBe("360");
    expect(localStorage.getItem("harness.rightbar")).toBe(String(1600 * RIGHTBAR_DEFAULT_RATIO));
    const second = setup(1600);
    expect(second.result.current.layout.sidebarPref).toBe(360);
    expect(second.result.current.layout.rightbarTrack).toBe(true);
  });

  it("auto-collapses the sidebar below the narrow breakpoint", () => {
    const { result, rerender } = setup(SIDEBAR_AUTO_COLLAPSE - 1);
    rerender(SIDEBAR_AUTO_COLLAPSE - 1);
    expect(result.current.layout.sidebarCollapsed).toBe(true);
    expect(result.current.layout.cols.sidebar).toBe(SIDEBAR_COLLAPSED);
    act(() => result.current.actions.setNarrowExpanded(true));
    expect(result.current.layout.sidebarCollapsed).toBe(false);
  });

  it("does not jump a clamped drag back to the stored preference", () => {
    // Review Focus 1：拖拽基线 = 渲染宽度，不是偏好值
    const { result } = setup(1024); // 1024 下 280 偏好可容纳
    act(() => result.current.actions.openRightbar(1024));
    const renderedRightbar = result.current.layout.cols.rightbar;
    act(() => result.current.actions.setRightbar(renderedRightbar - 10));
    expect(result.current.layout.cols.rightbar).toBe(renderedRightbar - 10);
  });
});
```

```tsx
// frontend/src/layout/AppFrame.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AppFrame, type FrameLayout } from "./AppFrame";

function firePointer(el: Element, type: "pointerdown" | "pointermove" | "pointerup", x: number) {
  fireEvent(el, new MouseEvent(type, { bubbles: true, clientX: x, button: 0 }));
}

function makeLayout(overrides: Partial<FrameLayout> = {}): FrameLayout {
  return {
    viewport: 1600,
    sidebarPref: 280,
    rightbarPref: 720,
    narrowExpanded: false,
    sidebarCollapsed: false,
    rightbarTrack: true,
    cols: { sidebar: 280, center: 600, rightbar: 720 },
    ...overrides,
  };
}

beforeEach(() => localStorage.clear());

describe("AppFrame", () => {
  it("renders three columns with solved widths in gridTemplateColumns", () => {
    render(
      <AppFrame
        layout={makeLayout()}
        actions={{} as never}
        sidebar={<div>left</div>}
        center={<div>chat</div>}
        rightbar={<div>panel</div>}
      />,
    );
    const frame = screen.getByText("chat").parentElement!.parentElement!;
    expect(frame.style.gridTemplateColumns).toBe("280px minmax(400px, 1fr) minmax(0px, 720px)");
    expect(screen.getByText("left")).toBeTruthy();
    expect(screen.getByText("panel")).toBeTruthy();
  });

  it("hides the rightbar track when rightbarTrack is false", () => {
    render(
      <AppFrame
        layout={makeLayout({ rightbarTrack: false, cols: { sidebar: 280, center: 1320, rightbar: 0 } })}
        actions={{} as never}
        sidebar={<div>left</div>}
        center={<div>chat</div>}
        rightbar={<div>panel</div>}
      />,
    );
    expect(screen.getByTestId("frame").style.gridTemplateColumns).toBe(
      "280px minmax(400px, 1fr) minmax(0px, 0px)",
    );
  });

  it("drags the sidebar handle and reports deltas against the drag-start width", () => {
    const onSidebarDrag = vi.fn();
    render(
      <AppFrame
        layout={makeLayout()}
        actions={{ onSidebarDrag } as never}
        sidebar={<div>left</div>}
        center={<div>chat</div>}
        rightbar={null}
      />,
    );
    const handle = screen.getByTestId("drag-sidebar");
    firePointer(handle, "pointerdown", 100);
    firePointer(handle, "pointermove", 140);
    firePointer(handle, "pointerup", 140);
    expect(onSidebarDrag).toHaveBeenCalledWith(40);
  });

  it("drags the rightbar handle with inverted deltas", () => {
    const onRightbarDrag = vi.fn();
    render(
      <AppFrame
        layout={makeLayout()}
        actions={{ onRightbarDrag } as never}
        sidebar={<div>left</div>}
        center={<div>chat</div>}
        rightbar={<div>panel</div>}
      />,
    );
    const handle = screen.getByTestId("drag-rightbar");
    firePointer(handle, "pointerdown", 900);
    firePointer(handle, "pointermove", 820);
    firePointer(handle, "pointerup", 820);
    expect(onRightbarDrag).toHaveBeenCalledWith(80); // 右把手向左拖 = 变宽
  });
});
```

注意：`AppFrameProps.actions` 的形态在 Step 3 定义为 `{ onSidebarDrag(dx), onRightbarDrag(dx), onSidebarToggle(), onNarrowToggle() }`，测试里 `as never` 处是为了构造部分动作；实现必须让缺失的动作可安全调用。

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/layout/useFrameLayout.test.tsx src/layout/AppFrame.test.tsx`
Expected: FAIL — "Cannot find module './useFrameLayout' / './AppFrame'"

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/layout/useFrameLayout.ts
// 框架布局状态：视口测量 + 两侧偏好（localStorage 持久化）+ 窄视口自动收起。
// 语义对齐参照 AppFrame.tsx:147-192（视口来自 ResizeObserver，窄视口自动折叠）。

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import {
  RIGHTBAR_DEFAULT_RATIO,
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_DEFAULT,
  clampWidth,
  computeColumns,
  RIGHTBAR_MAX_RATIO,
  RIGHTBAR_MIN,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  type Columns,
} from "./columns";

const SIDEBAR_KEY = "harness.sidebar";
const RIGHTBAR_KEY = "harness.rightbar";

function readStoredNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeStoredNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* 隐私模式等写入失败静默降级 */
  }
}

export type FrameLayoutState = {
  viewport: number;
  sidebarPref: number;
  rightbarPref: number | null;
  narrowExpanded: boolean;
  sidebarCollapsed: boolean;
  rightbarTrack: boolean;
  cols: Columns;
};

export type FrameActions = {
  setSidebar(px: number): void;
  setRightbar(px: number): void;
  toggleSidebar(): void;
  openRightbar(viewport: number): void;
  closeRightbar(): void;
  setNarrowExpanded(v: boolean): void;
};

export function useFrameLayout(frameRef: RefObject<HTMLElement | null>): {
  layout: FrameLayoutState;
  actions: FrameActions;
} {
  const [viewport, setViewport] = useState(() => frameRef.current?.clientWidth || window.innerWidth);
  const [sidebarPref, setSidebarPref] = useState(() => readStoredNumber(SIDEBAR_KEY) ?? SIDEBAR_DEFAULT);
  const [rightbarPref, setRightbarPref] = useState<number | null>(() => readStoredNumber(RIGHTBAR_KEY));
  const [narrowExpanded, setNarrowExpanded] = useState(false);
  const [rightbarTrack, setRightbarTrack] = useState(() => readStoredNumber(RIGHTBAR_KEY) !== null);

  useEffect(() => {
    const el = frameRef.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setViewport(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [frameRef]);

  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE;
  const sidebarCollapsed = narrow ? !narrowExpanded : sidebarPref === 0;
  const sidebarPreference = sidebarCollapsed
    ? 0
    : sidebarPref === 0
      ? SIDEBAR_DEFAULT
      : sidebarPref;
  const rightbarPreference = rightbarPref ?? viewport * RIGHTBAR_DEFAULT_RATIO;
  const cols = useMemo(
    () => computeColumns(viewport, sidebarPreference, rightbarTrack ? rightbarPreference : 0),
    [viewport, sidebarPreference, rightbarTrack, rightbarPreference],
  );

  const setSidebar = useCallback((px: number) => {
    const clamped = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX);
    setSidebarPref(clamped);
    writeStoredNumber(SIDEBAR_KEY, clamped);
  }, []);
  const setRightbar = useCallback((px: number) => {
    // clamp 用视口比例上限；宽度低于 RIGHTBAR_MIN 时收起轨道（与参照手感一致）
    const max = window.innerWidth * RIGHTBAR_MAX_RATIO;
    const clamped = clampWidth(px, RIGHTBAR_MIN, max);
    setRightbarPref(clamped);
    writeStoredNumber(RIGHTBAR_KEY, clamped);
  }, []);
  const toggleSidebar = useCallback(() => {
    if (narrow) setNarrowExpanded((v) => !v);
    else {
      const next = sidebarPref === 0 ? SIDEBAR_DEFAULT : 0;
      setSidebarPref(next);
      if (next !== 0) writeStoredNumber(SIDEBAR_KEY, next);
      else localStorage.removeItem(SIDEBAR_KEY);
    }
  }, [narrow, sidebarPref]);
  const openRightbar = useCallback((vp: number) => {
    setRightbarPref((current) => current ?? vp * RIGHTBAR_DEFAULT_RATIO);
    setRightbarTrack(true);
  }, []);
  const closeRightbar = useCallback(() => {
    setRightbarTrack(false);
    try {
      localStorage.removeItem(RIGHTBAR_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return {
    layout: { viewport, sidebarPref, rightbarPref, narrowExpanded, sidebarCollapsed, rightbarTrack, cols },
    actions: { setSidebar, setRightbar, toggleSidebar, openRightbar, closeRightbar, setNarrowExpanded },
  };
}
```

```tsx
// frontend/src/layout/AppFrame.tsx
// 三栏框架骨架：grid 三列 + 两侧 DragHandle（pointer capture + rAF 节流，
// 拖拽基线 = 按下时刻渲染宽度，参照 AppFrame.tsx:198-203 的防回跳语义）。

import { useCallback, useRef, useState, type ReactNode, type RefObject } from "react";
import { CENTER_MIN } from "./columns";
import { useFrameLayout, type FrameActions, type FrameLayoutState } from "./useFrameLayout";

export type AppFrameProps = {
  layout: FrameLayoutState;
  actions: FrameActions & {
    onSidebarDrag?(dx: number): void;
    onRightbarDrag?(dx: number): void;
  };
  sidebar: ReactNode;
  center: ReactNode;
  rightbar: ReactNode;
  frameRef?: RefObject<HTMLDivElement | null>;
};

type Side = "sidebar" | "rightbar";

function DragHandle(props: {
  side: Side;
  left: number;
  onDrag: (dx: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef(0);
  const frame = useRef<number | null>(null);
  const latest = useRef(0);
  const onDrag = useRef(props.onDrag);
  onDrag.current = props.onDrag;

  const schedule = useCallback((cb: () => void) => {
    if (typeof requestAnimationFrame === "function") {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        cb();
      });
    } else cb();
  }, []);
  const endDrag = useCallback(() => {
    setDragging(false);
    if (frame.current !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  return (
    <div
      className="frame__handle"
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      data-testid={`drag-${props.side}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* jsdom 无 pointer capture，忽略 */
        }
        origin.current = e.clientX;
        latest.current = e.clientX;
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        latest.current = e.clientX;
        schedule(() => onDrag.current(latest.current - origin.current));
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}

export function AppFrame({ layout, actions, sidebar, center, rightbar, frameRef }: AppFrameProps) {
  const [innerRef, setInnerRef] = useState<HTMLDivElement | null>(null);
  const ref = frameRef ?? { current: innerRef };
  const live = useFrameLayout(ref); // AppFrame 自带测量；App 可直接复用返回值
  const state = layout ?? live.layout;
  const act = actions ?? live.actions;

  const handleSidebarDrag = useCallback(
    (dx: number) => {
      act.onSidebarDrag?.(dx) ?? act.setSidebar(state.cols.sidebar + dx);
    },
    [act, state.cols.sidebar],
  );
  const handleRightbarDrag = useCallback(
    (dx: number) => {
      act.onRightbarDrag?.(dx) ?? act.setRightbar(state.cols.rightbar - dx);
    },
    [act, state.cols.rightbar],
  );

  return (
    <div
      ref={setInnerRef}
      data-testid="frame"
      className="frame"
      data-sidebar-collapsed={state.sidebarCollapsed || undefined}
      data-rightbar-collapsed={state.cols.rightbar === 0 || undefined}
      style={{
        gridTemplateColumns: `${state.cols.sidebar}px minmax(${CENTER_MIN}px, 1fr) minmax(0px, ${state.cols.rightbar}px)`,
      }}
    >
      <div className="frame__sidebar">{sidebar}</div>
      <div className="frame__center">{center}</div>
      <div className="frame__rightbar" data-rightbar-col>
        {state.cols.rightbar > 0 ? rightbar : null}
      </div>
      {!state.sidebarCollapsed && state.cols.sidebar > SIDEBAR_ICON_RAIL && (
        <DragHandle side="sidebar" left={state.cols.sidebar} onDrag={handleSidebarDrag} />
      )}
      {state.rightbarTrack && state.cols.rightbar > 0 && (
        <DragHandle side="rightbar" left={state.viewport - state.cols.rightbar} onDrag={handleRightbarDrag} />
      )}
    </div>
  );
}

const SIDEBAR_ICON_RAIL = 1;
```

注：`SIDEBAR_ICON_RAIL` 是让"侧栏收起为 56px 图标栏时不出拖拽手柄"成立的最小宽度判定（图标栏固定宽，不可拖，与参照 AppFrame.tsx:321 一致）。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/layout/useFrameLayout.test.tsx src/layout/AppFrame.test.tsx`
Expected: PASS (8 tests)

- [ ] **Step 5: Append frame styles to styles.css and commit**

在 `frontend/src/styles.css` 末尾追加：

```css
/* harness frame（task08 三栏框架） */
.frame {
  display: grid;
  position: relative;
  height: 100dvh;
  width: 100%;
  overflow: hidden;
}
.frame__sidebar { overflow-y: auto; min-width: 0; }
.frame__center { overflow-y: auto; min-width: 0; display: flex; flex-direction: column; }
.frame__rightbar { overflow: hidden; position: relative; }
.frame__handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 9px;
  transform: translateX(-50%);
  cursor: col-resize;
  z-index: 30;
}
.frame__handle[data-side="sidebar"] { cursor: col-resize; }
.frame__handle[data-dragging] { background: var(--accent, #4f6ef7); opacity: 0.25; }
```

```bash
git add frontend/src/layout frontend/src/styles.css
git commit -m "feat(frontend): app frame with drag handles and persisted column prefs"
```

---

### Task 3: 右栏面板域 panels/PanelHost

**Files:**
- Create: `frontend/src/panels/PanelHost.tsx`
- Test: `frontend/src/panels/PanelHost.test.tsx`

**Interfaces:**
- Consumes: 无新依赖（Task 5 传入面板定义）。
- Produces:
  - `type PanelId = "subagents" | "trajectory" | "workbench"`
  - `type PanelDef { id: PanelId; title: string; render(): ReactNode }`
  - `PanelHost({ panels, activeId, onActivate, persistKey = "harness.panel" }: { panels: PanelDef[]; activeId: PanelId | null; onActivate(id: PanelId | null): void; persistKey?: string }): JSX.Element` — tab 条 + 活动面板体；`onActivate(null)`（再次点击当前 tab）收起右栏；激活态持久化到 localStorage。

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/panels/PanelHost.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PanelHost, type PanelDef } from "./PanelHost";

const panels: PanelDef[] = [
  { id: "subagents", title: "Sub-agents", render: () => <div>subagent body</div> },
  { id: "trajectory", title: "Trajectory", render: () => <div>trajectory body</div> },
  { id: "workbench", title: "Workbench", render: () => <div>workbench body</div> },
];

beforeEach(() => localStorage.clear());

describe("PanelHost", () => {
  it("renders tab bar and only the active panel body", () => {
    render(<PanelHost panels={panels} activeId="trajectory" onActivate={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Sub-agents" })).toBeTruthy();
    expect(screen.getByText("trajectory body")).toBeTruthy();
    expect(screen.queryByText("subagent body")).toBeNull();
  });

  it("activates a tab on click and deactivates on second click", () => {
    const onActivate = vi.fn();
    render(<PanelHost panels={panels} activeId={null} onActivate={onActivate} />);
    fireEvent.click(screen.getByRole("tab", { name: "Workbench" }));
    expect(onActivate).toHaveBeenLastCalledWith("workbench");
    render(<PanelHost panels={panels} activeId="workbench" onActivate={onActivate} />);
    fireEvent.click(screen.getByRole("tab", { name: "Workbench" }));
    expect(onActivate).toHaveBeenLastCalledWith(null);
  });

  it("persists the active tab and restores it", () => {
    const onActivate = vi.fn();
    render(<PanelHost panels={panels} activeId="subagents" onActivate={onActivate} />);
    expect(localStorage.getItem("harness.panel")).toBe("subagents");
    // 恢复逻辑由 App 用同一键读取；PanelHost 只负责写
  });

  it("shows the empty state when no panels exist", () => {
    render(<PanelHost panels={[]} activeId={null} onActivate={vi.fn()} />);
    expect(screen.getByText("No panels available")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/panels/PanelHost.test.tsx`
Expected: FAIL — "Cannot find module './PanelHost'"

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/src/panels/PanelHost.tsx
// 右栏面板域：tab 注册表 + 面板体。参照 rightbar 语义——本组件只负责
// "轨道内的内容"，轨道有无由 AppFrame 的列求解决定（spec §4.2）。

import { useEffect, type ReactNode } from "react";

export type PanelId = "subagents" | "trajectory" | "workbench";

export type PanelDef = {
  id: PanelId;
  title: string;
  render(): ReactNode;
};

export function persistActivePanel(id: PanelId | null, key = "harness.panel"): void {
  try {
    if (id === null) localStorage.removeItem(key);
    else localStorage.setItem(key, id);
  } catch {
    /* ignore */
  }
}

export function readActivePanel(key = "harness.panel"): PanelId | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === "subagents" || raw === "trajectory" || raw === "workbench" ? raw : null;
  } catch {
    return null;
  }
}

export function PanelHost(props: {
  panels: PanelDef[];
  activeId: PanelId | null;
  onActivate(id: PanelId | null): void;
  persistKey?: string;
}): ReactNode {
  const { panels, activeId, onActivate, persistKey } = props;
  useEffect(() => {
    persistActivePanel(activeId, persistKey);
  }, [activeId, persistKey]);
  const active = panels.find((p) => p.id === activeId) ?? null;
  return (
    <div className="panel-host">
      <div className="panel-host__tabs" role="tablist">
        {panels.map((panel) => (
          <button
            key={panel.id}
            type="button"
            role="tab"
            aria-selected={panel.id === activeId}
            className={`panel-host__tab${panel.id === activeId ? " panel-host__tab--active" : ""}`}
            onClick={() => onActivate(panel.id === activeId ? null : panel.id)}
          >
            {panel.title}
          </button>
        ))}
      </div>
      <div className="panel-host__body" role="tabpanel">
        {active === null
          ? <p className="panel-host__empty">{panels.length === 0 ? "No panels available" : "Select a panel"}</p>
          : active.render()}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/panels/PanelHost.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Append panel styles to styles.css and commit**

```css
/* panel host（task08 右栏面板域） */
.panel-host { display: flex; flex-direction: column; height: 100%; }
.panel-host__tabs { display: flex; gap: 2px; padding: 6px 8px 0; border-bottom: 1px solid var(--border, #e3e6ee); }
.panel-host__tab {
  border: none; background: transparent; padding: 6px 10px; cursor: pointer;
  font-size: 13px; color: var(--muted, #6b7280); border-radius: 6px 6px 0 0;
}
.panel-host__tab--active { color: var(--fg, #111827); background: var(--surface, #fff); box-shadow: inset 0 -2px 0 var(--accent, #4f6ef7); }
.panel-host__body { flex: 1; overflow-y: auto; padding: 8px 10px; }
.panel-host__empty { color: var(--muted, #6b7280); font-size: 13px; padding: 16px 4px; }
```

```bash
git add frontend/src/panels frontend/src/styles.css
git commit -m "feat(frontend): right-bar panel host with tab registry and persistence"
```

---

### Task 4: 子 agent 面板 panels/useSubagentStream + 任务 tab

**Files:**
- Create: `frontend/src/panels/subagent-tasks.ts`
- Create: `frontend/src/panels/useSubagentStream.ts`
- Create: `frontend/src/panels/SubagentPanel.tsx`
- Test: `frontend/src/panels/subagent-tasks.test.ts`
- Test: `frontend/src/panels/SubagentPanel.test.tsx`

**Interfaces:**
- Consumes: `lib/stream.ts` 的 `API_URL`、`Row`/`buildRows`（`lib/messages.ts`）；`Message` 类型。
- Produces:
  - `type AsyncTaskView { taskId: string; threadId: string; status: string; startedAt: string | null }`
  - `readAsyncTasks(values: unknown): AsyncTaskView[]` — 从 `stream.values` 守卫式读取 `async_tasks`（缺失/空/畸形 → `[]`）。
  - `deriveSubagentTabs(tasks: AsyncTaskView[]): AsyncTaskView[]` — 去重保序（taskId 唯一）。
  - `useSubagentStream(threadId: string | undefined): { rows: Row[]; error: unknown; retry(): void }` — 懒连接（仅在 threadId 变为有值时挂 useStream），`retry` 重挂。
  - `SubagentPanel({ tasks, activeTaskId, onActivate }: {...}): JSX.Element` — 任务 tab 条 + 只读消息流 + 错误条 + 空态文案 `"No async sub-agent tasks yet"`。
  - `useAutoOpenRunningTask(tasks: AsyncTaskView[], onOpen: (taskId: string) => void): void` — 每个任务首次转 `"running"` 调一次 `onOpen`（已通告集合，重渲染不重复，Review Focus 3）。

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/panels/subagent-tasks.test.ts
import { describe, expect, it } from "vitest";
import { deriveSubagentTabs, readAsyncTasks } from "./subagent-tasks";

describe("readAsyncTasks", () => {
  it("reads well-formed async_tasks", () => {
    const values = {
      async_tasks: {
        "t-1": { task_id: "t-1", thread_id: "t-1", status: "running", started_at: "2026-10-04T00:00:00Z" },
        "t-2": { task_id: "t-2", thread_id: "t-2", status: "success" },
      },
    };
    expect(readAsyncTasks(values)).toEqual([
      { taskId: "t-1", threadId: "t-1", status: "running", startedAt: "2026-10-04T00:00:00Z" },
      { taskId: "t-2", threadId: "t-2", status: "success", startedAt: null },
    ]);
  });

  it("returns [] for missing, empty, or malformed shapes", () => {
    expect(readAsyncTasks(undefined)).toEqual([]);
    expect(readAsyncTasks({})).toEqual([]);
    expect(readAsyncTasks({ async_tasks: {} })).toEqual([]);
    expect(readAsyncTasks({ async_tasks: { t: { status: 42 } } })).toEqual([]);
    expect(readAsyncTasks("nope")).toEqual([]);
  });
});

describe("deriveSubagentTabs", () => {
  it("dedupes by taskId preserving order", () => {
    const a = { taskId: "t-1", threadId: "t-1", status: "running", startedAt: null };
    const b = { taskId: "t-2", threadId: "t-2", status: "success", startedAt: null };
    expect(deriveSubagentTabs([a, b, { ...a, status: "success" }])).toEqual([a, b]);
  });
});
```

```tsx
// frontend/src/panels/SubagentPanel.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAutoOpenRunningTask, type AsyncTaskView } from "./subagent-tasks";
import { SubagentPanel } from "./SubagentPanel";
import { renderHook } from "@testing-library/react";

const running: AsyncTaskView = { taskId: "t-1", threadId: "t-1", status: "running", startedAt: null };
const done: AsyncTaskView = { taskId: "t-2", threadId: "t-2", status: "success", startedAt: null };

describe("SubagentPanel", () => {
  it("shows the empty state when there are no tasks", () => {
    render(<SubagentPanel tasks={[]} activeTaskId={null} onActivate={vi.fn()} />);
    expect(screen.getByText("No async sub-agent tasks yet")).toBeTruthy();
  });

  it("renders one read-only tab per task with a status badge, body only for active", async () => {
    const { rerender } = render(
      <SubagentPanel tasks={[running, done]} activeTaskId="t-1" onActivate={vi.fn()} />,
    );
    expect(screen.getByRole("tab", { name: /t-1/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /running/ })).toBeTruthy();
    // 活动任务体存在；无 composer（只读）
    await waitFor(() => expect(screen.getByTestId("subagent-body-t-1")).toBeTruthy());
    expect(screen.queryByRole("textbox")).toBeNull();
    rerender(<SubagentPanel tasks={[running, done]} activeTaskId="t-2" onActivate={vi.fn()} />);
    expect(screen.queryByTestId("subagent-body-t-1")).toBeNull();
  });
});

describe("useAutoOpenRunningTask", () => {
  it("announces each task once when it first turns running", () => {
    const onOpen = vi.fn();
    const { rerender } = renderHook(
      ({ tasks }: { tasks: AsyncTaskView[] }) => useAutoOpenRunningTask(tasks, onOpen),
      { initialProps: { tasks: [done] } },
    );
    rerender({ tasks: [done, running] });
    rerender({ tasks: [done, running] }); // 同一 running 任务重渲染不重复
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("t-1");
  });

  it("does not announce tasks that were never running", () => {
    const onOpen = vi.fn();
    renderHook(({ tasks }: { tasks: AsyncTaskView[] }) => useAutoOpenRunningTask(tasks, onOpen), {
      initialProps: { tasks: [done] },
    });
    expect(onOpen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/panels/subagent-tasks.test.ts src/panels/SubagentPanel.test.tsx`
Expected: FAIL — "Cannot find module './subagent-tasks' / './SubagentPanel'"

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/panels/subagent-tasks.ts
// 父图 state 的 async_tasks 读取（spec §2.2：deepagents
// async_subagents.py:80-135 AsyncTask{task_id（=thread_id）, thread_id, status, started_at}）。

export type AsyncTaskView = {
  taskId: string;
  threadId: string;
  status: string;
  startedAt: string | null;
};

export function readAsyncTasks(values: unknown): AsyncTaskView[] {
  if (values === null || typeof values !== "object") return [];
  const raw = (values as Record<string, unknown>).async_tasks;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const tasks: AsyncTaskView[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") continue;
    const task = value as Record<string, unknown>;
    const threadId = typeof task.thread_id === "string" ? task.thread_id : "";
    const status = typeof task.status === "string" ? task.status : "";
    if (threadId === "" || status === "") continue;
    tasks.push({
      taskId: typeof task.task_id === "string" ? task.task_id : key,
      threadId,
      status,
      startedAt: typeof task.started_at === "string" ? task.started_at : null,
    });
  }
  return tasks;
}

export function deriveSubagentTabs(tasks: AsyncTaskView[]): AsyncTaskView[] {
  const seen = new Set<string>();
  const out: AsyncTaskView[] = [];
  for (const task of tasks) {
    if (seen.has(task.taskId)) continue;
    seen.add(task.taskId);
    out.push(task);
  }
  return out;
}

import { useEffect, useRef } from "react";

/** 每个任务首次转 running 时回调一次（Review Focus 3：已通告集合防重复）。 */
export function useAutoOpenRunningTask(
  tasks: AsyncTaskView[],
  onOpen: (taskId: string) => void,
): void {
  const announced = useRef(new Set<string>());
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  useEffect(() => {
    for (const task of tasks) {
      if (task.status !== "running" || announced.current.has(task.taskId)) continue;
      announced.current.add(task.taskId);
      onOpenRef.current(task.taskId);
    }
  }, [tasks]);
}
```

```ts
// frontend/src/panels/useSubagentStream.ts
// 子线程懒连接：threadId 有值才挂 useStream（spec §6），卸载即断。

import { useStream } from "@langchain/react";
import { useCallback, useState } from "react";
import { buildRows, type Row } from "../lib/messages";
import { API_URL, type Message } from "../lib/stream";

type SubagentState = { messages: Message[] };

export function useSubagentStream(threadId: string | undefined): {
  rows: Row[];
  error: unknown;
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const stream = useStream<SubagentState>({
    apiUrl: API_URL,
    assistantId: "sdd-agent",
    threadId: threadId === undefined ? null : threadId,
    onError: () => setAttempt((n) => n + 1),
  });
  const rows = threadId === undefined ? [] : buildRows((stream.messages ?? []) as Message[]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // attempt 参与依赖以强制重渲染（stream.error 在重试后仍指向旧错误的场景由 key 重建兜底）
  return { rows, error: stream.error, retry };
}
```

注意：`@langchain/react` 的 `useStream` 对 `threadId: null` 的行为是"不绑定既有线程"；若该包版本不接受 `null`，改为条件渲染——只在 `threadId !== undefined` 的分支挂载内部组件 `<SubagentStreamInner threadId>`（组件内再调 useStream），外层 `useSubagentStream` 保持签名不变。两种写法二选一，以本仓库 node_modules 里 `@langchain/react` 的实际类型为准（实现者第一步先查 `frontend/node_modules/@langchain/react/dist/*.d.ts` 的 `useStream` 入参）。

```tsx
// frontend/src/panels/SubagentPanel.tsx
// 子 agent 面板：任务 tab 条 + 只读消息流（无 composer，对齐参照
// SubagentReadOnlyComposer 语义）+ 错误条 + 重试（spec §7）。

import { messageText } from "../lib/messages";
import { deriveSubagentTabs, type AsyncTaskView } from "./subagent-tasks";
import { useSubagentStream } from "./useSubagentStream";

function SubagentThreadBody({ threadId }: { threadId: string }) {
  const { rows, error, retry } = useSubagentStream(threadId);
  if (error) {
    return (
      <div className="subagent-panel__error" role="alert">
        <span>Sub-agent stream failed: {String(error)}</span>
        <button type="button" onClick={retry}>Retry</button>
      </div>
    );
  }
  return (
    <div className="subagent-panel__thread" data-testid={`subagent-body-${threadId}`}>
      {rows.map((row) => (
        <div key={row.key} className={`subagent-panel__row subagent-panel__row--${row.kind}`}>
          {row.kind === "prose" ? messageText(row.body) : row.kind === "plan" ? messageText(row.body) : `${row.card.name}: ${row.card.status}`}
        </div>
      ))}
    </div>
  );
}

export function SubagentPanel(props: {
  tasks: AsyncTaskView[];
  activeTaskId: string | null;
  onActivate(taskId: string | null): void;
}) {
  const tabs = deriveSubagentTabs(props.tasks);
  if (tabs.length === 0) {
    return <p className="panel-host__empty">No async sub-agent tasks yet</p>;
  }
  const active = tabs.find((t) => t.taskId === props.activeTaskId) ?? null;
  return (
    <div className="subagent-panel">
      <div className="subagent-panel__tabs" role="tablist">
        {tabs.map((task) => (
          <button
            key={task.taskId}
            type="button"
            role="tab"
            aria-selected={task.taskId === props.activeTaskId}
            className="subagent-panel__tab"
            onClick={() => props.onActivate(task.taskId === props.activeTaskId ? null : task.taskId)}
          >
            {task.taskId.slice(0, 8)} <span className={`subagent-panel__badge subagent-panel__badge--${task.status}`}>{task.status}</span>
          </button>
        ))}
      </div>
      {active !== null && <SubagentThreadBody key={active.threadId} threadId={active.threadId} />}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/panels/subagent-tasks.test.ts src/panels/SubagentPanel.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels
git commit -m "feat(frontend): sub-agent panel with async task tabs and lazy sub-thread stream"
```

---

### Task 5: App 三栏接线（一期收口）

**Files:**
- Modify: `frontend/src/App.tsx`（整体重写挂载结构，见 Step 3）
- Modify: `frontend/src/styles.css`（微调 `.shell` 系列迁移至 `.frame__*`，保留原类避免破坏 Sidebar/Header）
- Test: `frontend/src/App.test.tsx`（更新为三栏断言 + Review Focus 5 集成用例）

**Interfaces:**
- Consumes: Task 2 `AppFrame`/`useFrameLayout`；Task 3 `PanelHost`/`PanelDef`/`readActivePanel`/`persistActivePanel`；Task 4 `SubagentPanel`/`readAsyncTasks`/`useAutoOpenRunningTask`；现有 `Sidebar`/`Header`/`Composer`/`MessageList`/`ActivityCard`/`ThemeSettingsDialog`/`TodoDock`/`ApprovalDock`。
- Produces: 完整一期布局——左栏现有会话列表、中央列 chat+Composer、右栏 PanelHost（subagents/trajectory 占位/workbench）。

- [ ] **Step 1: Update the App test（先改测试，含 Review Focus 5）**

在现有 `frontend/src/App.test.tsx`（mock `useAgentStream` 的既有写法保持不变）基础上新增/调整断言：

```tsx
// frontend/src/App.test.tsx 追加用例（沿用文件内既有 stream mock 与 helper）
it("renders the three-column frame with panel tabs in the right bar", async () => {
  render(<App />);
  expect(document.querySelector('[data-testid="frame"]')).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Sub-agents" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Trajectory" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Workbench" })).toBeTruthy();
});

it("keeps the approval contract: pending approval disables the composer (Review Focus 5)", async () => {
  // 复用本文件既有的 pendingApproval mock（若无则扩展 mock 返回 pendingApproval 样例）
  render(<App />);
  const composer = screen.getByRole("textbox") as HTMLTextAreaElement;
  const submitBtn = screen.getByRole("button", { name: /send/i });
  expect(submitBtn).toHaveProperty("disabled", true);
  // 审批卡在 Workbench 面板内可用（切到 Workbench tab 后可见）
  fireEvent.click(screen.getByRole("tab", { name: "Workbench" }));
  expect(screen.getByTestId("approval-dock")).toBeTruthy();
});
```

注：若现有 `App.test.tsx` 的 mock 未提供 `pendingApproval`，按 `lib/stream.ts` 的 `PendingApproval` 形态补一个样例（`actionRequests: [{ name: "request_phase_approval", args: { phase: "prd", summary: "x" } }], reviewConfigs: [{ action_name: "request_phase_approval", allowed_decisions: ["respond"] }]`）。同时给 `ApprovalDock.tsx` 根元素补 `data-testid="approval-dock"`（一行改动）。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/App.test.tsx`
Expected: FAIL — 找不到 `[data-testid="frame"]`

- [ ] **Step 3: Rewrite App.tsx**

```tsx
// frontend/src/App.tsx
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ThemeProvider } from "./theme/ThemeProvider";
import { API_URL, sessionLink, useAgentStream } from "./lib/stream";
import { useThreads } from "./lib/threads";
import { AppFrame } from "./layout/AppFrame";
import { useFrameLayout } from "./layout/useFrameLayout";
import { PanelHost, readActivePanel, type PanelDef, type PanelId } from "./panels/PanelHost";
import { SubagentPanel } from "./panels/SubagentPanel";
import { readAsyncTasks, useAutoOpenRunningTask, type AsyncTaskView } from "./panels/subagent-tasks";
import Sidebar from "./components/shell/Sidebar";
import Header from "./components/shell/Header";
import ThemeSettingsDialog from "./components/shell/ThemeSettingsDialog";
import Composer from "./components/composer/Composer";
import TodoDock from "./components/todo/TodoDock";
import { ApprovalDock } from "./components/approval/ApprovalDock";
import MessageList from "./components/chat/MessageList";
import ActivityCard from "./components/chat/ActivityCard";

function AgentWorkspace(): ReactNode {
  const stream = useAgentStream();
  const { threads, loading } = useThreads(API_URL);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const { layout, actions } = useFrameLayout(frameRef);
  const [activePanel, setActivePanel] = useState<PanelId | null>(() => readActivePanel());
  const [activeSubagentTask, setActiveSubagentTask] = useState<string | null>(null);

  const tasks: AsyncTaskView[] = useMemo(() => readAsyncTasks(stream.values), [stream.values]);
  useAutoOpenRunningTask(tasks, useCallback((taskId: string) => {
    actions.openRightbar(window.innerWidth);
    setActivePanel("subagents");
    setActiveSubagentTask(taskId);
  }, [actions]));

  const activatePanel = useCallback((id: PanelId | null) => {
    setActivePanel(id);
    if (id === null) actions.closeRightbar();
    else actions.openRightbar(window.innerWidth);
  }, [actions]);

  const sessionUrl = sessionLink(stream.threadId);

  const panels: PanelDef[] = useMemo(
    () => [
      {
        id: "subagents",
        title: "Sub-agents",
        render: () => (
          <SubagentPanel tasks={tasks} activeTaskId={activeSubagentTask} onActivate={setActiveSubagentTask} />
        ),
      },
      {
        id: "trajectory",
        title: "Trajectory",
        render: () => <p className="panel-host__empty">Trajectory arrives in phase 2</p>,
      },
      {
        id: "workbench",
        title: "Workbench",
        render: () => (
          <div className="workbench">
            <ApprovalDock
              pendingApproval={stream.pendingApproval ?? null}
              error={stream.approvalError}
              onSubmit={(decisions) => void stream.submitApproval(decisions)}
            />
            <TodoDock todos={stream.todos} />
          </div>
        ),
      },
    ],
    [tasks, activeSubagentTask, stream.pendingApproval, stream.approvalError, stream.todos, stream.submitApproval],
  );

  return (
    <AppFrame
      frameRef={frameRef}
      layout={layout}
      actions={{
        ...actions,
        onSidebarDrag: (dx) => actions.setSidebar(layout.cols.sidebar + dx),
        onRightbarDrag: (dx) => actions.setRightbar(layout.cols.rightbar - dx),
      }}
      sidebar={
        <>
          <button
            type="button"
            className="shell__menu"
            aria-label="打开会话列表"
            onClick={() => setDrawerOpen(true)}
          >
            ☰
          </button>
          {drawerOpen && <div className="shell__backdrop" onClick={() => setDrawerOpen(false)} />}
          <Sidebar
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            threads={threads}
            loading={loading}
            activeThreadId={stream.threadId}
            onSelect={(id) => {
              stream.openThread(id);
              setDrawerOpen(false);
            }}
            onNewSession={() => {
              stream.openThread(undefined);
              setDrawerOpen(false);
            }}
            onOpenAppearance={() => setAppearanceOpen(true)}
          />
        </>
      }
      center={
        <>
          <Header sessionUrl={sessionUrl} />
          <div className="shell__scroll">
            <div className="shell__content">
              <section className="chat" aria-label="Research conversation">
                {stream.rows.length === 0 && !stream.isLoading && (
                  <p className="hint">
                    Try: <em>"Research what LangGraph 1.0 added vs 0.x. Cite sources."</em>
                  </p>
                )}
                <MessageList rows={stream.rows} />
                <ActivityCard visible={stream.isLoading} />
                {stream.error ? <p className="error">{String(stream.error)}</p> : null}
              </section>
            </div>
          </div>
          <Composer
            isLoading={stream.isLoading}
            disabled={stream.pendingApproval != null}
            onSubmit={stream.submit}
            onStop={stream.stop}
          />
        </>
      }
      rightbar={
        <PanelHost panels={panels} activeId={activePanel} onActivate={activatePanel} />
      }
    />
  );
}

export default function App(): ReactNode {
  return (
    <ThemeProvider>
      <AgentWorkspace />
    </ThemeProvider>
  );
}
```

同时把 `useRef` 加入 import（`import { useCallback, useMemo, useRef, useState, ... }`）。

- [ ] **Step 4: Run the whole frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS — 全部现有测试（ApprovalDock/Composer/messages/stream/threads/registry 等）+ 新 App 用例均过；无回归。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/components/approval/ApprovalDock.tsx frontend/src/styles.css
git commit -m "feat(frontend): wire three-column app frame with right-bar panels"
```

---

### Task 6: Trajectory 数据派生 trajectory/layout.ts

**Files:**
- Create: `frontend/src/trajectory/layout.ts`
- Test: `frontend/src/trajectory/layout.test.ts`

**Interfaces:**
- Consumes: `lib/messages.ts` 的 `Message`/`RawToolCall`/`messageText`。
- Produces（Task 7/8/9 全部消费）:
  - `type TrajUsage { input?: number; output?: number }`
  - `type TrajToolBlock { callId: string; name: string; args: unknown; result: string | null; status: "pending" | "done"; isDelegation: boolean; subTools: TrajToolBlock[] }`（`isDelegation` = `name === "task"`，subTools 承载 prd/bdd 的 response_format JSON 报告块）
  - `type TrajCell = { kind: "assistant"; step: number; text: string; model: string | null; usage: TrajUsage | null; toolBlocks: TrajToolBlock[] }`（一 step 一 cell，Review Focus 4：partial 追加不改行数）
  - `type TrajStep = { step: number; model: string | null; usage: TrajUsage | null; cell: TrajCell }`
  - `type TrajTurn = { turn: number; prompt: string; steps: TrajStep[] }`
  - `deriveTrajectory(messages: Message[]): TrajTurn[]`
  - `cumulativeUsage(turns: TrajTurn[]): TrajUsage | null`（按序累加）
  - `collapsibleTurnIds(turns: TrajTurn[]): number[]`（内容步数 > 1 的 turn）
  - `parseDelegationReport(block: TrajToolBlock): unknown | null`（task 工具的 JSON 结果解析，失败返回 null）

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/trajectory/layout.test.ts
import { describe, expect, it } from "vitest";
import {
  collapsibleTurnIds,
  cumulativeUsage,
  deriveTrajectory,
  parseDelegationReport,
  type Message,
} from "./layout";

const human = (content: string, id: string): Message => ({ id, type: "human", content });
const ai = (id: string, text: string, calls: Message["tool_calls"] = [], usage?: unknown, model?: string): Message => ({
  id,
  type: "ai",
  content: text,
  ...(calls.length > 0 ? { tool_calls: calls } : {}),
  ...(usage !== undefined ? { usage_metadata: usage } : {}),
  ...(model !== undefined ? { response_metadata: { model_name: model } } : {}),
});
const tool = (callId: string, content: unknown): Message => ({
  id: `tool-${callId}`,
  type: "tool",
  tool_call_id: callId,
  content,
});

describe("deriveTrajectory", () => {
  it("opens a new turn per human message and one step per ai message", () => {
    const turns = deriveTrajectory([human("first", "h1"), ai("a1", "hi", [], undefined, "gpt-4.1-mini"), human("second", "h2"), ai("a2", "ok")]);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.prompt).toBe("first");
    expect(turns[0]!.steps).toHaveLength(1);
    expect(turns[0]!.steps[0]!.cell.model).toBe("gpt-4.1-mini");
    expect(turns[1]!.prompt).toBe("second");
  });

  it("pairs tool results into the step's tool blocks by call id", () => {
    const turns = deriveTrajectory([
      human("q", "h1"),
      ai("a1", "", [{ id: "c1", name: "tavily_search", args: { q: "x" } }]),
      tool("c1", "results"),
    ]);
    const block = turns[0]!.steps[0]!.cell.toolBlocks[0]!;
    expect(block.callId).toBe("c1");
    expect(block.name).toBe("tavily_search");
    expect(block.result).toBe("results");
    expect(block.status).toBe("done");
  });

  it("keeps a pending block when the result has not arrived", () => {
    const turns = deriveTrajectory([human("q", "h1"), ai("a1", "", [{ id: "c1", name: "task", args: {} }])]);
    expect(turns[0]!.steps[0]!.cell.toolBlocks[0]!.status).toBe("pending");
  });

  it("wraps task delegation results as nested sub-tool report blocks", () => {
    const report = JSON.stringify({ phase: "prd", summary: "PRD ok" });
    const turns = deriveTrajectory([
      human("q", "h1"),
      ai("a1", "", [{ id: "c1", name: "task", args: { subagent_type: "prd-agent" } }]),
      tool("c1", report),
    ]);
    const block = turns[0]!.steps[0]!.cell.toolBlocks[0]!;
    expect(block.isDelegation).toBe(true);
    expect(block.subTools).toHaveLength(1);
    expect(block.subTools[0]!.name).toBe("phase_report");
    expect(block.subTools[0]!.args).toEqual({ phase: "prd", summary: "PRD ok" });
  });

  it("extracts usage and model from metadata; null when absent", () => {
    const turns = deriveTrajectory([
      human("q", "h1"),
      ai("a1", "x", [], { input_tokens: 100, output_tokens: 20 }, "gpt-4.1-mini"),
      ai("a2", "y"),
    ]);
    const step1 = turns[0]!.steps[0]!;
    expect(step1.cell.usage).toEqual({ input: 100, output: 20 });
    expect(turns[0]!.steps[1]!.cell.usage).toBeNull();
  });

  it("keeps one cell per step regardless of streaming growth (Review Focus 4)", () => {
    const base = [human("q", "h1"), ai("a1", "partial")];
    const grown = [human("q", "h1"), ai("a1", "partial text grown longer")];
    expect(deriveTrajectory(base)[0]!.steps).toHaveLength(1);
    expect(deriveTrajectory(grown)[0]!.steps).toHaveLength(1);
    expect(deriveTrajectory(grown)[0]!.steps[0]!.cell.text).toContain("grown");
  });

  it("puts leading ai messages in turn 0 with an empty prompt", () => {
    const turns = deriveTrajectory([ai("a1", "boot")]);
    expect(turns[0]!.turn).toBe(0);
    expect(turns[0]!.prompt).toBe("");
  });
});

describe("cumulativeUsage", () => {
  it("accumulates usage across steps in order; null when none", () => {
    const turns = deriveTrajectory([
      human("q", "h1"),
      ai("a1", "x", [], { input_tokens: 100, output_tokens: 20 }),
      ai("a2", "y", [], { input_tokens: 50, output_tokens: 10 }),
    ]);
    expect(cumulativeUsage(turns)).toEqual({ input: 150, output: 30 });
    expect(cumulativeUsage(deriveTrajectory([human("q", "h1")]))).toBeNull();
  });
});

describe("collapsibleTurnIds", () => {
  it("includes only turns with more than one step", () => {
    const turns = deriveTrajectory([human("q1", "h1"), ai("a1", "x"), ai("a2", "y"), human("q2", "h2"), ai("a3", "z")]);
    expect(collapsibleTurnIds(turns)).toEqual([0]);
  });
});

describe("parseDelegationReport", () => {
  it("parses task JSON and returns null for non-delegation or malformed", () => {
    const turns = deriveTrajectory([
      human("q", "h1"),
      ai("a1", "", [
        { id: "c1", name: "task", args: {} },
        { id: "c2", name: "tavily_search", args: {} },
      ]),
      tool("c1", "{\"a\":1}"),
      tool("c2", "plain"),
    ]);
    const blocks = turns[0]!.steps[0]!.cell.toolBlocks;
    expect(parseDelegationReport(blocks[0]!)).toEqual({ a: 1 });
    expect(parseDelegationReport(blocks[1]!)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/trajectory/layout.test.ts`
Expected: FAIL — "Cannot find module './layout'"

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/trajectory/layout.ts
// Trajectory 派生（spec §5.1）：父线程 messages → turn（human 开新 turn）→
// step（AI 消息）→ cell；tool 结果按 call_id 归块；task 委派结果包成
// 嵌套报告块；usage/模型取自消息元数据，缺失为 null。

import { messageText, type Message, type RawToolCall } from "../lib/messages";

export type TrajUsage = { input?: number; output?: number };

export type TrajToolBlock = {
  callId: string;
  name: string;
  args: unknown;
  result: string | null;
  status: "pending" | "done";
  isDelegation: boolean;
  subTools: TrajToolBlock[];
};

export type TrajCell = {
  kind: "assistant";
  step: number;
  text: string;
  model: string | null;
  usage: TrajUsage | null;
  toolBlocks: TrajToolBlock[];
};

export type TrajStep = { step: number; model: string | null; usage: TrajUsage | null; cell: TrajCell };
export type TrajTurn = { turn: number; prompt: string; steps: TrajStep[] };

const DELEGATION_TOOL = "task";

function blockFromCall(call: RawToolCall, fallbackId: string): TrajToolBlock {
  const callId = typeof call.id === "string" && call.id !== "" ? call.id : fallbackId;
  const name = typeof call.name === "string" && call.name !== "" ? call.name : "tool";
  return { callId, name, args: call.args ?? {}, result: null, status: "pending", isDelegation: name === DELEGATION_TOOL, subTools: [] };
}

function usageFromMeta(meta: unknown): TrajUsage | null {
  if (meta === null || typeof meta !== "object") return null;
  const raw = meta as Record<string, unknown>;
  const input = typeof raw.input_tokens === "number" ? raw.input_tokens : undefined;
  const output = typeof raw.output_tokens === "number" ? raw.output_tokens : undefined;
  if (input === undefined && output === undefined) return null;
  return { ...(input === undefined ? {} : { input }), ...(output === undefined ? {} : { output }) };
}

function modelFromMeta(meta: unknown): string | null {
  if (meta === null || typeof meta !== "object") return null;
  const name = (meta as Record<string, unknown>).model_name;
  return typeof name === "string" && name !== "" ? name : null;
}

function metaOf(msg: Message, key: string): unknown {
  if (typeof msg !== "object" || msg === null) return null;
  return (msg as unknown as Record<string, unknown>)[key] ?? null;
}

export function deriveTrajectory(messages: Message[]): TrajTurn[] {
  const turns: TrajTurn[] = [];
  let current: TrajTurn | null = null;
  const blocksByCallId = new Map<string, TrajToolBlock>();

  const ensureTurn = (prompt: string): TrajTurn => {
    const turn: TrajTurn = { turn: turns.length, prompt, steps: [] };
    turns.push(turn);
    return turn;
  };

  for (const [index, msg] of messages.entries()) {
    if (msg.type === "human") {
      current = ensureTurn(messageText(msg.content));
      continue;
    }
    if (current === null) current = ensureTurn("");
    if (msg.type === "ai") {
      const usage = usageFromMeta(metaOf(msg, "usage_metadata"));
      const model = modelFromMeta(metaOf(msg, "response_metadata"));
      const stepNumber = current.steps.length + 1;
      const cell: TrajCell = {
        kind: "assistant",
        step: stepNumber,
        text: messageText(msg.content),
        model,
        usage,
        toolBlocks: (msg.tool_calls ?? []).map((call, i) =>
          blockFromCall(call, `${msg.id ?? "ai"}-${i}-${index}`),
        ),
      };
      for (const block of cell.toolBlocks) blocksByCallId.set(block.callId, block);
      current.steps.push({ step: stepNumber, model, usage, cell });
      continue;
    }
    if (msg.type === "tool") {
      const callId = msg.tool_call_id;
      const block = callId === undefined ? undefined : blocksByCallId.get(callId);
      if (block === undefined) continue; // 孤儿结果静默丢弃（与 buildRows 一致）
      const text = messageText(msg.content);
      block.result = text;
      block.status = "done";
      if (block.isDelegation) {
        block.subTools = [{
          callId: `${block.callId}:report`,
          name: "phase_report",
          args: safeJson(text),
          result: null,
          status: "done",
          isDelegation: false,
          subTools: [],
        }];
      }
    }
  }
  return turns;
}

function safeJson(text: string | null): unknown {
  if (text === null || text === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function parseDelegationReport(block: TrajToolBlock): unknown | null {
  if (!block.isDelegation || block.result === null) return null;
  return safeJson(block.result);
}

export function cumulativeUsage(turns: TrajTurn[]): TrajUsage | null {
  let input: number | undefined;
  let output: number | undefined;
  for (const turn of turns) {
    for (const step of turn.steps) {
      if (step.usage === null) continue;
      input = (input ?? 0) + (step.usage.input ?? 0);
      output = (output ?? 0) + (step.usage.output ?? 0);
    }
  }
  if (input === undefined && output === undefined) return null;
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
  };
}

export function collapsibleTurnIds(turns: TrajTurn[]): number[] {
  return turns.filter((turn) => turn.steps.length > 1).map((turn) => turn.turn);
}
```

注意：`Message` 从 `lib/messages.ts` re-export（`export type { Message } from "../lib/messages"` 不必——直接 `import type { Message }` 再在测试里从 `./layout` 引入即可；实现里加 `export type { Message };` 以满足测试的 import）。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/trajectory/layout.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/trajectory
git commit -m "feat(frontend): trajectory turn/step/cell derivation with delegation sub-reports"
```

---

### Task 7: Ledger 虚拟表格 + 折叠 trajectory/Ledger

**Files:**
- Modify: `frontend/package.json`（dependencies 加 `"@tanstack/react-virtual": "^3.13.0"`，随后 `npm install`）
- Create: `frontend/src/trajectory/rows.ts`
- Create: `frontend/src/trajectory/Ledger.tsx`
- Test: `frontend/src/trajectory/rows.test.ts`
- Test: `frontend/src/trajectory/Ledger.test.tsx`

**Interfaces:**
- Consumes: Task 6 全部导出（`TrajTurn`/`TrajStep`/`collapsibleTurnIds`）。
- Produces:
  - `type LedgerRow = { key: string; kind: "turn-header" | "request-header" | "assistant" | "tool"; turn: number; step: number | null; text: string; model: string | null; usage: TrajUsage | null; block: TrajToolBlock | null; collapsedSummary: "turn" | "assistant" | null }`
  - `flattenTrajectoryRows(turns: TrajTurn[], collapsedTurns: ReadonlySet<number>, collapsedAssistants: ReadonlySet<string>): LedgerRow[]` — 纯函数；折叠 turn 压成一行 summary；折叠 assistant（其后跟工具块）压成一行 summary。
  - `Ledger({ turns, searchMatches }: { turns: TrajTurn[]; searchMatches?: ReadonlySet<string> | null }): JSX.Element` — 内部维护折叠集合（toggle 单 turn / 全部 turn / 全部 assistant），`searchMatches` 命中的行加 `data-match="true"`；容器高度为 0（jsdom/SSR）时跳过虚拟化全量渲染。
- 依赖安装命令：`cd frontend && npm install @tanstack/react-virtual@^3.13.0`

- [ ] **Step 1: Install the dependency first（非 TDD 顺序，一次性脚手架动作）**

Run: `cd frontend && npm install @tanstack/react-virtual@^3.13.0`
Expected: package.json dependencies 出现该条目。

- [ ] **Step 2: Write the failing tests**

```ts
// frontend/src/trajectory/rows.test.ts
import { describe, expect, it } from "vitest";
import { deriveTrajectory, type Message } from "./layout";
import { flattenTrajectoryRows } from "./rows";

const human = (content: string, id: string): Message => ({ id, type: "human", content });
const ai = (id: string, text: string, calls: Message["tool_calls"] = []): Message => ({
  id, type: "ai", content: text, ...(calls.length > 0 ? { tool_calls: calls } : {}),
});
const tool = (callId: string, content: string): Message => ({ id: `t-${callId}`, type: "tool", tool_call_id: callId, content });

const messages: Message[] = [
  human("q1", "h1"),
  ai("a1", "thinking", [{ id: "c1", name: "tavily_search", args: { q: 1 } }]),
  tool("c1", "res"),
  ai("a2", "answer"),
  human("q2", "h2"),
  ai("a3", "final"),
];

describe("flattenTrajectoryRows", () => {
  it("emits turn headers, request headers, assistant and tool rows in order", () => {
    const turns = deriveTrajectory(messages);
    const rows = flattenTrajectoryRows(turns, new Set(), new Set());
    expect(rows.map((r) => r.kind)).toEqual([
      "turn-header", "request-header", "assistant", "tool", "request-header", "assistant",
      "turn-header", "request-header", "assistant",
    ]);
    expect(rows[0]).toMatchObject({ kind: "turn-header", turn: 0, text: "q1" });
    expect(rows[2]).toMatchObject({ kind: "assistant", text: "thinking", model: null });
    expect(rows[3]).toMatchObject({ kind: "tool", block: { callId: "c1", status: "done" } });
  });

  it("collapses a turn into a single summary row", () => {
    const turns = deriveTrajectory(messages);
    const rows = flattenTrajectoryRows(turns, new Set([0]), new Set());
    expect(rows.filter((r) => r.turn === 0)).toHaveLength(1);
    expect(rows.find((r) => r.turn === 0)).toMatchObject({ kind: "turn-header", collapsedSummary: "turn" });
  });

  it("collapses an assistant followed by tool rows into one summary", () => {
    const turns = deriveTrajectory(messages);
    const rows = flattenTrajectoryRows(turns, new Set(), new Set(["0:1"]));
    const turn0 = rows.filter((r) => r.turn === 0);
    expect(turn0.map((r) => r.kind)).toEqual(["turn-header", "request-header", "assistant"]);
    expect(turn0[2]!.collapsedSummary).toBe("assistant");
  });
});
```

```tsx
// frontend/src/trajectory/Ledger.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deriveTrajectory, type Message } from "./layout";
import { Ledger } from "./Ledger";

const messages: Message[] = [
  { id: "h1", type: "human", content: "q1" },
  { id: "a1", type: "ai", content: "step one", tool_calls: [{ id: "c1", name: "task", args: { subagent_type: "prd-agent" } }] },
  { id: "t1", type: "tool", tool_call_id: "c1", content: JSON.stringify({ phase: "prd" }) },
  { id: "a2", type: "ai", content: "done" },
];

describe("Ledger", () => {
  it("renders rows and the delegation report sub-block", () => {
    render(<Ledger turns={deriveTrajectory(messages)} />);
    expect(screen.getByText("q1")).toBeTruthy();
    expect(screen.getByText("step one")).toBeTruthy();
    expect(screen.getByText(/task/)).toBeTruthy();
    fireEvent.click(screen.getByText(/phase_report/)); // 展开子报告 JSON
    expect(screen.getByText(/"phase": "prd"/)).toBeTruthy();
  });

  it("toggles all turns collapsed and back", () => {
    render(<Ledger turns={deriveTrajectory(messages)} />);
    const all = screen.getByTestId("collapse-all-turns");
    fireEvent.click(all);
    expect(screen.getAllByText(/Turn 0/).length).toBeGreaterThan(0);
    fireEvent.click(all);
    expect(screen.getByText("step one")).toBeTruthy();
  });

  it("marks search-matched rows with data-match", () => {
    render(<Ledger turns={deriveTrajectory(messages)} searchMatches={new Set(["0:1"])} />);
    expect(document.querySelector('[data-match="true"]')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/trajectory/rows.test.ts src/trajectory/Ledger.test.tsx`
Expected: FAIL — "Cannot find module './rows' / './Ledger'"

- [ ] **Step 4: Write the implementation**

```ts
// frontend/src/trajectory/rows.ts
// 纯投影：turns → Ledger 行序（参照 trajectory-virtual-rows 的"边界并入下一
// 内容行"由 flatten 一并处理：turn/request header 行总是与内容同帧出现）。

import type { TrajToolBlock, TrajTurn, TrajUsage } from "./layout";

export type LedgerRow = {
  key: string;
  kind: "turn-header" | "request-header" | "assistant" | "tool";
  turn: number;
  step: number | null;
  text: string;
  model: string | null;
  usage: TrajUsage | null;
  block: TrajToolBlock | null;
  collapsedSummary: "turn" | "assistant" | null;
};

export function assistantKey(turn: number, step: number): string {
  return `${turn}:${step}`;
}

export function flattenTrajectoryRows(
  turns: TrajTurn[],
  collapsedTurns: ReadonlySet<number>,
  collapsedAssistants: ReadonlySet<string>,
): LedgerRow[] {
  const rows: LedgerRow[] = [];
  for (const turn of turns) {
    const turnCollapsed = collapsedTurns.has(turn.turn);
    if (turnCollapsed) {
      rows.push({
        key: `turn-${turn.turn}-summary`, kind: "turn-header", turn: turn.turn, step: null,
        text: turn.prompt, model: null, usage: null, block: null, collapsedSummary: "turn",
      });
      continue;
    }
    rows.push({
      key: `turn-${turn.turn}`, kind: "turn-header", turn: turn.turn, step: null,
      text: turn.prompt, model: null, usage: null, block: null, collapsedSummary: null,
    });
    for (const step of turn.steps) {
      const key = assistantKey(turn.turn, step.step);
      const collapsible = step.cell.toolBlocks.length > 0;
      if (collapsible && collapsedAssistants.has(key)) {
        rows.push({
          key: `asst-${key}-summary`, kind: "assistant", turn: turn.turn, step: step.step,
          text: step.cell.text, model: step.cell.model, usage: step.cell.usage, block: null,
          collapsedSummary: "assistant",
        });
        continue;
      }
      rows.push({
        key: `req-${key}`, kind: "request-header", turn: turn.turn, step: step.step,
        text: "", model: step.cell.model, usage: step.cell.usage, block: null, collapsedSummary: null,
      });
      rows.push({
        key: `asst-${key}`, kind: "assistant", turn: turn.turn, step: step.step,
        text: step.cell.text, model: step.cell.model, usage: step.cell.usage, block: null,
        collapsedSummary: null,
      });
      for (const block of step.cell.toolBlocks) {
        rows.push({
          key: `tool-${block.callId}`, kind: "tool", turn: turn.turn, step: step.step,
          text: "", model: null, usage: null, block, collapsedSummary: null,
        });
      }
    }
  }
  return rows;
}
```

```tsx
// frontend/src/trajectory/Ledger.tsx
// 虚拟化 Ledger：@tanstack/react-virtual 变高行；容器高度 0（jsdom/SSR）
// 时全量渲染兜底。折叠状态机与参照 TrajectoryView 一致（collapsedTurns/
// collapsedAssistants 集合 + 全部开关，TrajectoryView.tsx:462-502）。

import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  collapsibleTurnIds,
  cumulativeUsage,
  parseDelegationReport,
  type TrajToolBlock,
  type TrajTurn,
} from "./layout";
import { assistantKey, flattenTrajectoryRows } from "./rows";

function usageText(usage: { input?: number; output?: number } | null): string {
  if (usage === null) return "";
  const parts: string[] = [];
  if (usage.input !== undefined) parts.push(`in ${usage.input}`);
  if (usage.output !== undefined) parts.push(`out ${usage.output}`);
  return parts.join(" · ");
}

function ToolRow({ block }: { block: TrajToolBlock }): ReactNode {
  const [open, setOpen] = useState(false);
  const report = block.isDelegation ? parseDelegationReport(block) : null;
  return (
    <div className="ledger__tool" data-call={block.callId}>
      <button type="button" className="ledger__tool-head" onClick={() => setOpen((v) => !v)}>
        <span className="ledger__tool-name">{block.name}</span>
        <span className={`ledger__tool-status ledger__tool-status--${block.status}`}>{block.status}</span>
      </button>
      {open && (
        <div className="ledger__json">
          <pre>{JSON.stringify(block.args, null, 2)}</pre>
          {block.result !== null && <pre>{block.result}</pre>}
        </div>
      )}
      {report !== null && (
        <div className="ledger__subtool">
          <button
            type="button"
            className="ledger__tool-head"
            onClick={(e) => {
              const parent = e.currentTarget.nextElementSibling;
              if (parent !== null) parent.classList.toggle("ledger__json--hidden");
            }}
          >
            phase_report
          </button>
          <div className="ledger__json">
            <pre>{JSON.stringify(report, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export function Ledger(props: { turns: TrajTurn[]; searchMatches?: ReadonlySet<string> | null }): ReactNode {
  const { turns, searchMatches } = props;
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(new Set());
  const [collapsedAssistants, setCollapsedAssistants] = useState<ReadonlySet<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(
    () => flattenTrajectoryRows(turns, collapsedTurns, collapsedAssistants),
    [turns, collapsedTurns, collapsedAssistants],
  );
  const collapsibleTurns = useMemo(() => collapsibleTurnIds(turns), [turns]);
  const totalUsage = useMemo(() => cumulativeUsage(turns), [turns]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rows[index]!;
      return row.kind === "turn-header" ? 34 : row.kind === "request-header" ? 26 : 28;
    },
    overscan: 12,
  });
  // jsdom/SSR 兜底：容器无高度时虚拟窗口为空，直接全量渲染保证可测可用
  const useWindow = scrollRef.current !== null && scrollRef.current.clientHeight > 0;
  const windowRows = useWindow ? virtualizer.getVirtualItems() : rows.map((_, i) => ({ index: i, key: rows[i]!.key, start: 0, size: 0 }));

  const allTurnsCollapsed = collapsibleTurns.length > 0 && collapsibleTurns.every((t) => collapsedTurns.has(t));
  const collapsibleAssistantKeys: string[] = [];
  for (const turn of turns) {
    for (const step of turn.steps) {
      if (step.cell.toolBlocks.length > 0) collapsibleAssistantKeys.push(assistantKey(turn.turn, step.step));
    }
  }
  const allAssistantsCollapsed = collapsibleAssistantKeys.length > 0 && collapsibleAssistantKeys.every((k) => collapsedAssistants.has(k));

  const toggleAllTurns = () => {
    setCollapsedTurns(allTurnsCollapsed ? new Set() : new Set(collapsibleTurns));
  };
  const toggleAllAssistants = () => {
    setCollapsedAssistants(allAssistantsCollapsed ? new Set() : new Set(collapsibleAssistantKeys));
  };
  const toggleTurn = (turn: number) => {
    setCollapsedTurns((current) => {
      const next = new Set(current);
      if (next.has(turn)) next.delete(turn);
      else next.add(turn);
      return next;
    });
  };

  return (
    <div className="ledger">
      <div className="ledger__controls">
        <button type="button" data-testid="collapse-all-turns" onClick={toggleAllTurns}>
          {allTurnsCollapsed ? "Expand all turns" : "Collapse all turns"}
        </button>
        <button type="button" data-testid="collapse-all-assistants" onClick={toggleAllAssistants}>
          {allAssistantsCollapsed ? "Expand all steps" : "Collapse all steps"}
        </button>
        {totalUsage !== null && <span className="ledger__total-usage">tokens {usageText(totalUsage)}</span>}
      </div>
      <div className="ledger__scroll" ref={scrollRef} style={{ height: "100%", overflowY: "auto" }}>
        <div style={{ height: useWindow ? virtualizer.getTotalSize() : undefined, position: "relative" }}>
          {windowRows.map((item) => {
            const row = rows[item.index]!;
            const matched = searchMatches?.has(row.key) ?? false;
            const style = useWindow
              ? { position: "absolute" as const, top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }
              : undefined;
            return (
              <div
                key={row.key}
                data-virtual-index={item.index}
                data-match={matched || undefined}
                className={`ledger__row ledger__row--${row.kind}`}
                style={style}
              >
                {row.kind === "turn-header" && (
                  <button type="button" className="ledger__turn" onClick={() => toggleTurn(row.turn)}>
                    Turn {row.turn}: {row.text.slice(0, 60)}
                  </button>
                )}
                {row.kind === "request-header" && (
                  <div className="ledger__request">
                    <span>#{row.step}</span>
                    {row.model !== null && <span className="ledger__model">{row.model}</span>}
                    {row.usage !== null && <span className="ledger__usage">{usageText(row.usage)}</span>}
                  </div>
                )}
                {row.kind === "assistant" && (
                  <div className="ledger__assistant">
                    {row.text === "" ? <em>(no text)</em> : row.text}
                  </div>
                )}
                {row.kind === "tool" && row.block !== null && <ToolRow block={row.block} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/trajectory/rows.test.ts src/trajectory/Ledger.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 6: Append ledger styles to styles.css and commit**

```css
/* trajectory ledger（task08 二期） */
.ledger { display: flex; flex-direction: column; height: 100%; }
.ledger__controls { display: flex; gap: 8px; align-items: center; padding: 4px 0; }
.ledger__row { border-bottom: 1px solid var(--border, #eef0f5); padding: 3px 2px; font-size: 13px; }
.ledger__row--turn-header button { font-weight: 600; background: none; border: none; cursor: pointer; padding: 2px 0; }
.ledger__row--request-header { color: var(--muted, #6b7280); display: flex; gap: 8px; font-size: 12px; }
.ledger__row[data-match] { outline: 2px solid #f6c344; }
.ledger__tool-head { display: flex; gap: 8px; background: none; border: none; cursor: pointer; padding: 2px 0; }
.ledger__tool-status--pending { color: #b45309; }
.ledger__tool-status--done { color: #15803d; }
.ledger__json { background: var(--surface-2, #f7f8fb); padding: 6px; overflow-x: auto; }
.ledger__json--hidden { display: none; }
.ledger__json pre { margin: 0; font-size: 12px; white-space: pre-wrap; }
```

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/trajectory frontend/src/styles.css
git commit -m "feat(frontend): virtualized trajectory ledger with collapse and search marks"
```

---

### Task 8: Timeline 时间轴 + 时间戳捕获

**Files:**
- Create: `frontend/src/trajectory/timeline.ts`
- Create: `frontend/src/lib/timestamps.ts`
- Create: `frontend/src/trajectory/Timeline.tsx`
- Test: `frontend/src/trajectory/timeline.test.ts`
- Test: `frontend/src/lib/timestamps.test.tsx`
- Test: `frontend/src/trajectory/Timeline.test.tsx`

**Interfaces:**
- Consumes: Task 6 `TrajTurn`；Task 7 `assistantKey`。
- Produces:
  - `type TimelineMode = "off" | "sequence" | "duration" | "actual"`
  - `type TimelineItem { index: number; key: string; label: string; start: number | null; end: number | null; durationMs: number | null }`
  - `buildTimeline(turns: TrajTurn[], mode: TimelineMode, timestamps: ReadonlyMap<string, number>): TimelineItem[]` — sequence: start=index（纯序数）；duration/actual: start/end 取 timestamps（键 = `assistantKey(turn, step)`），无时间戳 → null；off → `[]`。
  - `timelineHasTimeData(turns: TrajTurn[], timestamps: ReadonlyMap<string, number>): boolean`
  - `useMessageTimestamps(messages: unknown[]): ReadonlyMap<string, number>` — 消息首次出现时 `Date.now()` 记录（键 = 消息 id），卸载不丢（useRef 生命周期内保留）。
  - `Timeline({ turns, timestamps, mode, onModeChange, selected, onSelect }: {...}): JSX.Element` — 横向条；无时间数据时 duration/actual 两个按钮 `disabled` + title 提示（spec §6 降级）；选区点击 item → `onSelect(item.key)`。

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/trajectory/timeline.test.ts
import { describe, expect, it } from "vitest";
import { deriveTrajectory, type Message } from "./layout";
import { assistantKey } from "./rows";
import { buildTimeline, timelineHasTimeData } from "./timeline";

const messages: Message[] = [
  { id: "h1", type: "human", content: "q" },
  { id: "a1", type: "ai", content: "one" },
  { id: "a2", type: "ai", content: "two" },
];
const turns = deriveTrajectory(messages);
const ts = new Map([[assistantKey(0, 1), 1000], [assistantKey(0, 2), 3000]]);

describe("buildTimeline", () => {
  it("uses ordinals in sequence mode", () => {
    const items = buildTimeline(turns, "sequence", new Map());
    expect(items.map((i) => i.start)).toEqual([0, 1]);
    expect(items.every((i) => i.durationMs === null)).toBe(true);
  });

  it("uses captured timestamps in duration mode", () => {
    const items = buildTimeline(turns, "duration", ts);
    expect(items[0]).toMatchObject({ start: 1000, end: 3000, durationMs: 2000 });
  });

  it("returns null starts when timestamps are missing", () => {
    const items = buildTimeline(turns, "duration", new Map());
    expect(items[0]!.start).toBeNull();
  });

  it("returns no items when mode is off", () => {
    expect(buildTimeline(turns, "off", ts)).toEqual([]);
  });
});

describe("timelineHasTimeData", () => {
  it("is true only when at least one step has a timestamp", () => {
    expect(timelineHasTimeData(turns, ts)).toBe(true);
    expect(timelineHasTimeData(turns, new Map())).toBe(false);
  });
});
```

```tsx
// frontend/src/lib/timestamps.test.tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMessageTimestamps } from "./timestamps";

describe("useMessageTimestamps", () => {
  it("records first-seen time per message id and keeps it on updates", () => {
    const { rerender, result } = renderHook(({ msgs }: { msgs: unknown[] }) => useMessageTimestamps(msgs), {
      initialProps: { msgs: [{ id: "a1" }] },
    });
    const first = result.current.get("a1");
    expect(typeof first).toBe("number");
    act(() => {
      vi.useFakeTimers();
      vi.setSystemTime((first as number) + 5_000);
    });
    rerender({ msgs: [{ id: "a1" }, { id: "a2" }] });
    expect(result.current.get("a1")).toBe(first); // 不刷新
    expect((result.current.get("a2") as number) - (first as number)).toBe(5_000);
    vi.useRealTimers();
  });

  it("skips messages without ids", () => {
    const { result } = renderHook(() => useMessageTimestamps([{ content: "no id" }]));
    expect(result.current.size).toBe(0);
  });
});
```

```tsx
// frontend/src/trajectory/Timeline.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { deriveTrajectory, type Message } from "./layout";
import { Timeline } from "./Timeline";

const messages: Message[] = [
  { id: "h1", type: "human", content: "q" },
  { id: "a1", type: "ai", content: "one" },
  { id: "a2", type: "ai", content: "two" },
];
const turns = deriveTrajectory(messages);

describe("Timeline", () => {
  it("disables time modes when there is no timestamp data", () => {
    render(<Timeline turns={turns} timestamps={new Map()} mode="sequence" onModeChange={vi.fn()} selected={null} onSelect={vi.fn()} />);
    const durationBtn = screen.getByRole("button", { name: /duration/i });
    expect(durationBtn).toHaveProperty("disabled", true);
  });

  it("selects a step and reports its key", () => {
    const onSelect = vi.fn();
    render(<Timeline turns={turns} timestamps={new Map()} mode="sequence" onModeChange={vi.fn()} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("timeline-item-0:1"));
    expect(onSelect).toHaveBeenCalledWith("0:1");
  });

  it("switches modes via the toolbar buttons", () => {
    const onModeChange = vi.fn();
    const ts = new Map([["0:1", 1], ["0:2", 2]]);
    render(<Timeline turns={turns} timestamps={ts} mode="sequence" onModeChange={onModeChange} selected={null} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /actual/i }));
    expect(onModeChange).toHaveBeenCalledWith("actual");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/trajectory/timeline.test.ts src/lib/timestamps.test.tsx src/trajectory/Timeline.test.tsx`
Expected: FAIL — 模块不存在

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/trajectory/timeline.ts
// Timeline 布局（spec §5.3）：序列模式用序数；耗时/真实时间模式用客户端
// 捕获的时间戳（键 = assistantKey），缺失 → null（禁用态由组件呈现）。

import type { TrajTurn } from "./layout";
import { assistantKey } from "./rows";

export type TimelineMode = "off" | "sequence" | "duration" | "actual";

export type TimelineItem = {
  index: number;
  key: string;
  label: string;
  start: number | null;
  end: number | null;
  durationMs: number | null;
};

export function buildTimeline(
  turns: TrajTurn[],
  mode: TimelineMode,
  timestamps: ReadonlyMap<string, number>,
): TimelineItem[] {
  if (mode === "off") return [];
  const items: TimelineItem[] = [];
  let index = 0;
  for (const turn of turns) {
    for (const step of turn.steps) {
      const key = assistantKey(turn.turn, step.step);
      const start = mode === "sequence" ? index : (timestamps.get(key) ?? null);
      const end = mode === "sequence" ? null : (timestamps.get(key) ?? null);
      items.push({
        index,
        key,
        label: `T${turn.turn}S${step.step}`,
        start,
        end,
        durationMs: mode === "sequence" || start === null || end === null ? null : Math.max(0, end - start),
      });
      index += 1;
    }
  }
  return items;
}

export function timelineHasTimeData(turns: TrajTurn[], timestamps: ReadonlyMap<string, number>): boolean {
  for (const turn of turns) {
    for (const step of turn.steps) {
      if (timestamps.has(assistantKey(turn.turn, step.step))) return true;
    }
  }
  return false;
}
```

```ts
// frontend/src/lib/timestamps.ts
// 消息首见时间捕获（spec §5.3）：实时流里消息首次到达时记 Date.now()；
// useRef 生命周期内保留（历史回放无时间戳 → Timeline 时间模式禁用）。

import { useEffect, useRef } from "react";

export function useMessageTimestamps(messages: unknown[]): ReadonlyMap<string, number> {
  const store = useRef(new Map<string, number>());
  useEffect(() => {
    for (const msg of messages) {
      if (msg === null || typeof msg !== "object") continue;
      const id = (msg as Record<string, unknown>).id;
      if (typeof id !== "string" || id === "" || store.current.has(id)) continue;
      store.current.set(id, Date.now());
    }
  }, [messages]);
  return store.current;
}
```

```tsx
// frontend/src/trajectory/Timeline.tsx
// 横向时间轴：模式切换 + 条目选择；无时间数据时禁用时间类模式（spec §6）。

import { timelineHasTimeData, type TimelineMode } from "./timeline";
import type { TrajTurn } from "./layout";

const MODES: TimelineMode[] = ["off", "sequence", "duration", "actual"];

export function Timeline(props: {
  turns: TrajTurn[];
  timestamps: ReadonlyMap<string, number>;
  mode: TimelineMode;
  onModeChange(mode: TimelineMode): void;
  selected: string | null;
  onSelect(key: string): void;
}): ReactNode {
  const { turns, timestamps, mode, onModeChange, selected, onSelect } = props;
  const hasTime = timelineHasTimeData(turns, timestamps);
  const timed = mode === "duration" || mode === "actual";
  const spanStart = timed ? Math.min(...[...timestamps.values()]) : 0;
  const spanEnd = timed ? Math.max(...[...timestamps.values()]) : 0;
  return (
    <div className="timeline">
      <div className="timeline__modes" role="toolbar" aria-label="Timeline mode">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            disabled={!hasTime && (m === "duration" || m === "actual")}
            title={!hasTime && (m === "duration" || m === "actual") ? "Time modes need a live capture; history has no timestamps" : undefined}
            className={m === mode ? "timeline__mode timeline__mode--active" : "timeline__mode"}
            onClick={() => onModeChange(m)}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="timeline__bar">
        {mode !== "off" && timed && timestamps.size === 0 ? null : null}
        {mode === "off" ? null : (
          <SequenceBar
            // timed 模式此刻仍按序渲染条目（时间刻度按相对位置），选择交互一致
            keys={collectStepKeys(turns)}
            selected={selected}
            onSelect={onSelect}
            spanStart={timed ? spanStart : 0}
            spanEnd={timed ? spanEnd : 0}
          />
        )}
      </div>
    </div>
  );
}

function collectStepKeys(turns: TrajTurn[]): { key: string; label: string; at: number | null }[] {
  const keys: { key: string; label: string; at: number | null }[] = [];
  let i = 0;
  for (const turn of turns) {
    for (const step of turn.steps) {
      keys.push({ key: `${turn.turn}:${step.step}`, label: `T${turn.turn}S${step.step}`, at: i });
      i += 1;
    }
  }
  return keys;
}

function SequenceBar(props: {
  keys: { key: string; label: string; at: number | null }[];
  selected: string | null;
  onSelect(key: string): void;
  spanStart: number;
  spanEnd: number;
}): ReactNode {
  const range = Math.max(1, props.spanEnd - props.spanStart);
  return (
    <>
      {props.keys.map((entry, index) => {
        const left = props.spanEnd > props.spanStart && entry.at !== null
          ? ((index / Math.max(1, props.keys.length - 1)) * 100)
          : (index / Math.max(1, props.keys.length)) * 100;
        return (
          <button
            key={entry.key}
            type="button"
            data-testid={`timeline-item-${entry.key}`}
            className={`timeline__item${props.selected === entry.key ? " timeline__item--selected" : ""}`}
            style={{ left: `${Math.min(97, left)}%` }}
            onClick={() => props.onSelect(entry.key)}
          >
            {entry.label}
          </button>
        );
      })}
    </>
  );
}
```

注：`range`/`spanStart` 变量在本实现中仅用于时间模式的位置缩放占位（条目仍按序数均布——真实刻度需要绝对定位度量，属参照项目的 timeline.ts 深化，spec §9 已把刻度精确度列为 defer 之外可后补的交互细节；此处保证选择/联动/禁用语义完整）。删除未使用变量以免 TS noUnusedLocals 报错——最终实现里若 `range` 未被引用则不声明。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/trajectory/timeline.test.ts src/lib/timestamps.test.tsx src/trajectory/Timeline.test.tsx`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/trajectory frontend/src/lib/timestamps.ts frontend/src/lib/timestamps.test.tsx
git commit -m "feat(frontend): trajectory timeline with modes and client-captured timestamps"
```

---

### Task 9: Toolbar + 搜索 + Trajectory 面板集成 + docs/dev 笔记

**Files:**
- Create: `frontend/src/trajectory/search.ts`
- Create: `frontend/src/trajectory/TrajectoryView.tsx`
- Modify: `frontend/src/App.tsx`（Trajectory 面板占位替换为 TrajectoryView；主线程接时间戳捕获）
- Modify: `frontend/src/lib/timestamps.ts`（不改——App 直接消费 `useMessageTimestamps(stream.messages)`）
- Modify: `frontend/src/styles.css`（timeline/toolbar 样式）
- Create: `docs/dev/trajectory-harness.md`
- Test: `frontend/src/trajectory/search.test.ts`
- Test: `frontend/src/trajectory/TrajectoryView.test.tsx`

**Interfaces:**
- Consumes: Task 6/7/8 全部导出；`lib/stream.ts` `AgentStream.rows` 背后的原始 messages（需要 App 从 `useAgentStream` 暴露 `messages`——`AgentStream` 增加只读字段 `messages: Message[]`，实现为 `stream.messages` 透传）。
- Produces:
  - `class TrajectorySearchIndex { update(rows: { key: string; text: string }[]): void; search(query: string): Set<string> | null }` — 小写分词索引；空 query 返回 null（无过滤）。
  - `TrajectoryView({ turns, timestamps, messages }: {...}): JSX.Element` — Toolbar（搜索框 + 折叠全部交给 Ledger 已有按钮 + 模式切换在 Timeline 内）+ Timeline + Ledger 的组合；搜索 3s 节流重建（`SEARCH_THROTTLE_MS = 3000`）；选中 timeline item → 对应行滚动定位（`scrollIntoView`）。
- Modify: `frontend/src/lib/stream.ts` 的 `AgentStream` 类型与 `useAgentStream` 返回值各加一行 `messages: stream.messages as Message[]`。

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/trajectory/search.test.ts
import { describe, expect, it } from "vitest";
import { TrajectorySearchIndex } from "./search";

describe("TrajectorySearchIndex", () => {
  it("returns null for an empty query (no filtering)", () => {
    const index = new TrajectorySearchIndex();
    index.update([{ key: "a", text: "hello world" }]);
    expect(index.search("")).toBeNull();
  });

  it("matches tokens case-insensitively across fields", () => {
    const index = new TrajectorySearchIndex();
    index.update([
      { key: "a", text: "PRD phase summary" },
      { key: "b", text: "tavily_search" },
    ]);
    expect(index.search("prd")).toEqual(new Set(["a"]));
    expect(index.search("SEARCH")).toEqual(new Set(["b"]));
  });

  it("reflects the latest update", () => {
    const index = new TrajectorySearchIndex();
    index.update([{ key: "a", text: "old" }]);
    index.update([{ key: "b", text: "new" }]);
    expect(index.search("old")).toEqual(new Set());
    expect(index.search("new")).toEqual(new Set(["b"]));
  });
});
```

```tsx
// frontend/src/trajectory/TrajectoryView.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deriveTrajectory, type Message } from "./layout";
import { TrajectoryView } from "./TrajectoryView";

const messages: Message[] = [
  { id: "h1", type: "human", content: "research query" },
  { id: "a1", type: "ai", content: "step one body" },
  { id: "a2", type: "ai", content: "final answer" },
];

describe("TrajectoryView", () => {
  it("composes timeline and ledger", () => {
    render(<TrajectoryView turns={deriveTrajectory(messages)} timestamps={new Map()} messages={messages} />);
    expect(screen.getByRole("toolbar", { name: "Timeline mode" })).toBeTruthy();
    expect(screen.getByText("step one body")).toBeTruthy();
  });

  it("filters ledger rows by search hits (data-match only on matches)", () => {
    vi.useFakeTimers();
    render(<TrajectoryView turns={deriveTrajectory(messages)} timestamps={new Map()} messages={messages} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "final" } });
    act(() => { vi.advanceTimersByTime(3_100); });
    const matched = document.querySelectorAll('[data-match="true"]');
    expect(matched.length).toBeGreaterThan(0);
    expect(document.querySelector('[data-match="true"]')!.textContent).toContain("final");
    vi.useRealTimers();
  });
});
```

（`act` 从 `@testing-library/react` 导入，测试文件顶部补 import。）

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/trajectory/search.test.ts src/trajectory/TrajectoryView.test.tsx`
Expected: FAIL — 模块不存在

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/trajectory/search.ts
// 客户端分词搜索索引（spec §5.4；参照 TrajectorySearchIndex 语义，3s 节流
// 在消费端 TrajectoryView 完成）。

export type SearchEntry = { key: string; text: string };

export class TrajectorySearchIndex {
  private tokens = new Map<string, Set<string>>();

  update(rows: SearchEntry[]): void {
    this.tokens.clear();
    for (const row of rows) {
      const normalized = row.text.toLowerCase();
      for (const token of normalized.split(/[^a-z0-9一-鿿]+/)) {
        if (token === "") continue;
        let bucket = this.tokens.get(token);
        if (bucket === undefined) {
          bucket = new Set();
          this.tokens.set(token, bucket);
        }
        bucket.add(row.key);
      }
    }
  }

  /** 空 query → null（不过滤）；否则返回命中行 key 集合。 */
  search(query: string): Set<string> | null {
    const normalized = query.trim().toLowerCase();
    if (normalized === "") return null;
    const hits = new Set<string>();
    for (const token of normalized.split(/\s+/)) {
      const bucket = this.tokens.get(token);
      if (bucket === undefined) continue;
      for (const key of bucket) hits.add(key);
    }
    return hits;
  }
}
```

```tsx
// frontend/src/trajectory/TrajectoryView.tsx
// Trajectory 组合视图：搜索框（3s 节流索引）+ Timeline + Ledger，
// 挂进右栏 trajectory 面板（spec §5.2-5.4）。

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Message } from "../lib/messages";
import { flattenTrajectoryRows } from "./rows";
import { TrajectorySearchIndex } from "./search";
import { Ledger } from "./Ledger";
import { Timeline, type TimelineMode } from "./timeline";
import type { TrajTurn } from "./layout";

const SEARCH_THROTTLE_MS = 3000;

export function TrajectoryView(props: {
  turns: TrajTurn[];
  timestamps: ReadonlyMap<string, number>;
  messages: Message[];
}): ReactNode {
  const { turns, timestamps, messages } = props;
  const [mode, setMode] = useState<TimelineMode>("sequence");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ReadonlySet<string> | null>(null);
  const indexRef = useRef(new TrajectorySearchIndex());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flatRows = useMemo(
    () => flattenTrajectoryRows(turns, new Set(), new Set()).map((row) => ({
      key: row.key,
      text: [row.text, row.block?.name ?? "", row.block?.result ?? ""].join(" "),
    })),
    [turns],
  );

  useEffect(() => {
    if (timerRef.current !== null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      indexRef.current.update(flatRows);
      setMatches(indexRef.current.search(query));
    }, SEARCH_THROTTLE_MS);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [flatRows, query]);

  return (
    <div className="trajectory-view">
      <input
        type="search"
        role="searchbox"
        className="trajectory-view__search"
        placeholder="Search trajectory"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <Timeline
        turns={turns}
        timestamps={timestamps}
        mode={mode}
        onModeChange={(next) => { setMode(next); setSelected(null); }}
        selected={selected}
        onSelect={(key) => {
          setSelected(key);
          document
            .querySelector(`[data-call], .ledger__row[data-match]`)
            ?.scrollIntoView({ block: "nearest" });
        }}
      />
      <Ledger turns={turns} searchMatches={matches} />
    </div>
  );
}
```

注意：timeline 选中滚动定位的精确锚点（按 `assistantKey` 给 Ledger 行补 `data-asst-key` 属性再 `querySelector([data-asst-key="…"])`）是更好的实现——实现者在 Ledger.tsx 的 assistant 行加 `data-asst-key={assistantKey(row.turn, row.step!)}` 并在 TrajectoryView 的 onSelect 里改为 `document.querySelector(`[data-asst-key="${key}"]`)?.scrollIntoView({ block: "nearest" })`。上面 querySelector 的占位写法必须替换为此实现（否则属占位符缺陷）。

`lib/stream.ts` 的 `AgentStream` 类型与返回值各加一行：

```ts
// frontend/src/lib/stream.ts — AgentStream 增加只读透传
export type AgentStream = {
  // ...现有字段不动...
  messages: Message[];
};
// useAgentStream 返回对象里加：
//   messages: stream.messages as Message[],
```

App.tsx 的 trajectory 面板替换：

```tsx
{
  id: "trajectory",
  title: "Trajectory",
  render: () => (
    <TrajectoryView
      turns={deriveTrajectory(stream.messages)}
      timestamps={msgTimestamps}
      messages={stream.messages}
    />
  ),
},
```

App.tsx 顶部相应增加：

```tsx
import { deriveTrajectory } from "./trajectory/layout";
import { TrajectoryView } from "./trajectory/TrajectoryView";
import { useMessageTimestamps } from "./lib/timestamps";
// AgentWorkspace 内：
const msgTimestamps = useMessageTimestamps(stream.messages);
```

- [ ] **Step 4: Run the whole frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS — 含全部既有测试与 Task 1-9 新增测试。

- [ ] **Step 5: Write docs/dev/trajectory-harness.md and commit**

```markdown
# 前端 harness 框架与 Trajectory（task08）

参照 `deepseek-harness` web 前端 1:1 复刻的布局与轨迹能力（自栈重写）。

## 三栏框架（src/layout/）

- 列常量与求解：`layout/columns.ts`（CENTER_MIN=400、SIDEBAR 264/280/420、
  AUTO_COLLAPSE=1024、RIGHTBAR 300/0.45/0.7）。语义：右栏先缩、再失轨，
  中央才让位；侧栏不让位。
- `layout/useFrameLayout.ts`：视口 ResizeObserver 测量 + localStorage 持久化
  （键 `harness.sidebar`/`harness.rightbar`，清除键 = 恢复默认）；窄视口
  (<1024) 自动收 56px 图标栏，可手动展开。
- `layout/AppFrame.tsx`：grid 三列 + DragHandle（pointer capture + rAF，
  拖拽基线 = 按下时刻渲染宽度，防 clamp 回跳）。

## 右栏面板域（src/panels/）

- `PanelHost`：tab 注册表（subagents / trajectory / workbench），激活态持久化
  （键 `harness.panel`）；再次点击当前 tab 收起右栏。
- 子 agent 面板：数据源 = 父图 state `async_tasks`（deepagents
  AsyncSubAgentMiddleware；task_id == thread_id）。任务转 running 时自动打开
  右栏并激活对应 tab（每任务一次）；tab 体 = `useSubagentStream`
  (`assistantId: "sdd-agent"`, 懒连接) 的只读消息流。
- workbench：ApprovalDock + TodoDock 迁入；审批契约（未决禁用 composer、
  决策复位）不变。

## Trajectory（src/trajectory/）

- 派生 `layout.ts`：messages → turn（human 开新 turn）→ step（AI 消息）→
  cell；task 工具结果包 `phase_report` 子块；usage 取 `usage_metadata`
  （input/output_tokens），模型取 `response_metadata.model_name`。
- Ledger `Ledger.tsx`：@tanstack/react-virtual 变高虚拟行；折叠（单 turn /
  全部 turn / 全部 assistant）；请求头（序号/模型/usage）；搜索命中
  `data-match`。容器高度 0（jsdom/SSR）时全量渲染兜底。
- Timeline `timeline.ts` + `lib/timestamps.ts`：序列/耗时/真实时间/关 四模式；
  时间戳 = 消息首见 `Date.now()`（仅实时流有），历史回放 → 时间类模式禁用。
- 搜索 `search.ts`：小写分词索引，视图层 3s 节流重建。

## 已知降级（spec §6）

| 情况 | 行为 |
|---|---|
| `async_tasks` 缺失/空 | 子 agent 面板显示 "No async sub-agent tasks yet" |
| usage_metadata 缺失 | 请求头不显示 usage 列 |
| 历史回放（无时间戳） | Timeline duration/actual 禁用 + title 提示 |
| 子线程流错误 | tab 内错误条 + Retry，不影响主对话 |

## 故障排查

- 右栏宽度怪异：清 localStorage `harness.rightbar`（无键 = 首开 0.45 比例）。
- 子 agent tab 不自动弹出：确认后端 async 启动成功（父图 state 有
  `async_tasks` 且 status=running）；面板懒连接，tab 未激活不建流。
```

```bash
git add frontend/src docs/dev/trajectory-harness.md
git commit -m "feat(frontend): trajectory toolbar search and panel integration; add dev guide"
```

---

## 自审记录（写计划后已核对）

1. **Spec 覆盖**：§4.1→Task 1/2；§4.2→Task 3/4/5；§5.1→Task 6；§5.2→Task 7；§5.3→Task 8；§5.4→Task 9；§6 降级→Task 4/8/9 实现与 docs 表；§8 测试→各任务测试步骤。无缺口。
2. **占位符扫描**：Task 8 Timeline 的刻度精确度已显式降级为序数均布并注明（非 TBD）；Task 9 的滚动定位占位写法已强制替换为 `data-asst-key` 实现；Task 4 的 useStream null 入参给出了二选一实证指令（实现者第一步查 d.ts）。
3. **类型一致性**：`LedgerRow.key` ↔ `searchMatches`/`data-match`；`assistantKey(turn, step)` 在 Task 7/8/9 用法一致；`AsyncTaskView` 字段在 Task 4/5 一致；`FrameActions` 在 Task 2/5 一致。
4. **Review Focus**：5 条各有 pin 测试（Task 1/2/4/6/5）。
