import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  ApprovalDecision,
  PendingApproval,
  ReviewConfig,
} from "../../lib/stream";

const GATE_TITLE = "阶段门禁";
const SENSITIVE_TITLE = "敏感操作";
const QUICK_APPROVE = "同意，继续下一阶段";

function argsSummary(args: Record<string, unknown> | undefined): string {
  if (!args || Object.keys(args).length === 0) return "{}";
  return JSON.stringify(args, null, 2);
}

function isGateConfig(config: ReviewConfig | undefined): boolean {
  return (config?.allowed_decisions ?? []).every((d) => d === "respond");
}

/**
 * 单页作答区：respond 门禁（快捷卡 + 自由输入）或敏感操作（批准 / 拒绝+理由）。
 * 决策暂存在对话框的 drafts 里，底部「提交」统一按 actionRequests 顺序组装。
 */
function ApprovalPage({
  config,
  text,
  onTextChange,
  choice,
  onChoice,
}: {
  config: ReviewConfig | undefined;
  text: string;
  onTextChange: (value: string) => void;
  choice: ApprovalDecision | null;
  onChoice: (decision: ApprovalDecision | null) => void;
}): ReactNode {
  const gate = isGateConfig(config);
  if (gate) {
    return (
      <div className="approval-dialog__answer">
        <button
          type="button"
          className="approval-dialog__option"
          onClick={() => onTextChange(QUICK_APPROVE)}
        >
          <span className="approval-dialog__option-title">{QUICK_APPROVE}</span>
          <span className="approval-dialog__option-desc">通过本阶段检查，推进下一阶段</span>
        </button>
        <textarea
          className="approval-dialog__input"
          rows={2}
          value={text}
          placeholder="输入你的答案：同意或填写修订意见…"
          aria-label="门禁回复"
          onChange={(e) => onTextChange(e.target.value)}
        />
      </div>
    );
  }
  const rejected = choice?.type === "reject";
  return (
    <div className="approval-dialog__answer">
      <button
        type="button"
        className={`approval-dialog__option${choice?.type === "approve" ? " approval-dialog__option--selected" : ""}`}
        aria-pressed={choice?.type === "approve"}
        onClick={() => onChoice({ type: "approve" })}
      >
        <span className="approval-dialog__option-title">批准</span>
        <span className="approval-dialog__option-desc">放行本次敏感操作</span>
      </button>
      <button
        type="button"
        className={`approval-dialog__option approval-dialog__option--danger${rejected ? " approval-dialog__option--selected" : ""}`}
        aria-pressed={rejected}
        onClick={() => onChoice(rejected ? null : { type: "reject", message: "" })}
      >
        <span className="approval-dialog__option-title">拒绝</span>
        <span className="approval-dialog__option-desc">驳回本次操作，理由将反馈给编排者</span>
      </button>
      {rejected && (
        <textarea
          className="approval-dialog__input"
          rows={2}
          value={choice.type === "reject" ? choice.message : ""}
          placeholder="拒绝原因（将反馈给编排者）"
          aria-label="拒绝原因"
          onChange={(e) => onChoice({ type: "reject", message: e.target.value })}
        />
      )}
    </div>
  );
}

/**
 * 审批模态弹窗（task11）：遮罩 + 居中卡片，多动作分页逐个作答，底部统一提交。
 * 决策契约与 ApprovalDock 一致：decisions 数组与 actionRequests 顺序一一对应。
 */
export function ApprovalDialog({
  pendingApproval,
  onSubmit,
  error,
}: {
  pendingApproval: PendingApproval | null;
  onSubmit: (decisions: ApprovalDecision[]) => void;
  error?: unknown;
}): ReactNode {
  const count = pendingApproval?.actionRequests.length ?? 0;
  const [page, setPage] = useState(0);
  const [texts, setTexts] = useState<string[]>(() =>
    new Array(pendingApproval?.actionRequests.length ?? 0).fill(""),
  );
  const [choices, setChoices] = useState<(ApprovalDecision | null)[]>(() =>
    new Array(pendingApproval?.actionRequests.length ?? 0).fill(null),
  );
  const [signature, setSignature] = useState<string>(() => JSON.stringify(pendingApproval));
  const [errorSignature, setErrorSignature] = useState<unknown>(null);

  // 中断内容变化（新中断到来）时重置作答——渲染期重置是 React 认可的模式。
  const nextSignature = JSON.stringify(pendingApproval);
  if (nextSignature !== signature) {
    setSignature(nextSignature);
    setPage(0);
    setTexts(new Array(count).fill(""));
    setChoices(new Array(count).fill(null));
  }

  // 提交失败（error 变为非空）时清空作答，让用户能调整后重新提交，
  // 否则弹窗卡在已完成态且 composer 被禁用，用户无法恢复。
  if (error !== errorSignature) {
    setErrorSignature(error);
    if (error != null) {
      setPage(0);
      setTexts(new Array(count).fill(""));
      setChoices(new Array(count).fill(null));
    }
  }

  if (pendingApproval == null || count === 0) return null;

  const safePage = Math.min(page, count - 1);
  const request = pendingApproval.actionRequests[safePage]!;
  const config = pendingApproval.reviewConfigs[safePage];
  const gate = isGateConfig(config);

  const ready = pendingApproval.actionRequests.every((_, index) => {
    if (isGateConfig(pendingApproval.reviewConfigs[index])) {
      return (texts[index] ?? "").trim() !== "";
    }
    const choice = choices[index] ?? null;
    if (choice === null) return false;
    return choice.type !== "reject" || choice.message.trim() !== "";
  });

  function buildDecisions(): ApprovalDecision[] {
    return pendingApproval!.actionRequests.map((_, index) => {
      if (isGateConfig(pendingApproval!.reviewConfigs[index])) {
        return { type: "respond", message: (texts[index] ?? "").trim() };
      }
      const choice = choices[index]!;
      return choice.type === "reject"
        ? { type: "reject", message: choice.message.trim() }
        : choice;
    });
  }

  const title = gate ? GATE_TITLE : SENSITIVE_TITLE;
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = "approval-dialog-title";

  // 焦点管理（a11y）：打开即聚焦容器；Tab 循环限制在弹窗内（HITL 必须作答，
  // 不存在关闭路径），避免键盘用户 Tab 进遮罩后仍在交互的背景内容。
  useEffect(() => {
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, textarea, input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables === undefined || focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="approval-overlay" data-testid="approval-dialog">
      <section
        ref={dialogRef}
        className="approval-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="approval-dialog__head">
          <strong id={titleId}>{title}</strong>
          <code className="approval-dialog__tool">{request.name}</code>
        </header>
        <pre className="approval-dialog__args">{argsSummary(request.args)}</pre>
        <ApprovalPage
          key={`${safePage}-${request.name}`}
          config={config}
          text={texts[safePage] ?? ""}
          onTextChange={(value) =>
            setTexts((current) => current.map((t, i) => (i === safePage ? value : t)))
          }
          choice={choices[safePage] ?? null}
          onChoice={(decision) =>
            setChoices((current) => current.map((c, i) => (i === safePage ? decision : c)))
          }
        />
        {error ? <p className="error approval-dialog__error">{String(error)}</p> : null}
        <footer className="approval-dialog__foot">
          <span className="approval-dialog__pager">
            <button
              type="button"
              aria-label="上一页"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              ‹
            </button>
            <span>
              {safePage + 1}/{count}
            </span>
            <button
              type="button"
              aria-label="下一页"
              disabled={safePage >= count - 1}
              onClick={() => setPage(safePage + 1)}
            >
              ›
            </button>
          </span>
          <button
            type="button"
            className="approval-dialog__submit"
            disabled={!ready}
            onClick={() => onSubmit(buildDecisions())}
          >
            提交
          </button>
        </footer>
      </section>
    </div>
  );
}
