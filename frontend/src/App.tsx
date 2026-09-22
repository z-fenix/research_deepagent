import { FormEvent, useMemo, useState } from "react";
import { useStream } from "@langchain/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import TodoList, { type TodoItem } from "./TodoList";
import ThinkingBlock from "./ThinkingBlock";
import ToolCallCard from "./ToolCallCard";
import { buildRows, type Message, type Row } from "./lib/messages";

type StreamState = {
  messages: Message[];
  todos?: TodoItem[];
};

export default function App() {
  const apiUrl =
    import.meta.env.VITE_LANGGRAPH_API_URL ?? "http://127.0.0.1:2024";
  const [threadId, setThreadId] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get("thread") ?? undefined,
  );
  const sessionUrl = threadId
    ? `${window.location.origin}${window.location.pathname}?thread=${threadId}`
    : null;

  const stream = useStream<StreamState>({
    apiUrl,
    assistantId: "research",
    threadId,
    onThreadId: (id) => {
      setThreadId(id);
      const url = new URL(window.location.href);
      url.searchParams.set("thread", id);
      window.history.replaceState({}, "", url);
    },
  });

  const [input, setInput] = useState("");
  const rows = useMemo(() => buildRows(stream.messages as Message[]), [stream.messages]);
  const todos = Array.isArray(stream.values?.todos) ? stream.values.todos : [];

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || stream.isLoading) return;
    setInput("");
    stream.submit({ messages: [{ type: "human", content: text }] });
  }

  return (
    <main>
      <h1>Research Deep Agent</h1>
      <section className="thread-banner" aria-label="Session link">
        <div className="thread-banner__copy">
          <strong>{threadId ? "Session link active" : "Session link ready"}</strong>
          <span>
            {threadId
              ? "Reopen this conversation later with the current URL."
              : "After the first message, this page adds a thread URL so you can reopen the same conversation later."}
          </span>
        </div>
        {sessionUrl ? <code className="thread-banner__url">{sessionUrl}</code> : null}
      </section>
      <TodoList todos={todos} />

      <section className="chat" aria-label="Research conversation">
        {rows.length === 0 && (
          <p className="hint">
            Try: <em>"Research what LangGraph 1.0 added vs 0.x. Cite sources."</em>
          </p>
        )}
        {rows.map((row) =>
          row.kind === "prose" ? (
            <article key={row.key} className={`msg msg--${row.type}`}>
              <header className="msg__role">{row.type}</header>
              <div className="msg__body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{row.body}</ReactMarkdown>
              </div>
            </article>
          ) : row.kind === "plan" ? (
            <ThinkingBlock key={row.key} body={row.body} />
          ) : (
            <ToolCallCard key={row.key} card={row.card} />
          ),
        )}
        {stream.isLoading && (
          <div className="activity-card" aria-live="polite" aria-label="Research in progress">
            <div className="activity-card__pulse" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="activity-card__copy">
              <strong>Research in progress</strong>
              <span>Waiting for sub-agent results and final synthesis.</span>
            </div>
          </div>
        )}
        {stream.error ? <p className="error">{String(stream.error)}</p> : null}
      </section>

      <form className="composer" onSubmit={onSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a research question…"
          disabled={stream.isLoading}
          autoFocus
        />
        <button type="submit" disabled={stream.isLoading || !input.trim()}>
          Send
        </button>
      </form>
    </main>
  );
}
