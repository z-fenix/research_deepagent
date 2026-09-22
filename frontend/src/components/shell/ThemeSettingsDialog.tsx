import type { ReactNode } from "react";
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from "../../theme/prefs";
import { useTheme } from "../../theme/ThemeProvider";

const MODES = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
] as const;

export default function ThemeSettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactNode | null {
  const { mode, fontSize, setMode, setFontSize } = useTheme();
  if (!open) return null;

  return (
    <div className="dialog" role="dialog" aria-label="外观设置">
      <div className="dialog__panel">
        <div className="dialog__head">
          <strong>外观设置</strong>
          <button type="button" onClick={onClose} aria-label="关闭外观设置">×</button>
        </div>
        <div className="dialog__section">
          <span className="dialog__label">主题</span>
          <div className="dialog__modes">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                className={`dialog__mode${mode === m.value ? " dialog__mode--active" : ""}`}
                onClick={() => setMode(m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="dialog__section">
          <span className="dialog__label">正文字号</span>
          <div className="dialog__stepper">
            <button
              type="button"
              onClick={() => setFontSize(fontSize - 1)}
              disabled={fontSize <= FONT_SIZE_MIN}
              aria-label="减小字号"
            >
              −
            </button>
            <span>{fontSize}px</span>
            <button
              type="button"
              onClick={() => setFontSize(fontSize + 1)}
              disabled={fontSize >= FONT_SIZE_MAX}
              aria-label="增大字号"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
