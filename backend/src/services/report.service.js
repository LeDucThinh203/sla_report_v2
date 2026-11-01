import crypto from "node:crypto";
import {
  buildFilterFingerprint,
  compareRequestRows,
  decodeAndVerifyCursor,
  encodeCursor,
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

const DEFAULT_MAX_SNAPSHOTS = 200;
const DEFAULT_SNAPSHOT_TTL_MS = 15 * 60 * 1000; // 15 minutes

export class ReportService {
  constructor(store, options = {}) {
    this.store = store;
    this.maxSnapshots = options.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS;
    this.snapshotTtlMs = options.snapshotTtlMs ?? DEFAULT_SNAPSHOT_TTL_MS;
    this.reportCache = new Map();
    this.walkSnapshots = new Map();
  }

  pruneExpiredSnapshots(now = Date.now()) {
    for (const [sid, snap] of this.walkSnapshots.entries()) {
      if (now - snap.createdAt > this.snapshotTtlMs) {
        this.walkSnapshots.delete(sid);
      }
    }
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

    const now = Date.now();
    this.pruneExpiredSnapshots(now);

    const fingerprint = buildFilterFingerprint(query);

    let snapshotId;
    let offset = 0;
    let rows;

    if (query.cursor !== undefined) {
      const cursorPayload = decodeAndVerifyCursor(query.cursor, fingerprint);
      if (!cursorPayload) {
        throw new BadRequestError("Invalid or expired cursor");
      }

      const snapshot = this.walkSnapshots.get(cursorPayload.sid);
      if (!snapshot || snapshot.fp !== fingerprint) {
        throw new BadRequestError("Invalid or expired cursor");
      }

      if (cursorPayload.offset <= 0 || cursorPayload.offset >= snapshot.rows.length) {
        throw new BadRequestError("Cursor offset out of range");
      }

      // Refresh LRU position & timestamp on active walk
      snapshot.createdAt = now;
      this.walkSnapshots.delete(cursorPayload.sid);
      this.walkSnapshots.set(cursorPayload.sid, snapshot);

      snapshotId = cursorPayload.sid;
      offset = cursorPayload.offset;
      rows = snapshot.rows;
    } else {
      const baseReport = this.getSlaReport(query.from, query.to);

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

      rows = filtered;
      snapshotId = crypto.randomBytes(12).toString("base64url");

      // Evict oldest snapshot if capacity exceeded
      while (this.walkSnapshots.size >= this.maxSnapshots) {
        const oldestKey = this.walkSnapshots.keys().next().value;
        if (oldestKey === undefined) break;
        this.walkSnapshots.delete(oldestKey);
      }

      this.walkSnapshots.set(snapshotId, {
        fp: fingerprint,
        rows,
        createdAt: now,
      });
    }

    const pageData = rows.slice(offset, offset + query.limit);
    const nextOffset = offset + pageData.length;
    const hasMore = nextOffset < rows.length;

    let nextCursor = null;
    if (hasMore && pageData.length > 0) {
      nextCursor = encodeCursor({
        fp: fingerprint,
        sid: snapshotId,
        offset: nextOffset,
      });
    }

    return {
      data: pageData,
      next_cursor: nextCursor,
    };
  }
}
