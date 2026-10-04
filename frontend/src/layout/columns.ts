// frontend/src/layout/columns.ts
// 三栏几何：常量与求解语义逐字对齐参照项目 ui-layout/src/client/columns.ts:11-59
// （spec §2.1）。右栏先收缩、再失去轨道，之后中央才允许低于最小值；侧栏不让位。

/** 中央列在右栏打开时受保护的最小宽度。 */
export const CENTER_MIN = 400;
/** 侧栏拖拽下限。 */
export const SIDEBAR_MIN = 264;
/** 侧栏拖拽上限。 */
export const SIDEBAR_MAX = 420;
/** 侧栏默认宽度。 */
export const SIDEBAR_DEFAULT = 280;
/** 侧栏收起后的图标栏宽度。 */
export const SIDEBAR_COLLAPSED = 56;
/** 低于该视口宽度时侧栏自动收起。 */
export const SIDEBAR_AUTO_COLLAPSE = 1024;
/** 右栏拖拽下限。 */
export const RIGHTBAR_MIN = 300;
/** 右栏最大宽度占框架比例。 */
export const RIGHTBAR_MAX_RATIO = 0.7;
/** 右栏首开偏好占框架比例。 */
export const RIGHTBAR_DEFAULT_RATIO = 0.45;

/** 一次列求解的解析结果。 */
export type Columns = { sidebar: number; center: number; rightbar: number };

/** 把宽度 clamp 进 [min, max] 并取整。 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)));
}

/**
 * 求解一次三栏宽度。
 * @param viewport 框架可用宽度 px。
 * @param sidebar 侧栏偏好（0 = 收起为图标栏）。
 * @param rightbar 右栏请求宽度（0 = 无轨道）。
 * @param collapsedWidth 侧栏收起时的轨道宽度。
 */
export function computeColumns(
  viewport: number,
  sidebar: number,
  rightbar: number,
  collapsedWidth: number = SIDEBAR_COLLAPSED,
): Columns {
  const s = sidebar === 0 ? collapsedWidth : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX);
  const available = viewport - s - CENTER_MIN;
  const r =
    rightbar === 0 || available < RIGHTBAR_MIN
      ? 0
      : Math.min(available, clampWidth(rightbar, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO));
  return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r };
}
