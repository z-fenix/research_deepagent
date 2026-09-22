import { describe, expect, it } from "vitest";
import { buildRows, isPlanLikeBody, messageText } from "./messages";

const PLAN_BODY =
  "## SESSION INTENT\nCompare LangGraph 1.0 and 0.x.\n\n## SUMMARY\nThe user requested a specific multi-step workflow.";

describe("messageText", () => {
  it("joins string and text parts", () => {
    expect(messageText(["a", { text: "b" }, "c"])).toBe("abc");
  });
  it("returns non-string content as empty string", () => {
    expect(messageText(42)).toBe("");
  });
});

describe("isPlanLikeBody", () => {
  it("flags bodies with two or more plan markers", () => {
    expect(isPlanLikeBody(PLAN_BODY)).toBe(true);
  });
  it("does not flag ordinary answers", () => {
    expect(isPlanLikeBody("LangGraph 1.0 adds a functional API.")).toBe(false);
  });
});

describe("buildRows", () => {
  it("folds tool results into their pending cards", () => {
    const rows = buildRows([
      { id: "h1", type: "human", content: "Research IBM" },
      {
        id: "a1",
        type: "ai",
        content: "",
        tool_calls: [{ id: "c1", name: "task", args: { description: "Research IBM" } }],
      },
      { id: "t1", type: "tool", tool_call_id: "c1", content: "IBM summary" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "prose", type: "human", body: "Research IBM" });
    expect(rows[1]).toMatchObject({
      kind: "card",
      card: { callId: "c1", name: "task", status: "done", result: "IBM summary" },
    });
  });

  it("renders empty-body ai tool calls as pending cards", () => {
    const rows = buildRows([
      {
        id: "a1",
        type: "ai",
        content: "",
        tool_calls: [{ id: "c1", name: "web_search", args: {} }],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "card", card: { status: "pending" } });
  });

  it("classifies plan-like ai bodies as plan rows", () => {
    const rows = buildRows([
      { id: "a1", type: "ai", content: PLAN_BODY },
      { id: "a2", type: "ai", content: "Final answer." },
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ kind: "plan", body: PLAN_BODY }),
      expect.objectContaining({ kind: "prose", type: "ai", body: "Final answer." }),
    ]);
  });

  it("drops orphan tool messages silently", () => {
    const rows = buildRows([
      { id: "t1", type: "tool", tool_call_id: "missing", content: "orphan" },
    ]);
    expect(rows).toHaveLength(0);
  });

  it("keeps substantive mixed ai content as prose plus cards", () => {
    const rows = buildRows([
      {
        id: "a1",
        type: "ai",
        content: "- **Answer point one:** ok",
        tool_calls: [{ id: "c1", name: "write_todos", args: {} }],
      },
      { id: "t1", type: "tool", tool_call_id: "c1", content: "Updated todo list" },
    ]);
    expect(rows[0]).toMatchObject({ kind: "prose", type: "ai" });
    expect(rows[1]).toMatchObject({ kind: "card", card: { name: "write_todos" } });
  });
});
