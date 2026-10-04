// 虚拟化 Ledger：@tanstack/react-virtual 变高行；容器高度 0（jsdom/SSR）
// 时全量渲染兜底。折叠状态机与参照 TrajectoryView 一致（collapsedTurns/
// collapsedAssistants 集合 + 全部开关，TrajectoryView.tsx:462-502）。

import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  collapsibleTurnIds,
  cumulativeUsage,
  parseDelegationReport,
  type TrajToolBlock,
  type TrajTurn,
} from "./layout";
import { assistantKey, flattenTrajectoryRows } from "./rows";

function usageText(usage: { input?: number; output?: number } | null): string {
  if (usage === null) return "";
  const parts: string[] = [];
  if (usage.input !== undefined) parts.push(`in ${usage.input}`);
  if (usage.output !== undefined) parts.push(`out ${usage.output}`);
  return parts.join(" · ");
}

function ToolRow({ block }: { block: TrajToolBlock }): ReactNode {
  const [open, setOpen] = useState(false);
  const report = block.isDelegation ? parseDelegationReport(block) : null;
  return (
    <div className="ledger__tool" data-call={block.callId}>
      <button type="button" className="ledger__tool-head" onClick={() => setOpen((v) => !v)}>
        <span className="ledger__tool-name">{block.name}</span>
        <span className={`ledger__tool-status ledger__tool-status--${block.status}`}>{block.status}</span>
      </button>
      {open && (
        <div className="ledger__json">
          <pre>{JSON.stringify(block.args, null, 2)}</pre>
          {block.result !== null && <pre>{block.result}</pre>}
        </div>
      )}
      {block.isDelegation && (
        <div className="ledger__subtool">
          <button
            type="button"
            className="ledger__tool-head"
            onClick={(e) => {
              const parent = e.currentTarget.nextElementSibling;
              if (parent !== null) parent.classList.toggle("ledger__json--hidden");
            }}
          >
            phase_report
          </button>
          {/* 上游 caveat：subTools[].args/报告 JSON 可能解析失败（null），
              此时显示占位文本而不是把 null stringify 出来 */}
          <div className="ledger__json">
            {report !== null ? <pre>{JSON.stringify(report, null, 2)}</pre> : <pre>(unparsable report)</pre>}
          </div>
        </div>
      )}
    </div>
  );
}

export function Ledger(props: { turns: TrajTurn[]; searchMatches?: ReadonlySet<string> | null }): ReactNode {
  const { turns, searchMatches } = props;
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(new Set());
  const [collapsedAssistants, setCollapsedAssistants] = useState<ReadonlySet<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(
    () => flattenTrajectoryRows(turns, collapsedTurns, collapsedAssistants),
    [turns, collapsedTurns, collapsedAssistants],
  );
  const collapsibleTurns = useMemo(() => collapsibleTurnIds(turns), [turns]);
  const totalUsage = useMemo(() => cumulativeUsage(turns), [turns]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rows[index]!;
      return row.kind === "turn-header" ? 34 : row.kind === "request-header" ? 26 : 28;
    },
    overscan: 12,
  });
  // jsdom/SSR 兜底：容器无高度时虚拟窗口为空，直接全量渲染保证可测可用
  const useWindow = scrollRef.current !== null && scrollRef.current.clientHeight > 0;
  const windowRows = useWindow ? virtualizer.getVirtualItems() : rows.map((_, i) => ({ index: i, key: rows[i]!.key, start: 0, size: 0 }));

  const allTurnsCollapsed = collapsibleTurns.length > 0 && collapsibleTurns.every((t) => collapsedTurns.has(t));
  const collapsibleAssistantKeys: string[] = [];
  for (const turn of turns) {
    for (const step of turn.steps) {
      if (step.cell.toolBlocks.length > 0) collapsibleAssistantKeys.push(assistantKey(turn.turn, step.step));
    }
  }
  const allAssistantsCollapsed = collapsibleAssistantKeys.length > 0 && collapsibleAssistantKeys.every((k) => collapsedAssistants.has(k));

  const toggleAllTurns = () => {
    setCollapsedTurns(allTurnsCollapsed ? new Set() : new Set(collapsibleTurns));
  };
  const toggleAllAssistants = () => {
    setCollapsedAssistants(allAssistantsCollapsed ? new Set() : new Set(collapsibleAssistantKeys));
  };
  const toggleTurn = (turn: number) => {
    setCollapsedTurns((current) => {
      const next = new Set(current);
      if (next.has(turn)) next.delete(turn);
      else next.add(turn);
      return next;
    });
  };

  return (
    <div className="ledger">
      <div className="ledger__controls">
        <button type="button" data-testid="collapse-all-turns" onClick={toggleAllTurns}>
          {allTurnsCollapsed ? "Expand all turns" : "Collapse all turns"}
        </button>
        <button type="button" data-testid="collapse-all-assistants" onClick={toggleAllAssistants}>
          {allAssistantsCollapsed ? "Expand all steps" : "Collapse all steps"}
        </button>
        {totalUsage !== null && <span className="ledger__total-usage">tokens {usageText(totalUsage)}</span>}
      </div>
      <div className="ledger__scroll" ref={scrollRef} style={{ height: "100%", overflowY: "auto" }}>
        <div style={{ height: useWindow ? virtualizer.getTotalSize() : undefined, position: "relative" }}>
          {windowRows.map((item) => {
            const row = rows[item.index]!;
            // searchMatches 以 assistantKey（"turn:step"）或行 key 命中
            const matched =
              (searchMatches?.has(row.key) ?? false) ||
              (row.step !== null && (searchMatches?.has(assistantKey(row.turn, row.step)) ?? false));
            const style = useWindow
              ? { position: "absolute" as const, top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }
              : undefined;
            return (
              <div
                key={row.key}
                data-virtual-index={item.index}
                data-match={matched || undefined}
                className={`ledger__row ledger__row--${row.kind}`}
                style={style}
              >
                {row.kind === "turn-header" && (
                  <button type="button" className="ledger__turn" onClick={() => toggleTurn(row.turn)}>
                    <span className="ledger__turn-label">Turn {row.turn}</span>
                    <span className="ledger__turn-text">{row.text.slice(0, 60)}</span>
                  </button>
                )}
                {row.kind === "request-header" && (
                  <div className="ledger__request">
                    <span>#{row.step}</span>
                    {row.model !== null && <span className="ledger__model">{row.model}</span>}
                    {row.usage !== null && <span className="ledger__usage">{usageText(row.usage)}</span>}
                  </div>
                )}
                {row.kind === "assistant" && (
                  <div className="ledger__assistant">
                    {row.text === "" ? <em>(no text)</em> : row.text}
                  </div>
                )}
                {row.kind === "tool" && row.block !== null && <ToolRow block={row.block} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
