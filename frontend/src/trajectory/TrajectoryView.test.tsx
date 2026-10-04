import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveTrajectory, type Message } from "./layout";
import { TrajectoryView } from "./TrajectoryView";

const messages: Message[] = [
  { id: "h1", type: "human", content: "research query" },
  { id: "a1", type: "ai", content: "step one body" },
  { id: "a2", type: "ai", content: "final answer" },
];

describe("TrajectoryView", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("composes timeline and ledger", () => {
    render(
      <TrajectoryView turns={deriveTrajectory(messages)} timestamps={new Map()} messages={messages} />,
    );
    expect(screen.getByRole("toolbar", { name: "Timeline mode" })).toBeTruthy();
    expect(screen.getByText("step one body")).toBeTruthy();
  });

  it("enables time modes when message-id captures convert into step keys (C2 end-to-end)", () => {
    // 回归：App 传入的 useMessageTimestamps 以 message id 为键；视图层经
    // stepTimestampsFromMessages 转换后 Timeline 的时间类模式才应可用。
    const msgTs = new Map([["a1", 1_000], ["a2", 3_000]]);
    render(
      <TrajectoryView turns={deriveTrajectory(messages)} timestamps={msgTs} messages={messages} />,
    );
    expect(screen.getByRole("button", { name: /duration/i })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: /actual/i })).toHaveProperty("disabled", false);
  });

  it("filters ledger rows by search hits (data-match only on matches)", () => {
    vi.useFakeTimers();
    render(
      <TrajectoryView turns={deriveTrajectory(messages)} timestamps={new Map()} messages={messages} />,
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "final" } });
    act(() => {
      vi.advanceTimersByTime(3_100);
    });
    const matched = document.querySelectorAll('[data-match="true"]');
    expect(matched.length).toBeGreaterThan(0);
    expect(document.querySelector('[data-match="true"]')!.textContent).toContain("final");
  });
});
