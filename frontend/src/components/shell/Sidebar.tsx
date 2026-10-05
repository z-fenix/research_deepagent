import type { ReactNode } from "react";
import type { ThreadSummary } from "../../lib/threads";

type SidebarProps = {
  open: boolean;
  onClose: () => void;
  threads: ThreadSummary[];
  loading: boolean;
  activeThreadId?: string;
  onSelect: (threadId: string) => void;
  onNewSession: () => void;
  onOpenAppearance: () => void;
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

export default function Sidebar(props: SidebarProps): ReactNode {
  return (
    <aside className={`sidebar${props.open ? " sidebar--open" : ""}`} aria-label="Session history">
      <div className="sidebar__brand-row">
        <span className="sidebar__brand">Research Deep Agent</span>
        <span className="sidebar__brand-tag">AGENT</span>
        <button type="button" className="sidebar__close" onClick={props.onClose} aria-label="关闭会话列表">
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
          <button
            key={thread.threadId}
            type="button"
            className={`sidebar__item${thread.threadId === props.activeThreadId ? " sidebar__item--active" : ""}`}
            onClick={() => props.onSelect(thread.threadId)}
          >
            <span className="sidebar__item-title">{thread.title}</span>
            <span className="sidebar__item-time">{relativeTime(thread.updatedAt)}</span>
          </button>
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
