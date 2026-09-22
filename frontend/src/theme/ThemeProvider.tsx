import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyTheme,
  clampFontSize,
  loadPrefs,
  savePrefs,
  type ThemeMode,
  type UiPrefs,
} from "./prefs";

type ThemeContextValue = {
  mode: ThemeMode;
  fontSize: number;
  setMode: (mode: ThemeMode) => void;
  setFontSize: (size: number) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<UiPrefs>(() => loadPrefs(window.localStorage));

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => applyTheme(document, prefs, media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [prefs]);

  useEffect(() => {
    savePrefs(window.localStorage, prefs);
  }, [prefs]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode: prefs.mode,
      fontSize: prefs.fontSize,
      setMode: (mode) => setPrefs((p) => ({ ...p, mode })),
      setFontSize: (size) => setPrefs((p) => ({ ...p, fontSize: clampFontSize(size) })),
    }),
    [prefs],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
