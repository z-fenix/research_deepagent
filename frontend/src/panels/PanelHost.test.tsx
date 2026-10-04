// frontend/src/panels/PanelHost.test.tsx
// 任务 3 Step 1：先写失败测试（TDD）。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelHost, type PanelDef } from "./PanelHost";

const panels: PanelDef[] = [
  { id: "subagents", title: "Sub-agents", render: () => <div>subagent body</div> },
  { id: "trajectory", title: "Trajectory", render: () => <div>trajectory body</div> },
  { id: "workbench", title: "Workbench", render: () => <div>workbench body</div> },
];

// 本仓库未开启 vitest globals，RTL 的自动 cleanup 不会注册，需显式清理（与 AppFrame.test.tsx 一致）
afterEach(() => {
  cleanup();
});

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
    cleanup(); // 仓库未开 vitest globals：同测试内二次挂载前需手动卸载，避免同名 tab 重复
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

  it("renders a vertical tab rail when collapsed; rail clicks always activate", () => {
    const onActivate = vi.fn();
    render(<PanelHost panels={panels} activeId="subagents" onActivate={onActivate} rail />);
    expect(document.querySelector(".panel-host--rail")).toBeTruthy();
    // rail 态不渲染面板体（0 宽轨道里只留可点 tab）
    expect(screen.queryByText("subagent body")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Workbench" }));
    expect(onActivate).toHaveBeenCalledWith("workbench");
    // 已激活 tab 在 rail 里点击也只激活（不存在"再点收起"——轨道本已收起）
    fireEvent.click(screen.getByRole("tab", { name: "Sub-agents" }));
    expect(onActivate).toHaveBeenLastCalledWith("subagents");
  });

  it("shows a per-panel fallback when the panel body throws, tabs stay alive, Retry remounts", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;
    const crashing: PanelDef[] = [
      { id: "trajectory", title: "Trajectory", render: () => { if (shouldThrow) throw new Error("boom"); return <div>trajectory body</div>; } },
    ];
    render(<PanelHost panels={crashing} activeId="trajectory" onActivate={vi.fn()} />);

    expect(screen.getByText("Panel crashed")).toBeTruthy();
    // 面板崩溃不影响 PanelHost 自身（tab 栏仍在）
    expect(screen.getByRole("tab", { name: "Trajectory" })).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(screen.getByText("trajectory body")).toBeTruthy();
    expect(screen.queryByText("Panel crashed")).toBeNull();
    consoleError.mockRestore();
  });
});
