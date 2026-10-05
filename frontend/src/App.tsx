// frontend/src/App.tsx
// 三栏接线：左栏会话列表（含复制链接/删除操作列），中央 Chat|Trajectory tab
// （task09 Task 3：Trajectory 出右栏入中央 tab）+ chat/Composer，右栏 PanelHost
// （subagents / workbench: TodoDock；审批走居中模态 ApprovalDialog）
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
import { API_URL, useAgentStream } from "./lib/stream";
import { useThreads } from "./lib/threads";
import { AppFrame } from "./layout/AppFrame";
import { useFrameLayout } from "./layout/useFrameLayout";
import { PanelHost, readActivePanel, type PanelDef, type PanelId } from "./panels/PanelHost";
import { SubagentPanel } from "./panels/SubagentPanel";
import { extractLaunchInfo, readAsyncTasks, useAutoOpenRunningTask, type AsyncTaskView } from "./panels/subagent-tasks";
import Sidebar from "./components/shell/Sidebar";
import ThemeSettingsDialog from "./components/shell/ThemeSettingsDialog";
import Composer from "./components/composer/Composer";
import TodoDock from "./components/todo/TodoDock";
import { ApprovalDialog } from "./components/approval/ApprovalDialog";
import MessageList from "./components/chat/MessageList";
import ActivityCard from "./components/chat/ActivityCard";
import { useMessageTimestamps } from "./lib/timestamps";
import { deriveTrajectory } from "./trajectory/layout";
import { TrajectoryView } from "./trajectory/TrajectoryView";

function AgentWorkspace(): ReactNode {
  const stream = useAgentStream();
  const { threads, loading, removeThread } = useThreads(API_URL);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const { layout, actions } = useFrameLayout(frameRef);
  // 惰性初始化：mount 时的 null 副作用会抹掉持久化的面板键（Task 3 裁定）。
  const [activePanel, setActivePanel] = useState<PanelId | null>(() => readActivePanel());
  const [activeSubagentTask, setActiveSubagentTask] = useState<string | null>(null);
  // 中央 Chat|Trajectory tab（task09 Task 3）：会话级视图，组件 state 不持久化。
  const [centerTab, setCenterTab] = useState<"chat" | "trajectory">("chat");

  const tasks: AsyncTaskView[] = useMemo(() => readAsyncTasks(stream.values), [stream.values]);
  // 客户端时间戳捕获（spec §5.3）：仅实时流有；历史回放 → Timeline 时间模式禁用。
  const msgTimestamps = useMessageTimestamps(stream.messages);
  // Composer 卡片下方 turns/steps 统计（Task 2）：由现有 deriveTrajectory 派生，数据层不动。
  const trajectoryTurns = useMemo(() => deriveTrajectory(stream.messages), [stream.messages]);
  const composerStats = useMemo(
    () => ({
      turns: trajectoryTurns.length,
      steps: trajectoryTurns.reduce((total, turn) => total + turn.steps.length, 0),
    }),
    [trajectoryTurns],
  );
  const launchInfo = useMemo(() => extractLaunchInfo(stream.messages), [stream.messages]);
  useAutoOpenRunningTask(
    tasks,
    useCallback(
      () => {
        // task12：自动打开右栏并定位到列表（高亮由状态点承担），不直接跳详情
        actions.openRightbar(window.innerWidth);
        setActivePanel("subagents");
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

  // 删除会话：确认后调 SDK delete 并刷新列表；删的是当前会话则切回新会话态。
  const handleDeleteSession = useCallback(
    async (threadId: string) => {
      if (!window.confirm("Delete this session?")) return;
      try {
        await removeThread(threadId);
        if (stream.threadId === threadId) stream.openThread(undefined);
      } catch (error) {
        window.alert(`Delete failed: ${String(error)}`);
      }
    },
    [removeThread, stream],
  );

  const panels: PanelDef[] = useMemo(
    () => [
      {
        id: "subagents",
        title: "Sub-agents",
        render: () => (
          <SubagentPanel
            tasks={tasks}
            launchInfo={launchInfo}
            activeTaskId={activeSubagentTask}
            onActivate={setActiveSubagentTask}
          />
        ),
      },
      {
        id: "workbench",
        title: "Workbench",
        render: () => (
          <div className="workbench">
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
              aria-label="Open session list"
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
              onDeleteSession={(id) => void handleDeleteSession(id)}
            />
          </>
        }
        center={
          <>
            <div className="center-tabs" role="tablist" aria-label="Center view">
              <button
                type="button"
                role="tab"
                className="center-tabs__tab"
                aria-selected={centerTab === "chat"}
                onClick={() => setCenterTab("chat")}
              >
                Chat
              </button>
              <button
                type="button"
                role="tab"
                className="center-tabs__tab"
                aria-selected={centerTab === "trajectory"}
                onClick={() => setCenterTab("trajectory")}
              >
                Trajectory
              </button>
            </div>
            {centerTab === "chat" ? (
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
            ) : (
              <div className="center-trajectory">
                <TrajectoryView
                  turns={trajectoryTurns}
                  timestamps={msgTimestamps}
                  messages={stream.messages}
                />
              </div>
            )}
            <Composer
              isLoading={stream.isLoading}
              disabled={stream.pendingApproval != null}
              onSubmit={stream.submit}
              onStop={stream.stop}
              stats={trajectoryTurns.length > 0 ? composerStats : undefined}
            />
          </>
        }
        // C1：右栏占位物恒挂载；轨道收起（cols.rightbar === 0，含 fresh install）
        // 时呈右缘 rail affordance，tab 点击经 activatePanel 打开轨道（默认 0.45 比例）。
        rightbar={
          <PanelHost
            panels={panels}
            activeId={activePanel}
            onActivate={activatePanel}
            rail={layout.cols.rightbar === 0}
          />
        }
      />
      <ApprovalDialog
        pendingApproval={stream.pendingApproval ?? null}
        error={stream.approvalError}
        onSubmit={(decisions) => void stream.submitApproval(decisions)}
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
