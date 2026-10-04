// 消息首见时间捕获（spec §5.3）：实时流里消息首次到达时记 Date.now()；
// useRef 生命周期内保留（历史回放无时间戳 → Timeline 时间模式禁用）。
// M3（final review）：effect 的首个 run（挂载批次）视为历史回放，不盖章；
// 只有挂载之后出现在后续 run 里的消息才算实时到达（保守语义：挂载时已有
// 消息的会话按历史处理）。

import { useEffect, useRef } from "react";

export function useMessageTimestamps(messages: unknown[]): ReadonlyMap<string, number> {
  const store = useRef(new Map<string, number>());
  // 挂载批次的消息 id（历史回放）：永久排除，后续 run 里仍在也不盖章
  const historyIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (historyIds.current === null) {
      historyIds.current = new Set(
        messages.flatMap((msg) => {
          if (msg === null || typeof msg !== "object") return [];
          const id = (msg as Record<string, unknown>).id;
          return typeof id === "string" && id !== "" ? [id] : [];
        }),
      );
      return;
    }
    for (const msg of messages) {
      if (msg === null || typeof msg !== "object") continue;
      const id = (msg as Record<string, unknown>).id;
      if (typeof id !== "string" || id === "" || store.current.has(id)) continue;
      if (historyIds.current.has(id)) continue; // 挂载时已存在 = 历史
      store.current.set(id, Date.now());
    }
  }, [messages]);
  return store.current;
}
