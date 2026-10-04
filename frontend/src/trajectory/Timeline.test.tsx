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
});
