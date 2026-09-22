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

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Sidebar(props: SidebarProps): ReactNode {
  return (
    <aside className={`sidebar${props.open ? " sidebar--open" : ""}`} aria-label="Session history">
      <div className="sidebar__head">
        <span className="sidebar__brand">Research Deep Agent</span>
        <button type="button" className="sidebar__close" onClick={props.onClose} aria-label="关闭会话列表">
          ×
        </button>
      </div>
      <button type="button" className="sidebar__new" onClick={props.onNewSession}>
        新建会话
      </button>
      <nav className="sidebar__list">
        {props.loading && props.threads.length === 0 && <p className="sidebar__empty">加载中…</p>}
        {!props.loading && props.threads.length === 0 && (
          <p className="sidebar__empty">还没有会话</p>
        )}
        {props.threads.map((thread) => (
          <button
            key={thread.threadId}
            type="button"
            className={`sidebar__item${thread.threadId === props.activeThreadId ? " sidebar__item--active" : ""}`}
            onClick={() => props.onSelect(thread.threadId)}
          >
            <span className="sidebar__item-title">{thread.title}</span>
            <span className="sidebar__item-time">{formatUpdatedAt(thread.updatedAt)}</span>
          </button>
        ))}
      </nav>
      <button type="button" className="sidebar__appearance" onClick={props.onOpenAppearance}>
        外观设置
      </button>
    </aside>
  );
}
