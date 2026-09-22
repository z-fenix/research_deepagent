import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentStream } from "./stream";

const mockStream = {
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
    </div>
  );
}

afterEach(() => {
  cleanup();
  capturedOptions = null;
  vi.clearAllMocks();
  window.history.replaceState({}, "", "http://localhost:3000/");
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
});
