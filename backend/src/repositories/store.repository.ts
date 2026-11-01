import type {
  HelpdeskChangeItem,
  HelpdeskEvent,
  HelpdeskHoliday,
  HelpdeskRequest,
  HelpdeskSite,
  HelpdeskStaff,
} from "../types/helpdesk.types.js";
import { parseHolidayDateToIso } from "../utils/timezone.utils.js";

export class StoreRepository {
  private sites = new Map<number, HelpdeskSite>();
  private holidaysBySite = new Map<number, Set<string>>();
  private staff = new Map<number, string>();
  private requests = new Map<number, HelpdeskRequest>();
  private eventsByRequest = new Map<number, Map<number, HelpdeskEvent>>();
  private latestCursor: string | null = null;
  private ready = false;
  private lastSyncedAt: string | null = null;
  private version = 0;

  public isReady(): boolean {
    return this.ready;
  }

  public setReady(value: boolean): void {
    this.ready = value;
  }

  public getVersion(): number {
    return this.version;
  }

  public getLastSyncedAt(): string | null {
    return this.lastSyncedAt;
  }

  public setLastSyncedAt(iso: string): void {
    this.lastSyncedAt = iso;
  }

  public getLatestCursor(): string | null {
    return this.latestCursor;
  }

  public setLatestCursor(cursor: string | null): void {
    this.latestCursor = cursor;
  }

  public setSites(sites: HelpdeskSite[]): void {
    this.sites.clear();
    for (const s of sites) {
      this.sites.set(s.id, s);
    }
    this.version++;
  }

  public setHolidaysForSite(siteId: number, holidays: HelpdeskHoliday[]): void {
    const isoSet = new Set<string>();
    for (const h of holidays) {
      isoSet.add(parseHolidayDateToIso(h.date));
    }
    this.holidaysBySite.set(siteId, isoSet);
    this.version++;
  }

  public setStaffList(staffList: HelpdeskStaff[]): void {
    this.staff.clear();
    for (const st of staffList) {
      this.staff.set(st.id, st.name);
    }
    this.version++;
  }

  public upsertStaff(staff: HelpdeskStaff): void {
    this.staff.set(staff.id, staff.name);
    this.version++;
  }

  public upsertRequest(request: HelpdeskRequest): void {
    this.requests.set(request.id, request);
    this.version++;
  }

  public upsertEvent(requestId: number, event: HelpdeskEvent): void {
    let reqEvents = this.eventsByRequest.get(requestId);
    if (!reqEvents) {
      reqEvents = new Map<number, HelpdeskEvent>();
      this.eventsByRequest.set(requestId, reqEvents);
    }
    reqEvents.set(event.id, event);
    this.version++;
  }

  public applyChanges(changes: HelpdeskChangeItem[]): void {
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
              reqEvents = new Map<number, HelpdeskEvent>();
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
  public replaceFrom(other: StoreRepository): void {
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

  public getSitesMap(): ReadonlyMap<number, HelpdeskSite> {
    return this.sites;
  }

  public getHolidaysBySiteMap(): ReadonlyMap<number, ReadonlySet<string>> {
    return this.holidaysBySite;
  }

  public getStaffMap(): ReadonlyMap<number, string> {
    return this.staff;
  }

  public getRequestsMap(): ReadonlyMap<number, HelpdeskRequest> {
    return this.requests;
  }

  public getEventsByRequestMap(): ReadonlyMap<number, ReadonlyMap<number, HelpdeskEvent>> {
    return this.eventsByRequest;
  }
}
