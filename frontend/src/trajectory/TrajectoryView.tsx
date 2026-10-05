// Trajectory 组合视图：工具栏（Duration/Turns/Calls 三 checkbox + 右侧搜索框，
// 3s 节流索引）+ Duration 堆叠分段条 + Ledger（task09 Task 4 重做）。
// Timeline 组件不再挂载——其模式语义并入 Duration checkbox + 分段条
// （组件保留导出与组件级测试）；分段数据沿用 buildTimeline（spec §6 降级：
// 无时间戳按序数均布，有则按 durationMs 占比）。
// C2（final review）：App 传入的 timestamps 以 message id 为键
// （useMessageTimestamps 契约不变）；此处经 stepTimestampsFromMessages
// 转换为 assistantKey 键，时间类派生由此获得数据。

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Message } from "../lib/messages";
import { assistantKey, flattenTrajectoryRows } from "./rows";
import { buildTimeline, stepTimestampsFromMessages, timelineHasTimeData } from "./timeline";
import { TrajectorySearchIndex } from "./search";
import { Ledger } from "./Ledger";
import type { TrajTurn } from "./layout";

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
  const [showDuration, setShowDuration] = useState(true);
  const [showTurns, setShowTurns] = useState(true);
  const [showCalls, setShowCalls] = useState(true);
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

  // Duration 分段（spec §6）：耗时模式按 durationMs 占比定宽，
  // 缺失耗时（末 step / 无时间戳）回退均分；无时间戳整体退化为序数均布。
  const segments = useMemo(() => {
    if (!showDuration) return [];
    const items = buildTimeline(turns, hasTimeData ? "duration" : "sequence", stepTimestamps);
    const totalMs = items.reduce((acc, it) => acc + (it.durationMs ?? 0), 0);
    const equalPct = 100 / Math.max(1, items.length);
    const averageMs = totalMs / Math.max(1, items.filter((it) => it.durationMs !== null).length);
    return items.map((it) => {
      const weightMs = it.durationMs ?? (hasTimeData && totalMs > 0 ? averageMs : 0);
      const widthPct = hasTimeData && totalMs > 0 ? (weightMs / totalMs) * 100 : equalPct;
      return {
        key: it.key,
        title: `${it.label}${it.durationMs !== null ? ` ${formatDuration(it.durationMs)}` : ""}`,
        tools: toolStepKeys.has(it.key),
        widthPct,
      };
    });
  }, [showDuration, turns, hasTimeData, stepTimestamps, toolStepKeys]);

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
      <div className="trajectory-view__toolbar">
        <div className="trajectory-view__filters">
          <label className="trajectory-view__filter">
            <input
              type="checkbox"
              checked={showDuration}
              onChange={(e) => setShowDuration(e.target.checked)}
            />
            Duration
          </label>
          <label className="trajectory-view__filter">
            <input
              type="checkbox"
              checked={showTurns}
              onChange={(e) => setShowTurns(e.target.checked)}
            />
            Turns
          </label>
          <label className="trajectory-view__filter">
            <input
              type="checkbox"
              checked={showCalls}
              onChange={(e) => setShowCalls(e.target.checked)}
            />
            Calls
          </label>
        </div>
        <input
          type="search"
          role="searchbox"
          className="trajectory-view__search"
          placeholder="Search trajectory"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {showDuration && (
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
      <Ledger turns={turns} searchMatches={matches} showTurns={showTurns} showCalls={showCalls} />
    </div>
  );
}
