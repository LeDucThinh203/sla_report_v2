import { useMemo } from "react";
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
    goToFirstPage,
    goToNextPage,
    goToPrevPage,
    goToLastPage,
    loading,
    error,
    refresh,
  } = useReport(DEFAULT_FILTERS);

  const isReady = metadata?.ready ?? false;

  const totalFilteredCount = useMemo(() => {
    if (!report) return 0;
    return report.requests.filter((row) => {
      if (filters.site_id && row.site_id !== Number(filters.site_id)) return false;
      if (filters.responder_id && row.responder_id !== Number(filters.responder_id))
        return false;
      if (filters.within_target !== "") {
        const expected = filters.within_target === "true";
        if (row.within_target !== expected) return false;
      }
      if (filters.late !== "") {
        const expected = filters.late === "true";
        if (row.completed_late !== expected) return false;
      }
      return true;
    }).length;
  }, [report, filters]);

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
              pageSize={filters.limit}
              totalFilteredCount={totalFilteredCount}
              hasNextPage={Boolean(nextCursor)}
              onFirstPage={() => void goToFirstPage()}
              onPrevPage={() => void goToPrevPage()}
              onNextPage={() => void goToNextPage()}
              onLastPage={() => void goToLastPage()}
              loading={loading}
            />
          </>
        )}
      </main>
    </div>
  );
}
