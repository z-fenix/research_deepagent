
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { RIGHTBAR_DEFAULT_RATIO } from "./layout/useFrameLayout";

const streamState: {
  values: { todos?: Array<{ content: string; status: "completed" | "in_progress" | "pending" }> };
  messages: Array<Record<string, unknown>>;
  isLoading: boolean;
  error: null;
  interrupt: { value: unknown } | null;
  submit: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} = {
  values: {
    todos: [
      { content: "Plan the report sections", status: "completed" },
      { content: "Research LangGraph 1.0 changes", status: "in_progress" },
      { content: "Write final summary", status: "pending" },
    ],
  },
  messages: [
    { id: "human-1", type: "human", content: "Research IBM" },
    {
      id: "ai-1",
      type: "ai",
      content: "",
      tool_calls: [
        {
          id: "call-1",
          name: "task",
          args: {
            description: "Research IBM's LangGraph work",
            subagent_type: "research-agent",
          },
        },
      ],
    },
    {
      id: "tool-1",
      type: "tool",
      tool_call_id: "call-1",
      content: "IBM summary",
    },
    {
      id: "ai-2",
      type: "ai",
      content: "IBM published a LangGraph guide.",
    },
  ],
  isLoading: false,
  error: null,
  interrupt: null,
  submit: vi.fn(),
  stop: vi.fn(),
};

/** HITL 中断样例（lib/stream.ts PendingApproval 形态，snake_case 由 extractPendingApproval 归一）。 */
const samplePendingApproval = {
  actionRequests: [
    { name: "request_phase_approval", args: { phase: "prd", summary: "x" } },
  ],
  reviewConfigs: [
    { action_name: "request_phase_approval", allowed_decisions: ["respond"] },
  ],
};

/** 右栏默认打开（可带初始面板）：jsdom 视口 1024，轨道存在时 PanelHost 才挂载。 */
function seedRightbar(panel: "subagents" | "workbench" | null): void {
  localStorage.setItem("harness.rightbar", "600");
  if (panel !== null) localStorage.setItem("harness.panel", panel);
}

let capturedStreamOptions: Record<string, unknown> | null = null;

vi.mock("@langchain/react", () => ({
  useStream: (options: Record<string, unknown>) => {
    capturedStreamOptions = options;
    return streamState;
  },
}));

vi.mock("@langchain/langgraph-sdk", () => ({
  Client: vi.fn(function () {
    return { threads: { search: vi.fn().mockResolvedValue([]) } };
  }),
}));

afterEach(() => {
  cleanup();
  capturedStreamOptions = null;
  window.history.replaceState({}, "", "http://localhost:3000/");
  streamState.isLoading = false;
  streamState.interrupt = null;
  localStorage.removeItem("harness.panel");
  localStorage.removeItem("harness.rightbar");
  localStorage.removeItem("harness.sidebar");
  streamState.values = {
    todos: [
      { content: "Plan the report sections", status: "completed" },
      { content: "Research LangGraph 1.0 changes", status: "in_progress" },
      { content: "Write final summary", status: "pending" },
    ],
  };
  streamState.messages = [
    { id: "human-1", type: "human", content: "Research IBM" },
    {
      id: "ai-1",
      type: "ai",
      content: "",
      tool_calls: [
        {
          id: "call-1",
          name: "task",
          args: {
            description: "Research IBM's LangGraph work",
            subagent_type: "research-agent",
          },
        },
      ],
    },
    {
      id: "tool-1",
      type: "tool",
      tool_call_id: "call-1",
      content: "IBM summary",
    },
    {
      id: "ai-2",
      type: "ai",
      content: "IBM published a LangGraph guide.",
    },
  ];
});

describe("App", () => {
  it("shows the new-session hint before any thread exists", () => {
    render(<App />);
    expect(screen.getByText("新会话 · 发送首条消息后生成链接")).toBeTruthy();
  });

  it("renders a collapsible todo dock with progress summary", () => {
    // TodoDock 现居右栏 Workbench 面板：先打开右栏并激活该面板（语义不变，仅入口变化）
    seedRightbar("workbench");
    render(<App />);

    const summary = screen.getByText("Research plan");
    expect(summary).toBeTruthy();
    expect(screen.getByText("1/3 · 33%")).toBeTruthy();
    expect(screen.queryByText("Plan the report sections")).toBeNull();

    fireEvent.click(summary);
    expect(screen.getByText("Plan the report sections")).toBeTruthy();
    expect(screen.getByText("Research LangGraph 1.0 changes")).toBeTruthy();
    expect(screen.getByText("Write final summary")).toBeTruthy();
  });

  it("renders sub-agent cards from streamed task tool calls", () => {
    render(<App />);

    expect(screen.getByText("Sub-agent: research-agent")).toBeTruthy();
    expect(screen.getByText("IBM summary")).toBeTruthy();
    expect(screen.getByText("IBM published a LangGraph guide.")).toBeTruthy();
  });

  it("renders planning-shaped mixed ai content as a collapsed AI plan block", () => {
    streamState.messages = [
      { id: "human-1", type: "human", content: "Research IBM" },
      {
        id: "ai-1",
        type: "ai",
        content:
          "## SESSION INTENT\nCompare LangGraph 1.0 and 0.x.\n\n## SUMMARY\nThe user requested a specific multi-step workflow.",
        tool_calls: [
          {
            id: "call-1",
            name: "task",
            args: {
              description: "Research IBM's LangGraph work",
              subagent_type: "research-agent",
            },
          },
        ],
      },
      {
        id: "tool-1",
        type: "tool",
        tool_call_id: "call-1",
        content: "IBM summary",
      },
    ];

    render(<App />);

    expect(screen.getByText("AI plan")).toBeTruthy();
    expect(screen.getByText("SESSION INTENT")).toBeTruthy();
    expect(screen.getByText("AI plan").closest("details")?.hasAttribute("open")).toBe(false);
    expect(screen.getByText("Sub-agent: research-agent")).toBeTruthy();
    expect(screen.getByText("IBM summary")).toBeTruthy();
  });

  it("renders a standalone planning message as a collapsed AI plan block", () => {
    streamState.messages = [
      { id: "human-1", type: "human", content: "Research IBM" },
      {
        id: "ai-1",
        type: "ai",
        content:
          "## SESSION INTENT\nCompare LangGraph 1.0 and 0.x.\n\n## SUMMARY\nThe user requested a specific multi-step workflow.",
      },
      {
        id: "ai-2",
        type: "ai",
        content: "Final answer after planning.",
      },
    ];

    render(<App />);

    expect(screen.getByText("AI plan")).toBeTruthy();
    expect(screen.getByText("SESSION INTENT")).toBeTruthy();
    expect(screen.getByText("Final answer after planning.")).toBeTruthy();
  });

  it("renders substantive mixed ai content as a normal assistant answer", () => {
    streamState.messages = [
      { id: "human-1", type: "human", content: "Research IBM" },
      {
        id: "ai-1",
        type: "ai",
        content:
          "- **Answer point one:** LangGraph 1.0 adds a functional API.\n- **Answer point two:** LangGraph 1.0 improves deployment tooling.",
        tool_calls: [
          {
            id: "call-1",
            name: "write_todos",
            args: {
              todos: [{ content: "Wrap up", status: "completed" }],
            },
          },
        ],
      },
      {
        id: "tool-1",
        type: "tool",
        tool_call_id: "call-1",
        content: "Updated todo list",
      },
    ];

    render(<App />);

    expect(screen.queryByText("AI plan")).toBeNull();
    expect(screen.getByText("Answer point one:")).toBeTruthy();
    expect(screen.getByText("Tool: write_todos")).toBeTruthy();
    expect(screen.getByText("Updated todo list")).toBeTruthy();
  });

  it("renders an activity card while research is in progress", () => {
    streamState.isLoading = true;

    render(<App />);

    expect(screen.getByText("Research in progress")).toBeTruthy();
    expect(screen.getByText("Waiting for sub-agent results and final synthesis.")).toBeTruthy();
  });

  it("writes the created thread id into the URL and shows the session link", () => {
    render(<App />);

    act(() => {
      (capturedStreamOptions?.onThreadId as ((id: string) => void) | undefined)?.("thread-123");
    });

    expect(window.location.search).toBe("?thread=thread-123");
    expect(screen.getByText("http://localhost:3000/?thread=thread-123")).toBeTruthy();
    expect(screen.getByText("复制会话链接")).toBeTruthy();
  });

  it("skips the todo panel when the backend has not emitted todos yet", () => {
    streamState.values = {};

    render(<App />);

    expect(screen.queryByText("Research plan")).toBeNull();
    expect(screen.getByText("Sub-agent: research-agent")).toBeTruthy();
  });

  it("renders the three-column frame with panel tabs in the right bar", () => {
    seedRightbar(null);
    render(<App />);

    expect(document.querySelector('[data-testid="frame"]')).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sub-agents" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Workbench" })).toBeTruthy();
  });

  it("moves Trajectory into center Chat|Trajectory tabs, keeping chat state (Review Focus 2)", () => {
    render(<App />);

    const chatTab = screen.getByRole("tab", { name: "Chat" });
    const trajectoryTab = screen.getByRole("tab", { name: "Trajectory" });
    // 默认 Chat 激活，Trajectory 内容不可见
    expect(chatTab.getAttribute("aria-selected")).toBe("true");
    expect(trajectoryTab.getAttribute("aria-selected")).toBe("false");
    expect(screen.queryByRole("button", { name: /Duration/ })).toBeNull();
    expect(screen.getByText("IBM published a LangGraph guide.")).toBeTruthy();

    // 点 Trajectory → TrajectoryView 出现（Duration 开关钮为其标志）
    fireEvent.click(trajectoryTab);
    expect(trajectoryTab.getAttribute("aria-selected")).toBe("true");
    expect(chatTab.getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("button", { name: /Duration/ })).toBeTruthy();
    // 右栏只剩 Sub-agents / Workbench 两 tab（Trajectory 面板已移除）
    const rightbarTabs = within(
      document.querySelector(".panel-host") as HTMLElement,
    ).getAllByRole("tab");
    expect(rightbarTabs.map((tab) => tab.textContent)).toEqual(["Sub-agents", "Workbench"]);

    // 切回 Chat：消息列表还在（流状态未因 tab 切换丢失）
    fireEvent.click(chatTab);
    expect(screen.getByText("IBM published a LangGraph guide.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Duration/ })).toBeNull();
  });

  it("keeps composer approval-disabled across center tab switches (Review Focus 2)", () => {
    streamState.interrupt = { value: samplePendingApproval };
    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: "Trajectory" }));
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /send/i })).toHaveProperty("disabled", true);
  });

  it("keeps the approval contract: pending approval disables the composer (Review Focus 5)", () => {
    seedRightbar(null);
    streamState.interrupt = { value: samplePendingApproval };
    render(<App />);

    // 审批未决：composer 输入与提交按钮均禁用
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    const submitBtn = screen.getByRole("button", { name: /send/i });
    expect(submitBtn).toHaveProperty("disabled", true);

    // 审批卡在 Workbench 面板内可用（切到 Workbench tab 后可见）
    fireEvent.click(screen.getByRole("tab", { name: "Workbench" }));
    expect(screen.getByTestId("approval-dock")).toBeTruthy();
  });

  it("routes sidebar drags through the press-frozen baseline into the persisted pref", () => {
    render(<App />);

    const handle = document.querySelector('[data-testid="drag-sidebar"]') as HTMLElement;
    expect(handle).toBeTruthy();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(handle, { button: 0, pointerId: 1, clientX: 110 });
    fireEvent.pointerUp(handle, { button: 0, pointerId: 1, clientX: 110 });

    // 按下时侧栏 280（SIDEBAR_DEFAULT），累计 dx=+10 → 290（基线冻结，不复利）
    expect(localStorage.getItem("harness.sidebar")).toBe("290");
  });

  it("opens the collapsed rightbar affordance with the default 0.45 ratio on fresh installs (C1a)", () => {
    // fresh install：无 harness.rightbar 键 → 轨道关闭、右栏呈 affordance rail
    render(<App />);

    const frame = document.querySelector('[data-testid="frame"]') as HTMLElement;
    expect(frame.hasAttribute("data-rightbar-collapsed")).toBe(true);
    // PanelHost 不被卸载：rail 里的 tab 可点
    fireEvent.click(screen.getByRole("tab", { name: "Sub-agents" }));

    expect(frame.hasAttribute("data-rightbar-collapsed")).toBe(false);
    expect(localStorage.getItem("harness.rightbar")).toBe(
      String(window.innerWidth * RIGHTBAR_DEFAULT_RATIO),
    );
  });

  it("restores the persisted rightbar width when reopening from the affordance (C1b)", () => {
    seedRightbar("workbench");
    localStorage.setItem("harness.rightbar", "600");
    render(<App />);

    // 收起：点击当前激活 tab → closeRightbar（轨道关闭，呈 affordance）
    fireEvent.click(screen.getByRole("tab", { name: "Workbench" }));
    const frame = document.querySelector('[data-testid="frame"]') as HTMLElement;
    expect(frame.hasAttribute("data-rightbar-collapsed")).toBe(true);

    // 经 affordance 重开：恢复仍驻留内存的持久化宽度（600），而非 0.45 默认
    fireEvent.click(screen.getByRole("tab", { name: "Workbench" }));
    expect(frame.hasAttribute("data-rightbar-collapsed")).toBe(false);
    expect(localStorage.getItem("harness.rightbar")).toBe("600");
  });
});

