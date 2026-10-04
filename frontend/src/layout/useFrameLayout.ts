// frontend/src/layout/useFrameLayout.ts
// 框架布局状态：视口测量 + 两侧偏好（localStorage 持久化）+ 窄视口自动收起。
// 语义对齐参照 AppFrame.tsx:147-192（视口来自 ResizeObserver，窄视口自动折叠）。

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import {
  RIGHTBAR_DEFAULT_RATIO,
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_DEFAULT,
  RIGHTBAR_MAX_RATIO,
  RIGHTBAR_MIN,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  clampWidth,
  computeColumns,
  type Columns,
} from "./columns";

// 测试与本模块的消费方从 "./useFrameLayout" 导入这些常量（简报契约），原样转出口。
export { RIGHTBAR_DEFAULT_RATIO, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED } from "./columns";

const SIDEBAR_KEY = "harness.sidebar";
const RIGHTBAR_KEY = "harness.rightbar";

function readStoredNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeStoredNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* 隐私模式等写入失败静默降级 */
  }
}

function removeStoredNumber(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export type FrameLayoutState = {
  viewport: number;
  sidebarPref: number;
  rightbarPref: number | null;
  narrowExpanded: boolean;
  sidebarCollapsed: boolean;
  rightbarTrack: boolean;
  cols: Columns;
};

export type FrameActions = {
  setSidebar(px: number): void;
  setRightbar(px: number): void;
  toggleSidebar(): void;
  openRightbar(viewport: number): void;
  closeRightbar(): void;
  setNarrowExpanded(v: boolean): void;
};

export function useFrameLayout(frameRef: RefObject<HTMLElement | null>): {
  layout: FrameLayoutState;
  actions: FrameActions;
} {
  const [viewport, setViewport] = useState(() => frameRef.current?.clientWidth || window.innerWidth);
  const [sidebarPref, setSidebarPref] = useState(() => readStoredNumber(SIDEBAR_KEY) ?? SIDEBAR_DEFAULT);
  const [rightbarPref, setRightbarPref] = useState<number | null>(() => readStoredNumber(RIGHTBAR_KEY));
  const [narrowExpanded, setNarrowExpanded] = useState(false);
  const [rightbarTrack, setRightbarTrack] = useState(() => readStoredNumber(RIGHTBAR_KEY) !== null);

  useEffect(() => {
    const el = frameRef.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setViewport(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [frameRef]);

  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE;
  const sidebarCollapsed = narrow ? !narrowExpanded : sidebarPref === 0;
  const sidebarPreference = sidebarCollapsed
    ? 0
    : sidebarPref === 0
      ? SIDEBAR_DEFAULT
      : sidebarPref;
  const rightbarPreference = rightbarPref ?? viewport * RIGHTBAR_DEFAULT_RATIO;
  const cols = useMemo(
    () => computeColumns(viewport, sidebarPreference, rightbarTrack ? rightbarPreference : 0),
    [viewport, sidebarPreference, rightbarTrack, rightbarPreference],
  );

  const setSidebar = useCallback((px: number) => {
    const clamped = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX);
    setSidebarPref(clamped);
    writeStoredNumber(SIDEBAR_KEY, clamped);
  }, []);
  const setRightbar = useCallback((px: number) => {
    // clamp 用视口比例上限；宽度低于 RIGHTBAR_MIN 时收起轨道（与参照手感一致）
    const max = window.innerWidth * RIGHTBAR_MAX_RATIO;
    const clamped = clampWidth(px, RIGHTBAR_MIN, max);
    setRightbarPref(clamped);
    writeStoredNumber(RIGHTBAR_KEY, clamped);
  }, []);
  const toggleSidebar = useCallback(() => {
    if (narrow) setNarrowExpanded((v) => !v);
    else {
      const next = sidebarPref === 0 ? SIDEBAR_DEFAULT : 0;
      setSidebarPref(next);
      if (next !== 0) writeStoredNumber(SIDEBAR_KEY, next);
      else removeStoredNumber(SIDEBAR_KEY);
    }
  }, [narrow, sidebarPref]);
  const openRightbar = useCallback((vp: number) => {
    // 偏好为空时按视口比例取默认值，并立即持久化（与测试契约一致）
    setRightbarPref((current) => {
      const next = current ?? vp * RIGHTBAR_DEFAULT_RATIO;
      writeStoredNumber(RIGHTBAR_KEY, next);
      return next;
    });
    setRightbarTrack(true);
  }, []);
  const closeRightbar = useCallback(() => {
    setRightbarTrack(false);
    removeStoredNumber(RIGHTBAR_KEY);
  }, []);

  return {
    layout: { viewport, sidebarPref, rightbarPref, narrowExpanded, sidebarCollapsed, rightbarTrack, cols },
    actions: { setSidebar, setRightbar, toggleSidebar, openRightbar, closeRightbar, setNarrowExpanded },
  };
}
