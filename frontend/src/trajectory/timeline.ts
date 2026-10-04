// Timeline 布局（spec §5.3）：序列模式用序数；耗时/真实时间模式用客户端
// 捕获的时间戳（键 = assistantKey），缺失 → null（禁用态由组件呈现）。

import type { TrajTurn } from "./layout";
import { assistantKey } from "./rows";

export type TimelineMode = "off" | "sequence" | "duration" | "actual";

export type TimelineItem = {
  index: number;
  key: string;
  label: string;
  start: number | null;
  end: number | null;
  durationMs: number | null;
};

export function buildTimeline(
  turns: TrajTurn[],
  mode: TimelineMode,
  timestamps: ReadonlyMap<string, number>,
): TimelineItem[] {
  if (mode === "off") return [];
  // duration/actual 语义：start = 本 step 首见时间，end = 下一 step 首见时间
  // （本步耗时覆盖到下一条消息到达），末 step / 缺失 → null。
  const stepKeys: string[] = [];
  for (const turn of turns) {
    for (const step of turn.steps) stepKeys.push(assistantKey(turn.turn, step.step));
  }
  const items: TimelineItem[] = [];
  let index = 0;
  for (const turn of turns) {
    for (const step of turn.steps) {
      const key = assistantKey(turn.turn, step.step);
      const start = mode === "sequence" ? index : (timestamps.get(key) ?? null);
      const nextKey = stepKeys[index + 1];
      const end = mode === "sequence" || nextKey === undefined ? null : (timestamps.get(nextKey) ?? null);
      items.push({
        index,
        key,
        label: `T${turn.turn}S${step.step}`,
        start,
        end,
        durationMs: mode === "sequence" || start === null || end === null ? null : Math.max(0, end - start),
      });
      index += 1;
    }
  }
  return items;
}

export function timelineHasTimeData(turns: TrajTurn[], timestamps: ReadonlyMap<string, number>): boolean {
  for (const turn of turns) {
    for (const step of turn.steps) {
      if (timestamps.has(assistantKey(turn.turn, step.step))) return true;
    }
  }
  return false;
}
