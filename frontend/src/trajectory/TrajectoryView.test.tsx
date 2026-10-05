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

const widthPct = (el: Element): number => {
  const m = (el.getAttribute("style") ?? "").match(/width:\s*([\d.]+)%/);
  return m === null ? NaN : Number.parseFloat(m[1]!);
};

describe("TrajectoryView", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the three reference toggle buttons with initial pressed state plus the search box", () => {
    renderView();
    expect(screen.getByRole("toolbar", { name: "Trajectory toolbar" })).toBeTruthy();
    // Duration 默认按下（按真实耗时定宽）；Turns/Calls 默认未按下（未折叠）
    expect(screen.getByRole("button", { name: /Duration/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Turns/ }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: /Calls/ }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("searchbox")).toBeTruthy();
  });

  it("keeps the duration bar always visible; Duration press toggles duration weighting (C2 end-to-end)", () => {
    // 回归：App 传入的 useMessageTimestamps 以 message id 为键；视图层经
    // stepTimestampsFromMessages 转换后 Duration 按下才应按真实耗时定宽。
    const threeSteps: Message[] = [
      { id: "h1", type: "human", content: "q" },
      { id: "a1", type: "ai", content: "one" },
      { id: "a2", type: "ai", content: "two" },
      { id: "a3", type: "ai", content: "three" },
    ];
    const msgTs = new Map([["a1", 1_000], ["a2", 2_000], ["a3", 4_000]]);
    render(<TrajectoryView turns={deriveTrajectory(threeSteps)} timestamps={msgTs} messages={threeSteps} />);
    const segments = document.querySelectorAll(".duration-bar__seg");
    expect(segments.length).toBe(3);
    expect(segments[0]!.getAttribute("title")).toBe("T0S1 1.0s");
    // 按下：按 durationMs 占比（1000ms vs 2000ms 前段更窄）
    expect(widthPct(segments[0]!)).toBeLessThan(widthPct(segments[1]!));
    // 取消按下：全部等宽（分段条仍可见）
    fireEvent.click(screen.getByRole("button", { name: /Duration/ }));
    expect(screen.getByRole("button", { name: /Duration/ }).getAttribute("aria-pressed")).toBe("false");
    const after = document.querySelectorAll(".duration-bar__seg");
    expect(after.length).toBe(3);
    expect(widthPct(after[0]!)).toBe(widthPct(after[1]!));
  });

  it("degrades to equal widths without timestamps even when Duration is pressed (spec §6)", () => {
    renderView();
    const segments = Array.from(document.querySelectorAll(".duration-bar__seg"));
    expect(segments.length).toBe(2);
    expect(widthPct(segments[0]!)).toBe(widthPct(segments[1]!));
  });

  it("Turns button folds all turn groups and expands back", () => {
    renderView();
    const turnsButton = screen.getByRole("button", { name: /Turns/ });
    expect(turnsButton.getAttribute("title")).toBe("Collapse turns");
    expect(screen.getByText("step one body")).toBeTruthy();
    fireEvent.click(turnsButton);
    expect(turnsButton.getAttribute("aria-pressed")).toBe("true");
    expect(turnsButton.getAttribute("title")).toBe("Expand turns");
    // 折叠后仅剩 turn 头行（含 human prompt），assistant/tool 行隐藏
    expect(screen.queryByText("step one body")).toBeNull();
    expect(screen.queryByText("tavily_search")).toBeNull();
    expect(screen.getByText(/Turn 0/)).toBeTruthy();
    fireEvent.click(turnsButton);
    expect(turnsButton.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("step one body")).toBeTruthy();
  });

  it("Calls button folds tool call rows under assistants and expands back", () => {
    renderView();
    const callsButton = screen.getByRole("button", { name: /Calls/ });
    expect(callsButton.getAttribute("title")).toBe("Collapse calls");
    expect(screen.getByText("tavily_search")).toBeTruthy();
    fireEvent.click(callsButton);
    expect(callsButton.getAttribute("aria-pressed")).toBe("true");
    expect(callsButton.getAttribute("title")).toBe("Expand calls");
    expect(screen.queryByText("tavily_search")).toBeNull();
    // assistant 行保留（折叠为 summary）
    expect(screen.getByText("step one body")).toBeTruthy();
    fireEvent.click(callsButton);
    expect(screen.getByText("tavily_search")).toBeTruthy();
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
