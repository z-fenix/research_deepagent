import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMessageTimestamps } from "./timestamps";

// 本仓库未开启 vitest globals，RTL 的自动 cleanup 不会注册，需显式清理
afterEach(() => {
  cleanup();
});

describe("useMessageTimestamps", () => {
  it("stamps messages that arrive after mount and keeps their first-seen time", () => {
    // 首个 effect run（挂载批次）视作历史回放，不盖章（M3）；后续到达才捕获。
    const { rerender, result } = renderHook(({ msgs }: { msgs: unknown[] }) => useMessageTimestamps(msgs), {
      initialProps: { msgs: [] as unknown[] },
    });
    rerender({ msgs: [{ id: "a1" }] });
    const first = result.current.get("a1");
    expect(typeof first).toBe("number");
    act(() => {
      vi.useFakeTimers();
      vi.setSystemTime((first as number) + 5_000);
    });
    rerender({ msgs: [{ id: "a1" }, { id: "a2" }] });
    expect(result.current.get("a1")).toBe(first); // 不刷新
    expect((result.current.get("a2") as number) - (first as number)).toBe(5_000);
    vi.useRealTimers();
  });

  it("does not stamp the mount-time batch (history replay, M3)", () => {
    const { rerender, result } = renderHook(({ msgs }: { msgs: unknown[] }) => useMessageTimestamps(msgs), {
      initialProps: { msgs: [{ id: "old-1" }, { id: "old-2" }] },
    });
    expect(result.current.size).toBe(0);
    // 后续到达的新消息仍被捕获
    rerender({ msgs: [{ id: "old-1" }, { id: "old-2" }, { id: "live-1" }] });
    expect(result.current.has("live-1")).toBe(true);
    expect(result.current.has("old-1")).toBe(false);
  });

  it("skips messages without ids", () => {
    const { result } = renderHook(() => useMessageTimestamps([{ content: "no id" }]));
    expect(result.current.size).toBe(0);
  });
});
