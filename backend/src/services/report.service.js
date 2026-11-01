import {
  buildFilterFingerprint,
  compareRequestRows,
  decodeAndVerifyCursor,
  encodeCursor,
  isRowAfterCursor,
} from "../utils/pagination.utils.js";
import { buildSlaReport } from "./sla.service.js";

export class BadRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "BadRequestError";
    this.status = 400;
  }
}

export class ServiceUnavailableError extends Error {
  constructor(message = "Service is warming up, please retry shortly") {
    super(message);
    this.name = "ServiceUnavailableError";
    this.status = 503;
  }
}

export class ReportService {
  constructor(store) {
    this.store = store;
    this.reportCache = new Map();
  }

  getSlaReport(from, to) {
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

  browseRequests(query) {
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
    const filtered = [];
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

    let nextCursor = null;
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

