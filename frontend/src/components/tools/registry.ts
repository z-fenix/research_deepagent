// Minimal dsh-style renderer registry: per-tool label/class overrides with a
// default fallback. Extend this map — do not branch inside ToolCallCard.

export type ToolCardMeta = { label: (name: string) => string; className?: string };

export const toolRegistry: Record<string, ToolCardMeta> = {
  task: { label: () => "Sub-agent: research-agent", className: "tool-card--subagent" },
  // deepagents AsyncSubAgentMiddleware 五件套（Task 06 异步 SDD 链路）
  start_async_task: { label: () => "异步任务启动", className: "tool-card--async" },
  check_async_task: { label: () => "异步任务查询", className: "tool-card--async" },
  update_async_task: { label: () => "异步任务追加指令", className: "tool-card--async" },
  cancel_async_task: { label: () => "异步任务取消", className: "tool-card--async" },
  list_async_tasks: { label: () => "异步任务列表", className: "tool-card--async" },
};

export function toolMeta(name: string): ToolCardMeta {
  return toolRegistry[name] ?? { label: (n) => `Tool: ${n}` };
}
