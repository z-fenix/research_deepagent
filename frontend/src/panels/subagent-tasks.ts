// frontend/src/panels/subagent-tasks.ts
// 父图 state 的 async_tasks 读取（spec §2.2：deepagents
// async_subagents.py:80-135 AsyncTask{task_id（=thread_id）, thread_id, status, started_at}）。

import { useEffect, useRef } from "react";

export type AsyncTaskView = {
  taskId: string;
  threadId: string;
  status: string;
  startedAt: string | null;
  lastUpdatedAt: string | null;
};

/** 单条子任务在列表里的展示信息（来自父线程 start_async_task 工具调用）。 */
export type LaunchInfo = { title: string; excerpt: string };

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
      // 后端真实字段是 created_at（async_subagents.py:91）；started_at 仅作容错
      startedAt:
        typeof task.created_at === "string"
          ? task.created_at
          : typeof task.started_at === "string"
            ? task.started_at
            : null,
      lastUpdatedAt: typeof task.last_updated_at === "string" ? task.last_updated_at : null,
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

/**
 * 从父线程消息提取 start_async_task 的展示信息：ToolMessage 结果文本
 * （"Launched async subagent. task_id: X"）把调用与其 task_id 关联。
 * 无匹配或畸形 → 该字段回退 task_id 前缀（列表渲染兜底）。
 */
export function extractLaunchInfo(messages: unknown[]): Record<string, LaunchInfo> {
  const argsByCall = new Map<string, Record<string, unknown>>();
  const info: Record<string, LaunchInfo> = {};
  for (const msg of messages) {
    if (msg === null || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;
    if (m.type === "ai" && Array.isArray(m.tool_calls)) {
      for (const call of m.tool_calls) {
        if (call === null || typeof call !== "object") continue;
        const c = call as Record<string, unknown>;
        if (c.name !== "start_async_task" || typeof c.id !== "string") continue;
        argsByCall.set(
          c.id,
          c.args !== null && typeof c.args === "object" ? (c.args as Record<string, unknown>) : {},
        );
      }
      continue;
    }
    if (m.type === "tool" && typeof m.tool_call_id === "string" && argsByCall.has(m.tool_call_id)) {
      const args = argsByCall.get(m.tool_call_id)!;
      const result = typeof m.content === "string" ? m.content : "";
      const match = result.match(/task_id:\s*(\S+)/);
      if (match === null) continue;
      const taskId = match[1]!;
      const description = typeof args.description === "string" ? args.description.trim() : "";
      info[taskId] = {
        title: description || `sdd-agent ${taskId.slice(0, 8)}`,
        excerpt: description,
      };
    }
  }
  return info;
}

/** 列表耗时标签：完成/终止 = 区间时长；运行中 = 至当前的时刻。畸形输入 → null。 */
export function durationLabel(
  startedAt: string | null,
  lastUpdatedAt: string | null,
  now: number,
): string | null {
  if (startedAt === null) return null;
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return null;
  const end = lastUpdatedAt === null ? now : Date.parse(lastUpdatedAt);
  if (Number.isNaN(end) || end < start) return null;
  const total = Math.max(0, Math.round((end - start) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}
