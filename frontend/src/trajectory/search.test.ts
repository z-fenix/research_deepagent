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
