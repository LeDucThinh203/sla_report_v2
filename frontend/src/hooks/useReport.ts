import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBrowseRequests, fetchMetadata } from "../services/report.api";
import type { BrowseFilterState } from "../types/report.types";
import { useLiveSync } from "./useLiveSync";
import { useRequestPagination } from "./useRequestPagination";
import { useSlaReport } from "./useSlaReport";

/**
 * Coordinates report filters, SLA summary fetching (`useSlaReport`),
 * cursor pagination (`useRequestPagination`), and live change-feed polling (`useLiveSync`).
 */
export function useReport(initialFilters: BrowseFilterState) {
  const [filters, setFilters] = useState<BrowseFilterState>(initialFilters);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const requestSeqRef = useRef<number>(0);

  const { report, setReport, loadSlaReport } = useSlaReport();
  const {
    browseRows,
    nextCursor,
    cursorHistory,
    pageIndex,
    applyFirstPage,
    applyPageResult,
    walkToLastPage,
  } = useRequestPagination();

  const loadFullDataRef = useRef<(activeFilters: BrowseFilterState) => Promise<void>>(
    async () => {}
  );

  const handleVersionChanged = useCallback(() => {
    const seq = ++requestSeqRef.current;
    void Promise.all([
      loadSlaReport(filters.from, filters.to),
      fetchBrowseRequests(filters, null),
    ])
      .then(([slaData, browseData]) => {
        if (seq !== requestSeqRef.current) return;
        setReport(slaData);
        applyFirstPage(browseData);
      })
      .catch(() => {
        if (seq !== requestSeqRef.current) return;
        void loadFullDataRef.current(filters);
      });
  }, [applyFirstPage, filters, loadSlaReport, setReport]);

  const handleBecameReady = useCallback(() => {
    void loadFullDataRef.current(filters);
  }, [filters]);

  const { metadata, updateMetadata } = useLiveSync({
    onBecameReady: handleBecameReady,
    onVersionChanged: handleVersionChanged,
  });

  const loadFullData = useCallback(
    async (activeFilters: BrowseFilterState) => {
      const seq = ++requestSeqRef.current;
      setLoading(true);
      setError(null);
      try {
        const meta = await fetchMetadata();
        if (seq !== requestSeqRef.current) return;
        updateMetadata(meta);

        if (!meta.ready) {
          setLoading(false);
          return;
        }

        const [slaData, browseData] = await Promise.all([
          loadSlaReport(activeFilters.from, activeFilters.to),
          fetchBrowseRequests(activeFilters, null),
        ]);
        if (seq !== requestSeqRef.current) return;

        setReport(slaData);
        applyFirstPage(browseData);
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load report data");
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [applyFirstPage, loadSlaReport, setReport, updateMetadata]
  );

  useEffect(() => {
    loadFullDataRef.current = loadFullData;
  }, [loadFullData]);

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
        applyPageResult(browseData, targetPageIndex, newHistory);
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load page");
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [applyPageResult]
  );

  // Reload full report + Page 1 whenever filters change
  useEffect(() => {
    void loadFullData(filters);
  }, [filters, loadFullData]);

  const goToFirstPage = async () => {
    if (pageIndex <= 0 || loading) return;
    await loadPageOnly(filters, null, 0, [null]);
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
      await walkToLastPage(filters, () => seq === requestSeqRef.current);
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
    setLoading(true);
    setError(null);
    try {
      const [meta, slaData, browseData] = await Promise.all([
        fetchMetadata(),
        loadSlaReport(filters.from, filters.to),
        fetchBrowseRequests(filters, null),
      ]);
      if (seq !== requestSeqRef.current) return;
      updateMetadata(meta);
      setReport(slaData);
      applyFirstPage(browseData);
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
