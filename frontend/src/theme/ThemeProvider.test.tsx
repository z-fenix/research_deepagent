import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeProvider";

function Probe() {
  const { mode, fontSize, setMode, setFontSize } = useTheme();
  return (
    <div>
      <span>{mode}</span>
      <span>{fontSize}</span>
      <button onClick={() => setMode("dark")}>to-dark</button>
      <button onClick={() => setFontSize(16)}>to-16</button>
      <button onClick={() => setFontSize(99)}>to-99</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.body.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("--app-content-font-size");
});

describe("ThemeProvider", () => {
  it("defaults to system mode and applies data-theme to body", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText("system")).toBeTruthy();
    expect(document.body.dataset.theme).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--app-content-font-size")).toBe("14px");
  });

  it("persists mode changes and font sizes to localStorage", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => { screen.getByText("to-dark").click(); });
    act(() => { screen.getByText("to-16").click(); });
    expect(screen.getByText("dark")).toBeTruthy();
    expect(document.body.dataset.theme).toBe("dark");
    expect(JSON.parse(window.localStorage.getItem("research-agent.ui-prefs")!)).toEqual({
      mode: "dark",
      fontSize: 16,
    });
  });

  it("clamps out-of-range font sizes", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => { screen.getByText("to-99").click(); });
    expect(screen.getByText("17")).toBeTruthy();
  });

  it("loads previously stored prefs on mount", () => {
    window.localStorage.setItem(
      "research-agent.ui-prefs",
      JSON.stringify({ mode: "light", fontSize: 12 }),
    );
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText("light")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });
});
