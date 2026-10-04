// frontend/src/layout/useFrameLayout.test.tsx
// 任务 2 Step 1：先写失败测试（TDD）。
// 说明：jsdom 中 ref.current.clientWidth 恒为 0，useFrameLayout 会回退到
// window.innerWidth，因此这里用 window.innerWidth 模拟框架宽度（对应
// ResizeObserver 上报的语义）。

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RIGHTBAR_DEFAULT_RATIO,
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_COLLAPSED,
  useFrameLayout,
} from "./useFrameLayout";

function setup(initialViewport = 1600) {
  // 模拟 ResizeObserver 报告的框架宽度（jsdom 无真实布局，用 innerWidth 承载）
  Object.defineProperty(window, "innerWidth", { configurable: true, value: initialViewport });
  const ref = { current: document.createElement("div") };
  const hook = renderHook(() => useFrameLayout(ref), { initialProps: initialViewport });
  return { ref, ...hook };
}

// 本仓库未开启 vitest globals，RTL 的自动 cleanup 不会注册，需显式清理
afterEach(() => {
  cleanup();
});

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
