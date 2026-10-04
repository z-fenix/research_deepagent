// 横向时间轴：模式切换 + 条目选择；无时间数据时禁用时间类模式（spec §6）。
// 条目按序数均布（真实时间刻度需绝对定位度量，spec §9 列为可后补细节）；
// 选择/联动/禁用语义完整。

import type { ReactNode } from "react";
import type { TrajTurn } from "./layout";
import { timelineHasTimeData, type TimelineMode } from "./timeline";

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
        {mode === "off" ? null : (
          <SequenceBar keys={collectStepKeys(turns)} selected={selected} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}

function collectStepKeys(turns: TrajTurn[]): { key: string; label: string }[] {
  const keys: { key: string; label: string }[] = [];
  for (const turn of turns) {
    for (const step of turn.steps) {
      keys.push({ key: `${turn.turn}:${step.step}`, label: `T${turn.turn}S${step.step}` });
    }
  }
  return keys;
}

function SequenceBar(props: {
  keys: { key: string; label: string }[];
  selected: string | null;
  onSelect(key: string): void;
}): ReactNode {
  return (
    <>
      {props.keys.map((entry, index) => {
        const left = (index / Math.max(1, props.keys.length)) * 100;
        return (
          <button
            key={entry.key}
            type="button"
            data-testid={`timeline-item-${entry.key}`}
            className={`timeline__item${props.selected === entry.key ? " timeline__item--selected" : ""}`}
            style={{ left: `${Math.min(97, left)}%` }}
            onClick={() => props.onSelect(entry.key)}
          >
            {entry.label}
          </button>
        );
      })}
    </>
  );
}
