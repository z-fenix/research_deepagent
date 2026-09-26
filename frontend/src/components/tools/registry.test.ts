import { describe, expect, it } from "vitest";
import { toolMeta } from "./registry";

describe("toolMeta", () => {
  it("returns the registered sub-agent meta for task", () => {
    const meta = toolMeta("task");
    expect(meta.label("task")).toBe("Sub-agent: research-agent");
    expect(meta.className).toBe("tool-card--subagent");
  });

  it.each([
    ["start_async_task", "异步任务启动"],
    ["check_async_task", "异步任务查询"],
    ["update_async_task", "异步任务追加指令"],
    ["cancel_async_task", "异步任务取消"],
    ["list_async_tasks", "异步任务列表"],
  ])("returns the registered async meta for %s", (name, expectedLabel) => {
    const meta = toolMeta(name);
    expect(meta.label(name)).toBe(expectedLabel);
    expect(meta.className).toBe("tool-card--async");
  });

  it("falls back to the default label for unregistered tools", () => {
    const meta = toolMeta("web_search");
    expect(meta.label("web_search")).toBe("Tool: web_search");
    expect(meta.className).toBeUndefined();
  });
});
