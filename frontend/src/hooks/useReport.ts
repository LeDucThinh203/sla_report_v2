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
  const requestSeqRef = useRef<number>(0);

  const loadFullData = useCallback(async (activeFilters: BrowseFilterState) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const meta = await fetchMetadata();
      if (seq !== requestSeqRef.current) return;
      setMetadata(meta);

      if (!meta.ready) {
        setLoading(false);
        return;
      }

      const [slaData, browseData] = await Promise.all([
        fetchSlaReport(activeFilters.from, activeFilters.to),
        fetchBrowseRequests(activeFilters, null),
      ]);
      if (seq !== requestSeqRef.current) return;

      const initialHistory: (string | null)[] = [null];
      setReport(slaData);
      setBrowseRows(browseData.data);
      setNextCursor(browseData.next_cursor);
      setPageIndex(0);
      pageIndexRef.current = 0;
      setCursorHistory(initialHistory);
      cursorHistoryRef.current = initialHistory;
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load report data");
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const loadPageOnly = useCallback(
    async (
      activeFilters: BrowseFilterState,
      cursor: string | null,
      targetPageIndex: number,
      newHistory?: (string | null)[]
    ) => {
      const seq = ++requestSeqRef.current;
      setLoading(true);
      setError(null);
      try {
        const browseData = await fetchBrowseRequests(activeFilters, cursor);
        if (seq !== requestSeqRef.current) return;

        setBrowseRows(browseData.data);
        setNextCursor(browseData.next_cursor);
        setPageIndex(targetPageIndex);
        pageIndexRef.current = targetPageIndex;

        if (newHistory) {
          setCursorHistory(newHistory);
          cursorHistoryRef.current = newHistory;
        }
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load page");
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    []
  );

  // Reload full report + Page 1 whenever filters change
  useEffect(() => {
    void loadFullData(filters);
  }, [filters, loadFullData]);

  // Poll metadata every 10s so warming-up state or live updates reflect automatically
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const meta = await fetchMetadata();
        setMetadata((prev) => {
          const becameReady = prev && !prev.ready && meta.ready;
          const versionChanged =
            prev &&
            meta.ready &&
            (prev.data_version !== meta.data_version ||
              prev.last_synced_at !== meta.last_synced_at);
          if (becameReady) {
            void loadFullData(filters);
          } else if (versionChanged) {
            const currentIdx = pageIndexRef.current;
            const currentCursor = cursorHistoryRef.current[currentIdx] ?? null;
            void Promise.all([
              fetchSlaReport(filters.from, filters.to),
              fetchBrowseRequests(filters, currentCursor),
            ])
              .then(([slaData, browseData]) => {
                setReport(slaData);
                setBrowseRows(browseData.data);
                setNextCursor(browseData.next_cursor);
              })
              .catch(() => {
                // If cursor snapshot expired on live refresh, fall back to page 1
                void loadFullData(filters);
              });
          }
          return meta;
        });
      } catch {
        // ignore background poll errors
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [filters, loadFullData]);

  const goToFirstPage = async () => {
    if (pageIndex <= 0 || loading) return;
    const initialHistory: (string | null)[] = [null];
    await loadPageOnly(filters, null, 0, initialHistory);
  };

  const goToNextPage = async () => {
    if (!nextCursor || loading) return;
    const nextIdx = pageIndex + 1;
    const updatedHistory = [...cursorHistory.slice(0, nextIdx), nextCursor];
    await loadPageOnly(filters, nextCursor, nextIdx, updatedHistory);
  };

  const goToPrevPage = async () => {
    if (pageIndex <= 0 || loading) return;
    const prevIdx = pageIndex - 1;
    const prevCursor = cursorHistory[prevIdx] ?? null;
    await loadPageOnly(filters, prevCursor, prevIdx);
  };

  const goToLastPage = async () => {
    if (!nextCursor || loading) return;
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      let curIdx = pageIndex;
      let curNext: string | null = nextCursor;
      const history = [...cursorHistory.slice(0, curIdx + 1)];
      let lastData: RequestReportRow[] = browseRows;

      let safety = 0;
      while (curNext !== null && safety < 500) {
        safety++;
        const pageRes = await fetchBrowseRequests(filters, curNext);
        if (seq !== requestSeqRef.current) return;
        curIdx += 1;
        history.push(curNext);
        lastData = pageRes.data;
        curNext = pageRes.next_cursor;
      }

      setBrowseRows(lastData);
      setNextCursor(null);
      setPageIndex(curIdx);
      pageIndexRef.current = curIdx;
      setCursorHistory(history);
      cursorHistoryRef.current = history;
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to jump to last page");
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  };

  const updateFilters = (patch: Partial<BrowseFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const refresh = async () => {
    const seq = ++requestSeqRef.current;
    const currentIdx = pageIndexRef.current;
    const currentCursor = cursorHistoryRef.current[currentIdx] ?? null;
    setLoading(true);
    try {
      const [meta, slaData, browseData] = await Promise.all([
        fetchMetadata(),
        fetchSlaReport(filters.from, filters.to),
        fetchBrowseRequests(filters, currentCursor),
      ]);
      if (seq !== requestSeqRef.current) return;
      setMetadata(meta);
      setReport(slaData);
      setBrowseRows(browseData.data);
      setNextCursor(browseData.next_cursor);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  };

  return {
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
    refresh: () => void refresh(),
  };
}
