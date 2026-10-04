import { describe, expect, it } from "vitest";
import { deriveTrajectory, type Message } from "./layout";
import { assistantKey } from "./rows";
import { buildTimeline, timelineHasTimeData } from "./timeline";

const messages: Message[] = [
  { id: "h1", type: "human", content: "q" },
  { id: "a1", type: "ai", content: "one" },
  { id: "a2", type: "ai", content: "two" },
];
const turns = deriveTrajectory(messages);
const ts = new Map([[assistantKey(0, 1), 1000], [assistantKey(0, 2), 3000]]);

describe("buildTimeline", () => {
  it("uses ordinals in sequence mode", () => {
    const items = buildTimeline(turns, "sequence", new Map());
    expect(items.map((i) => i.start)).toEqual([0, 1]);
    expect(items.every((i) => i.durationMs === null)).toBe(true);
  });

  it("uses captured timestamps in duration mode", () => {
    const items = buildTimeline(turns, "duration", ts);
    expect(items[0]).toMatchObject({ start: 1000, end: 3000, durationMs: 2000 });
  });

  it("returns null starts when timestamps are missing", () => {
    const items = buildTimeline(turns, "duration", new Map());
    expect(items[0]!.start).toBeNull();
  });

  it("returns no items when mode is off", () => {
    expect(buildTimeline(turns, "off", ts)).toEqual([]);
  });
});

describe("timelineHasTimeData", () => {
  it("is true only when at least one step has a timestamp", () => {
    expect(timelineHasTimeData(turns, ts)).toBe(true);
    expect(timelineHasTimeData(turns, new Map())).toBe(false);
  });
});
