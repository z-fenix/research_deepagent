// frontend/src/panels/useSubagentStream.ts
// 子线程懒连接：SDK 的 useStream 接受 threadId: null（= 不绑定既有线程，见
// node_modules/@langchain/langgraph-sdk/dist/ui/types.d.ts:832 `threadId?: string | null`），
// 因此 threadId 未定时传 null 即可，无需条件挂载内部组件。卸载即断。

import { useStream } from "@langchain/react";
import { useCallback, useEffect, useState } from "react";
import { buildRows, type Message, type Row } from "../lib/messages";
import { API_URL } from "../lib/stream";

type SubagentState = { messages: Message[] };

export function useSubagentStream(threadId: string | undefined): {
  rows: Row[];
  error: unknown;
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [detached, setDetached] = useState(false);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // retry：SDK 无显式 refetch API，只在 threadId 变化/挂载时拉取线程历史——
  // 先解绑一拍再回绑，强制 useStream 重新拉取。错误仅经 stream.error 展示，
  // 不自动重连（服务端持续不可达时会形成重试风暴）。
  useEffect(() => {
    if (attempt === 0) return;
    setDetached(true);
    const timer = setTimeout(() => setDetached(false), 50);
    return () => clearTimeout(timer);
  }, [attempt]);

  const stream = useStream<SubagentState>({
    apiUrl: API_URL,
    assistantId: "sdd-agent",
    threadId: threadId === undefined || detached ? null : threadId,
  });

  const rows = threadId === undefined ? [] : buildRows((stream.messages ?? []) as Message[]);
  return { rows, error: stream.error, retry };
}
