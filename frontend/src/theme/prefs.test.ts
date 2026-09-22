import { describe, expect, it } from "vitest";
import {
  applyTheme,
  clampFontSize,
  loadPrefs,
  resolveTheme,
  savePrefs,
} from "./prefs";

describe("prefs", () => {
  it("returns system mode and 14px when nothing is stored", () => {
    expect(loadPrefs({ getItem: () => null })).toEqual({
      mode: "system",
      fontSize: 14,
    });
  });

  it("parses stored prefs and clamps the font size", () => {
    const storage = {
      getItem: () => JSON.stringify({ mode: "dark", fontSize: 99 }),
    };
    expect(loadPrefs(storage)).toEqual({ mode: "dark", fontSize: 17 });
  });

  it("falls back to defaults on malformed JSON", () => {
    const storage = { getItem: () => "not-json" };
    expect(loadPrefs(storage)).toEqual({ mode: "system", fontSize: 14 });
  });

  it("round-trips through savePrefs", () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
    };
    savePrefs(storage, { mode: "light", fontSize: 16 });
    expect(loadPrefs(storage)).toEqual({ mode: "light", fontSize: 16 });
  });

  it("resolves system mode through prefers-color-scheme", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("clampFontSize bounds to 12-17", () => {
    expect(clampFontSize(0)).toBe(12);
    expect(clampFontSize(99)).toBe(17);
    expect(clampFontSize(Number.NaN)).toBe(14);
  });

  it("applyTheme writes data-theme and the font-size custom property", () => {
    const doc = {
      body: { dataset: {} as Record<string, string> },
      documentElement: { style: { setProperty: (..._: unknown[]) => {} } },
    };
    let written = "";
    (doc.documentElement.style as unknown as { setProperty: (k: string, v: string) => void }).setProperty =
      (k, v) => { written = `${k}=${v}`; };
    applyTheme(doc as unknown as Document, { mode: "dark", fontSize: 15 }, false);
    expect(doc.body.dataset.theme).toBe("dark");
    expect(written).toBe("--app-content-font-size=15px");
  });
});
