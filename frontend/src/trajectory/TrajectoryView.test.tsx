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
