export type RequestStatus = "pending" | "processing" | "complete" | "canceled";
export type RequestPriority = "Low" | "Medium" | "High" | null;

export interface HelpdeskAssignee {
  id: number;
  name: string;
}

export interface HelpdeskRequest {
  id: number;
  ref?: string;
  title?: string;
  location?: string;
  site_id: number;
  status: RequestStatus;
  priority: RequestPriority;
  created_at: string;
  updated_at?: string;
  due_on?: string | null;
  assignee?: HelpdeskAssignee | null;
  deleted_at: string | null;
  merged_into_id: number | null;
}

export interface HelpdeskEvent {
  id: number;
  status: RequestStatus;
  at: number; // Unix seconds
  actor_id: number | null;
  actor_name: string | null;
  assignee_name?: string | null;
  due_at: string | null; // "DD/MM/YYYY HH:mm" or null
  note?: string | null;
  reverts_id: number | null;
}

export interface BusinessHoursWindow {
  open: string; // "HH:mm"
  close: string; // "HH:mm"
}

export type DayOfWeekKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type BusinessHoursMap = Record<DayOfWeekKey, BusinessHoursWindow | null>;

export interface HelpdeskSite {
  id: number;
  name: string;
  timezone: string;
  business_hours: BusinessHoursMap;
}

export interface HelpdeskHoliday {
  date: string; // "DD/MM/YYYY"
  name: string;
}

export interface HelpdeskStaff {
  id: number;
  name: string;
}

export interface HelpdeskStatus {
  value: RequestStatus;
  label: string;
}

export type ChangeType =
  | "request.created"
  | "event.created"
  | "request.updated"
  | "staff.updated";

export interface HelpdeskChangeItem {
  seq: number;
  type: ChangeType;
  at: string;
  request?: HelpdeskRequest;
  request_id?: number;
  event?: HelpdeskEvent;
  staff?: HelpdeskStaff;
}

export interface HelpdeskChangesResponse {
  data: HelpdeskChangeItem[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface HelpdeskPagedRequestsResponse {
  data: HelpdeskRequest[];
  page: number;
  per_page: number;
  total_pages: number;
  total: number;
}

export interface HelpdeskPagedEventsResponse {
  data: HelpdeskEvent[];
  page: number;
  per_page: number;
  has_more: boolean;
}
