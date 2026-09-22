export type ThemeMode = "light" | "dark" | "system";

export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 17;
export const FONT_SIZE_DEFAULT = 14;
export const PREFS_KEY = "research-agent.ui-prefs";

export type UiPrefs = { mode: ThemeMode; fontSize: number };

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return FONT_SIZE_DEFAULT;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)));
}

export function loadPrefs(storage: { getItem(key: string): string | null }): UiPrefs {
  try {
    const raw = storage.getItem(PREFS_KEY);
    if (!raw) return { mode: "system", fontSize: FONT_SIZE_DEFAULT };
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    const mode: ThemeMode =
      parsed.mode === "light" || parsed.mode === "dark" ? parsed.mode : "system";
    return { mode, fontSize: clampFontSize(Number(parsed.fontSize)) };
  } catch {
    return { mode: "system", fontSize: FONT_SIZE_DEFAULT };
  }
}

export function savePrefs(
  storage: { setItem(key: string, value: string): void },
  prefs: UiPrefs,
): void {
  storage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function resolveTheme(mode: ThemeMode, systemDark: boolean): "light" | "dark" {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

export function applyTheme(
  doc: Pick<Document, "body" | "documentElement">,
  prefs: UiPrefs,
  systemDark: boolean,
): void {
  doc.body.dataset.theme = resolveTheme(prefs.mode, systemDark);
  doc.documentElement.style.setProperty("--app-content-font-size", `${prefs.fontSize}px`);
}
