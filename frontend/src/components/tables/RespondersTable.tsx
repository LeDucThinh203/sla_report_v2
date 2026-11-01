import { useMemo, useState } from "react";
import type { ResponderSummaryRow } from "../../types/report.types";
import { formatPercent } from "../../utils/formatters";

type ResponderSortKey =
  | "id"
  | "name"
  | "-requests"
  | "-within_target"
  | "-sla_rate"
  | "-completed_late";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [lateFilter, setLateFilter] = useState<"all" | "with_late" | "zero_late">("all");
  const [sortBy, setSortBy] = useState<ResponderSortKey>("id");

  const filteredResponders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = responders.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !String(r.id).includes(q)) {
        return false;
      }
      if (lateFilter === "with_late" && r.completed_late === 0) return false;
      if (lateFilter === "zero_late" && r.completed_late > 0) return false;
      return true;
    });

    list.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "-requests":
          return b.requests !== a.requests ? b.requests - a.requests : a.id - b.id;
        case "-within_target":
          return b.within_target !== a.within_target
            ? b.within_target - a.within_target
            : a.id - b.id;
        case "-sla_rate": {
          const rateA = a.requests > 0 ? a.within_target / a.requests : 0;
          const rateB = b.requests > 0 ? b.within_target / b.requests : 0;
          return rateB !== rateA ? rateB - rateA : a.id - b.id;
        }
        case "-completed_late":
          return b.completed_late !== a.completed_late
            ? b.completed_late - a.completed_late
            : a.id - b.id;
        case "id":
        default:
          return a.id - b.id;
      }
    });

    return list;
  }, [responders, searchQuery, lateFilter, sortBy]);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Responder Performance Breakdown</h2>
          <p className="panel-subtitle">
            Summary of handled requests, SLA target compliance, and late completions by staff member
          </p>
        </div>
        <span className="badge badge-neutral" translate="no">
          {filteredResponders.length} / {responders.length} Staff
        </span>
      </div>

      <div className="sub-filter-bar">
        <label className="form-field">
          <span>Search Staff</span>
          <input
            type="text"
            placeholder="Search by name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </label>

        <label className="form-field">
          <span>Deadline Performance</span>
          <select
            value={lateFilter}
            onChange={(e) =>
              setLateFilter(e.target.value as "all" | "with_late" | "zero_late")
            }
          >
            <option value="all">All Staff Members</option>
            <option value="with_late">Has Late Completions</option>
            <option value="zero_late">100% On-Time Completions</option>
          </select>
        </label>

        <label className="form-field">
          <span>Sort By</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as ResponderSortKey)}
          >
            <option value="id">Staff ID (Ascending)</option>
            <option value="name">Staff Name (A–Z)</option>
            <option value="-requests">Most Requests Handled</option>
            <option value="-within_target">Most Within SLA Target</option>
            <option value="-sla_rate">Highest SLA Compliance Rate</option>
            <option value="-completed_late">Most Late Completions</option>
          </select>
        </label>

        {(searchQuery || lateFilter !== "all" || sortBy !== "id") && (
          <div className="filter-reset-col">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSearchQuery("");
                setLateFilter("all");
                setSortBy("id");
              }}
            >
              Reset Filter
            </button>
          </div>
        )}
      </div>

      {filteredResponders.length === 0 ? (
        <div className="empty-state">
          No responders match the current filter criteria.
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Staff ID</th>
                <th>Responder Name</th>
                <th className="num-col">Requests Handled</th>
                <th className="num-col">Within SLA Target</th>
                <th className="num-col">SLA Compliance</th>
                <th className="num-col">Completed Late</th>
                <th>Quick Filter</th>
              </tr>
            </thead>
            <tbody>
              {filteredResponders.map((resp) => {
                const isSelected = selectedResponderId === String(resp.id);
                return (
                  <tr
                    key={resp.id}
                    className={isSelected ? "row-selected" : undefined}
                  >
                    <td className="mono-cell" translate="no">
                      #{resp.id}
                    </td>
                    <td className="font-medium">{resp.name}</td>
                    <td className="num-col" translate="no">
                      {resp.requests.toLocaleString()}
                    </td>
                    <td className="num-col" translate="no">
                      {resp.within_target.toLocaleString()}
                    </td>
                    <td className="num-col" translate="no">
                      <span className="badge badge-success">
                        {formatPercent(resp.within_target, resp.requests)}
                      </span>
                    </td>
                    <td className="num-col" translate="no">
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
                        {isSelected ? "Show All Requests" : "View Requests ↓"}
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
