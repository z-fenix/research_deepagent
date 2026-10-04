import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { deriveTrajectory, type Message } from "./layout";
import { Ledger } from "./Ledger";

const messages: Message[] = [
  { id: "h1", type: "human", content: "q1" },
  { id: "a1", type: "ai", content: "step one", tool_calls: [{ id: "c1", name: "task", args: { subagent_type: "prd-agent" } }] },
  { id: "t1", type: "tool", tool_call_id: "c1", content: JSON.stringify({ phase: "prd" }) },
  { id: "a2", type: "ai", content: "done" },
];

describe("Ledger", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders rows and the delegation report sub-block", () => {
    render(<Ledger turns={deriveTrajectory(messages)} />);
    expect(screen.getByText("q1")).toBeTruthy();
    expect(screen.getByText("step one")).toBeTruthy();
    expect(screen.getByText(/task/)).toBeTruthy();
    fireEvent.click(screen.getByText(/phase_report/)); // 展开子报告 JSON
    expect(screen.getByText(/"phase": "prd"/)).toBeTruthy();
  });

  it("shows (unparsable report) for malformed delegation JSON", () => {
    const malformed: Message[] = [
      ...messages.slice(0, 3),
      { id: "t2", type: "tool", tool_call_id: "c1", content: "{not json" },
      ...messages.slice(3),
    ];
    render(<Ledger turns={deriveTrajectory(malformed)} />);
    fireEvent.click(screen.getByText(/phase_report/));
    expect(screen.getByText("(unparsable report)")).toBeTruthy();
  });

  it("toggles all turns collapsed and back", () => {
    render(<Ledger turns={deriveTrajectory(messages)} />);
    const all = screen.getByTestId("collapse-all-turns");
    fireEvent.click(all);
    expect(screen.getAllByText(/Turn 0/).length).toBeGreaterThan(0);
    fireEvent.click(all);
    expect(screen.getByText("step one")).toBeTruthy();
  });

  it("marks search-matched rows with data-match", () => {
    render(<Ledger turns={deriveTrajectory(messages)} searchMatches={new Set(["0:1"])} />);
    expect(document.querySelector('[data-match="true"]')).toBeTruthy();
  });
});
