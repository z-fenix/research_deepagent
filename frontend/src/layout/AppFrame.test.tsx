// frontend/src/layout/AppFrame.test.tsx
// 任务 2 Step 1：先写失败测试（TDD）。

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { AppFrame, type FrameLayout } from "./AppFrame";
import { useFrameLayout } from "./useFrameLayout";

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

// 本仓库未开启 vitest globals，RTL 的自动 cleanup 不会注册，需显式清理（与 App.test.tsx 一致）
afterEach(() => {
  cleanup();
});

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

  it("keeps the rightbar occupant mounted with an edge affordance when the track is collapsed", () => {
    // C1：收起/未开轨不得卸载右栏占位物（fresh install 也要有可点入口）；
    // 右把手在占位物可见时始终渲染（含 affordance 态，拖拽即可重开）。
    render(
      <AppFrame
        layout={makeLayout({ rightbarTrack: false, cols: { sidebar: 280, center: 1320, rightbar: 0 } })}
        actions={{} as never}
        sidebar={<div>left</div>}
        center={<div>chat</div>}
        rightbar={<div>panel</div>}
      />,
    );
    expect(screen.getByText("panel")).toBeTruthy();
    expect(screen.getByTestId("drag-rightbar")).toBeTruthy();
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

  it("applies fallback-path deltas against the press-time width without compounding", () => {
    // Review Focus 1 回归：无 onSidebarDrag/onRightbarDrag 时走 setSidebar/setRightbar
    // 回退路径，基线必须冻结在按下时刻的渲染宽度。使用真实 useFrameLayout 状态
    // （setSidebar 会真正更新 cols.sidebar），并用假定时器逐帧推进 rAF：
    // 按下 280，+10 → 290；再累计 +30 → 310。若叠加当前渲染宽度则会得到 320。
    function LiveFrame() {
      const ref = useRef<HTMLDivElement | null>(null);
      const { layout, actions } = useFrameLayout(ref);
      return (
        <AppFrame
          layout={layout}
          actions={actions}
          frameRef={ref}
          sidebar={<div>left</div>}
          center={<div>chat</div>}
          rightbar={null}
        />
      );
    }
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      render(<LiveFrame />);
      const handle = screen.getByTestId("drag-sidebar");
      firePointer(handle, "pointerdown", 100); // 基线冻结为 280
      firePointer(handle, "pointermove", 110);
      act(() => {
        vi.advanceTimersByTime(16); // 第 1 帧：280 + 10
      });
      expect(screen.getByTestId("frame").style.gridTemplateColumns).toBe(
        "290px minmax(400px, 1fr) minmax(0px, 0px)",
      );
      firePointer(handle, "pointermove", 130); // 累计 dx = 30
      act(() => {
        vi.advanceTimersByTime(16); // 第 2 帧：基线 280 + 30 = 310（不叠加为 320）
      });
      expect(screen.getByTestId("frame").style.gridTemplateColumns).toBe(
        "310px minmax(400px, 1fr) minmax(0px, 0px)",
      );
      firePointer(handle, "pointerup", 130);
    } finally {
      vi.useRealTimers();
    }
  });
});
