import { useCallback, useRef, useState } from "react";
import { fetchBrowseRequests } from "../services/report.api";
import {
  MAX_LAST_PAGE_HOPS,
  type BrowseFilterState,
  type BrowseRequestsResponse,
  type RequestReportRow,
} from "../types/report.types";

/**
 * Manages cursor-paginated `/api/requests` rows, cursor history stack, and page navigation.
 */
export function useRequestPagination() {
  const [browseRows, setBrowseRows] = useState<RequestReportRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState<number>(0);

  const cursorHistoryRef = useRef<(string | null)[]>([null]);
  const pageIndexRef = useRef<number>(0);

  const applyFirstPage = useCallback((browseData: BrowseRequestsResponse) => {
    const initialHistory: (string | null)[] = [null];
    setBrowseRows(browseData.data);
    setNextCursor(browseData.next_cursor);
    setPageIndex(0);
    pageIndexRef.current = 0;
    setCursorHistory(initialHistory);
    cursorHistoryRef.current = initialHistory;
  }, []);

  const applyPageResult = useCallback(
    (
      browseData: BrowseRequestsResponse,
      targetPageIndex: number,
      newHistory?: (string | null)[]
    ) => {
      setBrowseRows(browseData.data);
      setNextCursor(browseData.next_cursor);
      setPageIndex(targetPageIndex);
      pageIndexRef.current = targetPageIndex;

      if (newHistory) {
        setCursorHistory(newHistory);
        cursorHistoryRef.current = newHistory;
      }
    },
    []
  );

  const applyRefreshedCurrentPage = useCallback((browseData: BrowseRequestsResponse) => {
    setBrowseRows(browseData.data);
    setNextCursor(browseData.next_cursor);
  }, []);

  const getCurrentCursor = useCallback((): string | null => {
    const currentIdx = pageIndexRef.current;
    return cursorHistoryRef.current[currentIdx] ?? null;
  }, []);

  const walkToLastPage = useCallback(
    async (
      filters: BrowseFilterState,
      isCurrentSeq: () => boolean
    ): Promise<boolean> => {
      let curIdx = pageIndex;
      let curNext: string | null = nextCursor;
      const history = [...cursorHistory.slice(0, curIdx + 1)];
      let lastData: RequestReportRow[] = browseRows;

      let hops = 0;
      while (curNext !== null && hops < MAX_LAST_PAGE_HOPS) {
        hops++;
        const pageRes = await fetchBrowseRequests(filters, curNext);
        if (!isCurrentSeq()) return false;
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
      return true;
    },
    [browseRows, cursorHistory, nextCursor, pageIndex]
  );

  return {
    browseRows,
    nextCursor,
    cursorHistory,
    pageIndex,
    applyFirstPage,
    applyPageResult,
    applyRefreshedCurrentPage,
    getCurrentCursor,
    walkToLastPage,
  };
}

