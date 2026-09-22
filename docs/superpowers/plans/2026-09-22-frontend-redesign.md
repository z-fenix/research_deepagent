# 前端重构实施计划（按 deepseek-harness 设计体系）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `frontend/` 重构为 token 化设计体系 + 三态主题 + 分层组件架构，并升级 Composer、会话侧栏与 TodoDock。

**Architecture:** dsh「static 调色板 → 语义 alias → 组件消费」浓缩为两层 CSS token；主题/字号状态由 ThemeProvider（Context + localStorage）持有，`index.html` 内联片段首帧前应用；消息组装与流封装拆为 `lib/` 纯函数层；`App.tsx` 仅做外壳组装。

**Tech Stack:** React 18 + TypeScript + Vite 8 + Vitest 4（jsdom）+ @langchain/react（useStream）；新增依赖 `@langchain/langgraph-sdk@1.8.10`、`clsx`。

**Spec:** `docs/superpowers/specs/2026-09-22-frontend-redesign-design.md`（本计划逐条实现该 spec，执行者需同时读两份）

## Global Constraints

- 所有工作目录：`frontend/`（测试命令在 `frontend/` 下执行）。仓库根为 WSL 路径。
- 组件 CSS **禁止硬编码颜色**：只允许消费 `theme/tokens.css` 定义的 `--app-*` alias（`rgba` 阴影/遮罩值也收进 tokens.css）。验收用 grep 检查。
- 新运行时依赖仅限：`@langchain/langgraph-sdk`（固定 `1.8.10`，与 `@langchain/react` 嵌套版本一致）和 `clsx`。
- 主题 token 命名：static 用 `--dsw-*`，语义 alias 用 `--app-*`。dark 别名挂 `body[data-theme="dark"]`。
- 字号范围 12–17px，默认 14，localStorage key `research-agent.ui-prefs`。
- WSL 侧 git 未配置身份，**每次 commit 必须带** `git -c user.name=ZhangKun -c user.email=zk1634@163.com commit`。
- 现有业务行为不变：plan-like 识别（`PLAN_MARKERS`）、工具卡折叠逻辑、`?thread=` URL 同步、aria 标注。测试断言仅允许在 UI 文案/结构变更处同步更新（下文逐任务列出）。
- 全部命令在 WSL 内执行（`wsl` 可从当前 Windows shell 调用；或直接在 WSL 终端）。

---

### Task 1: 依赖、tokens.css 与基础样式 token 化

**Files:**
- Modify: `frontend/package.json`（npm 安装写入）
- Create: `frontend/src/theme/tokens.css`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/styles.css`（仅顶部 `:root`/`body`/`code` 基础块）
- Commit: 上一阶段遗留的 spec 文档 `docs/superpowers/specs/2026-09-22-frontend-redesign-design.md`

**Interfaces:**
- Produces: `--app-*` 语义 alias 全集（后续所有任务消费）；`--app-content-font-size` 由 JS 写入 `documentElement`。

- [ ] **Step 1: 提交 spec 文档（补上 brainstorm 阶段欠下的 commit）**

```bash
cd /home/zhang/workplace/research_deepagent
git add docs/superpowers/specs/2026-09-22-frontend-redesign-design.md
git -c user.name=ZhangKun -c user.email=zk1634@163.com commit -m "docs(frontend): add frontend redesign design spec (dsh-inspired)"
```

- [ ] **Step 2: 安装依赖**

```bash
cd /home/zhang/workplace/research_deepagent/frontend
npm install @langchain/langgraph-sdk@1.8.10 clsx
```

- [ ] **Step 3: 创建 `frontend/src/theme/tokens.css`**

```css
/* tokens.css — static palette + semantic aliases.
   Palette values follow deepseek-harness ui-theme design-platform.css.
   Components must consume --app-* aliases only; no hardcoded colors. */

:root {
  /* ---- static palette (shared by both modes) ---- */
  --dsw-neutral-bluish-00: rgb(255, 255, 255);
  --dsw-neutral-bluish-50: rgb(249, 250, 251);
  --dsw-neutral-bluish-60: rgb(245, 246, 247);
  --dsw-neutral-bluish-75: rgb(241, 243, 245);
  --dsw-neutral-bluish-100: rgb(235, 238, 242);
  --dsw-neutral-bluish-200: rgb(225, 229, 238);
  --dsw-neutral-bluish-400: rgb(173, 178, 184);
  --dsw-neutral-bluish-500: rgb(151, 157, 166);
  --dsw-neutral-bluish-600: rgb(129, 133, 140);
  --dsw-neutral-bluish-700: rgb(97, 102, 107);
  --dsw-neutral-bluish-750: rgb(67, 69, 74);
  --dsw-neutral-bluish-850: rgb(44, 44, 46);
  --dsw-neutral-bluish-900: rgb(27, 27, 28);
  --dsw-neutral-bluish-950: rgb(21, 21, 23);
  --dsw-neutral-bluish-1000: rgb(15, 17, 21);
  --dsw-deepseek-50: rgb(237, 243, 254);
  --dsw-deepseek-100: rgb(228, 237, 253);
  --dsw-deepseek-200: rgb(211, 226, 255);
  --dsw-deepseek-400: rgb(122, 170, 255);
  --dsw-deepseek-500: rgb(65, 118, 230);
  --dsw-deepseek-600: rgb(72, 104, 178);
  --dsw-green-100: rgb(230, 250, 237);
  --dsw-green-400: rgb(78, 209, 126);
  --dsw-green-500: rgb(34, 197, 94);
  --dsw-amber-100: rgb(254, 245, 231);
  --dsw-amber-500: rgb(245, 158, 11);
  --dsw-amber-600: rgb(221, 134, 41);
  --dsw-red-500: rgb(239, 68, 68);
  --dsw-red-600: rgb(236, 19, 19);

  /* ---- masks & translucency (mode-specific, light defaults) ---- */
  --app-mask-l1: rgba(0, 0, 0, 0.12);
  --app-menu-backdrop: rgba(248, 249, 250, 0.58);
  --app-scrollbar-thumb: var(--dsw-neutral-bluish-200);

  /* ---- semantic aliases: light ---- */
  --app-bg-base: var(--dsw-neutral-bluish-00);
  --app-bg-layer-1: var(--dsw-neutral-bluish-50);
  --app-bg-layer-2: var(--dsw-neutral-bluish-60);
  --app-bg-accent-soft: var(--dsw-deepseek-50);
  --app-bg-accent-softer: var(--dsw-deepseek-100);
  --app-bg-success-soft: var(--dsw-green-100);
  --app-bg-warn-soft: var(--dsw-amber-100);
  --app-border-l1: rgba(0, 0, 0, 0.04);
  --app-border-l2: rgba(0, 0, 0, 0.1);
  --app-border-l3: rgba(0, 0, 0, 0.12);
  --app-border-l4: rgba(0, 0, 0, 0.16);
  --app-label-primary: var(--dsw-neutral-bluish-1000);
  --app-label-secondary: var(--dsw-neutral-bluish-700);
  --app-label-tertiary: var(--dsw-neutral-bluish-600);
  --app-label-caption: var(--dsw-neutral-bluish-400);
  --app-label-on-accent: var(--dsw-neutral-bluish-00);
  --app-accent: var(--dsw-deepseek-500);
  --app-accent-hover: var(--dsw-deepseek-600);
  --app-link: var(--dsw-deepseek-500);
  --app-state-success: var(--dsw-green-500);
  --app-state-warn: var(--dsw-amber-600);
  --app-state-error: var(--dsw-red-600);
  --app-bubble-user: var(--dsw-deepseek-50);

  /* ---- elevation: 0.5px hairline + layered soft shadows ---- */
  --app-elevation-stroke: 0 0 0 0.5px var(--app-border-l2);
  --app-shadow-lv1:
    var(--app-elevation-stroke),
    0 1px 2px rgba(0, 0, 0, 0.04),
    0 2px 8px rgba(0, 0, 0, 0.04);
  --app-shadow-lv2:
    var(--app-elevation-stroke),
    0 2px 6px rgba(0, 0, 0, 0.05),
    0 12px 32px rgba(0, 0, 0, 0.08);

  /* ---- shape & motion ---- */
  --app-radius-sm: 6px;
  --app-radius-md: 10px;
  --app-radius-lg: 16px;
  --app-ease: cubic-bezier(0.4, 0, 0.2, 1);
  --app-transition: 0.2s;

  /* ---- font ladder (base written by JS before first paint) ---- */
  --app-content-font-size: 14px;
  --app-content-font-size-secondary: calc(var(--app-content-font-size) - 1px);
  --app-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --app-font-family-code: "SF Mono", "JetBrains Mono", "Fira Code", Consolas,
    "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei";
}

body[data-theme="dark"] {
  --app-mask-l1: rgba(0, 0, 0, 0.48);
  --app-menu-backdrop: rgba(44, 44, 46, 0.58);
  --app-scrollbar-thumb: var(--dsw-neutral-bluish-750);

  --app-bg-base: var(--dsw-neutral-bluish-950);
  --app-bg-layer-1: var(--dsw-neutral-bluish-900);
  --app-bg-layer-2: var(--dsw-neutral-bluish-850);
  --app-bg-accent-soft: rgba(122, 170, 255, 0.1);
  --app-bg-accent-softer: rgba(122, 170, 255, 0.16);
  --app-bg-success-soft: rgba(34, 197, 94, 0.14);
  --app-bg-warn-soft: rgba(245, 158, 11, 0.14);
  --app-border-l1: rgba(255, 255, 255, 0.06);
  --app-border-l2: rgba(255, 255, 255, 0.12);
  --app-border-l3: rgba(255, 255, 255, 0.16);
  --app-border-l4: rgba(255, 255, 255, 0.22);
  --app-label-primary: var(--dsw-neutral-bluish-00);
  --app-label-secondary: var(--dsw-neutral-bluish-200);
  --app-label-tertiary: var(--dsw-neutral-bluish-400);
  --app-label-caption: var(--dsw-neutral-bluish-500);
  --app-label-on-accent: var(--dsw-neutral-bluish-00);
  --app-accent: var(--dsw-deepseek-400);
  --app-accent-hover: rgb(103, 158, 254);
  --app-link: var(--dsw-deepseek-400);
  --app-state-success: var(--dsw-green-400);
  --app-state-warn: var(--dsw-amber-500);
  --app-state-error: var(--dsw-red-500);
  --app-bubble-user: rgba(122, 170, 255, 0.14);
  --app-shadow-lv1:
    var(--app-elevation-stroke),
    0 1px 2px rgba(0, 0, 0, 0.3),
    0 2px 8px rgba(0, 0, 0, 0.3);
  --app-shadow-lv2:
    var(--app-elevation-stroke),
    0 2px 6px rgba(0, 0, 0, 0.35),
    0 12px 32px rgba(0, 0, 0, 0.45);
}

/* ---- global chrome: smooth corners, scrollbars, base text ---- */
@supports (corner-shape: superellipse(1.5)) {
  :root { --app-corner-shape: superellipse(1.5); }
  *, *::before, *::after { corner-shape: var(--app-corner-shape); }
}

* {
  scrollbar-width: thin;
  scrollbar-color: var(--app-scrollbar-thumb) transparent;
}
*::-webkit-scrollbar { width: 8px; height: 8px; }
*::-webkit-scrollbar-thumb {
  background: var(--app-scrollbar-thumb);
  border-radius: 999px;
}
*::-webkit-scrollbar-track { background: transparent; }

body {
  font-family: var(--app-font-family);
  font-size: var(--app-content-font-size);
  background: var(--app-bg-base);
  color: var(--app-label-primary);
  line-height: 1.5;
}

code {
  font-family: var(--app-font-family-code);
  background: var(--app-bg-layer-2);
  padding: 0.1em 0.35em;
  border-radius: var(--app-radius-sm);
  font-size: 0.95em;
}
```

- [ ] **Step 4: 改 `frontend/src/main.tsx` 引入 token（tokens 在组件样式之前）**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./theme/tokens.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 5: 替换 `styles.css` 顶部基础块（原 1–30 行的 `:root`/`body`/`code`）**

把 `styles.css` 原来的：

```css
:root {
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  line-height: 1.5;
  color-scheme: light dark;
  --app-bg: #f7f7f8;
  --app-fg: #1f1f1f;
  /* …thread-banner 变量… */
}

body { margin: 0; background: var(--app-bg); color: var(--app-fg); }
main { max-width: 820px; margin: 0 auto; padding: 2rem 1rem 6rem; }
code { background: rgba(0, 0, 0, 0.06); padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.95em; }
```

替换为（其余区块暂不动，只删掉这四个块）：

```css
body { margin: 0; }
main { max-width: 820px; margin: 0 auto; padding: 2rem 1rem 6rem; }
```

同时删除文件末尾 `@media (prefers-color-scheme: dark)` 里的 `body { background: #1c1c1e; ... }` 与 `code { ... }` 两条（颜色职责已移交 tokens.css）。

- [ ] **Step 6: 验证构建与测试仍绿**

```bash
npm run test && npm run build
```
Expected: 全部 PASS；`tsc -b && vite build` 成功。

- [ ] **Step 7: Commit**

```bash
cd /home/zhang/workplace/research_deepagent
git add frontend/package.json frontend/package-lock.json frontend/src/theme/tokens.css frontend/src/main.tsx frontend/src/styles.css
git -c user.name=ZhangKun -c user.email=zk1634@163.com commit -m "feat(frontend): add dsh-inspired design token layer"
```

---

### Task 2: 主题偏好（prefs.ts + ThemeProvider + 首帧防闪白）

**Files:**
- Create: `frontend/src/theme/prefs.ts`
- Create: `frontend/src/theme/prefs.test.ts`
- Create: `frontend/src/theme/ThemeProvider.tsx`
- Create: `frontend/src/theme/ThemeProvider.test.tsx`
- Create: `frontend/src/test-setup.ts`
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/index.html`

**Interfaces:**
- Produces:
  - `prefs.ts`: `type ThemeMode = "light" | "dark" | "system"`；`type UiPrefs = { mode: ThemeMode; fontSize: number }`；`loadPrefs(storage: { getItem(k): string | null }): UiPrefs`；`savePrefs(storage: { setItem(k, v): void }, prefs: UiPrefs): void`；`resolveTheme(mode: ThemeMode, systemDark: boolean): "light" | "dark"`；`applyTheme(doc: Pick<Document, "body" | "documentElement">, prefs: UiPrefs, systemDark: boolean): void`；常量 `FONT_SIZE_MIN = 12`、`FONT_SIZE_MAX = 17`、`FONT_SIZE_DEFAULT = 14`、`PREFS_KEY = "research-agent.ui-prefs"`。
  - `ThemeProvider.tsx`: `ThemeProvider({ children })`；`useTheme(): { mode: ThemeMode; fontSize: number; setMode(m: ThemeMode): void; setFontSize(n: number): void }`。

- [ ] **Step 1: 写失败测试 `frontend/src/theme/prefs.test.ts`**

```ts
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
```

- [ ] **Step 2: 运行确认失败**

```bash
cd /home/zhang/workplace/research_deepagent/frontend
npx vitest run --environment jsdom src/theme/prefs.test.ts
```
Expected: FAIL（`Cannot find module './prefs'`）。

- [ ] **Step 3: 实现 `frontend/src/theme/prefs.ts`**

```ts
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
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run --environment jsdom src/theme/prefs.test.ts
```
Expected: PASS（7 个用例）。

- [ ] **Step 5: 建 jsdom 测试环境（matchMedia mock + vitest 配置）**

创建 `frontend/src/test-setup.ts`：

```ts
// jsdom lacks matchMedia; ThemeProvider listens to it for "system" mode.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
```

修改 `frontend/vite.config.ts`：

```ts
/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const port = Number(env.FRONTEND_PORT ?? "5174");
  return {
    plugins: [react()],
    server: { host: "127.0.0.1", port, strictPort: true },
    test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"] },
  };
});
```

- [ ] **Step 6: 写失败测试 `frontend/src/theme/ThemeProvider.test.tsx`**

```tsx
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
```

- [ ] **Step 7: 运行确认失败**

```bash
npx vitest run --environment jsdom src/theme/ThemeProvider.test.tsx
```
Expected: FAIL（`Cannot find module './ThemeProvider'`）。

- [ ] **Step 8: 实现 `frontend/src/theme/ThemeProvider.tsx`**

```tsx
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
```

- [ ] **Step 9: 运行确认通过**

```bash
npx vitest run --environment jsdom src/theme/
```
Expected: prefs + ThemeProvider 全 PASS。

- [ ] **Step 10: `frontend/index.html` 加首帧内联片段（body 内、root div 之后）**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Research Deep Agent</title>
  </head>
  <body>
    <div id="root"></div>
    <script>
      // Keep in sync with frontend/src/theme/prefs.ts (its tests pin these defaults).
      (function () {
        try {
          var raw = localStorage.getItem("research-agent.ui-prefs");
          var prefs = raw ? JSON.parse(raw) : {};
          var mode = prefs.mode === "light" || prefs.mode === "dark" ? prefs.mode : "system";
          var size = Number(prefs.fontSize);
          if (!(size >= 12 && size <= 17)) size = 14;
          var dark =
            mode === "dark" ||
            (mode === "system" &&
              window.matchMedia("(prefers-color-scheme: dark)").matches);
          document.body.dataset.theme = dark ? "dark" : "light";
          document.documentElement.style.setProperty("--app-content-font-size", size + "px");
        } catch (e) {
          /* first paint falls back to tokens.css defaults */
        }
      })();
    </script>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 11: 全量测试 + Commit**

```bash
npm run test
cd /home/zhang/workplace/research_deepagent
git add frontend/src/theme/ frontend/src/test-setup.ts frontend/vite.config.ts frontend/index.html
git -c user.name=ZhangKun -c user.email=zk1634@163.com commit -m "feat(frontend): add tri-state theme with pre-paint bootstrap"
```

---

### Task 3: 消息组装纯函数迁移（lib/messages.ts，先测后迁）

**Files:**
- Create: `frontend/src/lib/messages.ts`
- Create: `frontend/src/lib/messages.test.ts`
- Modify: `frontend/src/App.tsx`（删除本地实现，改 import）

**Interfaces:**
- Produces（Task 4/6/10 依赖）:
  - `type Message = { id?: string; type: string; content: unknown; tool_calls?: RawToolCall[]; tool_call_id?: string; name?: string }`（`RawToolCall = { id?: string; name?: string; args?: unknown }`）
  - `type Row = { kind: "prose"; key: string; type: "human" | "ai"; body: string } | { kind: "plan"; key: string; body: string } | { kind: "card"; key: string; card: ToolCard }`
  - `messageText(content: unknown): string`、`isPlanLikeBody(body: string): boolean`、`buildRows(messages: Message[]): Row[]`
  - `PLAN_MARKERS: string[]`（值不变：`["SESSION INTENT", "SUMMARY", "NEXT STEPS", "ARTIFACTS"]`）

- [ ] **Step 1: 写失败测试 `frontend/src/lib/messages.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { buildRows, isPlanLikeBody, messageText } from "./messages";

const PLAN_BODY =
  "## SESSION INTENT\nCompare LangGraph 1.0 and 0.x.\n\n## SUMMARY\nThe user requested a specific multi-step workflow.";

describe("messageText", () => {
  it("joins string and text parts", () => {
    expect(messageText(["a", { text: "b" }, "c"])).toBe("abc");
  });
  it("returns non-string content as empty string", () => {
    expect(messageText(42)).toBe("");
  });
});

describe("isPlanLikeBody", () => {
  it("flags bodies with two or more plan markers", () => {
    expect(isPlanLikeBody(PLAN_BODY)).toBe(true);
  });
  it("does not flag ordinary answers", () => {
    expect(isPlanLikeBody("LangGraph 1.0 adds a functional API.")).toBe(false);
  });
});

describe("buildRows", () => {
  it("folds tool results into their pending cards", () => {
    const rows = buildRows([
      { id: "h1", type: "human", content: "Research IBM" },
      {
        id: "a1",
        type: "ai",
        content: "",
        tool_calls: [{ id: "c1", name: "task", args: { description: "Research IBM" } }],
      },
      { id: "t1", type: "tool", tool_call_id: "c1", content: "IBM summary" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "prose", type: "human", body: "Research IBM" });
    expect(rows[1]).toMatchObject({
      kind: "card",
      card: { callId: "c1", name: "task", status: "done", result: "IBM summary" },
    });
  });

  it("renders empty-body ai tool calls as pending cards", () => {
    const rows = buildRows([
      {
        id: "a1",
        type: "ai",
        content: "",
        tool_calls: [{ id: "c1", name: "web_search", args: {} }],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "card", card: { status: "pending" } });
  });

  it("classifies plan-like ai bodies as plan rows", () => {
    const rows = buildRows([
      { id: "a1", type: "ai", content: PLAN_BODY },
      { id: "a2", type: "ai", content: "Final answer." },
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ kind: "plan", body: PLAN_BODY }),
      expect.objectContaining({ kind: "prose", type: "ai", body: "Final answer." }),
    ]);
  });

  it("drops orphan tool messages silently", () => {
    const rows = buildRows([
      { id: "t1", type: "tool", tool_call_id: "missing", content: "orphan" },
    ]);
    expect(rows).toHaveLength(0);
  });

  it("keeps substantive mixed ai content as prose plus cards", () => {
    const rows = buildRows([
      {
        id: "a1",
        type: "ai",
        content: "- **Answer point one:** ok",
        tool_calls: [{ id: "c1", name: "write_todos", args: {} }],
      },
      { id: "t1", type: "tool", tool_call_id: "c1", content: "Updated todo list" },
    ]);
    expect(rows[0]).toMatchObject({ kind: "prose", type: "ai" });
    expect(rows[1]).toMatchObject({ kind: "card", card: { name: "write_todos" } });
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run --environment jsdom src/lib/messages.test.ts
```
Expected: FAIL（`Cannot find module './messages'`）。

- [ ] **Step 3: 创建 `frontend/src/lib/messages.ts` —— 逻辑从 `App.tsx:9-110` **原样**迁移（`messageText`、`PLAN_MARKERS`、`isPlanLikeBody`、`Row`、`buildRows`、类型），只加 `export` 关键字，不改任何判断逻辑**

文件头部：

```ts
// Message assembly: walk streamed messages in order and produce flat render
// rows. Migrated verbatim from the former App.tsx implementation.

export type RawToolCall = { id?: string; name?: string; args?: unknown };
export type Message = {
  id?: string;
  type: string;
  content: unknown;
  tool_calls?: RawToolCall[];
  tool_call_id?: string;
  name?: string;
};
export type ToolCard = {
  callId: string;
  name: string;
  args: unknown;
  result: string | null;
  status: "pending" | "done";
};

export const PLAN_MARKERS = ["SESSION INTENT", "SUMMARY", "NEXT STEPS", "ARTIFACTS"];

export function messageText(content: unknown): string {
  /* 原样迁移 App.tsx:25-39 */
}

export type Row =
  | { kind: "prose"; key: string; type: "human" | "ai"; body: string }
  | { kind: "plan"; key: string; body: string }
  | { kind: "card"; key: string; card: ToolCard };

export function isPlanLikeBody(body: string): boolean {
  /* 原样迁移 App.tsx:50-54 */
}

export function buildRows(messages: Message[]): Row[] {
  /* 原样迁移 App.tsx:56-110 */
}
```

（`/* 原样迁移 */` 处逐行复制现 `App.tsx` 对应函数体，不得改写。）

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run --environment jsdom src/lib/messages.test.ts
```
Expected: PASS。

- [ ] **Step 5: `App.tsx` 改为 import，删除本地副本**

```tsx
import { buildRows, type Message, type Row } from "./lib/messages";
```

删除 `App.tsx` 中 `RawToolCall`/`Message`/`StreamState` 以外的本地类型与 `messageText`/`PLAN_MARKERS`/`isPlanLikeBody`/`buildRows`（`StreamState` 暂留原地，Task 4 迁走）。`ToolCallCard` 的 `ToolCard` 类型改从 `./lib/messages` 导入（Task 9 会把组件迁走；本步先在 `ToolCallCard.tsx` 顶部改为 `import type { ToolCard } from "../lib/messages";` 并删除其本地定义）。

- [ ] **Step 6: 全量测试（现有 App/ToolCallCard 测试必须原样通过）**

```bash
npm run test
```
Expected: 全 PASS，无断言改动。

- [ ] **Step 7: Commit**

```bash
cd /home/zhang/workplace/research_deepagent
git add frontend/src/lib/messages.ts frontend/src/lib/messages.test.ts frontend/src/App.tsx frontend/src/ToolCallCard.tsx
git -c user.name=ZhangKun -c user.email=zk1634@163.com commit -m "refactor(frontend): extract message assembly into lib/messages"
```

---

### Task 4: 流封装（lib/stream.ts：useAgentStream）

**Files:**
- Create: `frontend/src/lib/stream.ts`
- Create: `frontend/src/lib/stream.test.tsx`
- Modify: `frontend/src/lib/messages.ts`（TodoItem/TodoStatus 类型收编到本文件，Task 8 的 TodoDock 改从这里 import；若 Task 3 已有则跳过）

**Interfaces:**
- Consumes: `buildRows`/`Message`/`Row`（Task 3）。
- Produces:
  - `type TodoStatus = "pending" | "in_progress" | "completed"`；`type TodoItem = { content: string; status: TodoStatus }`
  - `API_URL: string`（`import.meta.env.VITE_LANGGRAPH_API_URL ?? "http://127.0.0.1:2024"`）
  - `type AgentStream = { rows: Row[]; todos: TodoItem[]; isLoading: boolean; error: unknown; submit(text: string): void; stop(): void; threadId: string | undefined; openThread(threadId: string | undefined): void }`
  - `useAgentStream(): AgentStream`；`sessionLink(threadId: string | undefined): string | null`

- [ ] **Step 1: 写失败测试 `frontend/src/lib/stream.test.tsx`**

```tsx
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentStream } from "./stream";

const mockStream = {
  messages: [
    { id: "h1", type: "human", content: "Research IBM" },
    {
      id: "a1",
      type: "ai",
      content: "",
      tool_calls: [{ id: "c1", name: "task", args: {} }],
    },
    { id: "t1", type: "tool", tool_call_id: "c1", content: "IBM summary" },
  ],
  values: { todos: [{ content: "Step", status: "in_progress" }] },
  isLoading: true,
  error: null,
  submit: vi.fn(),
  stop: vi.fn(),
};
let capturedOptions: Record<string, unknown> | null = null;

vi.mock("@langchain/react", () => ({
  useStream: (options: Record<string, unknown>) => {
    capturedOptions = options;
    return mockStream;
  },
}));

function Probe() {
  const stream = useAgentStream();
  return (
    <div>
      <span>{stream.threadId ?? "no-thread"}</span>
      <span>{stream.rows.length}</span>
      <span>{stream.todos.length}</span>
      <button onClick={() => stream.submit("hi")}>submit</button>
      <button onClick={() => stream.stop()}>stop</button>
      <button onClick={() => stream.openThread("t-2")}>open</button>
      <button onClick={() => stream.openThread(undefined)}>new</button>
      <span>{stream.sessionUrl ?? "no-url"}</span>
    </div>
  );
}

afterEach(() => {
  cleanup();
  capturedOptions = null;
  vi.clearAllMocks();
  window.history.replaceState({}, "", "http://localhost:3000/");
});

describe("useAgentStream", () => {
  it("exposes rows and todos built from stream state", () => {
    render(<Probe />);
    expect(screen.getByText("2")).toBeTruthy(); // rows: human prose + card
    expect(screen.getByText("1")).toBeTruthy(); // todos
  });

  it("submits trimmed human messages through useStream", () => {
    render(<Probe />);
    act(() => { screen.getByText("submit").click(); });
    expect(mockStream.submit).toHaveBeenCalledWith({
      messages: [{ type: "human", content: "hi" }],
    });
  });

  it("routes stop() to useStream", () => {
    render(<Probe />);
    act(() => { screen.getByText("stop").click(); });
    expect(mockStream.stop).toHaveBeenCalled();
  });

  it("openThread writes ?thread= into the URL; undefined clears it", () => {
    render(<Probe />);
    act(() => { screen.getByText("open").click(); });
    expect(window.location.search).toBe("?thread=t-2");
    act(() => { screen.getByText("new").click(); });
    expect(window.location.search).toBe("");
  });

  it("passes the initial thread from the URL to useStream", () => {
    window.history.replaceState({}, "", "http://localhost:3000/?thread=t-9");
    render(<Probe />);
    expect(capturedOptions?.threadId).toBe("t-9");
    expect(screen.getByText("t-9")).toBeTruthy();
  });

  it("notifies useStream of created thread ids and syncs the URL", () => {
    render(<Probe />);
    act(() => {
      (capturedOptions?.onThreadId as ((id: string) => void) | undefined)?.("t-123");
    });
    expect(window.location.search).toBe("?thread=t-123");
    expect(screen.getByText("t-123")).toBeTruthy();
    expect(screen.getByText("http://localhost:3000/?thread=t-123")).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run --environment jsdom src/lib/stream.test.tsx
```
Expected: FAIL（`Cannot find module './stream'`）。

- [ ] **Step 3: 实现 `frontend/src/lib/stream.ts`**

```ts
import { useStream } from "@langchain/react";
import { useCallback, useMemo, useState } from "react";
import { buildRows, type Message, type Row } from "./messages";

export type TodoStatus = "pending" | "in_progress" | "completed";
export type TodoItem = { content: string; status: TodoStatus };

export const API_URL =
  (import.meta.env.VITE_LANGGRAPH_API_URL as string | undefined) ?? "http://127.0.0.1:2024";

type StreamState = { messages: Message[]; todos?: TodoItem[] };

export function syncThreadUrl(threadId: string | undefined): void {
  const url = new URL(window.location.href);
  if (threadId) url.searchParams.set("thread", threadId);
  else url.searchParams.delete("thread");
  window.history.replaceState({}, "", url);
}

export function sessionLink(threadId: string | undefined): string | null {
  if (!threadId) return null;
  const url = new URL(window.location.href);
  url.searchParams.set("thread", threadId);
  return url.toString();
}

export type AgentStream = {
  rows: Row[];
  todos: TodoItem[];
  isLoading: boolean;
  error: unknown;
  submit: (text: string) => void;
  stop: () => void;
  threadId: string | undefined;
  openThread: (threadId: string | undefined) => void;
  sessionUrl: string | null;
};

export function useAgentStream(): AgentStream {
  const [threadId, setThreadId] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get("thread") ?? undefined,
  );

  const stream = useStream<StreamState>({
    apiUrl: API_URL,
    assistantId: "research",
    threadId,
    onThreadId: (id) => {
      setThreadId(id);
      syncThreadUrl(id);
    },
  });

  const openThread = useCallback((id: string | undefined) => {
    setThreadId(id);
    syncThreadUrl(id);
  }, []);

  const rows = useMemo(() => buildRows(stream.messages as Message[]), [stream.messages]);
  const todos = Array.isArray(stream.values?.todos) ? stream.values.todos : [];

  return {
    rows,
    todos,
    isLoading: stream.isLoading,
    error: stream.error,
    submit: (text) => {
      void stream.submit({ messages: [{ type: "human", content: text }] });
    },
    stop: () => {
      void stream.stop();
    },
    threadId,
    openThread,
    sessionUrl: sessionLink(threadId),
  };
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run --environment jsdom src/lib/stream.test.tsx
```
Expected: PASS（6 个用例）。

- [ ] **Step 5: Commit**

```bash
cd /home/zhang/workplace/research_deepagent
git add frontend/src/lib/stream.ts frontend/src/lib/stream.test.tsx frontend/src/lib/messages.ts
git -c user.name=ZhangKun -c user.email=zk1634@163.com commit -m "refactor(frontend): encapsulate useStream behind useAgentStream"
```

---

### Task 5: 会话列表（lib/threads.ts：useThreads）

**Files:**
- Create: `frontend/src/lib/threads.ts`
- Create: `frontend/src/lib/threads.test.tsx`
- Modify: `frontend/package.json`（devDependencies 加 `@langchain/langgraph-sdk` 类型已随依赖）

**Interfaces:**
- Produces:
  - `type ThreadSummary = { threadId: string; updatedAt: string; title: string }`
  - `useThreads(apiUrl: string): { threads: ThreadSummary[]; loading: boolean; error: unknown; refresh: () => void }`

- [ ] **Step 1: 写失败测试 `frontend/src/lib/threads.test.tsx`**

```tsx
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useThreads } from "./threads";

const search = vi.fn();

vi.mock("@langchain/langgraph-sdk", () => ({
  Client: vi.fn(() => ({ threads: { search } })),
}));

function listFixture() {
  return [
    {
      thread_id: "aaaaaaaa-1111",
      updated_at: "2026-09-22T10:00:00Z",
      created_at: "2026-09-22T09:00:00Z",
      values: { messages: [{ type: "human", content: "研究 IBM 的 LangGraph 工作" }] },
    },
    {
      thread_id: "bbbbbbbb-2222",
      updated_at: "2026-09-21T10:00:00Z",
      created_at: "2026-09-21T09:00:00Z",
      values: {},
    },
  ];
}

function Probe() {
  const { threads, loading, refresh } = useThreads("http://x");
  return (
    <div>
      <span>{loading ? "loading" : "idle"}</span>
      {threads.map((t) => (
        <span key={t.threadId}>{t.title}</span>
      ))}
      <button onClick={refresh}>refresh</button>
    </div>
  );
}

describe("useThreads", () => {
  it("loads thread summaries with human-message titles and id fallbacks", async () => {
    search.mockResolvedValue(listFixture());
    render(<Probe />);
    await waitFor(() => expect(screen.getByText("idle")).toBeTruthy());
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, sortOrder: "desc" }),
    );
    expect(screen.getByText("研究 IBM 的 LangGraph 工作")).toBeTruthy();
    expect(screen.getByText("会话 bbbbbbbb")).toBeTruthy();
  });

  it("refresh re-queries the server", async () => {
    search.mockResolvedValue([]);
    render(<Probe />);
    await waitFor(() => expect(screen.getByText("idle")).toBeTruthy());
    act(() => { screen.getByText("refresh").click(); });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run --environment jsdom src/lib/threads.test.tsx
```
Expected: FAIL（`Cannot find module './threads'`）。

- [ ] **Step 3: 实现 `frontend/src/lib/threads.ts`**

```ts
import { Client, type Thread } from "@langchain/langgraph-sdk";
import { useCallback, useEffect, useState } from "react";

export type ThreadSummary = { threadId: string; updatedAt: string; title: string };

type Humanish = { type?: string; content?: unknown };

export function threadTitle(thread: Thread): string {
  const messages =
    (thread.values as { messages?: Humanish[] } | undefined)?.messages ?? [];
  const firstHuman = messages.find((m) => m.type === "human");
  const text = typeof firstHuman?.content === "string" ? firstHuman.content.trim() : "";
  return text ? text.slice(0, 48) : `会话 ${thread.thread_id.slice(0, 8)}`;
}

export function toSummary(thread: Thread): ThreadSummary {
  return { threadId: thread.thread_id, updatedAt: thread.updated_at, title: threadTitle(thread) };
}

export function useThreads(apiUrl: string): {
  threads: ThreadSummary[];
  loading: boolean;
  error: unknown;
  refresh: () => void;
} {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    new Client({ apiUrl })
      .threads.search({ limit: 20, sortBy: "updated_at", sortOrder: "desc" })
      .then((list) => {
        if (cancelled) return;
        setThreads(list.map(toSummary));
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { threads, loading, error, refresh };
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run --environment jsdom src/lib/threads.test.tsx
```
Expected: PASS（2 个用例）。

- [ ] **Step 5: Commit**

```bash
cd /home/zhang/workplace/research_deepagent
git add frontend/src/lib/threads.ts frontend/src/lib/threads.test.tsx
git -c user.name=ZhangKun -c user.email=zk1634@163.com commit -m "feat(frontend): add useThreads hook for session history"
```

---

### Task 6: 外壳组件与 App 组装（Sidebar / Header / ThemeSettingsDialog）

**Files:**
- Create: `frontend/src/components/shell/Sidebar.tsx`
- Create: `frontend/src/components/shell/Header.tsx`
- Create: `frontend/src/components/shell/ThemeSettingsDialog.tsx`
- Modify: `frontend/src/App.tsx`（重写为外壳组装，<100 行）
- Modify: `frontend/src/App.test.tsx`（thread-banner 断言替换为 header 等价断言，其余不动）
- Modify: `frontend/src/styles.css`（shell 布局 + sidebar + header + dialog 样式；删除 `.thread-banner*` 区块与旧 `main` 布局）

**Interfaces:**
- Consumes: `useAgentStream`/`sessionLink`/`API_URL`（Task 4）、`useThreads`/`ThreadSummary`（Task 5）、`useTheme`（Task 2）。
- Produces:
  - `Sidebar({ open, onClose, threads, loading, activeThreadId, onSelect, onNewSession, onOpenAppearance })`
  - `Header({ sessionUrl }: { sessionUrl: string | null })`
  - `ThemeSettingsDialog({ open, onClose })`
  - `App` 渲染结构：`.shell` > `.shell__menu`（移动端汉堡）+ `Sidebar` + `.shell__main` > `Header` + `.shell__scroll` > `.shell__content`（消息区）+ `TodoDock` 占位（Task 8 接入）+ `Composer` 占位（Task 7 接入）。本任务先以现有 `TodoList` 与旧表单内联在占位处，后续任务替换。

- [ ] **Step 1: 实现 `frontend/src/components/shell/Sidebar.tsx`**

```tsx
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
```

- [ ] **Step 2: 实现 `frontend/src/components/shell/Header.tsx`**

```tsx
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
```

- [ ] **Step 3: 实现 `frontend/src/components/shell/ThemeSettingsDialog.tsx`**

```tsx
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
```

- [ ] **Step 4: 重写 `frontend/src/App.tsx`（<100 行）**

```tsx
import { useState } from "react";
import { ThemeProvider } from "./theme/ThemeProvider";
import { API_URL, sessionLink, useAgentStream } from "./lib/stream";
import { useThreads } from "./lib/threads";
import Sidebar from "./components/shell/Sidebar";
import Header from "./components/shell/Header";
import ThemeSettingsDialog from "./components/shell/ThemeSettingsDialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import TodoList from "./TodoList";
import ThinkingBlock from "./ThinkingBlock";
import ToolCallCard from "./ToolCallCard";

function AgentWorkspace() {
  const stream = useAgentStream();
  const { threads, loading } = useThreads(API_URL);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const sessionUrl = sessionLink(stream.threadId);

  return (
    <div className="shell">
      <button
        type="button"
        className="shell__menu"
        aria-label="打开会话列表"
        onClick={() => setDrawerOpen(true)}
      >
        ☰
      </button>
      {drawerOpen && <div className="shell__backdrop" onClick={() => setDrawerOpen(false)} />}
      <Sidebar
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        threads={threads}
        loading={loading}
        activeThreadId={stream.threadId}
        onSelect={(id) => {
          stream.openThread(id);
          setDrawerOpen(false);
        }}
        onNewSession={() => {
          stream.openThread(undefined);
          setDrawerOpen(false);
        }}
        onOpenAppearance={() => setAppearanceOpen(true)}
      />
      <div className="shell__main">
        <Header sessionUrl={sessionUrl} />
        <div className="shell__scroll">
          <div className="shell__content">
            <TodoList todos={stream.todos} />
            <section className="chat" aria-label="Research conversation">
              {stream.rows.map((row) =>
                row.kind === "prose" ? (
                  <article key={row.key} className={`msg msg--${row.type}`}>
                    <header className="msg__role">{row.type}</header>
                    <div className="msg__body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{row.body}</ReactMarkdown>
                    </div>
                  </article>
                ) : row.kind === "plan" ? (
                  <ThinkingBlock key={row.key} body={row.body} />
                ) : (
                  <ToolCallCard key={row.key} card={row.card} />
                ),
              )}
              {stream.isLoading && (
                <div className="activity-card" aria-live="polite" aria-label="Research in progress">
                  <div className="activity-card__pulse" aria-hidden="true">
                    <span /><span /><span />
                  </div>
                  <div className="activity-card__copy">
                    <strong>Research in progress</strong>
                    <span>Waiting for sub-agent results and final synthesis.</span>
                  </div>
                </div>
              )}
              {stream.error ? <p className="error">{String(stream.error)}</p> : null}
            </section>
          </div>
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem("text") as HTMLInputElement;
              const value = input.value.trim();
              if (!value || stream.isLoading) return;
              input.value = "";
              stream.submit(value);
            }}
          >
            <input name="text" placeholder="Ask a research question…" disabled={stream.isLoading} />
            <button type="submit" disabled={stream.isLoading}>Send</button>
          </form>
        </div>
      </div>
      <ThemeSettingsDialog open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AgentWorkspace />
    </ThemeProvider>
  );
}
```

- [ ] **Step 5: `styles.css` 调整**

删除 `.thread-banner*` 全部区块、`@media (max-width: 640px)` 的 thread-banner 规则，并追加：

```css
/* shell ----------------------------------------------------------------- */
.shell {
  display: flex;
  min-height: 100dvh;
}

.shell__menu {
  display: none;
  position: fixed;
  top: 0.6rem;
  left: 0.6rem;
  z-index: 30;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: var(--app-bg-layer-1);
  color: var(--app-label-primary);
  box-shadow: var(--app-shadow-lv1);
  padding: 0.35rem 0.6rem;
  cursor: pointer;
}

.shell__backdrop {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 20;
  background: var(--app-mask-l1);
}

.shell__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100dvh;
}

.shell__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.shell__content {
  flex: 1;
  width: min(820px, 100%);
  margin: 0 auto;
  padding: 1rem 1rem 1.5rem;
}

/* header ---------------------------------------------------------------- */
.header {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 1rem;
  border-bottom: 1px solid var(--app-border-l1);
}

.header__hint { color: var(--app-label-caption); font-size: 0.85rem; }

.header__session { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.header__url {
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.header__copy {
  border: 0;
  border-radius: var(--app-radius-sm);
  background: var(--app-bg-layer-2);
  color: var(--app-label-primary);
  padding: 0.3rem 0.6rem;
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}
.header__copy:hover { background: var(--app-bg-accent-soft); }

/* sidebar --------------------------------------------------------------- */
.sidebar {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 0.75rem;
  border-right: 1px solid var(--app-border-l1);
  background: var(--app-bg-layer-1);
}

.sidebar__head { display: flex; justify-content: space-between; align-items: center; }
.sidebar__brand { font-weight: 600; font-size: var(--app-content-font-size-secondary); }
.sidebar__close { display: none; border: 0; background: none; font: inherit; color: var(--app-label-tertiary); cursor: pointer; }

.sidebar__new {
  border: 0;
  border-radius: var(--app-radius-md);
  background: var(--app-accent);
  color: var(--app-label-on-accent);
  padding: 0.55rem 0.8rem;
  font: inherit;
  cursor: pointer;
}
.sidebar__new:hover { background: var(--app-accent-hover); }

.sidebar__list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 0.25rem; }
.sidebar__empty { color: var(--app-label-caption); font-size: 0.85rem; padding: 0.5rem; }

.sidebar__item {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  text-align: left;
  border: 0;
  border-radius: var(--app-radius-md);
  background: transparent;
  color: var(--app-label-primary);
  padding: 0.5rem 0.6rem;
  font: inherit;
  cursor: pointer;
}
.sidebar__item:hover { background: var(--app-bg-layer-2); }
.sidebar__item--active { background: var(--app-bg-accent-soft); }
.sidebar__item-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sidebar__item-time { font-size: 0.75rem; color: var(--app-label-caption); }

.sidebar__appearance {
  border: 1px solid var(--app-border-l2);
  border-radius: var(--app-radius-md);
  background: transparent;
  color: var(--app-label-secondary);
  padding: 0.5rem 0.8rem;
  font: inherit;
  cursor: pointer;
}

/* dialog ---------------------------------------------------------------- */
.dialog {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--app-mask-l1);
}

.dialog__panel {
  width: min(360px, calc(100vw - 2rem));
  border-radius: var(--app-radius-lg);
  background: var(--app-bg-base);
  box-shadow: var(--app-shadow-lv2);
  padding: 1rem 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.dialog__head { display: flex; justify-content: space-between; align-items: center; }
.dialog__head button { border: 0; background: none; font: inherit; color: var(--app-label-tertiary); cursor: pointer; }
.dialog__section { display: flex; flex-direction: column; gap: 0.4rem; }
.dialog__label { font-size: 0.8rem; color: var(--app-label-secondary); }

.dialog__modes { display: flex; gap: 0.4rem; }
.dialog__mode {
  flex: 1;
  border: 1px solid var(--app-border-l2);
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-label-primary);
  padding: 0.4rem 0.5rem;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.dialog__mode--active { border-color: var(--app-accent); background: var(--app-bg-accent-soft); }

.dialog__stepper { display: flex; align-items: center; gap: 0.7rem; }
.dialog__stepper button {
  width: 1.8rem;
  height: 1.8rem;
  border: 1px solid var(--app-border-l2);
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-label-primary);
  font: inherit;
  cursor: pointer;
}
.dialog__stepper button:disabled { opacity: 0.4; cursor: not-allowed; }

@media (max-width: 768px) {
  .shell__menu { display: block; }
  .shell__backdrop { display: block; }
  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 25;
    transform: translateX(-100%);
    transition: transform var(--app-transition) var(--app-ease);
    box-shadow: var(--app-shadow-lv2);
  }
  .sidebar--open { transform: translateX(0); }
  .sidebar__close { display: block; }
}
```

同时把原 `.composer` 固定定位块（`position: fixed; bottom: 0; ...`）改为文档流内卡片：

```css
.composer {
  width: min(820px, 100%);
  margin: 0 auto;
  padding: 1rem;
  display: flex;
  gap: 0.5rem;
  border-top: 1px solid var(--app-border-l1);
}
```

- [ ] **Step 6: 更新 `App.test.tsx` 中受 UI 变更影响的两个用例**

替换 `shows that a thread URL will be added after the first message`：

```tsx
it("shows the new-session hint before any thread exists", () => {
  render(<App />);
  expect(screen.getByText("新会话 · 发送首条消息后生成链接")).toBeTruthy();
});
```

替换 `writes the created thread id into the URL and shows the session link`：

```tsx
it("writes the created thread id into the URL and shows the session link", () => {
  render(<App />);

  act(() => {
    (capturedStreamOptions?.onThreadId as ((id: string) => void) | undefined)?.("thread-123");
  });

  expect(window.location.search).toBe("?thread=thread-123");
  expect(screen.getByText("http://localhost:3000/?thread=thread-123")).toBeTruthy();
  expect(screen.getByText("复制会话链接")).toBeTruthy();
});
```

其余用例断言不变（todo 渲染、Sub-agent 卡片、AI plan、activity card 等）。同时给该文件顶部补 mock `@langchain/langgraph-sdk`（App 现在会挂 useThreads）：

```tsx
vi.mock("@langchain/langgraph-sdk", () => ({
  Client: vi.fn(() => ({
    threads: { search: vi.fn().mockResolvedValue([]) },
  })),
}));
```

- [ ] **Step 7: 全量测试 + 构建**

```bash
npm run test && npm run build
```
Expected: 全 PASS；构建成功。

- [ ] **Step 8: Commit**

```bash
cd /home/zhang/workplace/research_deepagent
git add frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/components/shell/ frontend/src/styles.css
git -c user.name=ZhangKun -c user.email=zk1634@163.com commit -m "feat(frontend): app shell with session sidebar and appearance dialog"
```

---

### Task 7: Composer 升级（textarea / Enter / IME / Stop）

**Files:**
- Create: `frontend/src/components/composer/Composer.tsx`
- Create: `frontend/src/components/composer/Composer.test.tsx`
- Modify: `frontend/src/App.tsx`（用 `<Composer />` 替换内联 form）
- Modify: `frontend/src/styles.css`（composer 输入框/按钮样式更新）

**Interfaces:**
- Consumes: `AgentStream.submit/stop`（Task 4）。
- Produces: `Composer({ isLoading, onSubmit, onStop }: { isLoading: boolean; onSubmit: (text: string) => void; onStop: () => void })`

- [ ] **Step 1: 写失败测试 `frontend/src/components/composer/Composer.test.tsx`**

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Composer from "./Composer";

afterEach(cleanup);

function type(text: string) {
  const input = screen.getByLabelText("Message input");
  fireEvent.change(input, { target: { value: text } });
}

describe("Composer", () => {
  it("sends on Enter and clears the draft", () => {
    const onSubmit = vi.fn();
    render(<Composer isLoading={false} onSubmit={onSubmit} onStop={vi.fn()} />);
    type("Research IBM");
    fireEvent.keyDown(screen.getByLabelText("Message input"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("Research IBM");
    expect((screen.getByLabelText("Message input") as HTMLTextAreaElement).value).toBe("");
  });

  it("does not send on Shift+Enter", () => {
    const onSubmit = vi.fn();
    render(<Composer isLoading={false} onSubmit={onSubmit} onStop={vi.fn()} />);
    type("Research IBM");
    fireEvent.keyDown(screen.getByLabelText("Message input"), {
      key: "Enter",
      shiftKey: true,
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not send while an IME composition is active", () => {
    const onSubmit = vi.fn();
    render(<Composer isLoading={false} onSubmit={onSubmit} onStop={vi.fn()} />);
    const input = screen.getByLabelText("Message input");
    type("研究");
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("研究");
  });

  it("does not send whitespace-only drafts", () => {
    const onSubmit = vi.fn();
    render(<Composer isLoading={false} onSubmit={onSubmit} onStop={vi.fn()} />);
    type("   ");
    fireEvent.keyDown(screen.getByLabelText("Message input"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows a Stop button while loading and routes clicks to onStop", () => {
    const onStop = vi.fn();
    render(<Composer isLoading onSubmit={vi.fn()} onStop={onStop} />);
    expect(screen.queryByLabelText("Send message")).toBeNull();
    fireEvent.click(screen.getByLabelText("Stop generation"));
    expect(onStop).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run --environment jsdom src/components/composer/Composer.test.tsx
```
Expected: FAIL（`Cannot find module './Composer'`）。

- [ ] **Step 3: 实现 `frontend/src/components/composer/Composer.tsx`**

```tsx
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

const MAX_VISIBLE_ROWS = 8;
const LINE_HEIGHT_PX = 24;

export default function Composer({
  isLoading,
  onSubmit,
  onStop,
}: {
  isLoading: boolean;
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
    if (!value || isLoading) return;
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
          disabled={!text.trim()}
          aria-label="Send message"
        >
          Send
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run --environment jsdom src/components/composer/Composer.test.tsx
```
Expected: PASS（5 个用例）。

- [ ] **Step 5: 接入 App —— 替换 Task 6 遗留的内联 form**

`App.tsx` 删除内联 `<form className="composer">…</form>`，改为：

```tsx
<Composer
  isLoading={stream.isLoading}
  onSubmit={stream.submit}
  onStop={stream.stop}
/>
```

（import 行加 `import Composer from "./components/composer/Composer";`。）

`styles.css` 的 composer 区块整体替换：

```css
.composer {
  width: min(820px, 100%);
  margin: 0 auto;
  padding: 0.75rem 1rem 1rem;
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}

.composer__input {
  flex: 1;
  resize: none;
  border: 1px solid var(--app-border-l2);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-base);
  color: var(--app-label-primary);
  font: inherit;
  padding: 0.6rem 0.8rem;
  line-height: 24px;
  overflow-y: auto;
}
.composer__input:focus {
  outline: none;
  border-color: var(--app-accent);
  box-shadow: var(--app-shadow-lv1);
}
.composer__input::placeholder { color: var(--app-label-caption); }

.composer__button {
  border: 0;
  border-radius: var(--app-radius-md);
  background: var(--app-accent);
  color: var(--app-label-on-accent);
  padding: 0.6rem 1.1rem;
  font: inherit;
  cursor: pointer;
}
.composer__button:hover:not(:disabled) { background: var(--app-accent-hover); }
.composer__button:disabled { opacity: 0.5; cursor: not-allowed; }
.composer__button--stop { background: var(--app-state-error); }
```

- [ ] **Step 6: 全量测试 + 构建 + Commit**

```bash
npm run test && npm run build
cd /home/zhang/workplace/research_deepagent
git add frontend/src/components/composer/ frontend/src/App.tsx frontend/src/styles.css
git -c user.name=ZhangKun -c user.email=zk1634@163.com commit -m "feat(frontend): auto-growing composer with IME guard and stop button"
```

---

### Task 8: TodoDock（composer 上方可折叠面板）

**Files:**
- Create: `frontend/src/components/todo/TodoDock.tsx`
- Delete: `frontend/src/TodoList.tsx`
- Modify: `frontend/src/App.tsx`（TodoList → TodoDock，置于 `.shell__content` 之外、`.shell__scroll` 内 composer 之前）
- Modify: `frontend/src/App.test.tsx`（todo 用例改为「折叠摘要 + 展开面板」两段断言）
- Modify: `frontend/src/styles.css`（`.todo-panel*` → `.todo-dock*`）

**Interfaces:**
- Consumes: `TodoItem`（`../../lib/stream`，Task 4 已定义）。
- Produces: `TodoDock({ todos }: { todos: TodoItem[] })`。折叠态 aria-label 仍为 `Research plan`，摘要文案 `{completed}/{total} · {progress}%`；展开态渲染与原 TodoList 相同的列表（`queued/active/done` 标签不变）。

- [ ] **Step 1: 实现 `frontend/src/components/todo/TodoDock.tsx`**

```tsx
import { useState, type ReactNode } from "react";
import type { TodoItem } from "../../lib/stream";

function statusLabel(status: TodoItem["status"]): string {
  switch (status) {
    case "completed":
      return "done";
    case "in_progress":
      return "active";
    default:
      return "queued";
  }
}

export default function TodoDock({ todos }: { todos: TodoItem[] }): ReactNode {
  const [expanded, setExpanded] = useState(false);
  if (todos.length === 0) return null;

  const completedCount = todos.filter((todo) => todo.status === "completed").length;
  const progress = Math.round((completedCount / todos.length) * 100);

  return (
    <section className="todo-dock" aria-label="Research plan">
      <button
        type="button"
        className="todo-dock__summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <strong>Research plan</strong>
        <span>{completedCount}/{todos.length} · {progress}%</span>
      </button>
      {expanded && (
        <ol className="todo-list">
          {todos.map((todo, index) => (
            <li
              key={`${todo.content}-${index}`}
              className={`todo-list__item todo-list__item--${todo.status}`}
            >
              <span className="todo-list__index">{index + 1}</span>
              <span className="todo-list__content">{todo.content}</span>
              <span className={`todo-list__status todo-list__status--${todo.status}`}>
                {statusLabel(todo.status)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

- [ ] **Step 2: 更新 `App.test.tsx` 的 todo 用例（折叠态摘要 + 展开态面板）**

替换 `renders live todo progress from deepagents state`：

```tsx
it("renders a collapsible todo dock with progress summary", () => {
  render(<App />);

  const summary = screen.getByText("Research plan");
  expect(summary).toBeTruthy();
  expect(screen.getByText("1/3 · 33%")).toBeTruthy();
  expect(screen.queryByText("Plan the report sections")).toBeNull();

  fireEvent.click(summary);
  expect(screen.getByText("Plan the report sections")).toBeTruthy();
  expect(screen.getByText("Research LangGraph 1.0 changes")).toBeTruthy();
  expect(screen.getByText("Write final summary")).toBeTruthy();
});
```

（`import { fireEvent }` 加入测试文件顶部的 testing-library import。）

`skips the todo panel when the backend has not emitted todos yet` 用例不变（`queryByText("Research plan")` 仍应为 null）。

- [ ] **Step 3: 接入 App 并删除旧组件**

`App.tsx`：
- import 行：`import TodoDock from "./components/todo/TodoDock";`，删除 `import TodoList from "./TodoList";`
- 渲染位置：`<TodoDock todos={stream.todos} />` 移到 `.shell__content` 闭合之后、`<Composer …>` 之前（`.shell__scroll` 的直接子级，使它视觉上贴住 composer 上方）。
- 删除文件 `frontend/src/TodoList.tsx`。

`styles.css`：`.todo-panel*` 类名全部改为 `.todo-dock*` 并追加摘要按钮样式：

```css
.todo-dock {
  width: min(820px, 100%);
  margin: 0 auto;
  padding: 0 1rem 0.5rem;
}

.todo-dock__summary {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid var(--app-border-l1);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-accent-soft);
  color: var(--app-label-primary);
  padding: 0.5rem 0.8rem;
  font: inherit;
  cursor: pointer;
  box-shadow: var(--app-shadow-lv1);
}
.todo-dock__summary span { color: var(--app-label-secondary); font-size: var(--app-content-font-size-secondary); }
```

（原 `.todo-panel` 的渐变背景、header/eyebrow/summary 区块随折叠改造一并删除；`.todo-list*` 各条目规则保留，仅把背景色换成 token：条目 `background: var(--app-bg-layer-1)`、completed `var(--app-bg-success-soft)`、in_progress `var(--app-bg-warn-soft)`；状态徽章同理用 `--app-state-success`/`--app-state-warn` 前景。）

- [ ] **Step 4: 全量测试 + 构建**

```bash
npm run test && npm run build
```
Expected: 全 PASS（todo 新断言 + 其余不变）。

- [ ] **Step 5: Commit**

```bash
cd /home/zhang/workplace/research_deepagent
git add -A frontend/src
git -c user.name=ZhangKun -c user.email=zk1634@163.com commit -m "feat(frontend): collapsible todo dock above the composer"
```

---

### Task 9: 工具卡片注册表

**Files:**
- Create: `frontend/src/components/tools/registry.ts`
- Create: `frontend/src/components/tools/registry.test.ts`
- Modify: `frontend/src/components/tools/ToolCallCard.tsx`（从 `frontend/src/ToolCallCard.tsx` 迁移并接注册表；删除原文件与其测试后在新位置重建 `frontend/src/components/tools/ToolCallCard.test.tsx`）
- Modify: `frontend/src/App.tsx` import 路径
- Modify: `frontend/src/styles.css`（追加 `.tool-card--subagent` 强调样式）

**Interfaces:**
- Consumes: `ToolCard`（`lib/messages`，Task 3）。
- Produces:
  - `type ToolCardMeta = { label: (name: string) => string; className?: string }`
  - `toolRegistry: Record<string, ToolCardMeta>`（含 `task` 项）
  - `toolMeta(name: string): ToolCardMeta`（未注册工具回退 `{ label: (n) => \`Tool: ${n}\` }`）

- [ ] **Step 1: 写失败测试 `frontend/src/components/tools/registry.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { toolMeta } from "./registry";

describe("toolMeta", () => {
  it("returns the registered sub-agent meta for task", () => {
    const meta = toolMeta("task");
    expect(meta.label("task")).toBe("Sub-agent: research-agent");
    expect(meta.className).toBe("tool-card--subagent");
  });

  it("falls back to the default label for unregistered tools", () => {
    const meta = toolMeta("web_search");
    expect(meta.label("web_search")).toBe("Tool: web_search");
    expect(meta.className).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run --environment jsdom src/components/tools/registry.test.ts
```
Expected: FAIL（`Cannot find module './registry'`）。

- [ ] **Step 3: 实现 `frontend/src/components/tools/registry.ts`**

```ts
// Minimal dsh-style renderer registry: per-tool label/class overrides with a
// default fallback. Extend this map — do not branch inside ToolCallCard.

export type ToolCardMeta = { label: (name: string) => string; className?: string };

export const toolRegistry: Record<string, ToolCardMeta> = {
  task: { label: () => "Sub-agent: research-agent", className: "tool-card--subagent" },
};

export function toolMeta(name: string): ToolCardMeta {
  return toolRegistry[name] ?? { label: (n) => `Tool: ${n}` };
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run --environment jsdom src/components/tools/registry.test.ts
```
Expected: PASS（2 个用例）。

- [ ] **Step 5: 迁移 ToolCallCard**

- `git mv frontend/src/ToolCallCard.tsx frontend/src/components/tools/ToolCallCard.tsx`（Windows 侧用移动+删除等价操作；测试文件同理迁到 `frontend/src/components/tools/ToolCallCard.test.tsx`）。
- 组件改动点（其余原样）：`import { toolMeta } from "./registry";` 与 `import type { ToolCard } from "../../lib/messages";`；函数体内：

```tsx
const meta = toolMeta(card.name);
const label = meta.label(card.name);
```

`<details>` 的 className 改为 `` `tool-card tool-card--${card.status}${meta.className ? ` ${meta.className}` : ""}` ``。
- 测试文件顶部 import 改为 `import ToolCallCard from "./ToolCallCard";`（断言不变，`Sub-agent: research-agent` 文案由注册表提供）。

- [ ] **Step 6: App.tsx import 路径更新**

```tsx
import ToolCallCard from "./components/tools/ToolCallCard";
```

`styles.css` 追加：

```css
.tool-card--subagent {
  background: var(--app-bg-accent-soft);
  border-color: var(--app-border-l3);
}
```

- [ ] **Step 7: 全量测试 + 构建 + Commit**

```bash
npm run test && npm run build
cd /home/zhang/workplace/research_deepagent
git add -A frontend/src
git -c user.name=ZhangKun -c user.email=zk1634@163.com commit -m "refactor(frontend): per-tool card registry for tool call cards"
```

---

### Task 10: 聊天组件拆分（MessageList / Message / ThinkingBlock / ActivityCard）

**Files:**
- Create: `frontend/src/components/chat/MessageList.tsx`
- Create: `frontend/src/components/chat/Message.tsx`
- Create: `frontend/src/components/chat/ActivityCard.tsx`
- Modify: `frontend/src/ThinkingBlock.tsx` → `git mv` 至 `frontend/src/components/chat/ThinkingBlock.tsx`
- Modify: `frontend/src/App.tsx`（渲染收缩为 `MessageList` + `ActivityCard` + 错误行）
- Modify: `frontend/src/styles.css`（`.msg*`/`.thinking-card*`/`.activity-card*`/`.chat` 区块 token 化重写）

**Interfaces:**
- Consumes: `Row`（`lib/messages`）、`ToolCallCard`（Task 9）。
- Produces:
  - `MessageList({ rows }: { rows: Row[] })`
  - `Message({ row }: { row: Extract<Row, { kind: "prose" }> })`
  - `ActivityCard({ visible }: { visible: boolean })`

- [ ] **Step 1: 实现 `frontend/src/components/chat/Message.tsx`**

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Row } from "../../lib/messages";
import type { ReactNode } from "react";

export default function Message({
  row,
}: {
  row: Extract<Row, { kind: "prose" }>;
}): ReactNode {
  return (
    <article className={`msg msg--${row.type}`}>
      <header className="msg__role">{row.type}</header>
      <div className="msg__body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{row.body}</ReactMarkdown>
      </div>
    </article>
  );
}
```

- [ ] **Step 2: 实现 `frontend/src/components/chat/MessageList.tsx`**

```tsx
import type { ReactNode } from "react";
import type { Row } from "../../lib/messages";
import Message from "./Message";
import ThinkingBlock from "./ThinkingBlock";
import ToolCallCard from "../tools/ToolCallCard";

export default function MessageList({ rows }: { rows: Row[] }): ReactNode {
  return (
    <>
      {rows.map((row) =>
        row.kind === "prose" ? (
          <Message key={row.key} row={row} />
        ) : row.kind === "plan" ? (
          <ThinkingBlock key={row.key} body={row.body} />
        ) : (
          <ToolCallCard key={row.key} card={row.card} />
        ),
      )}
    </>
  );
}
```

- [ ] **Step 3: 实现 `frontend/src/components/chat/ActivityCard.tsx`**

```tsx
import type { ReactNode } from "react";

export default function ActivityCard({ visible }: { visible: boolean }): ReactNode | null {
  if (!visible) return null;
  return (
    <div className="activity-card" aria-live="polite" aria-label="Research in progress">
      <div className="activity-card__pulse" aria-hidden="true">
        <span /><span /><span />
      </div>
      <div className="activity-card__copy">
        <strong>Research in progress</strong>
        <span>Waiting for sub-agent results and final synthesis.</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 迁移 ThinkingBlock 并更新 App**

- `git mv frontend/src/ThinkingBlock.tsx frontend/src/components/chat/ThinkingBlock.tsx`（import 不变，ReactMarkdown 依赖照旧）。
- `App.tsx`：`.chat` section 内容收缩为：

```tsx
<section className="chat" aria-label="Research conversation">
  {stream.rows.length === 0 && !stream.isLoading && (
    <p className="hint">
      Try: <em>"Research what LangGraph 1.0 added vs 0.x. Cite sources."</em>
    </p>
  )}
  <MessageList rows={stream.rows} />
  <ActivityCard visible={stream.isLoading} />
  {stream.error ? <p className="error">{String(stream.error)}</p> : null}
</section>
```

（原 rows.map 内联渲染、activity-card 内联块全部删除；相应 import 更新。）

- [ ] **Step 5: `styles.css` 中 `.chat`/`.msg*`/`.thinking-card*`/`.activity-card*`/`.hint`/`.error` 区块 token 化重写**

```css
.chat {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 1rem 0;
}

.msg {
  border-radius: var(--app-radius-md);
  padding: 0.75rem 1rem;
  background: var(--app-bg-layer-1);
}
.msg--human { background: var(--app-bubble-user); }

.msg__role {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--app-label-tertiary);
  margin-bottom: 0.25rem;
}

.msg__body > :first-child { margin-top: 0; }
.msg__body > :last-child { margin-bottom: 0; }
.msg__body table { border-collapse: collapse; margin: 0.5rem 0; }
.msg__body th, .msg__body td {
  border: 1px solid var(--app-border-l2);
  padding: 0.35rem 0.6rem;
  text-align: left;
}
.msg__body pre {
  background: var(--app-bg-layer-2);
  padding: 0.75rem;
  border-radius: var(--app-radius-sm);
  overflow-x: auto;
  font-family: var(--app-font-family-code);
}

.thinking-card {
  border: 1px solid var(--app-border-l2);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-accent-soft);
}
.thinking-card__summary {
  list-style: none;
  cursor: pointer;
  padding: 0.6rem 0.9rem;
}
.thinking-card__summary::-webkit-details-marker { display: none; }
.thinking-card__summary::marker { display: none; }
.thinking-card__name {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--app-label-tertiary);
}
.thinking-card__body { padding: 0 0.9rem 0.75rem; }
.thinking-card__body > :first-child { margin-top: 0; }
.thinking-card__body > :last-child { margin-bottom: 0; }

.activity-card {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem 1rem;
  border-radius: var(--app-radius-md);
  background: var(--app-bg-accent-soft);
  box-shadow: var(--app-shadow-lv1);
}
.activity-card__pulse { display: inline-flex; align-items: center; gap: 0.28rem; flex-shrink: 0; }
.activity-card__pulse span {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: var(--app-accent);
  animation: activity-pulse 1.2s infinite ease-in-out;
}
.activity-card__pulse span:nth-child(2) { animation-delay: 0.15s; }
.activity-card__pulse span:nth-child(3) { animation-delay: 0.3s; }
.activity-card__copy { display: flex; flex-direction: column; gap: 0.15rem; }
.activity-card__copy span { color: var(--app-label-secondary); font-size: var(--app-content-font-size-secondary); }

.hint { color: var(--app-label-tertiary); font-style: italic; }
.error { color: var(--app-state-error); }
```

（删除这些区块的原定义，包括末尾整个 `@media (prefers-color-scheme: dark)` 覆盖块——token 已按 `body[data-theme]` 切换。）

- [ ] **Step 6: 全量测试 + 构建**

```bash
npm run test && npm run build
```
Expected: 全 PASS（现有 App.test 的渲染断言全部不变地通过）。

- [ ] **Step 7: Commit**

```bash
cd /home/zhang/workplace/research_deepagent
git add -A frontend/src
git -c user.name=ZhangKun -c user.email=zk1634@163.com commit -m "refactor(frontend): split chat rendering into components"
```

---

### Task 11: 收尾验收（无硬编码颜色检查、ToolCallCard 样式 token 化、README、全量回归）

**Files:**
- Modify: `frontend/src/styles.css`（`.tool-card*` 区块 token 化——这是最后一个含硬编码颜色的区块）
- Modify: `README.md`（冒烟测试一节补充主题/侧栏说明）

**Interfaces:**
- Consumes: 前 10 个任务的全部产物。

- [ ] **Step 1: `.tool-card*` 区块 token 化**

```css
/* Tool / sub-agent cards ------------------------------------------------ */
.tool-card {
  border: 1px solid var(--app-border-l2);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-warn-soft);
}

.tool-card--done { background: var(--app-bg-success-soft); }
.tool-card--subagent { background: var(--app-bg-accent-soft); }

.tool-card__summary {
  list-style: none;
  cursor: pointer;
  padding: 0.6rem 0.9rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.tool-card__summary::-webkit-details-marker { display: none; }
.tool-card__summary::marker { display: none; }

.tool-card__name { font-weight: 600; font-size: 0.95rem; }

.tool-card__badge {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.15em 0.5em;
  border-radius: 999px;
}
.tool-card__badge--pending { background: var(--app-bg-warn-soft); color: var(--app-state-warn); }
.tool-card__badge--done { background: var(--app-bg-success-soft); color: var(--app-state-success); }

.tool-card__body {
  padding: 0 0.9rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.tool-card__section { display: flex; flex-direction: column; gap: 0.25rem; }
.tool-card__label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--app-label-caption);
}
.tool-card__code {
  background: var(--app-bg-layer-2);
  border-radius: var(--app-radius-sm);
  padding: 0.5rem 0.65rem;
  font-size: 0.85em;
  font-family: var(--app-font-family-code);
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
}
.tool-card__code--result { max-height: 360px; }
```

（删除原 `.tool-card*` 区块与 dark-mode 覆盖。）

- [ ] **Step 2: 无硬编码颜色检查**

```bash
cd /home/zhang/workplace/research_deepagent/frontend
grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/styles.css src/components src/theme/ThemeProvider.tsx src/lib
```
Expected: 仅 `src/theme/tokens.css` 命中；`src/styles.css` 与组件目录零命中。若命中则改回对应 `--app-*` token 并重跑。

- [ ] **Step 3: 更新 `README.md`**

冒烟测试一节末尾追加：

```markdown
前端支持浅色/深色/跟随系统三种主题与 12–17px 正文字号：侧栏底部「外观设置」
中切换，选择持久化在浏览器 localStorage（key `research-agent.ui-prefs`）。
```

- [ ] **Step 4: 全量回归**

```bash
npm run test && npm run build
cd /home/zhang/workplace/research_deepagent && uv run pytest -q
```
Expected: 前端 vitest 全 PASS、vite build 成功；Python 侧 pytest 不受影响（全 PASS）。

- [ ] **Step 5: 手动冒烟（如环境可用；不可用则记录跳过原因）**

启动 `uvx agentseek dev` + `npm run dev`，按 README 冒烟流程走一轮：三态主题切换无闪白、字号步进生效、侧栏会话切换、Composer Enter/Shift+Enter、Stop 按钮。

- [ ] **Step 6: Commit**

```bash
cd /home/zhang/workplace/research_deepagent
git add frontend/src/styles.css README.md
git -c user.name=ZhangKun -c user.email=zk1634@163.com commit -m "feat(frontend): finish token migration and document appearance settings"
```
