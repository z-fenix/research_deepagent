// frontend/src/App.tsx
// 三栏接线（task08 Task 5）：左栏会话列表，中央 chat+Composer，右栏 PanelHost
// （subagents / trajectory 占位 / workbench: ApprovalDock+TodoDock）。
//
// 拖拽接线（对简报 App 代码的修正，两处，均经 AppFrame 源码核实）：
// 简报让 App 覆盖 onSidebarDrag/onRightbarDrag（`setSidebar(layout.cols.sidebar + dx)`），
// 但 DragHandle 上报的是"相对按下点的累计增量"（AppFrame.tsx emit: latest - origin）：
// 1. 右把手在回调前已把增量反转为"变宽为正"（AppFrame.tsx:140 `act.onRightbarDrag(-dx)`），
//    简报的 `- dx` 会二次反转；
// 2. "当前渲染宽度 + 累计 dx" 随每帧 set 后的重渲染复利 —— 这正是 Task 2 review
//    fix round 1 在回退路径里修掉的 bug。AppFrame 的回退路径（未提供覆盖时）以
//    按下时刻冻结的宽度为基线调用 actions.setSidebar/setRightbar，即绑定的
//    "baseline frozen at pointerdown" 语义，因此这里直接透传 actions、不提供覆盖。

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ThemeProvider } from "./theme/ThemeProvider";
import { API_URL, sessionLink, useAgentStream } from "./lib/stream";
import { useThreads } from "./lib/threads";
import { AppFrame } from "./layout/AppFrame";
import { useFrameLayout } from "./layout/useFrameLayout";
import { PanelHost, readActivePanel, type PanelDef, type PanelId } from "./panels/PanelHost";
import { SubagentPanel } from "./panels/SubagentPanel";
import { readAsyncTasks, useAutoOpenRunningTask, type AsyncTaskView } from "./panels/subagent-tasks";
import Sidebar from "./components/shell/Sidebar";
import Header from "./components/shell/Header";
import ThemeSettingsDialog from "./components/shell/ThemeSettingsDialog";
import Composer from "./components/composer/Composer";
import TodoDock from "./components/todo/TodoDock";
import { ApprovalDock } from "./components/approval/ApprovalDock";
import MessageList from "./components/chat/MessageList";
import ActivityCard from "./components/chat/ActivityCard";

function AgentWorkspace(): ReactNode {
  const stream = useAgentStream();
  const { threads, loading } = useThreads(API_URL);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const { layout, actions } = useFrameLayout(frameRef);
  // 惰性初始化：mount 时的 null 副作用会抹掉持久化的面板键（Task 3 裁定）。
  const [activePanel, setActivePanel] = useState<PanelId | null>(() => readActivePanel());
  const [activeSubagentTask, setActiveSubagentTask] = useState<string | null>(null);

  const tasks: AsyncTaskView[] = useMemo(() => readAsyncTasks(stream.values), [stream.values]);
  useAutoOpenRunningTask(
    tasks,
    useCallback(
      (taskId: string) => {
        actions.openRightbar(window.innerWidth);
        setActivePanel("subagents");
        setActiveSubagentTask(taskId);
      },
      [actions],
    ),
  );

  const activatePanel = useCallback(
    (id: PanelId | null) => {
      setActivePanel(id);
      if (id === null) actions.closeRightbar();
      else actions.openRightbar(window.innerWidth);
    },
    [actions],
  );

  const sessionUrl = sessionLink(stream.threadId);

  const panels: PanelDef[] = useMemo(
    () => [
      {
        id: "subagents",
        title: "Sub-agents",
        render: () => (
          <SubagentPanel
            tasks={tasks}
            activeTaskId={activeSubagentTask}
            onActivate={setActiveSubagentTask}
          />
        ),
      },
      {
        id: "trajectory",
        title: "Trajectory",
        render: () => <p className="panel-host__empty">Trajectory arrives in phase 2</p>,
      },
      {
        id: "workbench",
        title: "Workbench",
        render: () => (
          <div className="workbench">
            <ApprovalDock
              pendingApproval={stream.pendingApproval ?? null}
              error={stream.approvalError}
              onSubmit={(decisions) => void stream.submitApproval(decisions)}
            />
            <TodoDock todos={stream.todos} />
          </div>
        ),
      },
    ],
    [
      tasks,
      activeSubagentTask,
      stream.pendingApproval,
      stream.approvalError,
      stream.todos,
      stream.submitApproval,
    ],
  );

  return (
    <>
      <AppFrame
        frameRef={frameRef}
        layout={layout}
        actions={actions}
        sidebar={
          <>
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
          </>
        }
        center={
          <>
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
            </div>
            <Composer
              isLoading={stream.isLoading}
              disabled={stream.pendingApproval != null}
              onSubmit={stream.submit}
              onStop={stream.stop}
            />
          </>
        }
        rightbar={<PanelHost panels={panels} activeId={activePanel} onActivate={activatePanel} />}
      />
      <ThemeSettingsDialog open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
    </>
  );
}

export default function App(): ReactNode {
  return (
    <ThemeProvider>
      <AgentWorkspace />
    </ThemeProvider>
  );
}
