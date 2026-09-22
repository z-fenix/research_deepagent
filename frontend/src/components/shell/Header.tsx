import { useState, type ReactNode } from "react";

export default function Header({ sessionUrl }: { sessionUrl: string | null }): ReactNode {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!sessionUrl) return;
    try {
      await navigator.clipboard.writeText(sessionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the URL stays visible for manual copy */
    }
  }

  return (
    <header className="header" aria-label="Session">
      {sessionUrl ? (
        <div className="header__session">
          <code className="header__url">{sessionUrl}</code>
          <button type="button" className="header__copy" onClick={copy}>
            {copied ? "已复制" : "复制会话链接"}
          </button>
        </div>
      ) : (
        <span className="header__hint">新会话 · 发送首条消息后生成链接</span>
      )}
    </header>
  );
}
