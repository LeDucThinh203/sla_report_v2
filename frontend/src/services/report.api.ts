import type {
  AppMetadataResponse,
  BrowseFilterState,
  BrowseRequestsResponse,
  SlaReportResponse,
} from "../types/report.types";

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const errJson = (await res.json()) as { error?: string };
      if (errJson?.error) message = errJson.error;
    } catch {
      // ignore json parse error
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function fetchMetadata(): Promise<AppMetadataResponse> {
  const res = await fetch("/api/metadata");
  return handleResponse<AppMetadataResponse>(res);
}

export async function fetchSlaReport(
  from: string,
  to: string
): Promise<SlaReportResponse> {
  const params = new URLSearchParams({ from, to });
  const res = await fetch(`/api/sla-report?${params.toString()}`);
  return handleResponse<SlaReportResponse>(res);
}

export async function fetchBrowseRequests(
  filters: BrowseFilterState,
  cursor?: string | null
): Promise<BrowseRequestsResponse> {
  const params = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    sort: filters.sort,
    limit: String(filters.limit),
  });
  if (filters.site_id) params.set("site_id", filters.site_id);
  if (filters.responder_id) params.set("responder_id", filters.responder_id);
  if (filters.within_target) params.set("within_target", filters.within_target);
  if (filters.late) params.set("late", filters.late);
  if (cursor) params.set("cursor", cursor);

  const res = await fetch(`/api/requests?${params.toString()}`);
  return handleResponse<BrowseRequestsResponse>(res);
}

export function buildRequestsCsvUrl(filters: BrowseFilterState): string {
  const params = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    sort: filters.sort,
  });
  if (filters.site_id) params.set("site_id", filters.site_id);
  if (filters.responder_id) params.set("responder_id", filters.responder_id);
  if (filters.within_target) params.set("within_target", filters.within_target);
  if (filters.late) params.set("late", filters.late);

  return `/api/requests.csv?${params.toString()}`;
}


