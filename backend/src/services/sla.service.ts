import type {
  HelpdeskEvent,
  HelpdeskRequest,
  HelpdeskSite,
  RequestPriority,
} from "../types/helpdesk.types.js";
import type {
  RequestReportRow,
  ResponderSummaryRow,
  SlaReportResponse,
} from "../types/report.types.js";
import {
  calculateBusinessMinutes,
  isoToLocalDateString,
  parseDueAtToUtcSeconds,
} from "../utils/timezone.utils.js";

/**
 * Rule 1: Which requests count.
 * `created_at`, converted to the site's local date, is from `from` to `to` inclusive.
 * Skip requests with status `canceled`, with `deleted_at` set, or with `merged_into_id` set.
 */
export function isRequestEligible(
  request: HelpdeskRequest,
  site: HelpdeskSite,
  fromDate: string,
  toDate: string
): boolean {
  if (request.status === "canceled") return false;
  if (request.deleted_at !== null && request.deleted_at !== undefined) return false;
  if (request.merged_into_id !== null && request.merged_into_id !== undefined) return false;

  const localCreatedDate = isoToLocalDateString(request.created_at, site.timezone);
  return localCreatedDate >= fromDate && localCreatedDate <= toDate;
}

/**
 * Rule 2: Undone events.
 * An event with `reverts_id` undoes the event it points at.
 * Ignore both the reverted event and the reverting event in every rule below.
 */
export function filterActiveEvents(events: readonly HelpdeskEvent[]): HelpdeskEvent[] {
  const ignoredIds = new Set<number>();

  for (const ev of events) {
    if (ev.reverts_id !== null && ev.reverts_id !== undefined) {
      ignoredIds.add(ev.id);
      ignoredIds.add(ev.reverts_id);
    }
  }

  // Sort active events chronologically ascending by `at`, then by `id` ascending for deterministic order
  return events
    .filter((ev) => !ignoredIds.has(ev.id))
    .slice()
    .sort((a, b) => (a.at !== b.at ? a.at - b.at : a.id - b.id));
}

/**
 * Rule 5: Within target.
 * `response_business_minutes` <= 60 for `High`, 240 for `Medium`, 480 for `Low` or `null` priority.
 */
export function isWithinSlaTarget(
  responseBusinessMinutes: number,
  priority: RequestPriority
): boolean {
  if (priority === "High") {
    return responseBusinessMinutes <= 60;
  }
  if (priority === "Medium") {
    return responseBusinessMinutes <= 240;
  }
  // "Low" or null
  return responseBusinessMinutes <= 480;
}

/**
 * Computes the report row for a single eligible request according to Rules 2 through 7.
 */
export function evaluateRequestSla(
  request: HelpdeskRequest,
  rawEvents: readonly HelpdeskEvent[],
  site: HelpdeskSite,
  holidayIsoDates: ReadonlySet<string>,
  staffById: ReadonlyMap<number, string>
): RequestReportRow {
  const activeEvents = filterActiveEvents(rawEvents);

  // Rule 3: First response and responder
  // The earliest event (by `at`) with status `processing` and an `actor_id` (System events have `actor_id: null`).
  let firstResponseEvent: HelpdeskEvent | null = null;
  for (const ev of activeEvents) {
    if (ev.status === "processing" && ev.actor_id !== null && ev.actor_id !== undefined) {
      firstResponseEvent = ev;
      break; // activeEvents is already sorted ascending by `at`
    }
  }

  let responderId: number | null = null;
  let responderName: string | null = null;
  let responseBusinessMinutes: number | null = null;
  let withinTarget: boolean | null = null;

  if (firstResponseEvent && firstResponseEvent.actor_id !== null) {
    responderId = firstResponseEvent.actor_id;
    responderName =
      staffById.get(responderId) ?? firstResponseEvent.actor_name ?? null;

    // Rule 4: Response minutes
    const createdAtUtcSec = Math.floor(Date.parse(request.created_at) / 1000);
    responseBusinessMinutes = calculateBusinessMinutes(
      createdAtUtcSec,
      firstResponseEvent.at,
      site,
      holidayIsoDates
    );

    // Rule 5: Within target
    withinTarget = isWithinSlaTarget(responseBusinessMinutes, request.priority);
  }

  // Rule 6: Completed late
  // The last event with status `complete` (even if later events reopened the request) has `at` strictly after the deadline.
  // The deadline is the `due_at` of the latest event that has one, read as site-local wall-clock time.
  let lastCompleteEvent: HelpdeskEvent | null = null;
  let latestDueAtEvent: HelpdeskEvent | null = null;

  for (const ev of activeEvents) {
    if (ev.status === "complete") {
      if (!lastCompleteEvent || ev.at >= lastCompleteEvent.at) {
        lastCompleteEvent = ev;
      }
    }
    if (ev.due_at !== null && ev.due_at !== undefined && ev.due_at.trim() !== "") {
      if (!latestDueAtEvent || ev.at >= latestDueAtEvent.at) {
        latestDueAtEvent = ev;
      }
    }
  }

  let completedLate: boolean | null = null;
  if (lastCompleteEvent && latestDueAtEvent && latestDueAtEvent.due_at) {
    const deadlineUtcSec = parseDueAtToUtcSeconds(
      latestDueAtEvent.due_at,
      site.timezone
    );
    completedLate = lastCompleteEvent.at > deadlineUtcSec;
  }

  return {
    id: request.id,
    site_id: request.site_id,
    responder_id: responderId,
    responder: responderName,
    response_business_minutes: responseBusinessMinutes,
    within_target: withinTarget,
    completed_late: completedLate,
  };
}

/**
 * Aggregates responder summary rows from computed request rows.
 * Contract: "one row per responder in `requests`: current name, request count,
 * and how many of those were within target and completed late."
 */
export function aggregateResponders(
  requestRows: readonly RequestReportRow[],
  staffById: ReadonlyMap<number, string>
): ResponderSummaryRow[] {
  const map = new Map<number, ResponderSummaryRow>();

  for (const row of requestRows) {
    if (row.responder_id === null) continue;

    let entry = map.get(row.responder_id);
    if (!entry) {
      entry = {
        id: row.responder_id,
        name: staffById.get(row.responder_id) ?? row.responder ?? `Staff #${row.responder_id}`,
        requests: 0,
        within_target: 0,
        completed_late: 0,
      };
      map.set(row.responder_id, entry);
    }

    entry.requests += 1;
    if (row.within_target === true) {
      entry.within_target += 1;
    }
    if (row.completed_late === true) {
      entry.completed_late += 1;
    }
  }

  return Array.from(map.values()).sort((a, b) => a.id - b.id);
}

/**
 * Builds the complete SLA report for the given date range [from, to].
 */
export function buildSlaReport(
  from: string,
  to: string,
  requests: Iterable<HelpdeskRequest>,
  eventsByRequestId: ReadonlyMap<number, ReadonlyMap<number, HelpdeskEvent>>,
  sitesById: ReadonlyMap<number, HelpdeskSite>,
  holidaysBySiteId: ReadonlyMap<number, ReadonlySet<string>>,
  staffById: ReadonlyMap<number, string>
): SlaReportResponse {
  const reportRows: RequestReportRow[] = [];

  for (const req of requests) {
    const site = sitesById.get(req.site_id);
    if (!site) continue;

    if (!isRequestEligible(req, site, from, to)) {
      continue;
    }

    const eventMap = eventsByRequestId.get(req.id);
    const rawEvents = eventMap ? Array.from(eventMap.values()) : [];
    const holidays = holidaysBySiteId.get(req.site_id) ?? new Set<string>();

    const row = evaluateRequestSla(req, rawEvents, site, holidays, staffById);
    reportRows.push(row);
  }

  // Deterministic order by id ascending
  reportRows.sort((a, b) => a.id - b.id);

  const responders = aggregateResponders(reportRows, staffById);

  return {
    from,
    to,
    requests: reportRows,
    responders,
  };
}

