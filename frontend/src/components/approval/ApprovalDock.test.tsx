import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { ApprovalDock } from "./ApprovalDock";

afterEach(cleanup);

const gateRequest = {
  actionRequests: [{ name: "request_phase_approval", args: { phase: "prd", summary: "3 条需求" } }],
  reviewConfigs: [{ action_name: "request_phase_approval", allowed_decisions: ["respond"] }],
};

describe("ApprovalDock", () => {
  it("renders respond textarea for gate approval", () => {
    render(<ApprovalDock pendingApproval={gateRequest} onSubmit={vi.fn()} />);
    expect(screen.getByText(/阶段门禁/)).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("renders approve/reject for sensitive tools", () => {
    render(
      <ApprovalDock
        pendingApproval={{
          actionRequests: [{ name: "pencli_x", args: {} }],
          reviewConfigs: [{ action_name: "pencli_x", allowed_decisions: ["approve", "reject"] }],
        }}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /批准/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /拒绝/ })).toBeTruthy();
  });

  it("submits respond decision with user text", () => {
    const onSubmit = vi.fn();
    render(<ApprovalDock pendingApproval={gateRequest} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "同意，继续" } });
    fireEvent.click(screen.getByRole("button", { name: /提交/ }));
    expect(onSubmit).toHaveBeenCalledWith([{ type: "respond", message: "同意，继续" }]);
  });

  it("renders nothing when no pending approval", () => {
    const { container } = render(<ApprovalDock pendingApproval={null} onSubmit={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("submits reject decision with the entered reason", () => {
    const onSubmit = vi.fn();
    render(
      <ApprovalDock
        pendingApproval={{
          actionRequests: [{ name: "delete", args: { path: "/memories/x.md" } }],
          reviewConfigs: [{ action_name: "delete", allowed_decisions: ["approve", "reject"] }],
        }}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /拒绝/ }));
    const reason = screen.getByLabelText("拒绝原因");
    fireEvent.change(reason, { target: { value: "路径不对，先别删" } });
    fireEvent.click(screen.getByRole("button", { name: /确认拒绝/ }));
    expect(onSubmit).toHaveBeenCalledWith([{ type: "reject", message: "路径不对，先别删" }]);
  });

  it("shows tool name and args summary per action request", () => {
    render(<ApprovalDock pendingApproval={gateRequest} onSubmit={vi.fn()} />);
    expect(screen.getByText(/request_phase_approval/)).toBeTruthy();
    expect(screen.getByText(/prd/)).toBeTruthy();
  });

  it("resets recorded decisions and allows re-submit when submission fails", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <ApprovalDock pendingApproval={gateRequest} onSubmit={onSubmit} />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "第一次意见" } });
    fireEvent.click(screen.getByRole("button", { name: /提交/ }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/已选择/)).toBeTruthy();

    // 提交失败：错误展示且已记录的决策被清空，卡片回到可编辑状态
    rerender(
      <ApprovalDock
        pendingApproval={gateRequest}
        onSubmit={onSubmit}
        error={new Error("提交失败")}
      />,
    );
    expect(screen.getByText(/提交失败/)).toBeTruthy();
    expect(screen.queryByText(/已选择/)).toBeNull();
    expect(screen.getByRole("textbox")).toBeTruthy();

    // 用户调整意见后可重新提交
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "修改后的意见" } });
    fireEvent.click(screen.getByRole("button", { name: /提交/ }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith([{ type: "respond", message: "修改后的意见" }]);
  });
});
