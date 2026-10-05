// frontend/src/panels/SubagentPanel.tsx
// task12：子智能体列表布局（参照 deepseek-harness）——列表态（状态点/标题/
// 徽标/耗时/箭头）+ 详情态（只读子线程流 + 返回）。只读无 composer（对齐
// 参照 SubagentReadOnlyComposer 语义）；错误条 + 重试（spec §7）。

import type { ReactNode } from "react";
import { messageText } from "../lib/messages";
import {
  deriveSubagentTabs,
  durationLabel,
  type AsyncTaskView,
  type LaunchInfo,
} from "./subagent-tasks";
import { useSubagentStream } from "./useSubagentStream";

const STATUS_LABEL: Record<string, string> = {
  running: "running",
  success: "completed",
  error: "error",
  cancelled: "cancelled",
};

function SubagentThreadBody({ threadId }: { threadId: string }): ReactNode {
  const { rows, error, retry } = useSubagentStream(threadId);
  if (error) {
    return (
      <div className="subagent-panel__error" role="alert">
        <span>Sub-agent stream failed: {String(error)}</span>
        <button type="button" onClick={retry}>Retry</button>
      </div>
    );
  }
  return (
    <div className="subagent-panel__thread" data-testid={`subagent-body-${threadId}`}>
      {rows.map((row) => (
        <div key={row.key} className={`subagent-panel__row subagent-panel__row--${row.kind}`}>
          {row.kind === "prose" ? messageText(row.body) : row.kind === "plan" ? messageText(row.body) : `${row.card.name}: ${row.card.status}`}
        </div>
      ))}
    </div>
  );
}

function SubagentRow(props: {
  task: AsyncTaskView;
  info: LaunchInfo | undefined;
  onOpen: (taskId: string) => void;
}): ReactNode {
  const { task, info } = props;
  const status = STATUS_LABEL[task.status] ?? task.status;
  const duration = durationLabel(task.startedAt, task.lastUpdatedAt, Date.now());
  return (
    <div className="subagent-row" data-status={task.status}>
      <span className="subagent-row__dot" aria-hidden="true" />
      <div className="subagent-row__body">
        <div className="subagent-row__title">{info?.title ?? `sdd-agent ${task.taskId.slice(0, 8)}`}</div>
        <div className="subagent-row__meta">
          <span className="subagent-row__excerpt">{info?.excerpt || "read-only sub-agent run"}</span>
          <span className="subagent-row__badges">read-only · {status}</span>
        </div>
      </div>
      <div className="subagent-row__side">
        {duration !== null && <span className="subagent-row__duration">{duration}</span>}
        <button
          type="button"
          className="subagent-row__open"
          aria-label={`Open sub-agent ${task.taskId}`}
          onClick={() => props.onOpen(task.taskId)}
        >
          ›
        </button>
      </div>
    </div>
  );
}

export function SubagentPanel(props: {
  tasks: AsyncTaskView[];
  launchInfo: Record<string, LaunchInfo>;
  activeTaskId: string | null;
  onActivate: (taskId: string | null) => void;
}): ReactNode {
  const tabs = deriveSubagentTabs(props.tasks);
  if (tabs.length === 0) {
    return <p className="panel-host__empty">No async sub-agent tasks yet</p>;
  }
  const active = tabs.find((t) => t.taskId === props.activeTaskId) ?? null;
  if (active !== null) {
    return (
      <div className="subagent-panel subagent-panel--detail">
        <button
          type="button"
          className="subagent-panel__back"
          onClick={() => props.onActivate(null)}
        >
          ‹ Back to list
        </button>
        <SubagentThreadBody key={active.threadId} threadId={active.threadId} />
      </div>
    );
  }
  return (
    <div className="subagent-panel">
      <div className="subagent-panel__head">
        {tabs.length} sub-agents
      </div>
      <div className="subagent-panel__list">
        {tabs.map((task) => (
          <SubagentRow
            key={task.taskId}
            task={task}
            info={props.launchInfo[task.taskId]}
            onOpen={props.onActivate}
          />
        ))}
      </div>
    </div>
  );
}
