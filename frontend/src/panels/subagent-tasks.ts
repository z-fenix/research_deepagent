// frontend/src/panels/subagent-tasks.ts
// 父图 state 的 async_tasks 读取（spec §2.2：deepagents
// async_subagents.py:80-135 AsyncTask{task_id（=thread_id）, thread_id, status, started_at}）。

import { useEffect, useRef } from "react";

export type AsyncTaskView = {
  taskId: string;
  threadId: string;
  status: string;
  startedAt: string | null;
};

/** 从 stream.values 守卫式读取 async_tasks：缺失/空/畸形（非对象、缺 thread_id/status）→ []。 */
export function readAsyncTasks(values: unknown): AsyncTaskView[] {
  if (values === null || typeof values !== "object") return [];
  const raw = (values as Record<string, unknown>).async_tasks;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const tasks: AsyncTaskView[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") continue;
    const task = value as Record<string, unknown>;
    const threadId = typeof task.thread_id === "string" ? task.thread_id : "";
    const status = typeof task.status === "string" ? task.status : "";
    if (threadId === "" || status === "") continue;
    tasks.push({
      taskId: typeof task.task_id === "string" ? task.task_id : key,
      threadId,
      status,
      startedAt: typeof task.started_at === "string" ? task.started_at : null,
    });
  }
  return tasks;
}

/** 按 taskId 去重保序（首个出现的视图胜出）。 */
export function deriveSubagentTabs(tasks: AsyncTaskView[]): AsyncTaskView[] {
  const seen = new Set<string>();
  const out: AsyncTaskView[] = [];
  for (const task of tasks) {
    if (seen.has(task.taskId)) continue;
    seen.add(task.taskId);
    out.push(task);
  }
  return out;
}

/** 每个任务首次转 running 时回调一次（Review Focus 3：已通告集合防重复）。 */
export function useAutoOpenRunningTask(
  tasks: AsyncTaskView[],
  onOpen: (taskId: string) => void,
): void {
  const announced = useRef(new Set<string>());
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  useEffect(() => {
    for (const task of tasks) {
      if (task.status !== "running" || announced.current.has(task.taskId)) continue;
      announced.current.add(task.taskId);
      onOpenRef.current(task.taskId);
    }
  }, [tasks]);
}
