// frontend/src/panels/PanelErrorBoundary.tsx
// 面板级错误边界（spec §7）：单个面板体崩溃只降级该面板（fallback + Retry），
// 不拖垮 PanelHost 的 tab 栏与相邻面板。render 以 prop 传入并在边界内部调用，
// 保证抛错发生在边界自身的 render 阶段（若是 children 预先求值则会越过边界）。

import { Component, type ReactNode } from "react";

type Props = { render(): ReactNode };
type State = { failed: boolean };

export class PanelErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error("[panel] panel body crashed", error);
  }

  private readonly retry = (): void => {
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="panel-host__error" role="alert">
          <p>Panel crashed</p>
          <button type="button" onClick={this.retry}>Retry</button>
        </div>
      );
    }
    // render 必须在子组件里调用：错误边界只捕获其子树的错误，
    // 自身 render 抛错不会被自己的 getDerivedStateFromError 捕获。
    return <PanelBody render={this.props.render} />;
  }
}

function PanelBody(props: { render(): ReactNode }): ReactNode {
  return <>{props.render()}</>;
}
