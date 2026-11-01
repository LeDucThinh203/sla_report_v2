export interface RequestReportRow {
  id: number;
  site_id: number;
  responder_id: number | null;
  responder: string | null;
  response_business_minutes: number | null;
  within_target: boolean | null;
  completed_late: boolean | null;
}

export interface ResponderSummaryRow {
  id: number;
  name: string;
  requests: number;
  within_target: number;
  completed_late: number;
}

export interface SlaReportResponse {
  from: string;
  to: string;
  requests: RequestReportRow[];
  responders: ResponderSummaryRow[];
}

export type SortField =
  | "id"
  | "-id"
  | "response_business_minutes"
  | "-response_business_minutes";

export interface BrowseRequestsResponse {
  data: RequestReportRow[];
  next_cursor: string | null;
}

export interface SiteInfo {
  id: number;
  name: string;
  timezone: string;
}

export interface StaffInfo {
  id: number;
  name: string;
}

export interface AppMetadataResponse {
  ready: boolean;
  data_version: number;
  last_synced_at: string | null;
  total_requests_cached: number;
  sites: SiteInfo[];
  staff: StaffInfo[];
}

export interface BrowseFilterState {
  from: string;
  to: string;
  site_id: string;
  responder_id: string;
  within_target: string;
  late: string;
  sort: SortField;
  limit: number;
}

