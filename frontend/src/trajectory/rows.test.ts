import { describe, expect, it } from "vitest";
import { deriveTrajectory, type Message } from "./layout";
import { flattenTrajectoryRows } from "./rows";

const human = (content: string, id: string): Message => ({ id, type: "human", content });
const ai = (id: string, text: string, calls: Message["tool_calls"] = []): Message => ({
  id, type: "ai", content: text, ...(calls.length > 0 ? { tool_calls: calls } : {}),
});
const tool = (callId: string, content: string): Message => ({ id: `t-${callId}`, type: "tool", tool_call_id: callId, content });

const messages: Message[] = [
  human("q1", "h1"),
  ai("a1", "thinking", [{ id: "c1", name: "tavily_search", args: { q: 1 } }]),
  tool("c1", "res"),
  ai("a2", "answer"),
  human("q2", "h2"),
  ai("a3", "final"),
];

describe("flattenTrajectoryRows", () => {
  it("emits turn headers, request headers, assistant and tool rows in order", () => {
    const turns = deriveTrajectory(messages);
    const rows = flattenTrajectoryRows(turns, new Set(), new Set());
    expect(rows.map((r) => r.kind)).toEqual([
      "turn-header", "request-header", "assistant", "tool", "request-header", "assistant",
      "turn-header", "request-header", "assistant",
    ]);
    expect(rows[0]).toMatchObject({ kind: "turn-header", turn: 0, text: "q1" });
    expect(rows[2]).toMatchObject({ kind: "assistant", text: "thinking", model: null });
    expect(rows[3]).toMatchObject({ kind: "tool", block: { callId: "c1", status: "done" } });
  });

  it("collapses a turn into a single summary row", () => {
    const turns = deriveTrajectory(messages);
    const rows = flattenTrajectoryRows(turns, new Set([0]), new Set());
    expect(rows.filter((r) => r.turn === 0)).toHaveLength(1);
    expect(rows.find((r) => r.turn === 0)).toMatchObject({ kind: "turn-header", collapsedSummary: "turn" });
  });

  it("collapses an assistant plus its tool rows into one summary, later steps still render", () => {
    // 参照语义（§5.2）：折叠只隐藏该 assistant + 紧随的工具行，
    // 同 turn 内后续 step（请求头 + assistant + 工具）继续渲染。
    const turns = deriveTrajectory(messages);
    const rows = flattenTrajectoryRows(turns, new Set(), new Set(["0:1"]));
    const turn0 = rows.filter((r) => r.turn === 0);
    expect(turn0.map((r) => r.kind)).toEqual([
      "turn-header", "request-header", "assistant", "request-header", "assistant",
    ]);
    expect(turn0[2]!.collapsedSummary).toBe("assistant");
    expect(turn0[2]!.step).toBe(1);
    expect(turn0[4]).toMatchObject({ kind: "assistant", step: 2, collapsedSummary: null });
  });
});
