import { useState } from "react";
import { ThemeProvider } from "./theme/ThemeProvider";
import { API_URL, sessionLink, useAgentStream } from "./lib/stream";
import { useThreads } from "./lib/threads";
import Sidebar from "./components/shell/Sidebar";
import Header from "./components/shell/Header";
import ThemeSettingsDialog from "./components/shell/ThemeSettingsDialog";
import Composer from "./components/composer/Composer";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import TodoDock from "./components/todo/TodoDock";
import ThinkingBlock from "./ThinkingBlock";
import ToolCallCard from "./components/tools/ToolCallCard";

function AgentWorkspace() {
  const stream = useAgentStream();
  const { threads, loading } = useThreads(API_URL);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const sessionUrl = sessionLink(stream.threadId);

  return (
    <div className="shell">
      <button
        type="button"
        className="shell__menu"
        aria-label="打开会话列表"
        onClick={() => setDrawerOpen(true)}
      >
        ☰
      </button>
      {drawerOpen && <div className="shell__backdrop" onClick={() => setDrawerOpen(false)} />}
      <Sidebar
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        threads={threads}
        loading={loading}
        activeThreadId={stream.threadId}
        onSelect={(id) => {
          stream.openThread(id);
          setDrawerOpen(false);
        }}
        onNewSession={() => {
          stream.openThread(undefined);
          setDrawerOpen(false);
        }}
        onOpenAppearance={() => setAppearanceOpen(true)}
      />
      <div className="shell__main">
        <Header sessionUrl={sessionUrl} />
        <div className="shell__scroll">
          <div className="shell__content">
            <section className="chat" aria-label="Research conversation">
              {stream.rows.map((row) =>
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
                    <span /><span /><span />
                  </div>
                  <div className="activity-card__copy">
                    <strong>Research in progress</strong>
                    <span>Waiting for sub-agent results and final synthesis.</span>
                  </div>
                </div>
              )}
              {stream.error ? <p className="error">{String(stream.error)}</p> : null}
            </section>
          </div>
          <TodoDock todos={stream.todos} />
          <Composer
            isLoading={stream.isLoading}
            onSubmit={stream.submit}
            onStop={stream.stop}
          />
        </div>
      </div>
      <ThemeSettingsDialog open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AgentWorkspace />
    </ThemeProvider>
  );
}
