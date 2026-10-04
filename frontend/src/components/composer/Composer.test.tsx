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

  it("does not send while an approval is pending (Review Focus 1)", () => {
    const onSubmit = vi.fn();
    render(<Composer isLoading={false} disabled onSubmit={onSubmit} onStop={vi.fn()} />);
    type("绕过审批");
    fireEvent.keyDown(screen.getByLabelText("Message input"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    const send = screen.getByLabelText("Send message") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
