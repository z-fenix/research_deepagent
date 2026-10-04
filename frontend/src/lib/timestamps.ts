// 消息首见时间捕获（spec §5.3）：实时流里消息首次到达时记 Date.now()；
// useRef 生命周期内保留（历史回放无时间戳 → Timeline 时间模式禁用）。

import { useEffect, useRef } from "react";

export function useMessageTimestamps(messages: unknown[]): ReadonlyMap<string, number> {
  const store = useRef(new Map<string, number>());
  useEffect(() => {
    for (const msg of messages) {
      if (msg === null || typeof msg !== "object") continue;
      const id = (msg as Record<string, unknown>).id;
      if (typeof id !== "string" || id === "" || store.current.has(id)) continue;
      store.current.set(id, Date.now());
    }
  }, [messages]);
  return store.current;
}
