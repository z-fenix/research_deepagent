import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThreads } from "./threads";

beforeEach(() => {
  search.mockClear();
  remove.mockClear();
});

afterEach(() => {
  cleanup();
});

const search = vi.fn();
const remove = vi.fn();

vi.mock("@langchain/langgraph-sdk", () => ({
  Client: vi.fn(function () {
    return { threads: { search, delete: remove } };
  }),
}));

function listFixture() {
  return [
    {
      thread_id: "aaaaaaaa-1111",
      updated_at: "2026-09-22T10:00:00Z",
      created_at: "2026-09-22T09:00:00Z",
      values: { messages: [{ type: "human", content: "研究 IBM 的 LangGraph 工作" }] },
    },
    {
      thread_id: "bbbbbbbb-2222",
      updated_at: "2026-09-21T10:00:00Z",
      created_at: "2026-09-21T09:00:00Z",
      values: {},
    },
  ];
}

function Probe({ withRemove = false }: { withRemove?: boolean }) {
  const { threads, loading, refresh, removeThread } = useThreads("http://x");
  return (
    <div>
      <span>{loading ? "loading" : "idle"}</span>
      {threads.map((t) => (
        <span key={t.threadId}>{t.title}</span>
      ))}
      <button onClick={refresh}>refresh</button>
      {withRemove && (
        <button onClick={() => void removeThread("aaaaaaaa-1111")}>remove</button>
      )}
    </div>
  );
}

describe("useThreads", () => {
  it("loads thread summaries with human-message titles and id fallbacks", async () => {
    search.mockResolvedValue(listFixture());
    render(<Probe />);
    await waitFor(() => expect(screen.getByText("idle")).toBeTruthy());
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, sortOrder: "desc" }),
    );
    expect(screen.getByText("研究 IBM 的 LangGraph 工作")).toBeTruthy();
    expect(screen.getByText("会话 bbbbbbbb")).toBeTruthy();
  });

  it("refresh re-queries the server", async () => {
    search.mockResolvedValue([]);
    render(<Probe />);
    await waitFor(() => expect(screen.getByText("idle")).toBeTruthy());
    act(() => { screen.getByText("refresh").click(); });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
  });

  it("removeThread deletes via the SDK then refreshes the list", async () => {
    remove.mockResolvedValue(undefined);
    search.mockResolvedValue(listFixture());
    render(<Probe withRemove />);
    await waitFor(() => expect(screen.getByText("idle")).toBeTruthy());
    expect(search).toHaveBeenCalledTimes(1);
    act(() => { screen.getByText("remove").click(); });
    await waitFor(() => expect(remove).toHaveBeenCalledWith("aaaaaaaa-1111"));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
  });
});
