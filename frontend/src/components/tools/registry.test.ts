import { describe, expect, it } from "vitest";
import { toolMeta } from "./registry";

describe("toolMeta", () => {
  it("returns the registered sub-agent meta for task", () => {
    const meta = toolMeta("task");
    expect(meta.label("task")).toBe("Sub-agent: research-agent");
    expect(meta.className).toBe("tool-card--subagent");
  });

  it("falls back to the default label for unregistered tools", () => {
    const meta = toolMeta("web_search");
    expect(meta.label("web_search")).toBe("Tool: web_search");
    expect(meta.className).toBeUndefined();
  });
});
