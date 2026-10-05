import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ApprovalDialog } from "./ApprovalDialog";

afterEach(cleanup);

const gateRequest = {
  actionRequests: [{ name: "request_phase_approval", args: { phase: "prd", summary: "3 条需求" } }],
  reviewConfigs: [{ action_name: "request_phase_approval", allowed_decisions: ["respond"] }],
};

const sensitiveRequest = {
  actionRequests: [{ name: "pencli_x", args: { cmd: "deploy" } }],
  reviewConfigs: [{ action_name: "pencli_x", allowed_decisions: ["approve", "reject"] }],
};

describe("ApprovalDialog", () => {
  it("renders nothing without a pending approval", () => {
    render(<ApprovalDialog pendingApproval={null} onSubmit={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders a modal dialog with gate title, tool name, and args summary", () => {
    render(<ApprovalDialog pendingApproval={gateRequest} onSubmit={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/阶段门禁/)).toBeTruthy();
    expect(screen.getByText("request_phase_approval")).toBeTruthy();
    expect(screen.getByText(/3 条需求/)).toBeTruthy();
  });

  it("fills the textarea from the quick approve card and stays editable", () => {
    render(<ApprovalDialog pendingApproval={gateRequest} onSubmit={vi.fn()} />);
    const quick = screen.getByRole("button", { name: /同意，继续下一阶段/ });
    const input = screen.getByLabelText("门禁回复") as HTMLTextAreaElement;
    fireEvent.click(quick);
    expect(input.value).toBe("同意，继续下一阶段");
    fireEvent.change(input, { target: { value: "同意，但 REQ-003 要改" } });
    expect(input.value).toBe("同意，但 REQ-003 要改");
  });

  it("disables submit while the respond text is empty", () => {
    render(<ApprovalDialog pendingApproval={gateRequest} onSubmit={vi.fn()} />);
    const submit = screen.getByRole("button", { name: "提交" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("门禁回复"), { target: { value: "同意" } });
    expect(submit.disabled).toBe(false);
  });

  it("submits the respond decision with the typed message", () => {
    const onSubmit = vi.fn();
    render(<ApprovalDialog pendingApproval={gateRequest} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /同意，继续下一阶段/ }));
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    expect(onSubmit).toHaveBeenCalledWith([{ type: "respond", message: "同意，继续下一阶段" }]);
  });

  it("renders approve/reject cards for sensitive tools; approve submits directly", () => {
    const onSubmit = vi.fn();
    render(<ApprovalDialog pendingApproval={sensitiveRequest} onSubmit={onSubmit} />);
    expect(screen.getByText("敏感操作")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /批准/ }));
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    expect(onSubmit).toHaveBeenCalledWith([{ type: "approve" }]);
  });

  it("requires a reason for reject", () => {
    const onSubmit = vi.fn();
    render(<ApprovalDialog pendingApproval={sensitiveRequest} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /拒绝/ }));
    const reason = screen.getByLabelText("拒绝原因") as HTMLTextAreaElement;
    expect((screen.getByRole("button", { name: "提交" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(reason, { target: { value: "风险太高" } });
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    expect(onSubmit).toHaveBeenCalledWith([{ type: "reject", message: "风险太高" }]);
  });

  it("paginates multiple action requests and submits decisions in order", () => {
    const onSubmit = vi.fn();
    render(
      <ApprovalDialog
        pendingApproval={{
          actionRequests: [
            gateRequest.actionRequests[0]!,
            sensitiveRequest.actionRequests[0]!,
          ],
          reviewConfigs: [gateRequest.reviewConfigs[0]!, sensitiveRequest.reviewConfigs[0]!],
        }}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByText("1/2")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("门禁回复"), { target: { value: "同意" } });
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("2/2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /批准/ }));
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    expect(onSubmit).toHaveBeenCalledWith([
      { type: "respond", message: "同意" },
      { type: "approve" },
    ]);
  });

  it("shows the submission error inside the dialog", () => {
    render(<ApprovalDialog pendingApproval={gateRequest} onSubmit={vi.fn()} error="channel refused" />);
    expect(screen.getByText(/channel refused/)).toBeTruthy();
  });
});
