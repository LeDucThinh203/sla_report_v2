import { useCallback, useState } from "react";
import { fetchSlaReport } from "../services/report.api";
import type { SlaReportResponse } from "../types/report.types";

/**
 * Manages the aggregate SLA report (`/api/sla-report`) state and fetching.
 */
export function useSlaReport() {
  const [report, setReport] = useState<SlaReportResponse | null>(null);

  const loadSlaReport = useCallback(async (from: string, to: string) => {
    return await fetchSlaReport(from, to);
  }, []);

  return {
    report,
    setReport,
    loadSlaReport,
  };
}

