// Trajectory 派生（spec §5.1）：父线程 messages → turn（human 开新 turn）→
// step（AI 消息）→ cell；tool 结果按 call_id 归块；task 委派结果包成
// 嵌套报告块；usage/模型取自消息元数据，缺失为 null。

import { messageText, type Message, type RawToolCall } from "../lib/messages";

export type { Message };

export type TrajUsage = { input?: number; output?: number };

export type TrajToolBlock = {
  callId: string;
  name: string;
  args: unknown;
  result: string | null;
  status: "pending" | "done";
  isDelegation: boolean;
  subTools: TrajToolBlock[];
};

export type TrajCell = {
  kind: "assistant";
  step: number;
  text: string;
  model: string | null;
  usage: TrajUsage | null;
  toolBlocks: TrajToolBlock[];
};

export type TrajStep = { step: number; model: string | null; usage: TrajUsage | null; cell: TrajCell };
export type TrajTurn = { turn: number; prompt: string; steps: TrajStep[] };

const DELEGATION_TOOL = "task";

function blockFromCall(call: RawToolCall, fallbackId: string): TrajToolBlock {
  const callId = typeof call.id === "string" && call.id !== "" ? call.id : fallbackId;
  const name = typeof call.name === "string" && call.name !== "" ? call.name : "tool";
  return { callId, name, args: call.args ?? {}, result: null, status: "pending", isDelegation: name === DELEGATION_TOOL, subTools: [] };
}

function usageFromMeta(meta: unknown): TrajUsage | null {
  if (meta === null || typeof meta !== "object") return null;
  const raw = meta as Record<string, unknown>;
  const input = typeof raw.input_tokens === "number" ? raw.input_tokens : undefined;
  const output = typeof raw.output_tokens === "number" ? raw.output_tokens : undefined;
  if (input === undefined && output === undefined) return null;
  return { ...(input === undefined ? {} : { input }), ...(output === undefined ? {} : { output }) };
}

function modelFromMeta(meta: unknown): string | null {
  if (meta === null || typeof meta !== "object") return null;
  const name = (meta as Record<string, unknown>).model_name;
  return typeof name === "string" && name !== "" ? name : null;
}

function metaOf(msg: Message, key: string): unknown {
  if (typeof msg !== "object" || msg === null) return null;
  return (msg as unknown as Record<string, unknown>)[key] ?? null;
}

export function deriveTrajectory(messages: Message[]): TrajTurn[] {
  const turns: TrajTurn[] = [];
  let current: TrajTurn | null = null;
  const blocksByCallId = new Map<string, TrajToolBlock>();

  const ensureTurn = (prompt: string): TrajTurn => {
    const turn: TrajTurn = { turn: turns.length, prompt, steps: [] };
    turns.push(turn);
    return turn;
  };

  for (const [index, msg] of messages.entries()) {
    if (msg.type === "human") {
      current = ensureTurn(messageText(msg.content));
      continue;
    }
    if (current === null) current = ensureTurn("");
    if (msg.type === "ai") {
      const usage = usageFromMeta(metaOf(msg, "usage_metadata"));
      const model = modelFromMeta(metaOf(msg, "response_metadata"));
      const stepNumber = current.steps.length + 1;
      const cell: TrajCell = {
        kind: "assistant",
        step: stepNumber,
        text: messageText(msg.content),
        model,
        usage,
        toolBlocks: (msg.tool_calls ?? []).map((call, i) =>
          blockFromCall(call, `${msg.id ?? "ai"}-${i}-${index}`),
        ),
      };
      for (const block of cell.toolBlocks) blocksByCallId.set(block.callId, block);
      current.steps.push({ step: stepNumber, model, usage, cell });
      continue;
    }
    if (msg.type === "tool") {
      const callId = msg.tool_call_id;
      const block = callId === undefined ? undefined : blocksByCallId.get(callId);
      if (block === undefined) continue; // 孤儿结果静默丢弃（与 buildRows 一致）
      const text = messageText(msg.content);
      block.result = text;
      block.status = "done";
      if (block.isDelegation) {
        block.subTools = [{
          callId: `${block.callId}:report`,
          name: "phase_report",
          args: safeJson(text),
          result: null,
          status: "done",
          isDelegation: false,
          subTools: [],
        }];
      }
    }
  }
  return turns;
}

function safeJson(text: string | null): unknown {
  if (text === null || text === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function parseDelegationReport(block: TrajToolBlock): unknown | null {
  if (!block.isDelegation || block.result === null) return null;
  return safeJson(block.result);
}

export function cumulativeUsage(turns: TrajTurn[]): TrajUsage | null {
  let input: number | undefined;
  let output: number | undefined;
  for (const turn of turns) {
    for (const step of turn.steps) {
      if (step.usage === null) continue;
      input = (input ?? 0) + (step.usage.input ?? 0);
      output = (output ?? 0) + (step.usage.output ?? 0);
    }
  }
  if (input === undefined && output === undefined) return null;
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
  };
}

export function collapsibleTurnIds(turns: TrajTurn[]): number[] {
  return turns.filter((turn) => turn.steps.length > 1).map((turn) => turn.turn);
}
