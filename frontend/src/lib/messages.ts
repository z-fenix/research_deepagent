// Message assembly: walk streamed messages in order and produce flat render
// rows. Migrated verbatim from the former App.tsx implementation.

export type RawToolCall = { id?: string; name?: string; args?: unknown };
export type Message = {
  id?: string;
  type: string;
  content: unknown;
  tool_calls?: RawToolCall[];
  tool_call_id?: string;
  name?: string;
};
export type ToolCard = {
  callId: string;
  name: string;
  args: unknown;
  result: string | null;
  status: "pending" | "done";
};

export const PLAN_MARKERS = ["SESSION INTENT", "SUMMARY", "NEXT STEPS", "ARTIFACTS"];

export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : typeof part === "object" && part !== null && "text" in part
            ? String((part as { text: unknown }).text ?? "")
            : "",
      )
      .join("");
  }
  return "";
}

export type Row =
  | { kind: "prose"; key: string; type: "human" | "ai"; body: string }
  | { kind: "plan"; key: string; body: string }
  | { kind: "card"; key: string; card: ToolCard };

export function isPlanLikeBody(body: string): boolean {
  const normalized = body.toUpperCase();
  const markerHits = PLAN_MARKERS.filter((marker) => normalized.includes(marker)).length;
  return markerHits >= 2 || (markerHits >= 1 && /the user requested/i.test(body));
}

export function buildRows(messages: Message[]): Row[] {
  const rows: Row[] = [];
  const cardByCallId = new Map<string, ToolCard>();
  for (const msg of messages) {
    if (msg.type === "human") {
      rows.push({
        kind: "prose",
        key: msg.id ?? `h-${rows.length}`,
        type: "human",
        body: messageText(msg.content),
      });
    } else if (msg.type === "ai") {
      const calls = msg.tool_calls ?? [];
      const body = messageText(msg.content);
      const trimmedBody = body.trim();
      if (trimmedBody) {
        if (isPlanLikeBody(trimmedBody)) {
          rows.push({ kind: "plan", key: msg.id ?? `p-${rows.length}`, body: trimmedBody });
        } else {
          rows.push({
            kind: "prose",
            key: msg.id ?? `a-${rows.length}`,
            type: "ai",
            body: trimmedBody,
          });
        }
      }
      if (calls.length > 0) {
        // Open a new card per call. Pending until its tool message arrives.
        for (const call of calls) {
          const callId = call.id ?? `${msg.id}-${call.name}-${rows.length}`;
          const card: ToolCard = {
            callId,
            name: call.name ?? "tool",
            args: call.args ?? {},
            result: null,
            status: "pending",
          };
          cardByCallId.set(callId, card);
          rows.push({ kind: "card", key: `c-${callId}`, card });
        }
      }
    } else if (msg.type === "tool") {
      // Match into the card by tool_call_id. If no card exists (shouldn't
      // happen), drop silently — the user doesn't care about orphans.
      const callId = msg.tool_call_id;
      if (callId && cardByCallId.has(callId)) {
        const card = cardByCallId.get(callId)!;
        card.result = messageText(msg.content);
        card.status = "done";
      }
    }
  }
  return rows;
}
