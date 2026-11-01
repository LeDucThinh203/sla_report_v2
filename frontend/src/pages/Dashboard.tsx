import { SummaryCards } from "../components/cards/SummaryCards";
import { FilterBar } from "../components/filters/FilterBar";
import { Header } from "../components/layout/Header";
import { RequestsTable } from "../components/tables/RequestsTable";
import { RespondersTable } from "../components/tables/RespondersTable";
import { useReport } from "../hooks/useReport";
import type { BrowseFilterState } from "../types/report.types";

const DEFAULT_FILTERS: BrowseFilterState = {
  from: "2026-10-01",
  to: "2026-10-31",
  site_id: "",
  responder_id: "",
  within_target: "",
  late: "",
  sort: "id",
  limit: 50,
};

export function Dashboard() {
  const {
    filters,
    updateFilters,
    metadata,
    report,
    browseRows,
    nextCursor,
    pageIndex,
    goToNextPage,
    goToPrevPage,
    loading,
    error,
    refresh,
  } = useReport(DEFAULT_FILTERS);

  const isReady = metadata?.ready ?? false;

  return (
    <div className="app-shell">
      <Header metadata={metadata} onRefresh={refresh} loading={loading} />

      <main className="main-container">
        <FilterBar
          filters={filters}
          sites={metadata?.sites ?? []}
          staff={metadata?.staff ?? []}
          onChange={updateFilters}
        />

        {error && (
          <div className="alert alert-error" role="alert">
            <strong>API Error:</strong> {error}
          </div>
        )}

        {!isReady && !error && (
          <div className="alert alert-info">
            <strong>Synchronizing with Helpdesk Practice API...</strong> The
            server is currently draining the change feed (`/v1/changes`). The
            dashboard will populate automatically as soon as `/ready` returns
            `200`.
          </div>
        )}

        {report && (
          <>
            <SummaryCards requests={report.requests} />

            <RespondersTable
              responders={report.responders}
              selectedResponderId={filters.responder_id}
              onSelectResponder={(responder_id) => updateFilters({ responder_id })}
            />

            <RequestsTable
              rows={browseRows}
              sites={metadata?.sites ?? []}
              pageIndex={pageIndex}
              hasNextPage={Boolean(nextCursor)}
              onPrevPage={() => void goToPrevPage()}
              onNextPage={() => void goToNextPage()}
              loading={loading}
            />
          </>
        )}
      </main>
    </div>
  );
}
