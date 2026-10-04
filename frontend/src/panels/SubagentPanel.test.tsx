// frontend/src/panels/SubagentPanel.test.tsx
// 任务 4 Step 1：先写失败测试（TDD）。

import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoOpenRunningTask, type AsyncTaskView } from "./subagent-tasks";
import { SubagentPanel } from "./SubagentPanel";

const running: AsyncTaskView = { taskId: "t-1", threadId: "t-1", status: "running", startedAt: null };
const done: AsyncTaskView = { taskId: "t-2", threadId: "t-2", status: "success", startedAt: null };

// 与 App.test.tsx 一致：mock @langchain/react，避免测试期真实联网拉取线程历史。
let capturedStreamOptions: Record<string, unknown> | null = null;

vi.mock("@langchain/react", () => ({
  useStream: (options: Record<string, unknown>) => {
    capturedStreamOptions = options;
    return { messages: [], values: {}, error: null };
  },
}));

// 本仓库未开启 vitest globals，RTL 的自动 cleanup 不会注册，需显式清理（与 PanelHost.test.tsx 一致）
afterEach(() => {
  cleanup();
  capturedStreamOptions = null;
});

beforeEach(() => localStorage.clear());

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
    // 懒连接：活动子线程的 threadId 被传给 useStream
    expect(capturedStreamOptions?.threadId).toBe("t-1");
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
