import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractPendingApproval, useAgentStream } from "./stream";

const gateInterruptValue = {
  action_requests: [
    { name: "request_phase_approval", args: { phase: "prd", summary: "3 条需求" } },
  ],
  review_configs: [{ action_name: "request_phase_approval", allowed_decisions: ["respond"] }],
};

const mockStream: {
  messages: Array<Record<string, unknown>>;
  values: { todos?: Array<{ content: string; status: string }> };
  isLoading: boolean;
  error: null;
  submit: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  interrupt?: { value: unknown };
} = {
  messages: [
    { id: "h1", type: "human", content: "Research IBM" },
    {
      id: "a1",
      type: "ai",
      content: "",
      tool_calls: [{ id: "c1", name: "task", args: {} }],
    },
    { id: "t1", type: "tool", tool_call_id: "c1", content: "IBM summary" },
  ],
  values: { todos: [{ content: "Step", status: "in_progress" }] },
  isLoading: true,
  error: null,
  submit: vi.fn(),
  stop: vi.fn(),
};
let capturedOptions: Record<string, unknown> | null = null;

vi.mock("@langchain/react", () => ({
  useStream: (options: Record<string, unknown>) => {
    capturedOptions = options;
    return mockStream;
  },
}));

function Probe() {
  const stream = useAgentStream();
  return (
    <div>
      <span>{stream.threadId ?? "no-thread"}</span>
      <span>{stream.rows.length}</span>
      <span>{stream.todos.length}</span>
      <button onClick={() => stream.submit("hi")}>submit</button>
      <button onClick={() => stream.stop()}>stop</button>
      <button onClick={() => stream.openThread("t-2")}>open</button>
      <button onClick={() => stream.openThread(undefined)}>new</button>
      <span>{stream.sessionUrl ?? "no-url"}</span>
      <span data-testid="pending">
        {stream.pendingApproval
          ? `pending:${stream.pendingApproval.actionRequests.length}`
          : "none"}
      </span>
      <button onClick={() => void stream.submitApproval([{ type: "approve" }])}>approve</button>
      <span>{stream.approvalError ? "approval-error" : "no-approval-error"}</span>
    </div>
  );
}

afterEach(() => {
  cleanup();
  capturedOptions = null;
  vi.clearAllMocks();
  window.history.replaceState({}, "", "http://localhost:3000/");
  mockStream.submit = vi.fn();
});

describe("useAgentStream", () => {
  it("exposes rows and todos built from stream state", () => {
    render(<Probe />);
    expect(screen.getByText("2")).toBeTruthy(); // rows: human prose + card
    expect(screen.getByText("1")).toBeTruthy(); // todos
  });

  it("submits trimmed human messages through useStream", () => {
    render(<Probe />);
    act(() => { screen.getByText("submit").click(); });
    expect(mockStream.submit).toHaveBeenCalledWith({
      messages: [{ type: "human", content: "hi" }],
    });
  });

  it("routes stop() to useStream", () => {
    render(<Probe />);
    act(() => { screen.getByText("stop").click(); });
    expect(mockStream.stop).toHaveBeenCalled();
  });

  it("openThread writes ?thread= into the URL; undefined clears it", () => {
    render(<Probe />);
    act(() => { screen.getByText("open").click(); });
    expect(window.location.search).toBe("?thread=t-2");
    act(() => { screen.getByText("new").click(); });
    expect(window.location.search).toBe("");
  });

  it("passes the initial thread from the URL to useStream", () => {
    window.history.replaceState({}, "", "http://localhost:3000/?thread=t-9");
    render(<Probe />);
    expect(capturedOptions?.threadId).toBe("t-9");
    expect(screen.getByText("t-9")).toBeTruthy();
  });

  it("notifies useStream of created thread ids and syncs the URL", () => {
    render(<Probe />);
    act(() => {
      (capturedOptions?.onThreadId as ((id: string) => void) | undefined)?.("t-123");
    });
    expect(window.location.search).toBe("?thread=t-123");
    expect(screen.getByText("t-123")).toBeTruthy();
    expect(screen.getByText("http://localhost:3000/?thread=t-123")).toBeTruthy();
  });

  it("exposes no pending approval when the stream is not interrupted", () => {
    render(<Probe />);
    expect(screen.getByTestId("pending").textContent).toBe("none");
  });

  it("extracts a pending approval from the interrupt value", () => {
    mockStream.interrupt = { value: gateInterruptValue };
    try {
      render(<Probe />);
      expect(screen.getByTestId("pending").textContent).toBe("pending:1");
    } finally {
      delete mockStream.interrupt;
    }
  });

  it("submits the resume command on the same thread", () => {
    render(<Probe />);
    act(() => {
      screen.getByText("approve").click();
    });
    expect(mockStream.submit).toHaveBeenCalledWith(null, {
      command: { resume: { decisions: [{ type: "approve" }] } },
      onError: expect.any(Function),
    });
  });

  it("surfaces resume submission failures instead of swallowing them", async () => {
    mockStream.submit = vi.fn((_values, options) => {
      (options as { onError: (e: unknown) => void }).onError(new Error("command rejected"));
      return Promise.resolve();
    });
    try {
      render(<Probe />);
      await act(async () => {
        screen.getByText("approve").click();
      });
      expect(screen.getByText("approval-error")).toBeTruthy();
    } finally {
      mockStream.submit = vi.fn();
    }
  });
});

describe("extractPendingApproval", () => {
  it("parses the backend interrupt payload (snake_case)", () => {
    const pending = extractPendingApproval(gateInterruptValue);
    expect(pending).not.toBeNull();
    expect(pending!.actionRequests[0].name).toBe("request_phase_approval");
    expect(pending!.actionRequests[0].args).toEqual({ phase: "prd", summary: "3 条需求" });
    expect(pending!.reviewConfigs[0].allowed_decisions).toEqual(["respond"]);
  });

  it("accepts camelCase aliases", () => {
    const pending = extractPendingApproval({
      actionRequests: [{ name: "delete", args: {} }],
      reviewConfigs: [{ action_name: "delete", allowedDecisions: ["approve", "reject"] }],
    });
    expect(pending).not.toBeNull();
    expect(pending!.reviewConfigs[0].allowed_decisions).toEqual(["approve", "reject"]);
  });

  it("returns null for non-interrupt values", () => {
    expect(extractPendingApproval(undefined)).toBeNull();
    expect(extractPendingApproval(null)).toBeNull();
    expect(extractPendingApproval("oops")).toBeNull();
    expect(extractPendingApproval({ messages: [] })).toBeNull();
  });
});
