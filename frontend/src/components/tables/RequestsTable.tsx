import type { RequestReportRow, SiteInfo } from "../../types/report.types";
import { formatMinutes } from "../../utils/formatters";

interface RequestsTableProps {
  rows: RequestReportRow[];
  sites: SiteInfo[];
  pageIndex: number;
  pageSize: number;
  hasNextPage: boolean;
  onPrevPage: () => void;
  onNextPage: () => void;
  loading: boolean;
}

export function RequestsTable({
  rows,
  sites,
  pageIndex,
  pageSize,
  hasNextPage,
  onPrevPage,
  onNextPage,
  loading,
}: RequestsTableProps) {
  const siteMap = new Map(sites.map((s) => [s.id, s]));
  const startRowNum = rows.length > 0 ? pageIndex * pageSize + 1 : 0;
  const endRowNum = pageIndex * pageSize + rows.length;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Browse Requests (/api/requests)</h2>
          <p className="panel-subtitle">
            Cursor-paginated request evaluation rows with live filtering & sorting
          </p>
        </div>
        <span className="badge badge-neutral" translate="no">
          Page {pageIndex + 1} · Rows {startRowNum}–{endRowNum}
        </span>
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

          <div className="table-footer">
            <div className="footer-info" translate="no">
              Showing rows <strong>{startRowNum}</strong> to{" "}
              <strong>{endRowNum}</strong> (Page <strong>{pageIndex + 1}</strong>)
            </div>
            <div className="pagination-controls" translate="no">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onPrevPage}
                disabled={pageIndex === 0 || loading}
              >
                ← Previous Page
              </button>
              <span className="page-indicator">Page {pageIndex + 1}</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onNextPage}
                disabled={!hasNextPage || loading}
              >
                Next Page →
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
