import { describe, expect, it } from "vitest";
import { deriveTrajectory, type Message } from "./layout";
import { assistantKey } from "./rows";
import { buildTimeline, stepTimestampsFromMessages, timelineHasTimeData } from "./timeline";

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

describe("stepTimestampsFromMessages (C2: message-id captures → step keys)", () => {
  it("yields hasTimeData true and non-null starts via the converter", () => {
    // 集成路径：useMessageTimestamps 按 message id 记录，转换器配对为 assistantKey
    const msgTs = new Map([["a1", 1000], ["a2", 3000]]);
    const stepTs = stepTimestampsFromMessages(messages, turns, msgTs);
    expect(timelineHasTimeData(turns, stepTs)).toBe(true);
    const items = buildTimeline(turns, "duration", stepTs);
    expect(items[0]!.start).toBe(1000);
    expect(items[1]!.start).toBe(3000);
    expect(items[0]!.durationMs).toBe(2000);
  });

  it("pairs AI messages to steps positionally and keeps first capture per step", () => {
    const msgTs = new Map([["a1", 1000], ["a2", 3000]]);
    const stepTs = stepTimestampsFromMessages(messages, turns, msgTs);
    expect(stepTs.get(assistantKey(0, 1))).toBe(1000);
    expect(stepTs.get(assistantKey(0, 2))).toBe(3000);
    expect(stepTs.size).toBe(2);
  });

  it("returns an empty map when nothing was captured", () => {
    const stepTs = stepTimestampsFromMessages(messages, turns, new Map());
    expect(stepTs.size).toBe(0);
    expect(timelineHasTimeData(turns, stepTs)).toBe(false);
  });

  it("ignores captured ids that do not correspond to any step", () => {
    const msgTs = new Map([["a1", 1000], ["ghost", 999]]);
    const stepTs = stepTimestampsFromMessages(messages, turns, msgTs);
    expect(stepTs.size).toBe(1);
    expect(stepTs.get(assistantKey(0, 1))).toBe(1000);
  });
});
