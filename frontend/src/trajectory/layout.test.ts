import { describe, expect, it } from "vitest";
import {
  collapsibleTurnIds,
  cumulativeUsage,
  deriveTrajectory,
  parseDelegationReport,
  type Message,
} from "./layout";

const human = (content: string, id: string): Message => ({ id, type: "human", content });
const ai = (id: string, text: string, calls: Message["tool_calls"] = [], usage?: unknown, model?: string): Message => ({
  id,
  type: "ai",
  content: text,
  ...(calls.length > 0 ? { tool_calls: calls } : {}),
  ...(usage !== undefined ? { usage_metadata: usage } : {}),
  ...(model !== undefined ? { response_metadata: { model_name: model } } : {}),
});
const tool = (callId: string, content: unknown): Message => ({
  id: `tool-${callId}`,
  type: "tool",
  tool_call_id: callId,
  content,
});

describe("deriveTrajectory", () => {
  it("opens a new turn per human message and one step per ai message", () => {
    const turns = deriveTrajectory([human("first", "h1"), ai("a1", "hi", [], undefined, "gpt-4.1-mini"), human("second", "h2"), ai("a2", "ok")]);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.prompt).toBe("first");
    expect(turns[0]!.steps).toHaveLength(1);
    expect(turns[0]!.steps[0]!.cell.model).toBe("gpt-4.1-mini");
    expect(turns[1]!.prompt).toBe("second");
  });

  it("pairs tool results into the step's tool blocks by call id", () => {
    const turns = deriveTrajectory([
      human("q", "h1"),
      ai("a1", "", [{ id: "c1", name: "tavily_search", args: { q: "x" } }]),
      tool("c1", "results"),
    ]);
    const block = turns[0]!.steps[0]!.cell.toolBlocks[0]!;
    expect(block.callId).toBe("c1");
    expect(block.name).toBe("tavily_search");
    expect(block.result).toBe("results");
    expect(block.status).toBe("done");
  });

  it("keeps a pending block when the result has not arrived", () => {
    const turns = deriveTrajectory([human("q", "h1"), ai("a1", "", [{ id: "c1", name: "task", args: {} }])]);
    expect(turns[0]!.steps[0]!.cell.toolBlocks[0]!.status).toBe("pending");
  });

  it("wraps task delegation results as nested sub-tool report blocks", () => {
    const report = JSON.stringify({ phase: "prd", summary: "PRD ok" });
    const turns = deriveTrajectory([
      human("q", "h1"),
      ai("a1", "", [{ id: "c1", name: "task", args: { subagent_type: "prd-agent" } }]),
      tool("c1", report),
    ]);
    const block = turns[0]!.steps[0]!.cell.toolBlocks[0]!;
    expect(block.isDelegation).toBe(true);
    expect(block.subTools).toHaveLength(1);
    expect(block.subTools[0]!.name).toBe("phase_report");
    expect(block.subTools[0]!.args).toEqual({ phase: "prd", summary: "PRD ok" });
  });

  it("extracts usage and model from metadata; null when absent", () => {
    const turns = deriveTrajectory([
      human("q", "h1"),
      ai("a1", "x", [], { input_tokens: 100, output_tokens: 20 }, "gpt-4.1-mini"),
      ai("a2", "y"),
    ]);
    const step1 = turns[0]!.steps[0]!;
    expect(step1.cell.usage).toEqual({ input: 100, output: 20 });
    expect(turns[0]!.steps[1]!.cell.usage).toBeNull();
  });

  it("keeps one cell per step regardless of streaming growth (Review Focus 4)", () => {
    const base = [human("q", "h1"), ai("a1", "partial")];
    const grown = [human("q", "h1"), ai("a1", "partial text grown longer")];
    expect(deriveTrajectory(base)[0]!.steps).toHaveLength(1);
    expect(deriveTrajectory(grown)[0]!.steps).toHaveLength(1);
    expect(deriveTrajectory(grown)[0]!.steps[0]!.cell.text).toContain("grown");
  });

  it("puts leading ai messages in turn 0 with an empty prompt", () => {
    const turns = deriveTrajectory([ai("a1", "boot")]);
    expect(turns[0]!.turn).toBe(0);
    expect(turns[0]!.prompt).toBe("");
  });
});

describe("cumulativeUsage", () => {
  it("accumulates usage across steps in order; null when none", () => {
    const turns = deriveTrajectory([
      human("q", "h1"),
      ai("a1", "x", [], { input_tokens: 100, output_tokens: 20 }),
      ai("a2", "y", [], { input_tokens: 50, output_tokens: 10 }),
    ]);
    expect(cumulativeUsage(turns)).toEqual({ input: 150, output: 30 });
    expect(cumulativeUsage(deriveTrajectory([human("q", "h1")]))).toBeNull();
  });
});

describe("collapsibleTurnIds", () => {
  it("includes only turns with more than one step", () => {
    const turns = deriveTrajectory([human("q1", "h1"), ai("a1", "x"), ai("a2", "y"), human("q2", "h2"), ai("a3", "z")]);
    expect(collapsibleTurnIds(turns)).toEqual([0]);
  });
});

describe("parseDelegationReport", () => {
  it("parses task JSON and returns null for non-delegation or malformed", () => {
    const turns = deriveTrajectory([
      human("q", "h1"),
      ai("a1", "", [
        { id: "c1", name: "task", args: {} },
        { id: "c2", name: "tavily_search", args: {} },
      ]),
      tool("c1", "{\"a\":1}"),
      tool("c2", "plain"),
    ]);
    const blocks = turns[0]!.steps[0]!.cell.toolBlocks;
    expect(parseDelegationReport(blocks[0]!)).toEqual({ a: 1 });
    expect(parseDelegationReport(blocks[1]!)).toBeNull();
  });
});
