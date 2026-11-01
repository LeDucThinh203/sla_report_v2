import { parseHolidayDateToIso } from "../utils/timezone.utils.js";

export class StoreRepository {
  constructor() {
    this.sites = new Map();
    this.holidaysBySite = new Map();
    this.staff = new Map();
    this.requests = new Map();
    this.eventsByRequest = new Map();
    this.latestCursor = null;
    this.ready = false;
    this.lastSyncedAt = null;
    this.version = 0;
  }

  isReady() {
    return this.ready;
  }

  setReady(value) {
    this.ready = value;
  }

  getVersion() {
    return this.version;
  }

  getLastSyncedAt() {
    return this.lastSyncedAt;
  }

  setLastSyncedAt(iso) {
    this.lastSyncedAt = iso;
  }

  getLatestCursor() {
    return this.latestCursor;
  }

  setLatestCursor(cursor) {
    this.latestCursor = cursor;
  }

  setSites(sites) {
    this.sites.clear();
    for (const s of sites) {
      this.sites.set(s.id, s);
    }
    this.version++;
  }

  setHolidaysForSite(siteId, holidays) {
    const isoSet = new Set();
    for (const h of holidays) {
      isoSet.add(parseHolidayDateToIso(h.date));
    }
    this.holidaysBySite.set(siteId, isoSet);
    this.version++;
  }

  setStaffList(staffList) {
    this.staff.clear();
    for (const st of staffList) {
      this.staff.set(st.id, st.name);
    }
    this.version++;
  }

  upsertStaff(staff) {
    this.staff.set(staff.id, staff.name);
    this.version++;
  }

  upsertRequest(request) {
    this.requests.set(request.id, request);
    this.version++;
  }

  upsertEvent(requestId, event) {
    let reqEvents = this.eventsByRequest.get(requestId);
    if (!reqEvents) {
      reqEvents = new Map();
      this.eventsByRequest.set(requestId, reqEvents);
    }
    reqEvents.set(event.id, event);
    this.version++;
  }

  applyChanges(changes) {
    if (changes.length === 0) return;

    for (const item of changes) {
      switch (item.type) {
        case "request.created":
        case "request.updated":
          if (item.request) {
            this.requests.set(item.request.id, item.request);
          }
          break;
        case "event.created":
          if (item.request_id !== undefined && item.event) {
            let reqEvents = this.eventsByRequest.get(item.request_id);
            if (!reqEvents) {
              reqEvents = new Map();
              this.eventsByRequest.set(item.request_id, reqEvents);
            }
            reqEvents.set(item.event.id, item.event);
          }
          break;
        case "staff.updated":
          if (item.staff) {
            this.staff.set(item.staff.id, item.staff.name);
          }
          break;
      }
    }
    this.version++;
  }

  /**
   * Replaces all request, event, staff, site, and holiday data atomically from a freshly built store.
   */
  replaceFrom(other) {
    this.sites = new Map(other.sites);
    this.holidaysBySite = new Map(other.holidaysBySite);
    this.staff = new Map(other.staff);
    this.requests = new Map(other.requests);
    this.eventsByRequest = new Map(other.eventsByRequest);
    this.latestCursor = other.latestCursor;
    this.lastSyncedAt = other.lastSyncedAt;
    this.ready = other.ready;
    this.version++;
  }

  getSitesMap() {
    return this.sites;
  }

  getHolidaysBySiteMap() {
    return this.holidaysBySite;
  }

  getStaffMap() {
    return this.staff;
  }

  getRequestsMap() {
    return this.requests;
  }

  getEventsByRequestMap() {
    return this.eventsByRequest;
  }
}

