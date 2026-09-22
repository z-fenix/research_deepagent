import { Client, type Thread } from "@langchain/langgraph-sdk";
import { useCallback, useEffect, useState } from "react";

export type ThreadSummary = { threadId: string; updatedAt: string; title: string };

type Humanish = { type?: string; content?: unknown };

export function threadTitle(thread: Thread): string {
  const messages =
    (thread.values as { messages?: Humanish[] } | undefined)?.messages ?? [];
  const firstHuman = messages.find((m) => m.type === "human");
  const text = typeof firstHuman?.content === "string" ? firstHuman.content.trim() : "";
  return text ? text.slice(0, 48) : `会话 ${thread.thread_id.slice(0, 8)}`;
}

export function toSummary(thread: Thread): ThreadSummary {
  return { threadId: thread.thread_id, updatedAt: thread.updated_at, title: threadTitle(thread) };
}

export function useThreads(apiUrl: string): {
  threads: ThreadSummary[];
  loading: boolean;
  error: unknown;
  refresh: () => void;
} {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    new Client({ apiUrl })
      .threads.search({ limit: 20, sortBy: "updated_at", sortOrder: "desc" })
      .then((list) => {
        if (cancelled) return;
        setThreads(list.map(toSummary));
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { threads, loading, error, refresh };
}
