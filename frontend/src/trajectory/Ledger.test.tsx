import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveTrajectory, type Message } from "./layout";
import { Ledger } from "./Ledger";

const messages: Message[] = [
  { id: "h1", type: "human", content: "q1" },
  { id: "a1", type: "ai", content: "step one", tool_calls: [{ id: "c1", name: "task", args: { subagent_type: "prd-agent" } }] },
  { id: "t1", type: "tool", tool_call_id: "c1", content: JSON.stringify({ phase: "prd" }) },
  { id: "a2", type: "ai", content: "done" },
];

type LedgerProps = Parameters<typeof Ledger>[0];

const renderLedger = (overrides: Partial<LedgerProps> = {}) =>
  render(
    <Ledger
      turns={deriveTrajectory(messages)}
      collapsedTurns={new Set()}
      collapsedAssistants={new Set()}
      onToggleTurn={() => {}}
      {...overrides}
    />,
  );

describe("Ledger", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders rows and the delegation report sub-block", () => {
    renderLedger();
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
    render(
      <Ledger
        turns={deriveTrajectory(malformed)}
        collapsedTurns={new Set()}
        collapsedAssistants={new Set()}
        onToggleTurn={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(/phase_report/));
    expect(screen.getByText("(unparsable report)")).toBeTruthy();
  });

  it("renders from controlled collapse state (folded turn hides its rows)", () => {
    // 折叠状态已上提到 TrajectoryView（工具栏 Turns/Calls 拥有全部开合），
    // Ledger 变为受控渲染；单 turn 开合经 onToggleTurn 回调。
    renderLedger({ collapsedTurns: new Set([0]) });
    expect(screen.getByText(/Turn 0/)).toBeTruthy();
    expect(screen.queryByText("step one")).toBeNull();
  });

  it("invokes onToggleTurn when a turn header is clicked", () => {
    const onToggleTurn = vi.fn();
    renderLedger({ onToggleTurn });
    fireEvent.click(screen.getByText(/Turn 0/));
    expect(onToggleTurn).toHaveBeenCalledWith(0);
  });

  it("marks search-matched rows with data-match", () => {
    renderLedger({ searchMatches: new Set(["0:1"]) });
    expect(document.querySelector('[data-match="true"]')).toBeTruthy();
  });

  it("renders visual role badges without changing keys or matching", () => {
    renderLedger();
    expect(document.querySelector(".badge--turn")!.textContent).toBe("T0");
    expect(document.querySelector(".badge--user")!.textContent).toBe("USER");
    expect(document.querySelector(".badge--assistant")!.textContent).toBe("AI");
    expect(document.querySelector(".badge--tool")!.textContent).toBe("TOOL");
    // badge 仅视觉：assistant 行仍带 data-asst-key（滚动锚定不受影响）
    expect(document.querySelector('[data-asst-key="0:1"]')).toBeTruthy();
  });
});
