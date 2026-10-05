import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveTrajectory, type Message } from "./layout";
import { TrajectoryView } from "./TrajectoryView";

const messages: Message[] = [
  { id: "h1", type: "human", content: "research query" },
  {
    id: "a1", type: "ai", content: "step one body",
    tool_calls: [{ id: "c1", name: "tavily_search", args: { q: 1 } }],
  },
  { id: "t1", type: "tool", tool_call_id: "c1", content: "res" },
  { id: "a2", type: "ai", content: "final answer" },
];

const renderView = (timestamps: ReadonlyMap<string, number> = new Map()) =>
  render(<TrajectoryView turns={deriveTrajectory(messages)} timestamps={timestamps} messages={messages} />);

describe("TrajectoryView", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the three filter checkboxes checked plus the search box", () => {
    renderView();
    for (const name of ["Duration", "Turns", "Calls"]) {
      expect(screen.getByRole("checkbox", { name })).toHaveProperty("checked", true);
    }
    expect(screen.getByRole("searchbox")).toBeTruthy();
    expect(screen.getByText("step one body")).toBeTruthy();
  });

  it("unchecking Turns hides turn header rows but keeps assistant rows", () => {
    renderView();
    expect(screen.getByText("Turn 0")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Turns" }));
    expect(screen.queryByText("Turn 0")).toBeNull();
    expect(screen.queryByText("research query")).toBeNull();
    expect(screen.getByText("step one body")).toBeTruthy();
  });

  it("unchecking Calls hides tool rows but keeps assistant rows", () => {
    renderView();
    expect(screen.getByText("tavily_search")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Calls" }));
    expect(screen.queryByText("tavily_search")).toBeNull();
    expect(screen.getByText("step one body")).toBeTruthy();
  });

  it("renders the duration bar when Duration is checked and hides it when unchecked", () => {
    renderView();
    const bar = document.querySelector(".duration-bar");
    expect(bar).toBeTruthy();
    expect(bar!.children.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("checkbox", { name: "Duration" }));
    expect(document.querySelector(".duration-bar")).toBeNull();
  });

  it("builds duration segments from message-id captures converted to step keys (C2 end-to-end)", () => {
    // 回归：App 传入的 useMessageTimestamps 以 message id 为键；视图层经
    // stepTimestampsFromMessages 转换后 duration 分段才应携带真实耗时。
    const threeSteps: Message[] = [
      { id: "h1", type: "human", content: "q" },
      { id: "a1", type: "ai", content: "one" },
      { id: "a2", type: "ai", content: "two" },
      { id: "a3", type: "ai", content: "three" },
    ];
    const msgTs = new Map([["a1", 1_000], ["a2", 2_000], ["a3", 4_000]]);
    render(
      <TrajectoryView turns={deriveTrajectory(threeSteps)} timestamps={msgTs} messages={threeSteps} />,
    );
    const segments = document.querySelectorAll(".duration-bar__seg");
    expect(segments.length).toBe(3);
    expect(segments[0]!.getAttribute("title")).toBe("T0S1 1.0s");
    // 有时间戳 → 按 durationMs 占比（1000ms vs 2000ms 前段更窄）
    const widthPct = (el: Element): number => {
      const m = (el.getAttribute("style") ?? "").match(/width:\s*([\d.]+)%/);
      return m === null ? NaN : Number.parseFloat(m[1]!);
    };
    expect(widthPct(segments[0]!)).toBeLessThan(widthPct(segments[1]!));
  });

  it("degrades to equal-width segments without timestamps (spec §6)", () => {
    renderView();
    const segments = Array.from(document.querySelectorAll(".duration-bar__seg"));
    expect(segments.length).toBe(2);
    const widths = segments.map((s) => s.getAttribute("style"));
    expect(widths[0]).toBe(widths[1]);
  });

  it("filters ledger rows by search hits (data-match only on matches)", () => {
    vi.useFakeTimers();
    renderView();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "final" } });
    act(() => {
      vi.advanceTimersByTime(3_100);
    });
    const matched = document.querySelectorAll('[data-match="true"]');
    expect(matched.length).toBeGreaterThan(0);
    expect(document.querySelector('[data-match="true"]')!.textContent).toContain("final");
  });
});
