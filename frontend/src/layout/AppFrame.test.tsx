// frontend/src/layout/AppFrame.test.tsx
// 任务 2 Step 1：先写失败测试（TDD）。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
