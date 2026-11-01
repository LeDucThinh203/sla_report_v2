import { useCallback, useEffect, useState } from "react";
import {
  fetchBrowseRequests,
  fetchMetadata,
  fetchSlaReport,
} from "../services/report.api";
import type {
  AppMetadataResponse,
  BrowseFilterState,
  RequestReportRow,
  SlaReportResponse,
} from "../types/report.types";

export function useReport(initialFilters: BrowseFilterState) {
  const [filters, setFilters] = useState<BrowseFilterState>(initialFilters);
  const [metadata, setMetadata] = useState<AppMetadataResponse | null>(null);
  const [report, setReport] = useState<SlaReportResponse | null>(null);
  const [browseRows, setBrowseRows] = useState<RequestReportRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(
    async (activeFilters: BrowseFilterState, cursor: string | null = null, resetPaging = true) => {
      setLoading(true);
      setError(null);
      try {
        const meta = await fetchMetadata();
        setMetadata(meta);

        if (!meta.ready) {
          setLoading(false);
          return;
        }

        const [slaData, browseData] = await Promise.all([
          fetchSlaReport(activeFilters.from, activeFilters.to),
          fetchBrowseRequests(activeFilters, cursor),
        ]);

        setReport(slaData);
        setBrowseRows(browseData.data);
        setNextCursor(browseData.next_cursor);

        if (resetPaging) {
          setCursorHistory([null]);
          setPageIndex(0);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load report data");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadData(filters, null, true);
  }, [filters, loadData]);

  // Poll metadata every 10s so warming-up state or live updates reflect automatically
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const meta = await fetchMetadata();
        setMetadata((prev) => {
          const becameReady = prev && !prev.ready && meta.ready;
          const syncedChanged =
            prev &&
            meta.ready &&
            prev.total_requests_cached !== meta.total_requests_cached;
          if (becameReady || syncedChanged) {
            void loadData(filters, cursorHistory[pageIndex] ?? null, false);
          }
          return meta;
        });
      } catch {
        // ignore background poll errors
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [filters, cursorHistory, pageIndex, loadData]);

  const goToNextPage = async () => {
    if (!nextCursor) return;
    const nextIdx = pageIndex + 1;
    const updatedHistory = [...cursorHistory.slice(0, nextIdx), nextCursor];
    setCursorHistory(updatedHistory);
    setPageIndex(nextIdx);
    await loadData(filters, nextCursor, false);
  };

  const goToPrevPage = async () => {
    if (pageIndex <= 0) return;
    const prevIdx = pageIndex - 1;
    const prevCursor = cursorHistory[prevIdx] ?? null;
    setPageIndex(prevIdx);
    await loadData(filters, prevCursor, false);
  };

  const updateFilters = (patch: Partial<BrowseFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const refresh = () => {
    void loadData(filters, cursorHistory[pageIndex] ?? null, false);
  };

  return {
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
  };
}
