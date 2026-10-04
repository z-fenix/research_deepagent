// Timeline 布局（spec §5.3）：序列模式用序数；耗时/真实时间模式用客户端
// 捕获的时间戳（键 = assistantKey），缺失 → null（禁用态由组件呈现）。
// C2（final review）：useMessageTimestamps 以 message id 为键（契约不变），
// 视图层经 stepTimestampsFromMessages 转换为 assistantKey 键后喂给
// buildTimeline / timelineHasTimeData —— 两套键在此交汇。

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

/**
 * 把 message-id 键的时间戳捕获转换为 assistantKey 键的 step 时间戳。
 * 配对规则与 deriveTrajectory 一致：第 k 条 AI 消息创建第 k 个 step
 * （messages 按序遍历取 AI 消息 id，steps 按 turn/step 序展开，位置对位置）；
 * 同一 step 首个捕获生效。
 */
export function stepTimestampsFromMessages(
  messages: ReadonlyArray<unknown>,
  turns: TrajTurn[],
  timestamps: ReadonlyMap<string, number>,
): Map<string, number> {
  const aiIds: string[] = [];
  for (const msg of messages) {
    if (typeof msg !== "object" || msg === null) continue;
    if ((msg as Record<string, unknown>).type !== "ai") continue;
    const id = (msg as Record<string, unknown>).id;
    if (typeof id === "string" && id !== "") aiIds.push(id);
  }
  const out = new Map<string, number>();
  let k = 0;
  for (const turn of turns) {
    for (const step of turn.steps) {
      const id = aiIds[k];
      k += 1;
      if (id === undefined) break;
      const captured = timestamps.get(id);
      if (captured === undefined) continue;
      const key = assistantKey(turn.turn, step.step);
      if (!out.has(key)) out.set(key, captured); // 首 capture 优先
    }
  }
  return out;
}

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
