import { useState, type ReactNode } from "react";
import type { ThreadSummary } from "../../lib/threads";
import { sessionLink } from "../../lib/stream";

type SidebarProps = {
  open: boolean;
  onClose: () => void;
  threads: ThreadSummary[];
  loading: boolean;
  activeThreadId?: string;
  onSelect: (threadId: string) => void;
  onNewSession: () => void;
  onOpenAppearance: () => void;
  /** 删除确认与 SDK 调用由 App 负责；Sidebar 只上报 threadId。 */
  onDeleteSession: (threadId: string) => void;
};

/** 相对时间：<60s "now"、<60m "Xm"、<24h "Xh"、否则 "Xd"。 */
export function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const WORKSPACE_ICONS = ["⌕", "▤", "⊞"] as const;

/** 单条会话行：主按钮（选中）+ 悬停/聚焦浮现的操作列（复制链接 / 删除）。 */
function SessionItem(props: {
  thread: ThreadSummary;
  active: boolean;
  copied: boolean;
  onSelect: (threadId: string) => void;
  onCopy: (threadId: string) => void;
  onDelete: (threadId: string) => void;
}): ReactNode {
  const { thread } = props;
  return (
    <div className={`sidebar__item${props.active ? " sidebar__item--active" : ""}`}>
      <button
        type="button"
        className="sidebar__item-main"
        onClick={() => props.onSelect(thread.threadId)}
      >
        <span className="sidebar__item-title">{thread.title}</span>
        <span className="sidebar__item-time">{relativeTime(thread.updatedAt)}</span>
      </button>
      <span className="sidebar__item-actions">
        <button
          type="button"
          className="sidebar__item-action"
          aria-label="Copy session link"
          title={props.copied ? "Copied" : "Copy session link"}
          onClick={() => props.onCopy(thread.threadId)}
        >
          {props.copied ? "✓" : "🔗"}
        </button>
        <button
          type="button"
          className="sidebar__item-action"
          aria-label="Delete session"
          title="Delete session"
          onClick={() => props.onDelete(thread.threadId)}
        >
          🗑
        </button>
      </span>
    </div>
  );
}

export default function Sidebar(props: SidebarProps): ReactNode {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copySession(threadId: string) {
    const url = sessionLink(threadId);
    if (url === null) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(threadId);
      setTimeout(() => setCopiedId((current) => (current === threadId ? null : current)), 1500);
    } catch {
      /* clipboard unavailable — keep the row usable */
    }
  }

  return (
    <aside className={`sidebar${props.open ? " sidebar--open" : ""}`} aria-label="Session history">
      <div className="sidebar__brand-row">
        <span className="sidebar__brand">Research Deep Agent</span>
        <span className="sidebar__brand-tag">AGENT</span>
        <button type="button" className="sidebar__close" onClick={props.onClose} aria-label="Close session list">
          ×
        </button>
      </div>
      <button type="button" className="sidebar__new" onClick={props.onNewSession}>
        ⊕ New Session
      </button>
      <div className="sidebar__section">
        <span className="sidebar__section-title">Workspaces</span>
        <span className="sidebar__section-icons" aria-hidden="true">
          {WORKSPACE_ICONS.map((icon) => (
            <button key={icon} type="button" className="sidebar__section-icon" disabled>
              {icon}
            </button>
          ))}
        </span>
      </div>
      <nav className="sidebar__list">
        {props.loading && props.threads.length === 0 && <p className="sidebar__empty">Loading…</p>}
        {!props.loading && props.threads.length === 0 && (
          <p className="sidebar__empty">No sessions yet</p>
        )}
        {props.threads.map((thread) => (
          <SessionItem
            key={thread.threadId}
            thread={thread}
            active={thread.threadId === props.activeThreadId}
            copied={copiedId === thread.threadId}
            onSelect={props.onSelect}
            onCopy={(id) => void copySession(id)}
            onDelete={props.onDeleteSession}
          />
        ))}
      </nav>
      <div className="sidebar__footer">
        <span className="sidebar__avatar" aria-hidden="true">
          L
        </span>
        <span className="sidebar__footer-name">local-user</span>
        <button type="button" className="sidebar__appearance" onClick={props.onOpenAppearance}>
          Appearance
        </button>
      </div>
    </aside>
  );
}
