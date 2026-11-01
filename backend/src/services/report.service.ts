import { StoreRepository } from "../repositories/store.repository.js";
import type {
  BrowseRequestsQuery,
  BrowseRequestsResponse,
  RequestReportRow,
  SlaReportResponse,
} from "../types/report.types.js";
import {
  buildFilterFingerprint,
  compareRequestRows,
  decodeAndVerifyCursor,
  encodeCursor,
  isRowAfterCursor,
} from "../utils/pagination.utils.js";
import { buildSlaReport } from "./sla.service.js";

export class BadRequestError extends Error {
  public readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

export class ServiceUnavailableError extends Error {
  public readonly status = 503;
  constructor(message = "Service is warming up, please retry shortly") {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}

interface CachedReport {
  version: number;
  report: SlaReportResponse;
}

export class ReportService {
  private readonly store: StoreRepository;
  private readonly reportCache = new Map<string, CachedReport>();

  constructor(store: StoreRepository) {
    this.store = store;
  }

  public getSlaReport(from: string, to: string): SlaReportResponse {
    if (!this.store.isReady()) {
      throw new ServiceUnavailableError();
    }

    const cacheKey = `${from}:${to}`;
    const currentVersion = this.store.getVersion();
    const cached = this.reportCache.get(cacheKey);
    if (cached && cached.version === currentVersion) {
      return cached.report;
    }

    const report = buildSlaReport(
      from,
      to,
      this.store.getRequestsMap().values(),
      this.store.getEventsByRequestMap(),
      this.store.getSitesMap(),
      this.store.getHolidaysBySiteMap(),
      this.store.getStaffMap()
    );

    // Keep cache bounded
    if (this.reportCache.size > 50) {
      this.reportCache.clear();
    }
    this.reportCache.set(cacheKey, { version: currentVersion, report });

    return report;
  }

  public browseRequests(query: BrowseRequestsQuery): BrowseRequestsResponse {
    if (!this.store.isReady()) {
      throw new ServiceUnavailableError();
    }

    const fingerprint = buildFilterFingerprint(query);
    let cursorPayload = null;
    if (query.cursor !== undefined) {
      cursorPayload = decodeAndVerifyCursor(query.cursor, fingerprint);
      if (!cursorPayload) {
        throw new BadRequestError("Invalid or expired cursor");
      }
    }

    const baseReport = this.getSlaReport(query.from, query.to);

    // Filter rows
    const filtered: RequestReportRow[] = [];
    for (const row of baseReport.requests) {
      if (query.site_id !== undefined && row.site_id !== query.site_id) {
        continue;
      }
      if (query.responder_id !== undefined && row.responder_id !== query.responder_id) {
        continue;
      }
      if (query.late !== undefined && row.completed_late !== query.late) {
        continue;
      }
      if (query.within_target !== undefined && row.within_target !== query.within_target) {
        continue;
      }
      filtered.push(row);
    }

    // Sort rows according to `query.sort` (nulls last, ties by `id` ascending)
    filtered.sort((a, b) => compareRequestRows(a, b, query.sort));

    // Apply keyset cursor filtering
    const afterCursor = cursorPayload
      ? filtered.filter((row) => isRowAfterCursor(row, cursorPayload, query.sort))
      : filtered;

    const pageData = afterCursor.slice(0, query.limit);
    const hasMore = afterCursor.length > query.limit;

    let nextCursor: string | null = null;
    if (hasMore && pageData.length > 0) {
      const lastItem = pageData[pageData.length - 1];
      nextCursor = encodeCursor({
        fp: fingerprint,
        lastId: lastItem.id,
        lastMinutes: lastItem.response_business_minutes,
      });
    }

    return {
      data: pageData,
      next_cursor: nextCursor,
    };
  }
}

