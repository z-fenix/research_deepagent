import { useEffect, useRef, useState, type KeyboardEvent } from "react";

const MAX_VISIBLE_ROWS = 8;
const LINE_HEIGHT_PX = 24;

export default function Composer({
  isLoading,
  disabled = false,
  onSubmit,
  onStop,
}: {
  isLoading: boolean;
  /** 审批未决时禁用提交（Review Focus 1：避免绕过门禁直接发消息）。 */
  disabled?: boolean;
  onSubmit: (text: string) => void;
  onStop: () => void;
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
      <textarea
        ref={inputRef}
        className="composer__input"
        rows={1}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        placeholder="Ask a research question…"
        aria-label="Message input"
      />
      {isLoading ? (
        <button
          type="button"
          className="composer__button composer__button--stop"
          onClick={onStop}
          aria-label="Stop generation"
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          className="composer__button"
          onClick={send}
          disabled={!text.trim() || disabled}
          aria-label="Send message"
        >
          Send
        </button>
      )}
    </div>
  );
}
