// frontend/src/panels/PanelHost.tsx
// 右栏面板域：tab 注册表 + 面板体。参照 rightbar 语义——本组件只负责
// "轨道内的内容"，轨道有无由 AppFrame 的列求解决定（spec §4.2）。
// rail 模式（final review C1）：轨道收起（cols.rightbar === 0）时 PanelHost
// 仍保持挂载，呈右缘竖排 tab affordance；rail 里点击 tab 只会激活（打开轨道），
// 不存在"再点收起"（轨道本已收起）。

import { useEffect, type ReactNode } from "react";
import { PanelErrorBoundary } from "./PanelErrorBoundary";

export type PanelId = "subagents" | "workbench";

export type PanelDef = {
  id: PanelId;
  title: string;
  render(): ReactNode;
};

export function persistActivePanel(id: PanelId | null, key = "harness.panel"): void {
  try {
    if (id === null) localStorage.removeItem(key);
    else localStorage.setItem(key, id);
  } catch {
    /* ignore */
  }
}

export function readActivePanel(key = "harness.panel"): PanelId | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === "subagents" || raw === "workbench" ? raw : null;
  } catch {
    return null;
  }
}

export function PanelHost(props: {
  panels: PanelDef[];
  activeId: PanelId | null;
  onActivate(id: PanelId | null): void;
  persistKey?: string;
  /** 轨道收起时的右缘竖排 affordance 形态（tab 仍可点，点击 = 打开轨道）。 */
  rail?: boolean;
}): ReactNode {
  const { panels, activeId, onActivate, persistKey, rail = false } = props;
  useEffect(() => {
    persistActivePanel(activeId, persistKey);
  }, [activeId, persistKey]);
  if (rail) {
    return (
      <div className="panel-host panel-host--rail">
        <div
          className="panel-host__tabs panel-host__tabs--rail"
          role="tablist"
          aria-orientation="vertical"
          aria-label="Panels"
        >
          {panels.map((panel) => (
            <button
              key={panel.id}
              type="button"
              role="tab"
              title={panel.title}
              aria-selected={panel.id === activeId}
              className={`panel-host__tab panel-host__tab--rail${panel.id === activeId ? " panel-host__tab--active" : ""}`}
              onClick={() => onActivate(panel.id)}
            >
              {panel.title}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const active = panels.find((p) => p.id === activeId) ?? null;
  return (
    <div className="panel-host">
      <div className="panel-host__tabs" role="tablist">
        {panels.map((panel) => (
          <button
            key={panel.id}
            type="button"
            role="tab"
            aria-selected={panel.id === activeId}
            className={`panel-host__tab${panel.id === activeId ? " panel-host__tab--active" : ""}`}
            onClick={() => onActivate(panel.id === activeId ? null : panel.id)}
          >
            {panel.title}
          </button>
        ))}
      </div>
      <div className="panel-host__body" role="tabpanel">
        {active === null
          ? <p className="panel-host__empty">{panels.length === 0 ? "No panels available" : "Select a panel"}</p>
          : <PanelErrorBoundary key={active.id} render={active.render} />}
      </div>
    </div>
  );
}
