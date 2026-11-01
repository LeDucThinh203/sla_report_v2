import type { ResponderSummaryRow } from "../../types/report.types";
import { formatPercent } from "../../utils/formatters";

interface RespondersTableProps {
  responders: ResponderSummaryRow[];
  selectedResponderId: string;
  onSelectResponder: (responderId: string) => void;
}

export function RespondersTable({
  responders,
  selectedResponderId,
  onSelectResponder,
}: RespondersTableProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Responder Performance Breakdown</h2>
          <p className="panel-subtitle">
            Aggregated across all eligible requests in the selected date range
          </p>
        </div>
        <span className="badge badge-neutral">{responders.length} Staff</span>
      </div>

      {responders.length === 0 ? (
        <div className="empty-state">
          No responders found for requests in this date range.
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Staff ID</th>
                <th>Responder Name</th>
                <th className="num-col">Requests</th>
                <th className="num-col">Within Target</th>
                <th className="num-col">SLA Rate</th>
                <th className="num-col">Completed Late</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {responders.map((resp) => {
                const isSelected = selectedResponderId === String(resp.id);
                return (
                  <tr
                    key={resp.id}
                    className={isSelected ? "row-selected" : undefined}
                  >
                    <td className="mono-cell">#{resp.id}</td>
                    <td className="font-medium">{resp.name}</td>
                    <td className="num-col">{resp.requests.toLocaleString()}</td>
                    <td className="num-col">{resp.within_target.toLocaleString()}</td>
                    <td className="num-col">
                      <span className="badge badge-success">
                        {formatPercent(resp.within_target, resp.requests)}
                      </span>
                    </td>
                    <td className="num-col">
                      {resp.completed_late > 0 ? (
                        <span className="badge badge-danger">
                          {resp.completed_late.toLocaleString()}
                        </span>
                      ) : (
                        <span className="badge badge-neutral">0</span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-xs"
                        onClick={() =>
                          onSelectResponder(isSelected ? "" : String(resp.id))
                        }
                      >
                        {isSelected ? "Clear Filter" : "Filter Requests"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
