import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMessageTimestamps } from "./timestamps";

describe("useMessageTimestamps", () => {
  it("records first-seen time per message id and keeps it on updates", () => {
    const { rerender, result } = renderHook(({ msgs }: { msgs: unknown[] }) => useMessageTimestamps(msgs), {
      initialProps: { msgs: [{ id: "a1" }] },
    });
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

  it("skips messages without ids", () => {
    const { result } = renderHook(() => useMessageTimestamps([{ content: "no id" }]));
    expect(result.current.size).toBe(0);
  });
});
