import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveTrajectory, type Message } from "./layout";
import { Timeline } from "./Timeline";

const messages: Message[] = [
  { id: "h1", type: "human", content: "q" },
  { id: "a1", type: "ai", content: "one" },
  { id: "a2", type: "ai", content: "two" },
];
const turns = deriveTrajectory(messages);

describe("Timeline", () => {
  afterEach(() => {
    cleanup();
  });

  it("disables time modes when there is no timestamp data", () => {
    render(<Timeline turns={turns} timestamps={new Map()} mode="sequence" onModeChange={vi.fn()} selected={null} onSelect={vi.fn()} />);
    const durationBtn = screen.getByRole("button", { name: /duration/i });
    expect(durationBtn).toHaveProperty("disabled", true);
  });

  it("selects a step and reports its key", () => {
    const onSelect = vi.fn();
    render(<Timeline turns={turns} timestamps={new Map()} mode="sequence" onModeChange={vi.fn()} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("timeline-item-0:1"));
    expect(onSelect).toHaveBeenCalledWith("0:1");
  });

  it("switches modes via the toolbar buttons", () => {
    const onModeChange = vi.fn();
    const ts = new Map([["0:1", 1], ["0:2", 2]]);
    render(<Timeline turns={turns} timestamps={ts} mode="sequence" onModeChange={onModeChange} selected={null} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /actual/i }));
    expect(onModeChange).toHaveBeenCalledWith("actual");
  });

  it("renders ordinal labels in sequence mode (I1: sequence unchanged)", () => {
    render(<Timeline turns={turns} timestamps={new Map()} mode="sequence" onModeChange={vi.fn()} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByTestId("timeline-item-0:1").textContent).toBe("T0S1");
  });

  it("renders duration labels in duration mode (I1: buildTimeline consumed)", () => {
    const ts = new Map([["0:1", 1_000], ["0:2", 3_000]]);
    render(<Timeline turns={turns} timestamps={ts} mode="duration" onModeChange={vi.fn()} selected={null} onSelect={vi.fn()} />);
    // 首条覆盖到下一 step 到达（2000ms）；末 step 无 end → 回退序号标签
    expect(screen.getByTestId("timeline-item-0:1").textContent).toContain("2.0s");
    expect(screen.getByTestId("timeline-item-0:2").textContent).toContain("T0S2");
  });

  it("positions time-mode items by their timestamps (linear scale)", () => {
    const ts = new Map([["0:1", 1_000], ["0:2", 3_000]]);
    render(<Timeline turns={turns} timestamps={ts} mode="actual" onModeChange={vi.fn()} selected={null} onSelect={vi.fn()} />);
    const first = screen.getByTestId("timeline-item-0:1") as HTMLElement;
    const second = screen.getByTestId("timeline-item-0:2") as HTMLElement;
    expect(first.style.left).toBe("0%");
    expect(second.style.left).toBe("100%");
  });

  it("falls back to ordinal slots for steps without timestamps in time modes", () => {
    const ts = new Map([["0:1", 1_000]]);
    render(<Timeline turns={turns} timestamps={ts} mode="duration" onModeChange={vi.fn()} selected={null} onSelect={vi.fn()} />);
    const second = screen.getByTestId("timeline-item-0:2") as HTMLElement;
    // 第 2 步无时间戳 → 序数槽位（1/2 * 100）
    expect(second.style.left).toBe("50%");
  });

  it("renders clock times in actual mode", () => {
    const base = new Date(2026, 0, 1, 10, 30, 5).getTime();
    const ts = new Map([["0:1", base], ["0:2", base + 60_000]]);
    render(<Timeline turns={turns} timestamps={ts} mode="actual" onModeChange={vi.fn()} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByTestId("timeline-item-0:1").textContent).toContain("10:30:05");
  });
});
