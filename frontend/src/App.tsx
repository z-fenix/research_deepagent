import { useState } from "react";
import { ThemeProvider } from "./theme/ThemeProvider";
import { API_URL, sessionLink, useAgentStream } from "./lib/stream";
import { useThreads } from "./lib/threads";
import Sidebar from "./components/shell/Sidebar";
import Header from "./components/shell/Header";
import ThemeSettingsDialog from "./components/shell/ThemeSettingsDialog";
import Composer from "./components/composer/Composer";
import TodoDock from "./components/todo/TodoDock";
import { ApprovalDock } from "./components/approval/ApprovalDock";
import MessageList from "./components/chat/MessageList";
import ActivityCard from "./components/chat/ActivityCard";

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
              {stream.rows.length === 0 && !stream.isLoading && (
                <p className="hint">
                  Try: <em>"Research what LangGraph 1.0 added vs 0.x. Cite sources."</em>
                </p>
              )}
              <MessageList rows={stream.rows} />
              <ActivityCard visible={stream.isLoading} />
              {stream.error ? <p className="error">{String(stream.error)}</p> : null}
            </section>
          </div>
          <TodoDock todos={stream.todos} />
          <ApprovalDock
            pendingApproval={stream.pendingApproval ?? null}
            error={stream.approvalError}
            onSubmit={(decisions) => void stream.submitApproval(decisions)}
          />
          <Composer
            isLoading={stream.isLoading}
            disabled={stream.pendingApproval != null}
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
