import { useEffect, useRef, useState, type KeyboardEvent } from "react";

const MAX_VISIBLE_ROWS = 8;
const LINE_HEIGHT_PX = 24;
// harness 参照：模型名静态展示，环境可覆盖（Global Constraints）。
const MODEL_NAME = (import.meta.env.VITE_MODEL_NAME as string | undefined) ?? "gpt-4.1-mini";

export default function Composer({
  isLoading,
  disabled = false,
  onSubmit,
  onStop,
  stats,
}: {
  isLoading: boolean;
  /** 审批未决时禁用提交（Review Focus 1：避免绕过门禁直接发消息）。 */
  disabled?: boolean;
  onSubmit: (text: string) => void;
  onStop: () => void;
  /** 由 App 由 deriveTrajectory 派生的 turns/steps 统计；不传则不渲染统计行。 */
  stats?: { turns: number; steps: number };
}) {
  const [text, setText] = useState("");
  const [composing, setComposing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, LINE_HEIGHT_PX * MAX_VISIBLE_ROWS)}px`;
  }, [text]);

  function send() {
    const value = text.trim();
    if (!value || isLoading || disabled) return;
    onSubmit(value);
    setText("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (composing || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  }

  return (
    <div className="composer">
      <div className="composer-card">
        <textarea
          ref={inputRef}
          className="composer-card__input"
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          placeholder="Message or run a task…"
          aria-label="Message input"
        />
        <div className="composer-card__row">
          <button
            type="button"
            className="composer-card__attach"
            disabled
            aria-label="Attach files"
            title="Attachments not supported yet"
          >
            ＋
          </button>
          <span className="composer-card__chip">⚙ Workspace Write</span>
          <span className="composer-card__spacer" />
          <span className="composer-card__model">{MODEL_NAME} High ▾</span>
          {isLoading ? (
            <button
              type="button"
              className="composer-card__send composer-card__send--stop"
              onClick={onStop}
              aria-label="Stop generation"
            >
              ■
            </button>
          ) : (
            <button
              type="button"
              className="composer-card__send"
              onClick={send}
              disabled={!text.trim() || disabled}
              aria-label="Send message"
            >
              ↑
            </button>
          )}
        </div>
      </div>
      {stats ? (
        <p className="composer-stats">
          ⏱ {stats.turns} turns {stats.steps} steps
        </p>
      ) : null}
    </div>
  );
}
