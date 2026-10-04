import { useStream } from "@langchain/react";
import { useCallback, useMemo, useState } from "react";
import { buildRows, type Message, type Row } from "./messages";

export type TodoStatus = "pending" | "in_progress" | "completed";
export type TodoItem = { content: string; status: TodoStatus };

/** 单条审批请求：interrupt value 的 action_requests 元素。 */
export type ActionRequest = {
  name: string;
  args?: Record<string, unknown>;
  description?: string;
};

/** 单条评审配置：interrupt value 的 review_configs 元素。 */
export type ReviewConfig = {
  action_name: string;
  allowed_decisions: string[];
};

/** 待决审批：与后端 HITL 中断 value 对齐（决策数组按 actionRequests 顺序提交）。 */
export type PendingApproval = {
  actionRequests: ActionRequest[];
  reviewConfigs: ReviewConfig[];
};

/** 恢复决策：respond=门禁回复 / approve=敏感工具放行 / reject=敏感工具拒绝。 */
export type ApprovalDecision =
  | { type: "respond"; message: string }
  | { type: "approve" }
  | { type: "reject"; message: string };

/**
 * 从 HITL 中断 value 提取待决审批。
 *
 * 后端（deepagents HumanInTheLoopMiddleware）产生 snake_case
 * `{action_requests, review_configs}`；LangGraph SDK 读侧会补 camelCase
 * 别名——两种键名都接受。非中断值返回 null。
 */
export function extractPendingApproval(interruptValue: unknown): PendingApproval | null {
  if (interruptValue === null || typeof interruptValue !== "object" || Array.isArray(interruptValue)) {
    return null;
  }
  const raw = interruptValue as Record<string, unknown>;
  const requests = raw.actionRequests ?? raw.action_requests;
  const configs = raw.reviewConfigs ?? raw.review_configs;
  if (!Array.isArray(requests)) return null;

  const actionRequests: ActionRequest[] = [];
  for (const item of requests) {
    if (item === null || typeof item !== "object") continue;
    const request = item as Record<string, unknown>;
    if (typeof request.name !== "string") continue;
    actionRequests.push({
      name: request.name,
      args:
        request.args !== null && typeof request.args === "object"
          ? (request.args as Record<string, unknown>)
          : undefined,
      description: typeof request.description === "string" ? request.description : undefined,
    });
  }
  if (actionRequests.length === 0) return null;

  const reviewConfigs: ReviewConfig[] = [];
  if (Array.isArray(configs)) {
    for (const item of configs) {
      if (item === null || typeof item !== "object") continue;
      const config = item as Record<string, unknown>;
      const decisions = config.allowedDecisions ?? config.allowed_decisions;
      reviewConfigs.push({
        action_name:
          typeof config.actionName === "string"
            ? config.actionName
            : typeof config.action_name === "string"
              ? config.action_name
              : "",
        allowed_decisions: Array.isArray(decisions)
          ? decisions.filter((d): d is string => typeof d === "string")
          : [],
      });
    }
  }
  return { actionRequests, reviewConfigs };
}

export const API_URL =
  (import.meta.env.VITE_LANGGRAPH_API_URL as string | undefined) ?? "http://127.0.0.1:2024";

type StreamState = { messages: Message[]; todos?: TodoItem[] };

export function syncThreadUrl(threadId: string | undefined): void {
  const url = new URL(window.location.href);
  if (threadId) url.searchParams.set("thread", threadId);
  else url.searchParams.delete("thread");
  window.history.replaceState({}, "", url);
}

export function sessionLink(threadId: string | undefined): string | null {
  if (!threadId) return null;
  const url = new URL(window.location.href);
  url.searchParams.set("thread", threadId);
  return url.toString();
}

export type AgentStream = {
  rows: Row[];
  todos: TodoItem[];
  isLoading: boolean;
  error: unknown;
  pendingApproval: PendingApproval | null;
  approvalError: unknown;
  submit: (text: string) => void;
  submitApproval: (decisions: ApprovalDecision[]) => Promise<void>;
  stop: () => void;
  threadId: string | undefined;
  openThread: (threadId: string | undefined) => void;
  sessionUrl: string | null;
};

export function useAgentStream(): AgentStream {
  const [threadId, setThreadId] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get("thread") ?? undefined,
  );
  const [approvalError, setApprovalError] = useState<unknown>(null);

  const stream = useStream<StreamState>({
    apiUrl: API_URL,
    assistantId: "research",
    threadId,
    onThreadId: (id) => {
      setThreadId(id);
      syncThreadUrl(id);
    },
  });

  const openThread = useCallback((id: string | undefined) => {
    setThreadId(id);
    syncThreadUrl(id);
  }, []);

  const rows = useMemo(() => buildRows(stream.messages as Message[]), [stream.messages]);
  const todos = Array.isArray(stream.values?.todos) ? stream.values.todos : [];
  const pendingApproval = extractPendingApproval(stream.interrupt?.value);

  const submitApproval = useCallback(
    async (decisions: ApprovalDecision[]) => {
      setApprovalError(null);
      // 恢复走既有 run 通道：同一 thread_id 提交 Command(resume={"decisions": ...})。
      // 失败（如通道拒绝 Command）经 onError/异常落入 approvalError，不得静默吞错。
      try {
        await stream.submit(null, {
          command: { resume: { decisions } },
          onError: (error) => {
            setApprovalError(error);
          },
        });
      } catch (error) {
        setApprovalError(error);
      }
    },
    [stream],
  );

  return {
    rows,
    todos,
    isLoading: stream.isLoading,
    error: stream.error,
    pendingApproval,
    approvalError,
    submit: (text) => {
      void stream.submit({ messages: [{ type: "human", content: text }] });
    },
    submitApproval,
    stop: () => {
      void stream.stop();
    },
    threadId,
    openThread,
    sessionUrl: sessionLink(threadId),
  };
}
