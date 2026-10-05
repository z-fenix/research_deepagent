// Trajectory 组合视图：工具栏（Duration/Turns/Calls 三开关钮 + 右侧搜索框，
// 3s 节流索引）+ Duration 堆叠分段条 + Ledger（task09 Task 4，参照
// TrajectoryToolbar 语义校正：三者为 toggle button，非行过滤器）。
// - Duration：aria-pressed 开关，按下 → 分段按 durationMs 占比定宽，
//   未按下 → 全部等宽；分段条常驻（buildTimeline，spec §6 降级不变）。
// - Turns/Calls：全部折叠开关，aria-pressed = 全折叠态；折叠状态
//   （collapsedTurns/collapsedAssistants）由此持有并受控传入 Ledger。
// Timeline 组件不再挂载——组件保留导出与组件级测试。
// C2（final review）：App 传入的 timestamps 以 message id 为键
// （useMessageTimestamps 契约不变）；此处经 stepTimestampsFromMessages
// 转换为 assistantKey 键，时间类派生由此获得数据。

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Message } from "../lib/messages";
import { collapsibleTurnIds, type TrajTurn } from "./layout";
import { assistantKey, flattenTrajectoryRows } from "./rows";
import { buildTimeline, stepTimestampsFromMessages, timelineHasTimeData } from "./timeline";
import { TrajectorySearchIndex } from "./search";
import { Ledger } from "./Ledger";

const SEARCH_THROTTLE_MS = 3000;

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function TrajectoryView(props: {
  turns: TrajTurn[];
  timestamps: ReadonlyMap<string, number>;
  messages: Message[];
}): ReactNode {
  const { turns, timestamps, messages } = props;
  const [durationPressed, setDurationPressed] = useState(true);
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(new Set());
  const [collapsedAssistants, setCollapsedAssistants] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ReadonlySet<string> | null>(null);
  const indexRef = useRef(new TrajectorySearchIndex());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // message id 捕获 → assistantKey 步级时间戳（k 条 AI 消息 = k 个 step）
  const stepTimestamps = useMemo(
    () => stepTimestampsFromMessages(messages, turns, timestamps),
    [messages, turns, timestamps],
  );
  const hasTimeData = useMemo(() => timelineHasTimeData(turns, stepTimestamps), [turns, stepTimestamps]);

  // 可折叠集合（与原 Ledger 派生一致）：turn 全体 / 含 tool 块的 assistant
  const collapsibleTurns = useMemo(() => collapsibleTurnIds(turns), [turns]);
  const collapsibleAssistantKeys = useMemo(() => {
    const keys: string[] = [];
    for (const turn of turns) {
      for (const step of turn.steps) {
        if (step.cell.toolBlocks.length > 0) keys.push(assistantKey(turn.turn, step.step));
      }
    }
    return keys;
  }, [turns]);
  const allTurnsCollapsed =
    collapsibleTurns.length > 0 && collapsibleTurns.every((t) => collapsedTurns.has(t));
  const allAssistantsCollapsed =
    collapsibleAssistantKeys.length > 0 &&
    collapsibleAssistantKeys.every((k) => collapsedAssistants.has(k));

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

  // 段色规则：step 含 tool 块 → green（tools），否则 blue（model）
  const toolStepKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const turn of turns) {
      for (const step of turn.steps) {
        if (step.cell.toolBlocks.length > 0) keys.add(assistantKey(turn.turn, step.step));
      }
    }
    return keys;
  }, [turns]);

  // Duration 分段（spec §6）：按下且有时间戳 → 按 durationMs 占比定宽
  // （缺失耗时以非零段均值近似）；否则全部等宽（无时间戳降级同一公式）。
  const segments = useMemo(() => {
    const items = buildTimeline(turns, hasTimeData ? "duration" : "sequence", stepTimestamps);
    const totalMs = items.reduce((acc, it) => acc + (it.durationMs ?? 0), 0);
    const equalPct = 100 / Math.max(1, items.length);
    const averageMs = totalMs / Math.max(1, items.filter((it) => it.durationMs !== null).length);
    const proportional = durationPressed && hasTimeData && totalMs > 0;
    return items.map((it) => {
      const widthPct = proportional ? ((it.durationMs ?? averageMs) / totalMs) * 100 : equalPct;
      return {
        key: it.key,
        title: `${it.label}${it.durationMs !== null ? ` ${formatDuration(it.durationMs)}` : ""}`,
        tools: toolStepKeys.has(it.key),
        widthPct,
      };
    });
  }, [durationPressed, turns, hasTimeData, stepTimestamps, toolStepKeys]);

  const flatRows = useMemo(
    () =>
      flattenTrajectoryRows(turns, new Set(), new Set()).map((row) => ({
        key: row.key,
        text: [row.text, row.block?.name ?? "", row.block?.result ?? ""].join(" "),
      })),
    [turns],
  );

  useEffect(() => {
    if (timerRef.current !== null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      indexRef.current.update(flatRows);
      setMatches(indexRef.current.search(query));
    }, SEARCH_THROTTLE_MS);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [flatRows, query]);

  return (
    <div className="trajectory-view">
      <div className="trajectory-view__toolbar" role="toolbar" aria-label="Trajectory toolbar">
        <button
          type="button"
          className="trajectory-view__toggle"
          aria-pressed={durationPressed}
          data-pressed={durationPressed || undefined}
          title={durationPressed ? "Use equal widths" : "Use actual durations"}
          onClick={() => setDurationPressed((v) => !v)}
        >
          <span aria-hidden="true" className="trajectory-view__toggle-icon">⏱</span>
          Duration
        </button>
        <button
          type="button"
          className="trajectory-view__toggle"
          aria-pressed={allTurnsCollapsed}
          data-pressed={allTurnsCollapsed || undefined}
          title={allTurnsCollapsed ? "Expand turns" : "Collapse turns"}
          onClick={toggleAllTurns}
        >
          <span aria-hidden="true">{allTurnsCollapsed ? "⊞" : "⊟"}</span>
          Turns
        </button>
        <button
          type="button"
          className="trajectory-view__toggle"
          aria-pressed={allAssistantsCollapsed}
          data-pressed={allAssistantsCollapsed || undefined}
          title={allAssistantsCollapsed ? "Expand calls" : "Collapse calls"}
          onClick={toggleAllAssistants}
        >
          <span aria-hidden="true">{allAssistantsCollapsed ? "⊞" : "⊟"}</span>
          Calls
        </button>
        <input
          type="search"
          role="searchbox"
          className="trajectory-view__search"
          placeholder="Search trajectory"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {/* 分段条常驻（Duration 只影响定宽）；零分段（无 turn）时隐藏避免空灰条 */}
      {segments.length > 0 && (
        <div className="duration-bar" data-testid="duration-bar">
          {segments.map((seg) => (
            <div
              key={seg.key}
              title={seg.title}
              className={`duration-bar__seg ${seg.tools ? "duration-bar__seg--tools" : "duration-bar__seg--model"}`}
              style={{ width: `${seg.widthPct}%` }}
            />
          ))}
        </div>
      )}
      <Ledger
        turns={turns}
        searchMatches={matches}
        collapsedTurns={collapsedTurns}
        collapsedAssistants={collapsedAssistants}
        onToggleTurn={toggleTurn}
      />
    </div>
  );
}
