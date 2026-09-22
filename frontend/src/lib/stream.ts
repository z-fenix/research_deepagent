import { useStream } from "@langchain/react";
import { useCallback, useMemo, useState } from "react";
import { buildRows, type Message, type Row } from "./messages";

export type TodoStatus = "pending" | "in_progress" | "completed";
export type TodoItem = { content: string; status: TodoStatus };

export const API_URL =
  (import.meta.env.VITE_LANGGRAPH_API_URL as string | undefined) ?? "http://127.0.0.1:2024";

type StreamState = { messages: Message[]; todos?: TodoItem[] };

export function syncThreadUrl(threadId: string | undefined): void {
  const url = new URL(window.location.href);
  if (threadId) url.searchParams.set("thread", threadId);
  else url.searchParams.delete("thread");
  window.history.replaceState({}, "", url);
}

export function sessionLink(threadId: string | undefined): string | null {
  if (!threadId) return null;
  const url = new URL(window.location.href);
  url.searchParams.set("thread", threadId);
  return url.toString();
}

export type AgentStream = {
  rows: Row[];
  todos: TodoItem[];
  isLoading: boolean;
  error: unknown;
  submit: (text: string) => void;
  stop: () => void;
  threadId: string | undefined;
  openThread: (threadId: string | undefined) => void;
  sessionUrl: string | null;
};

export function useAgentStream(): AgentStream {
  const [threadId, setThreadId] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get("thread") ?? undefined,
  );

  const stream = useStream<StreamState>({
    apiUrl: API_URL,
    assistantId: "research",
    threadId,
    onThreadId: (id) => {
      setThreadId(id);
      syncThreadUrl(id);
    },
  });

  const openThread = useCallback((id: string | undefined) => {
    setThreadId(id);
    syncThreadUrl(id);
  }, []);

  const rows = useMemo(() => buildRows(stream.messages as Message[]), [stream.messages]);
  const todos = Array.isArray(stream.values?.todos) ? stream.values.todos : [];

  return {
    rows,
    todos,
    isLoading: stream.isLoading,
    error: stream.error,
    submit: (text) => {
      void stream.submit({ messages: [{ type: "human", content: text }] });
    },
    stop: () => {
      void stream.stop();
    },
    threadId,
    openThread,
    sessionUrl: sessionLink(threadId),
  };
}
