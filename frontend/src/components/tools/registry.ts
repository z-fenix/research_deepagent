// Minimal dsh-style renderer registry: per-tool label/class overrides with a
// default fallback. Extend this map — do not branch inside ToolCallCard.

export type ToolCardMeta = { label: (name: string) => string; className?: string };

export const toolRegistry: Record<string, ToolCardMeta> = {
  task: { label: () => "Sub-agent: research-agent", className: "tool-card--subagent" },
};

export function toolMeta(name: string): ToolCardMeta {
  return toolRegistry[name] ?? { label: (n) => `Tool: ${n}` };
}
