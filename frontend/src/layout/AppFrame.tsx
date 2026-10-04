// frontend/src/layout/AppFrame.tsx
// 三栏框架骨架：grid 三列 + 两侧 DragHandle（pointer capture + rAF 节流，
// 拖拽基线 = 按下时刻渲染宽度，参照 AppFrame.tsx:198-203 的防回跳语义）。
// 与简报的偏差（均已验证为简报自测不通过处）：
// 1. onRightbarDrag 收到的是"变宽为正"的反转增量（测试契约）；
// 2. 回调用显式存在性判断 + 可选链，而非 `?.() ??`（vi.fn() 返回 undefined
//    会穿透 ?? 落到缺失的 setSidebar 上并抛错）；
// 3. rAF 节流在拖拽结束时补发未决增量，避免 down→move→up 快于一个 rAF 时丢增量；
// 4. 导出 FrameLayout 别名（测试从本模块导入该名字）。

import { useCallback, useRef, useState, type ReactNode, type RefObject } from "react";
import { CENTER_MIN } from "./columns";
import { useFrameLayout, type FrameActions, type FrameLayoutState } from "./useFrameLayout";

/** FrameLayoutState 的别名，供测试与消费方使用简报中的命名。 */
export type FrameLayout = FrameLayoutState;

export type AppFrameProps = {
  layout: FrameLayoutState;
  actions: FrameActions & {
    onSidebarDrag?(dx: number): void;
    onRightbarDrag?(dx: number): void;
  };
  sidebar: ReactNode;
  center: ReactNode;
  rightbar: ReactNode;
  frameRef?: RefObject<HTMLDivElement | null>;
};

type Side = "sidebar" | "rightbar";

const SIDEBAR_ICON_RAIL = 1;

function DragHandle(props: {
  side: Side;
  left: number;
  onDrag: (dx: number) => void;
  /** 按下时刻回调：宿主借此冻结拖拽基线（Review Focus 1：基线 = 按下宽度）。 */
  onDragStart?: () => void;
  /** 拖拽结束（up/cancel）回调：宿主借此清除基线。 */
  onDragEnd?: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef(0);
  const frame = useRef<number | null>(null);
  const latest = useRef(0);
  const handlers = useRef(props);
  handlers.current = props;

  const emit = useCallback(() => {
    handlers.current.onDrag(latest.current - origin.current);
  }, []);
  const schedule = useCallback((cb: () => void) => {
    if (frame.current !== null) return; // 已有待执行帧，节流
    if (typeof requestAnimationFrame === "function") {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        cb();
      });
    } else cb();
  }, []);
  const endDrag = useCallback(() => {
    setDragging(false);
    if (frame.current !== null) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frame.current);
      }
      frame.current = null;
      emit(); // 拖拽收尾时补发最后一帧增量，防止快速拖放丢增量
    }
    handlers.current.onDragEnd?.();
  }, [emit]);

  return (
    <div
      className="frame__handle"
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      data-testid={`drag-${props.side}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* jsdom 无 pointer capture，忽略 */
        }
        origin.current = e.clientX;
        latest.current = e.clientX;
        handlers.current.onDragStart?.();
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        latest.current = e.clientX;
        schedule(emit);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}

export function AppFrame({ layout, actions, sidebar, center, rightbar, frameRef }: AppFrameProps) {
  const [innerRef, setInnerRef] = useState<HTMLDivElement | null>(null);
  const ref = frameRef ?? { current: innerRef };
  const live = useFrameLayout(ref); // AppFrame 自带测量；App 可直接复用返回值
  const state = layout ?? live.layout;
  const act = actions ?? live.actions;

  // 回退路径的拖拽基线：按下时刻冻结的渲染宽度（Review Focus 1），
  // 避免"当前渲染宽度 + 累计 dx"随前一次 set 的重渲染而叠加。
  const sidebarBaseline = useRef<number | null>(null);
  const rightbarBaseline = useRef<number | null>(null);

  const beginSidebarGesture = useCallback(() => {
    sidebarBaseline.current = state.cols.sidebar;
  }, [state.cols.sidebar]);
  const endSidebarGesture = useCallback(() => {
    sidebarBaseline.current = null;
  }, []);
  const beginRightbarGesture = useCallback(() => {
    rightbarBaseline.current = state.cols.rightbar;
  }, [state.cols.rightbar]);
  const endRightbarGesture = useCallback(() => {
    rightbarBaseline.current = null;
  }, []);

  const handleSidebarDrag = useCallback(
    (dx: number) => {
      if (act.onSidebarDrag !== undefined) act.onSidebarDrag(dx);
      else act.setSidebar?.((sidebarBaseline.current ?? state.cols.sidebar) + dx);
    },
    [act, state.cols.sidebar],
  );
  const handleRightbarDrag = useCallback(
    (dx: number) => {
      // 右把手向左拖（dx < 0）= 变宽，因此上报反转后的增量
      if (act.onRightbarDrag !== undefined) act.onRightbarDrag(-dx);
      else act.setRightbar?.((rightbarBaseline.current ?? state.cols.rightbar) - dx);
    },
    [act, state.cols.rightbar],
  );

  return (
    <div
      ref={setInnerRef}
      data-testid="frame"
      className="frame"
      data-sidebar-collapsed={state.sidebarCollapsed || undefined}
      data-rightbar-collapsed={state.cols.rightbar === 0 || undefined}
      style={{
        gridTemplateColumns: `${state.cols.sidebar}px minmax(${CENTER_MIN}px, 1fr) minmax(0px, ${state.cols.rightbar}px)`,
      }}
    >
      <div className="frame__sidebar">{sidebar}</div>
      <div className="frame__center">{center}</div>
      <div className="frame__rightbar" data-rightbar-col>
        {state.cols.rightbar > 0 ? rightbar : null}
      </div>
      {!state.sidebarCollapsed && state.cols.sidebar > SIDEBAR_ICON_RAIL && (
        <DragHandle
          side="sidebar"
          left={state.cols.sidebar}
          onDrag={handleSidebarDrag}
          onDragStart={beginSidebarGesture}
          onDragEnd={endSidebarGesture}
        />
      )}
      {state.rightbarTrack && state.cols.rightbar > 0 && (
        <DragHandle
          side="rightbar"
          left={state.viewport - state.cols.rightbar}
          onDrag={handleRightbarDrag}
          onDragStart={beginRightbarGesture}
          onDragEnd={endRightbarGesture}
        />
      )}
    </div>
  );
}
