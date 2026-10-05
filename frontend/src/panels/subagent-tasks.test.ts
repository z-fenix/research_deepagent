// frontend/src/panels/subagent-tasks.test.ts
// 任务 4 Step 1：先写失败测试（TDD）。

import { describe, expect, it } from "vitest";
import { deriveSubagentTabs, readAsyncTasks } from "./subagent-tasks";

describe("readAsyncTasks", () => {
  it("reads well-formed async_tasks", () => {
    const values = {
      async_tasks: {
        "t-1": { task_id: "t-1", thread_id: "t-1", status: "running", created_at: "2026-10-04T00:00:00Z", last_updated_at: "2026-10-04T00:05:00Z" },
        "t-2": { task_id: "t-2", thread_id: "t-2", status: "success" },
      },
    };
    expect(readAsyncTasks(values)).toEqual([
      { taskId: "t-1", threadId: "t-1", status: "running", startedAt: "2026-10-04T00:00:00Z", lastUpdatedAt: "2026-10-04T00:05:00Z" },
      { taskId: "t-2", threadId: "t-2", status: "success", startedAt: null, lastUpdatedAt: null },
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
    const a = { taskId: "t-1", threadId: "t-1", status: "running", startedAt: null, lastUpdatedAt: null };
    const b = { taskId: "t-2", threadId: "t-2", status: "success", startedAt: null, lastUpdatedAt: null };
    expect(deriveSubagentTabs([a, b, { ...a, status: "success" }])).toEqual([a, b]);
  });
});
