import { useCallback, useEffect, useRef, useState } from "react";
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

  const cursorHistoryRef = useRef<(string | null)[]>([null]);
  const pageIndexRef = useRef<number>(0);

  const loadData = useCallback(
    async (
      activeFilters: BrowseFilterState,
      cursor: string | null = null,
      targetPageIndex = 0,
      newHistory?: (string | null)[]
    ) => {
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
        setPageIndex(targetPageIndex);
        pageIndexRef.current = targetPageIndex;

        if (newHistory) {
          setCursorHistory(newHistory);
          cursorHistoryRef.current = newHistory;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load report data");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Reload from Page 1 (index 0) whenever filters change
  useEffect(() => {
    const initialHistory: (string | null)[] = [null];
    void loadData(filters, null, 0, initialHistory);
  }, [filters, loadData]);

  // Poll metadata every 10s so warming-up state or live updates reflect automatically
  // without resetting the user's current page!
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
            const currentIdx = pageIndexRef.current;
            const currentCursor = cursorHistoryRef.current[currentIdx] ?? null;
            void loadData(filters, currentCursor, currentIdx);
          }
          return meta;
        });
      } catch {
        // ignore background poll errors
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [filters, loadData]);

  const goToNextPage = async () => {
    if (!nextCursor || loading) return;
    const nextIdx = pageIndex + 1;
    const updatedHistory = [...cursorHistory.slice(0, nextIdx), nextCursor];
    await loadData(filters, nextCursor, nextIdx, updatedHistory);
  };

  const goToPrevPage = async () => {
    if (pageIndex <= 0 || loading) return;
    const prevIdx = pageIndex - 1;
    const prevCursor = cursorHistory[prevIdx] ?? null;
    await loadData(filters, prevCursor, prevIdx);
  };

  const updateFilters = (patch: Partial<BrowseFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const refresh = () => {
    const currentIdx = pageIndexRef.current;
    const currentCursor = cursorHistoryRef.current[currentIdx] ?? null;
    void loadData(filters, currentCursor, currentIdx);
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
