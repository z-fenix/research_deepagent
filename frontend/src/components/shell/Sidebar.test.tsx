import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Sidebar, { relativeTime } from "./Sidebar";
import type { ThreadSummary } from "../../lib/threads";

afterEach(cleanup);

const noop = (): void => undefined;

function threadAt(updatedAt: string): ThreadSummary[] {
  return [{ threadId: "t1", updatedAt, title: "Quantum error correction" }];
}

function renderSidebar(threads: ThreadSummary[] = [], onDeleteSession: (id: string) => void = noop) {
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
      onDeleteSession={onDeleteSession}
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
        onDeleteSession={noop}
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
        onDeleteSession={noop}
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

describe("Sidebar session actions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderWithSession(onDeleteSession: (id: string) => void) {
    return renderSidebar([{ threadId: "t1", updatedAt: "2026-10-05T10:00:00Z", title: "Quantum error correction" }], onDeleteSession);
  }

  it("exposes per-session copy-link and delete actions", () => {
    renderWithSession(noop);
    expect(screen.getByRole("button", { name: "Copy session link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete session" })).toBeTruthy();
  });

  it("copies the session URL to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderWithSession(noop);
    fireEvent.click(screen.getByRole("button", { name: "Copy session link" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const url = writeText.mock.calls[0]![0] as string;
    expect(url).toContain("thread=t1");
  });

  it("delegates deletion to onDeleteSession with the thread id", () => {
    const onDeleteSession = vi.fn();
    renderWithSession(onDeleteSession);
    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
    expect(onDeleteSession).toHaveBeenCalledWith("t1");
  });
});
