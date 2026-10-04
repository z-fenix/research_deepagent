// frontend/src/panels/SubagentPanel.tsx
// 子 agent 面板：任务 tab 条 + 只读消息流（无 composer，对齐参照
// SubagentReadOnlyComposer 语义）+ 错误条 + 重试（spec §7）。

import { messageText } from "../lib/messages";
import { deriveSubagentTabs, type AsyncTaskView } from "./subagent-tasks";
import { useSubagentStream } from "./useSubagentStream";

function SubagentThreadBody({ threadId }: { threadId: string }) {
  const { rows, error, retry } = useSubagentStream(threadId);
  if (error) {
    return (
      <div className="subagent-panel__error" role="alert">
        <span>Sub-agent stream failed: {String(error)}</span>
        <button type="button" onClick={retry}>
          Retry
        </button>
      </div>
    );
  }
  return (
    <div className="subagent-panel__thread" data-testid={`subagent-body-${threadId}`}>
      {rows.map((row) => (
        <div key={row.key} className={`subagent-panel__row subagent-panel__row--${row.kind}`}>
          {row.kind === "prose"
            ? messageText(row.body)
            : row.kind === "plan"
              ? messageText(row.body)
              : `${row.card.name}: ${row.card.status}`}
        </div>
      ))}
    </div>
  );
}

export function SubagentPanel(props: {
  tasks: AsyncTaskView[];
  activeTaskId: string | null;
  onActivate(taskId: string | null): void;
}) {
  const tabs = deriveSubagentTabs(props.tasks);
  if (tabs.length === 0) {
    return <p className="panel-host__empty">No async sub-agent tasks yet</p>;
  }
  const active = tabs.find((t) => t.taskId === props.activeTaskId) ?? null;
  return (
    <div className="subagent-panel">
      <div className="subagent-panel__tabs" role="tablist">
        {tabs.map((task) => (
          <button
            key={task.taskId}
            type="button"
            role="tab"
            aria-selected={task.taskId === props.activeTaskId}
            className="subagent-panel__tab"
            onClick={() =>
              props.onActivate(task.taskId === props.activeTaskId ? null : task.taskId)
            }
          >
            {task.taskId.slice(0, 8)}{" "}
            <span className={`subagent-panel__badge subagent-panel__badge--${task.status}`}>
              {task.status}
            </span>
          </button>
        ))}
      </div>
      {active !== null && <SubagentThreadBody key={active.threadId} threadId={active.threadId} />}
    </div>
  );
}
