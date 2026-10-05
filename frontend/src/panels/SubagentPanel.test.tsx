// frontend/src/panels/SubagentPanel.test.tsx
// task12：列表布局（参照 deepseek-harness 子智能体列表）——先写失败测试（TDD）。

import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  durationLabel,
  extractLaunchInfo,
  useAutoOpenRunningTask,
  type AsyncTaskView,
} from "./subagent-tasks";
import { SubagentPanel } from "./SubagentPanel";

const running: AsyncTaskView = {
  taskId: "t-1", threadId: "t-1", status: "running", startedAt: null, lastUpdatedAt: null,
};
const done: AsyncTaskView = {
  taskId: "t-2", threadId: "t-2", status: "success", startedAt: null, lastUpdatedAt: null,
};

const launchInfo = {
  "t-1": { title: "分析工具体系与扩展架构", excerpt: "你是架构子智能体，只读分析工具分层" },
  "t-2": { title: "分析控制流与会话核心架构", excerpt: "你是架构子智能体，只读分析会话核心" },
};

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

function renderPanel(tasks: AsyncTaskView[], activeTaskId: string | null = null) {
  return render(
    <SubagentPanel
      tasks={tasks}
      launchInfo={launchInfo}
      activeTaskId={activeTaskId}
      onActivate={vi.fn()}
    />,
  );
}

describe("SubagentPanel (list layout)", () => {
  it("shows the empty state when there are no tasks", () => {
    renderPanel([]);
    expect(screen.getByText("No async sub-agent tasks yet")).toBeTruthy();
  });

  it("renders a count header and one row per task with status dot, title, badge, chevron", () => {
    renderPanel([running, done]);
    expect(screen.getByText("2 sub-agents")).toBeTruthy();
    expect(screen.getByText("分析工具体系与扩展架构")).toBeTruthy();
    expect(screen.getByText("分析控制流与会话核心架构")).toBeTruthy();
    // 状态点 + 徽标（read-only · status）
    expect(document.querySelector('[data-status="running"]')).toBeTruthy();
    expect(document.querySelector('[data-status="success"]')).toBeTruthy();
    expect(screen.getAllByText(/read-only · running/)).toHaveLength(1);
    expect(screen.getAllByText(/read-only · completed/)).toHaveLength(1);
    expect(screen.getByRole("button", { name: /open sub-agent t-1/i })).toBeTruthy();
  });

  it("falls back to the task-id prefix title when launch info is missing", () => {
    render(
      <SubagentPanel tasks={[running]} launchInfo={{}} activeTaskId={null} onActivate={vi.fn()} />,
    );
    expect(screen.getByText(/sdd-agent t-1/)).toBeTruthy();
  });

  it("shows the read-only thread body only after opening a row, with a back button", async () => {
    const onActivate = vi.fn();
    const { rerender } = render(
      <SubagentPanel
        tasks={[running, done]}
        launchInfo={launchInfo}
        activeTaskId={null}
        onActivate={onActivate}
      />,
    );
    // 列表态：无子线程连接
    expect(screen.queryByTestId("subagent-body-t-1")).toBeNull();
    expect(capturedStreamOptions?.threadId).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: /open sub-agent t-1/i }));
    expect(onActivate).toHaveBeenCalledWith("t-1");

    rerender(
      <SubagentPanel
        tasks={[running, done]}
        launchInfo={launchInfo}
        activeTaskId="t-1"
        onActivate={onActivate}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("subagent-body-t-1")).toBeTruthy());
    expect(capturedStreamOptions?.threadId).toBe("t-1");
    expect(screen.queryByRole("textbox")).toBeNull(); // 只读
    fireEvent.click(screen.getByRole("button", { name: /back to list/i }));
    expect(onActivate).toHaveBeenLastCalledWith(null);
  });
});

describe("extractLaunchInfo", () => {
  it("pairs start_async_task calls with their result task ids", () => {
    const messages = [
      { id: "a1", type: "ai", content: "", tool_calls: [{ id: "c1", name: "start_async_task", args: { description: "分析工具体系", subagent_type: "sdd-agent" } }] },
      { id: "t1", type: "tool", tool_call_id: "c1", content: "Launched async subagent. task_id: t-1" },
      { id: "a2", type: "ai", content: "", tool_calls: [{ id: "c2", name: "check_async_task", args: { task_id: "t-1" } }] },
      { id: "t2", type: "tool", tool_call_id: "c2", content: "status: running" },
    ];
    expect(extractLaunchInfo(messages)).toEqual({
      "t-1": { title: "分析工具体系", excerpt: "分析工具体系" },
    });
  });

  it("skips results without a parseable task id", () => {
    const messages = [
      { id: "a1", type: "ai", content: "", tool_calls: [{ id: "c1", name: "start_async_task", args: { description: "x", subagent_type: "sdd-agent" } }] },
      { id: "t1", type: "tool", tool_call_id: "c1", content: "failed to launch" },
    ];
    expect(extractLaunchInfo(messages)).toEqual({});
  });
});

describe("durationLabel", () => {
  it("formats sub-minute and minute ranges", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(durationLabel("2026-10-05T11:59:40Z", "2026-10-05T12:00:00Z", now)).toBe("20s");
    expect(durationLabel("2026-10-05T11:56:52Z", "2026-10-05T12:00:00Z", now)).toBe("3m 08s");
  });

  it("uses now for running tasks and null for malformed input", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(durationLabel("2026-10-05T11:59:40Z", null, now)).toBe("20s");
    expect(durationLabel(null, null, now)).toBeNull();
    expect(durationLabel("nope", null, now)).toBeNull();
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
