// 纯投影：turns → Ledger 行序（参照 trajectory-virtual-rows 的"边界并入下一
// 内容行"由 flatten 一并处理：turn/request header 行总是与内容同帧出现）。

import type { TrajToolBlock, TrajTurn, TrajUsage } from "./layout";

export type LedgerRow = {
  key: string;
  kind: "turn-header" | "request-header" | "assistant" | "tool";
  turn: number;
  step: number | null;
  text: string;
  model: string | null;
  usage: TrajUsage | null;
  block: TrajToolBlock | null;
  collapsedSummary: "turn" | "assistant" | null;
};

export function assistantKey(turn: number, step: number): string {
  return `${turn}:${step}`;
}

export function flattenTrajectoryRows(
  turns: TrajTurn[],
  collapsedTurns: ReadonlySet<number>,
  collapsedAssistants: ReadonlySet<string>,
): LedgerRow[] {
  const rows: LedgerRow[] = [];
  for (const turn of turns) {
    const turnCollapsed = collapsedTurns.has(turn.turn);
    if (turnCollapsed) {
      rows.push({
        key: `turn-${turn.turn}-summary`, kind: "turn-header", turn: turn.turn, step: null,
        text: turn.prompt, model: null, usage: null, block: null, collapsedSummary: "turn",
      });
      continue;
    }
    rows.push({
      key: `turn-${turn.turn}`, kind: "turn-header", turn: turn.turn, step: null,
      text: turn.prompt, model: null, usage: null, block: null, collapsedSummary: null,
    });
    for (const step of turn.steps) {
      const key = assistantKey(turn.turn, step.step);
      const collapsible = step.cell.toolBlocks.length > 0;
      // 折叠 assistant（参照 §5.2 语义）：请求边界行保留（与其后内容同帧），
      // summary 行顶替该 assistant + 紧随其工具行；同 turn 后续 step 继续渲染。
      if (collapsible && collapsedAssistants.has(key)) {
        rows.push({
          key: `req-${key}`, kind: "request-header", turn: turn.turn, step: step.step,
          text: "", model: step.cell.model, usage: step.cell.usage, block: null, collapsedSummary: null,
        });
        rows.push({
          key: `asst-${key}-summary`, kind: "assistant", turn: turn.turn, step: step.step,
          text: step.cell.text, model: step.cell.model, usage: step.cell.usage, block: null,
          collapsedSummary: "assistant",
        });
        continue;
      }
      rows.push({
        key: `req-${key}`, kind: "request-header", turn: turn.turn, step: step.step,
        text: "", model: step.cell.model, usage: step.cell.usage, block: null, collapsedSummary: null,
      });
      rows.push({
        key: `asst-${key}`, kind: "assistant", turn: turn.turn, step: step.step,
        text: step.cell.text, model: step.cell.model, usage: step.cell.usage, block: null,
        collapsedSummary: null,
      });
      for (const block of step.cell.toolBlocks) {
        rows.push({
          key: `tool-${block.callId}`, kind: "tool", turn: turn.turn, step: step.step,
          text: "", model: null, usage: null, block, collapsedSummary: null,
        });
      }
    }
  }
  return rows;
}
