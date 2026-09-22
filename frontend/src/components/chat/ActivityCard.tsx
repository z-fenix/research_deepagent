import type { ReactNode } from "react";

export default function ActivityCard({ visible }: { visible: boolean }): ReactNode | null {
  if (!visible) return null;
  return (
    <div className="activity-card" aria-live="polite" aria-label="Research in progress">
      <div className="activity-card__pulse" aria-hidden="true">
        <span /><span /><span />
      </div>
      <div className="activity-card__copy">
        <strong>Research in progress</strong>
        <span>Waiting for sub-agent results and final synthesis.</span>
      </div>
    </div>
  );
}
