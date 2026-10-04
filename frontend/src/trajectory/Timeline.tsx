// 横向时间轴：模式切换 + 条目选择；无时间数据时禁用时间类模式（spec §6）。
// I1（final review）：条目统一由 buildTimeline 派生——序列模式沿用序数均布；
// 耗时/真实时间模式按时间戳线性定位（[min start, max end] 标度），缺失时间戳
// 的条目回退序数槽位；耗时模式显示 durationMs 标签，真实时间模式显示时钟时刻。
// 条目键/标签来自 buildTimeline（assistantKey，Task 8 ledger 漂移一并消除）。

import type { ReactNode } from "react";
import type { TrajTurn } from "./layout";
import { buildTimeline, timelineHasTimeData, type TimelineItem, type TimelineMode } from "./timeline";

const MODES: TimelineMode[] = ["off", "sequence", "duration", "actual"];

export function Timeline(props: {
  turns: TrajTurn[];
  timestamps: ReadonlyMap<string, number>;
  mode: TimelineMode;
  onModeChange(mode: TimelineMode): void;
  selected: string | null;
  onSelect(key: string): void;
}): ReactNode {
  const { turns, timestamps, mode, onModeChange, selected, onSelect } = props;
  const hasTime = timelineHasTimeData(turns, timestamps);
  const items = buildTimeline(turns, mode, timestamps);
  const scale = timeScale(items);
  return (
    <div className="timeline">
      <div className="timeline__modes" role="toolbar" aria-label="Timeline mode">
        {MODES.map((m) => {
          const timeMode = m === "duration" || m === "actual";
          return (
            <button
              key={m}
              type="button"
              disabled={!hasTime && timeMode}
              title={!hasTime && timeMode ? "Time modes need a live capture; history has no timestamps" : undefined}
              className={m === mode ? "timeline__mode timeline__mode--active" : "timeline__mode"}
              onClick={() => onModeChange(m)}
            >
              {m}
            </button>
          );
        })}
      </div>
      <div className="timeline__bar">
        {mode === "off"
          ? null
          : items.map((item) => (
              <TimelineItemButton
                key={item.key}
                item={item}
                mode={mode}
                scale={scale}
                total={items.length}
                selected={selected === item.key}
                onSelect={onSelect}
              />
            ))}
      </div>
    </div>
  );
}

/** 耗时/真实时间模式的线性标度域：[min start, max end]，无数据 → null。 */
function timeScale(items: TimelineItem[]): { min: number; span: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const item of items) {
    if (item.start === null) continue;
    min = Math.min(min, item.start);
    max = Math.max(max, item.end ?? item.start);
  }
  if (min === Infinity) return null;
  return { min, span: Math.max(0, max - min) };
}

function TimelineItemButton(props: {
  item: TimelineItem;
  mode: TimelineMode;
  scale: { min: number; span: number } | null;
  total: number;
  selected: boolean;
  onSelect(key: string): void;
}): ReactNode {
  const { item, mode, scale, total, selected, onSelect } = props;
  const isTimeMode = mode === "duration" || mode === "actual";
  let leftPct: number;
  if (isTimeMode && scale !== null && item.start !== null) {
    leftPct = scale.span > 0 ? ((item.start - scale.min) / scale.span) * 100 : 0;
  } else {
    // 序数槽位（sequence 全量；时间模式缺时间戳的条目回退）
    leftPct = (item.index / Math.max(1, total)) * 100;
  }
  const widthPct =
    isTimeMode && scale !== null && scale.span > 0 && item.start !== null && item.end !== null
      ? ((item.end - item.start) / scale.span) * 100
      : null;
  const label = itemLabel(item, mode);
  return (
    <button
      type="button"
      data-testid={`timeline-item-${item.key}`}
      title={`${item.label}${item.durationMs !== null ? ` · ${formatDuration(item.durationMs)}` : ""}`}
      className={`timeline__item${selected ? " timeline__item--selected" : ""}`}
      style={{
        left: `${Math.min(100, Math.max(0, leftPct))}%`,
        ...(widthPct !== null ? { width: `${Math.max(2, widthPct)}%` } : {}),
      }}
      onClick={() => onSelect(item.key)}
    >
      {label}
    </button>
  );
}

function itemLabel(item: TimelineItem, mode: TimelineMode): string {
  if (mode === "duration") return item.durationMs !== null ? formatDuration(item.durationMs) : item.label;
  if (mode === "actual") return item.start !== null ? formatClock(item.start) : item.label;
  return item.label;
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
