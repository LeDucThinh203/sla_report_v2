import { useRef } from "react";
import type {
  BrowseFilterState,
  RequestReportRow,
  SiteInfo,
  SortField,
  StaffInfo,
} from "../../types/report.types";
import { formatMinutes } from "../../utils/formatters";

interface RequestsTableProps {
  rows: RequestReportRow[];
  sites: SiteInfo[];
  staff: StaffInfo[];
  filters: BrowseFilterState;
  onFilterChange: (patch: Partial<BrowseFilterState>) => void;
  pageIndex: number;
  pageSize: number;
  totalFilteredCount: number;
  hasNextPage: boolean;
  onFirstPage: () => Promise<void> | void;
  onPrevPage: () => Promise<void> | void;
  onNextPage: () => Promise<void> | void;
  onLastPage: () => Promise<void> | void;
  loading: boolean;
}

export function RequestsTable({
  rows,
  sites,
  staff,
  filters,
  onFilterChange,
  pageIndex,
  pageSize,
  totalFilteredCount,
  hasNextPage,
  onFirstPage,
  onPrevPage,
  onNextPage,
  onLastPage,
  loading,
}: RequestsTableProps) {
  const footerRef = useRef<HTMLDivElement | null>(null);
  const siteMap = new Map(sites.map((s) => [s.id, s]));
  const startRowNum = rows.length > 0 ? pageIndex * pageSize + 1 : 0;
  const endRowNum = pageIndex * pageSize + rows.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / pageSize));

  const hasActiveBrowseFilters = Boolean(
    filters.site_id ||
      filters.responder_id ||
      filters.within_target ||
      filters.late ||
      filters.sort !== "id" ||
      filters.limit !== 50
  );

  const keepFooterAnchored = async (action: () => Promise<void> | void) => {
    await action();
    requestAnimationFrame(() => {
      footerRef.current?.scrollIntoView({ block: "nearest" });
    });
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Browse Requests (/api/requests)</h2>
          <p className="panel-subtitle">
            Server-side filtered, sorted, and cursor-paginated requests
          </p>
        </div>
        <span className="badge badge-neutral" translate="no">
          Page {pageIndex + 1} / {totalPages} · {totalFilteredCount.toLocaleString()} matching
        </span>
      </div>

      {/* Dedicated Filter Bar for Browse Requests (/api/requests) */}
      <div className="sub-filter-bar">
        <label className="form-field">
          <span>Site (`site_id`)</span>
          <select
            value={filters.site_id}
            onChange={(e) => onFilterChange({ site_id: e.target.value })}
          >
            <option value="">All Sites</option>
            {sites.map((s) => (
              <option key={s.id} value={String(s.id)}>
                #{s.id} — {s.name} ({s.timezone})
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Responder (`responder_id`)</span>
          <select
            value={filters.responder_id}
            onChange={(e) => onFilterChange({ responder_id: e.target.value })}
          >
            <option value="">All Responders</option>
            {staff.map((st) => (
              <option key={st.id} value={String(st.id)}>
                {st.name} (#{st.id})
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Within SLA Target (`within_target`)</span>
          <select
            value={filters.within_target}
            onChange={(e) => onFilterChange({ within_target: e.target.value })}
          >
            <option value="">All</option>
            <option value="true">Within Target (true)</option>
            <option value="false">Missed Target (false)</option>
          </select>
        </label>

        <label className="form-field">
          <span>Completed Late (`late`)</span>
          <select
            value={filters.late}
            onChange={(e) => onFilterChange({ late: e.target.value })}
          >
            <option value="">All</option>
            <option value="true">Completed Late (true)</option>
            <option value="false">On Time (false)</option>
          </select>
        </label>

        <label className="form-field">
          <span>Sort Order (`sort`)</span>
          <select
            value={filters.sort}
            onChange={(e) => onFilterChange({ sort: e.target.value as SortField })}
          >
            <option value="id">Request ID (Ascending)</option>
            <option value="-id">Request ID (Descending)</option>
            <option value="response_business_minutes">
              Response Minutes (Fastest First, Nulls Last)
            </option>
            <option value="-response_business_minutes">
              Response Minutes (Slowest First, Nulls Last)
            </option>
          </select>
        </label>

        <label className="form-field">
          <span>Page Size (`limit`)</span>
          <select
            value={String(filters.limit)}
            onChange={(e) => onFilterChange({ limit: Number(e.target.value) })}
          >
            <option value="25">25 rows</option>
            <option value="50">50 rows</option>
            <option value="100">100 rows</option>
            <option value="200">200 rows</option>
          </select>
        </label>

        {hasActiveBrowseFilters && (
          <div className="filter-reset-col">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                onFilterChange({
                  site_id: "",
                  responder_id: "",
                  within_target: "",
                  late: "",
                  sort: "id",
                  limit: 50,
                })
              }
            >
              Reset Request Filters
            </button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          No requests match the current filter criteria.
        </div>
      ) : (
        <>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Request ID</th>
                  <th>Site</th>
                  <th>Responder</th>
                  <th className="num-col">Response Business Minutes</th>
                  <th>SLA Status (within_target)</th>
                  <th>Completion Status (completed_late)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const site = siteMap.get(row.site_id);
                  return (
                    <tr key={row.id}>
                      <td className="mono-cell" translate="no">
                        #{row.id}
                      </td>
                      <td>
                        <div className="font-medium">
                          {site ? site.name : `Site #${row.site_id}`}
                        </div>
                        <div className="text-muted text-xs">
                          ID: {row.site_id} {site ? `· ${site.timezone}` : ""}
                        </div>
                      </td>
                      <td>
                        {row.responder ? (
                          <div>
                            <div className="font-medium">{row.responder}</div>
                            <div className="text-muted text-xs">
                              Staff #{row.responder_id}
                            </div>
                          </div>
                        ) : (
                          <span className="badge badge-neutral">No Response</span>
                        )}
                      </td>
                      <td className="num-col mono-cell" translate="no">
                        {row.response_business_minutes !== null ? (
                          <span title={formatMinutes(row.response_business_minutes)}>
                            {row.response_business_minutes} min
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {row.within_target === true && (
                          <span className="badge badge-success">Within Target</span>
                        )}
                        {row.within_target === false && (
                          <span className="badge badge-warning">Missed Target</span>
                        )}
                        {row.within_target === null && (
                          <span className="badge badge-neutral" translate="no">
                            null
                          </span>
                        )}
                      </td>
                      <td>
                        {row.completed_late === true && (
                          <span className="badge badge-danger">Completed Late</span>
                        )}
                        {row.completed_late === false && (
                          <span className="badge badge-success">On Time</span>
                        )}
                        {row.completed_late === null && (
                          <span className="badge badge-neutral" translate="no">
                            null
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="table-footer" ref={footerRef}>
            <div className="footer-info" translate="no">
              Showing <strong>{startRowNum}</strong>–<strong>{endRowNum}</strong> of{" "}
              <strong>{totalFilteredCount.toLocaleString()}</strong> requests (Page{" "}
              <strong>{pageIndex + 1}</strong> of <strong>{totalPages}</strong>)
            </div>
            <div className="pagination-controls" translate="no">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void keepFooterAnchored(onFirstPage)}
                disabled={pageIndex === 0 || loading}
                title="Go to first page"
              >
                ⏮ First
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void keepFooterAnchored(onPrevPage)}
                disabled={pageIndex === 0 || loading}
                title="Go to previous page"
              >
                ← Prev
              </button>
              <span className="page-indicator">
                Page {pageIndex + 1} / {totalPages}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void keepFooterAnchored(onNextPage)}
                disabled={!hasNextPage || loading}
                title="Go to next page"
              >
                Next →
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void keepFooterAnchored(onLastPage)}
                disabled={!hasNextPage || loading}
                title="Go to last page"
              >
                Last ⏭
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
