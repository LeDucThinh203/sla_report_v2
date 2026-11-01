import type { RequestReportRow } from "../../types/report.types";
import { formatMinutes, formatPercent } from "../../utils/formatters";

interface SummaryCardsProps {
  requests: RequestReportRow[];
}

export function SummaryCards({ requests }: SummaryCardsProps) {
  const totalRequests = requests.length;

  let respondedCount = 0;
  let withinTargetCount = 0;
  let missedTargetCount = 0;
  let completedLateCount = 0;
  let totalResponseMinutes = 0;

  for (const r of requests) {
    if (r.response_business_minutes !== null) {
      respondedCount++;
      totalResponseMinutes += r.response_business_minutes;
    }
    if (r.within_target === true) {
      withinTargetCount++;
    } else if (r.within_target === false) {
      missedTargetCount++;
    }
    if (r.completed_late === true) {
      completedLateCount++;
    }
  }

  const avgResponseMinutes =
    respondedCount > 0 ? Math.round(totalResponseMinutes / respondedCount) : null;

  return (
    <section className="kpi-grid">
      <div className="kpi-card">
        <span className="kpi-label">Total Eligible Requests</span>
        <strong className="kpi-value">{totalRequests.toLocaleString()}</strong>
        <span className="kpi-sub">
          {respondedCount.toLocaleString()} responded ·{" "}
          {(totalRequests - respondedCount).toLocaleString()} awaiting response
        </span>
      </div>

      <div className="kpi-card kpi-success">
        <span className="kpi-label">Within SLA Target</span>
        <strong className="kpi-value">{withinTargetCount.toLocaleString()}</strong>
        <span className="kpi-sub">
          {formatPercent(withinTargetCount, respondedCount)} of responded requests
        </span>
      </div>

      <div className="kpi-card kpi-warning">
        <span className="kpi-label">Missed SLA Target</span>
        <strong className="kpi-value">{missedTargetCount.toLocaleString()}</strong>
        <span className="kpi-sub">
          {formatPercent(missedTargetCount, respondedCount)} exceeded target window
        </span>
      </div>

      <div className="kpi-card kpi-danger">
        <span className="kpi-label">Completed Late</span>
        <strong className="kpi-value">{completedLateCount.toLocaleString()}</strong>
        <span className="kpi-sub">Completed strictly after deadline</span>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">Avg Response Time</span>
        <strong className="kpi-value">{formatMinutes(avgResponseMinutes)}</strong>
        <span className="kpi-sub">Business-hours minutes (floored)</span>
      </div>
    </section>
  );
}
