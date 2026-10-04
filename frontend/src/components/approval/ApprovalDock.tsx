import { useState, type ReactNode } from "react";
import type {
  ActionRequest,
  ApprovalDecision,
  PendingApproval,
  ReviewConfig,
} from "../../lib/stream";

const GATE_TITLE = "阶段门禁";
const SENSITIVE_TITLE = "敏感操作";

function argsSummary(args: Record<string, unknown> | undefined): string {
  if (!args || Object.keys(args).length === 0) return "{}";
  return JSON.stringify(args, null, 2);
}

function isGateConfig(config: ReviewConfig | undefined): boolean {
  return (config?.allowed_decisions ?? []).every((d) => d === "respond");
}

function decisionLabel(decision: ApprovalDecision): string {
  switch (decision.type) {
    case "approve":
      return "已选择：批准";
    case "reject":
      return `已选择：拒绝（${decision.message}）`;
    default:
      return `已选择：回复「${decision.message}」`;
  }
}

type ApprovalCardProps = {
  request: ActionRequest;
  config: ReviewConfig | undefined;
  decided: ApprovalDecision | undefined;
  decide: (decision: ApprovalDecision) => void;
};

/**
 * 单张审批卡：门禁卡（respond 文本框 + 提交）或敏感操作卡（批准 / 拒绝+意见）。
 * 决策交给父级按 actionRequests 顺序组装数组并统一提交。
 */
function ApprovalCard({ request, config, decided, decide }: ApprovalCardProps) {
  const gate = isGateConfig(config);
  const [respondText, setRespondText] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  return (
    <article
      className="approval-card"
      aria-label={`${gate ? GATE_TITLE : SENSITIVE_TITLE} ${request.name}`}
    >
      <header className="approval-card__header">
        <strong>{gate ? GATE_TITLE : SENSITIVE_TITLE}</strong>
        <code className="approval-card__tool">{request.name}</code>
      </header>
      <pre className="approval-card__args">{argsSummary(request.args)}</pre>
      {decided != null ? (
        <p className="approval-card__decided">{decisionLabel(decided)}</p>
      ) : gate ? (
        <div className="approval-card__actions">
          <textarea
            className="approval-card__input"
            rows={2}
            value={respondText}
            placeholder="回复门禁：同意或填写修订意见…"
            aria-label="门禁回复"
            onChange={(e) => setRespondText(e.target.value)}
          />
          <button
            type="button"
            className="approval-card__button"
            disabled={!respondText.trim()}
            onClick={() => decide({ type: "respond", message: respondText.trim() })}
          >
            提交
          </button>
        </div>
      ) : (
        <div className="approval-card__actions">
          <button
            type="button"
            className="approval-card__button"
            onClick={() => decide({ type: "approve" })}
          >
            批准
          </button>
          {!rejectOpen ? (
            <button
              type="button"
              className="approval-card__button approval-card__button--reject"
              onClick={() => setRejectOpen(true)}
            >
              拒绝
            </button>
          ) : (
            <div className="approval-card__reject">
              <textarea
                className="approval-card__input"
                rows={2}
                value={rejectReason}
                placeholder="拒绝原因（将反馈给编排者）"
                aria-label="拒绝原因"
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <button
                type="button"
                className="approval-card__button approval-card__button--reject"
                disabled={!rejectReason.trim()}
                onClick={() => decide({ type: "reject", message: rejectReason.trim() })}
              >
                确认拒绝
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function ApprovalDock({
  pendingApproval,
  onSubmit,
  error,
}: {
  pendingApproval: PendingApproval | null;
  onSubmit: (decisions: ApprovalDecision[]) => void;
  error?: unknown;
}): ReactNode {
  const [decisions, setDecisions] = useState<(ApprovalDecision | undefined)[]>(
    () => new Array(pendingApproval?.actionRequests.length ?? 0).fill(undefined),
  );
  const [signature, setSignature] = useState<string>(() => JSON.stringify(pendingApproval));
  const [errorSignature, setErrorSignature] = useState<unknown>(null);

  // 中断内容变化（新中断到来）时重置已记录的决策——渲染期重置是 React 认可的模式。
  const nextSignature = JSON.stringify(pendingApproval);
  if (nextSignature !== signature) {
    setSignature(nextSignature);
    setDecisions(new Array(pendingApproval?.actionRequests.length ?? 0).fill(undefined));
  }

  // 提交失败（error 变为非空）时清空已记录的决策，让用户能调整后重新提交，
  // 否则卡片停留在"已选择"态且 composer 被禁用，用户无法恢复。
  if (error !== errorSignature) {
    setErrorSignature(error);
    if (error != null) {
      setDecisions(new Array(pendingApproval?.actionRequests.length ?? 0).fill(undefined));
    }
  }

  if (pendingApproval == null || pendingApproval.actionRequests.length === 0) return null;

  function handleDecide(index: number, decision: ApprovalDecision) {
    // 决策数组与 actionRequests 顺序一一对应；全部就绪后立即提交。
    const next = decisions.map((d, i) => (i === index ? decision : d));
    setDecisions(next);
    if (next.every((d) => d != null)) {
      onSubmit(next as ApprovalDecision[]);
    }
  }

  return (
    <section className="approval-dock" aria-label="审批" data-testid="approval-dock">
      {pendingApproval.actionRequests.map((request, index) => (
        <ApprovalCard
          key={`${index}-${request.name}`}
          request={request}
          config={pendingApproval.reviewConfigs[index]}
          decided={decisions[index]}
          decide={(decision) => handleDecide(index, decision)}
        />
      ))}
      {error ? <p className="error approval-dock__error">{String(error)}</p> : null}
    </section>
  );
}
