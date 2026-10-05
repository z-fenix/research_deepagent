import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Sidebar, { relativeTime } from "./Sidebar";
import type { ThreadSummary } from "../../lib/threads";

afterEach(cleanup);

const noop = (): void => undefined;

function threadAt(updatedAt: string): ThreadSummary[] {
  return [{ threadId: "t1", updatedAt, title: "Quantum error correction" }];
}

function renderSidebar(threads: ThreadSummary[] = []) {
  return render(
    <Sidebar
      open
      onClose={noop}
      threads={threads}
      loading={false}
      activeThreadId="t1"
      onSelect={noop}
      onNewSession={noop}
      onOpenAppearance={noop}
    />,
  );
}

describe("Sidebar", () => {
  it("renders brand row with AGENT tag", () => {
    renderSidebar();
    expect(screen.getByText("AGENT")).toBeTruthy();
  });

  it("renders a full-width New Session button", () => {
    const onNewSession = vi.fn();
    render(
      <Sidebar
        open
        onClose={noop}
        threads={[]}
        loading={false}
        onSelect={noop}
        onNewSession={onNewSession}
        onOpenAppearance={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /new session/i })).toBeTruthy();
  });

  it("renders the Workspaces section header", () => {
    renderSidebar();
    expect(screen.getByText("Workspaces")).toBeTruthy();
  });

  it("pins the footer with local-user and the appearance button", () => {
    const onOpenAppearance = vi.fn();
    render(
      <Sidebar
        open
        onClose={noop}
        threads={[]}
        loading={false}
        onSelect={noop}
        onNewSession={noop}
        onOpenAppearance={onOpenAppearance}
      />,
    );
    expect(screen.getByText("local-user")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /appearance/i }));
    expect(onOpenAppearance).toHaveBeenCalledTimes(1);
  });

  it("shows relative time badges in the session list", () => {
    const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    renderSidebar(threadAt(tenHoursAgo));
    expect(screen.getByText("10h")).toBeTruthy();
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats <60s as now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    expect(relativeTime("2026-10-05T11:59:50Z")).toBe("now");
  });

  it("formats <60m as Xm", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    expect(relativeTime("2026-10-05T11:31:00Z")).toBe("29m");
  });

  it("formats <24h as Xh", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    expect(relativeTime("2026-10-05T02:00:00Z")).toBe("10h");
  });

  it("formats >=24h as Xd", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    expect(relativeTime("2026-10-01T12:00:00Z")).toBe("4d");
  });
});
