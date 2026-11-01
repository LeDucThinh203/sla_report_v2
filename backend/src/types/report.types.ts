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

export interface BrowseRequestsQuery {
  from: string;
  to: string;
  site_id?: number;
  responder_id?: number;
  late?: boolean;
  within_target?: boolean;
  sort: SortField;
  limit: number;
  cursor?: string;
}

export interface BrowseRequestsResponse {
  data: RequestReportRow[];
  next_cursor: string | null;
}
