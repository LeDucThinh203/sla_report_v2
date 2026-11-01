import crypto from "node:crypto";
import {
  DEFAULT_MAX_SNAPSHOTS,
  DEFAULT_SNAPSHOT_TTL_MS,
  MAX_REPORT_CACHE_ENTRIES,
  SNAPSHOT_ID_BYTES,
} from "../types/report.types.js";
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

export class ReportService {
  constructor(store, options = {}) {
    this.store = store;
    this.maxSnapshots = options.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS;
    this.snapshotTtlMs = options.snapshotTtlMs ?? DEFAULT_SNAPSHOT_TTL_MS;
    this.reportCache = new Map();
    this.walkSnapshots = new Map();
    this.versionSnapshotIndex = new Map();
  }

  pruneExpiredSnapshots(now = Date.now()) {
    for (const [sid, snap] of this.walkSnapshots.entries()) {
      if (now - snap.createdAt > this.snapshotTtlMs) {
        this.walkSnapshots.delete(sid);
        if (snap.versionKey && this.versionSnapshotIndex.get(snap.versionKey) === sid) {
          this.versionSnapshotIndex.delete(snap.versionKey);
        }
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

    if (this.reportCache.size > MAX_REPORT_CACHE_ENTRIES) {
      this.reportCache.clear();
    }
    this.reportCache.set(cacheKey, { version: currentVersion, report });

    return report;
  }

  /**
   * Filters request rows by `site_id`, `responder_id`, `late`, and `within_target`.
   */
  filterRows(rows, query) {
    const filtered = [];
    for (const row of rows) {
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
    return filtered;
  }

  /**
   * Sorts a copy of `rows` according to `sort` (nulls last, ties broken by `id` ascending).
   */
  sortRows(rows, sort) {
    return [...rows].sort((a, b) => compareRequestRows(a, b, sort));
  }

  /**
   * Stores a pagination snapshot in the bounded LRU map, evicting the oldest entry if full.
   */
  saveSnapshot(snapshotId, fingerprint, versionKey, rows, now) {
    while (this.walkSnapshots.size >= this.maxSnapshots) {
      const oldestKey = this.walkSnapshots.keys().next().value;
      if (oldestKey === undefined) break;
      const evicted = this.walkSnapshots.get(oldestKey);
      this.walkSnapshots.delete(oldestKey);
      if (
        evicted?.versionKey &&
        this.versionSnapshotIndex.get(evicted.versionKey) === oldestKey
      ) {
        this.versionSnapshotIndex.delete(evicted.versionKey);
      }
    }

    this.walkSnapshots.set(snapshotId, {
      fp: fingerprint,
      versionKey,
      rows,
      createdAt: now,
    });
    this.versionSnapshotIndex.set(versionKey, snapshotId);
  }

  /**
   * Creates or reuses an immutable filtered & sorted snapshot for `(storeVersion, fingerprint)`.
   * Deduplicating by `(storeVersion, fingerprint)` prevents repeated Page-1 requests from
   * evicting active pagination walks while guaranteeing strict `exactly-once` semantics.
   */
  createSnapshot(fingerprint, query, now) {
    const currentVersion = this.store.getVersion();
    const versionKey = `${currentVersion}:${fingerprint}`;
    const existingSid = this.versionSnapshotIndex.get(versionKey);

    if (existingSid) {
      const existingSnap = this.walkSnapshots.get(existingSid);
      if (existingSnap && existingSnap.fp === fingerprint) {
        existingSnap.createdAt = now;
        this.walkSnapshots.delete(existingSid);
        this.walkSnapshots.set(existingSid, existingSnap);
        return { snapshotId: existingSid, offset: 0, rows: existingSnap.rows };
      }
      this.versionSnapshotIndex.delete(versionKey);
    }

    const baseReport = this.getSlaReport(query.from, query.to);
    const filtered = this.filterRows(baseReport.requests, query);
    const rows = this.sortRows(filtered, query.sort);
    const snapshotId = crypto.randomBytes(SNAPSHOT_ID_BYTES).toString("base64url");
    this.saveSnapshot(snapshotId, fingerprint, versionKey, rows, now);
    return { snapshotId, offset: 0, rows };
  }

  /**
   * Validates `cursorStr` and resolves the immutable snapshot & offset for subsequent pages.
   * Strictly requires the snapshot to be valid and within TTL so mutated fields can never
   * cause duplicate or skipped rows during a pagination walk.
   */
  readSnapshotPage(cursorStr, fingerprint, now) {
    const cursorPayload = decodeAndVerifyCursor(cursorStr, fingerprint);
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

    return {
      snapshotId: cursorPayload.sid,
      offset: cursorPayload.offset,
      rows: snapshot.rows,
    };
  }

  /**
   * Slices a page of rows and encodes `next_cursor` if more rows remain.
   */
  buildPaginatedResult(rows, offset, limit, fingerprint, snapshotId) {
    const pageData = rows.slice(offset, offset + limit);
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

  browseRequests(query) {
    if (!this.store.isReady()) {
      throw new ServiceUnavailableError();
    }

    const now = Date.now();
    this.pruneExpiredSnapshots(now);

    const fingerprint = buildFilterFingerprint(query);
    const { snapshotId, offset, rows } =
      query.cursor !== undefined
        ? this.readSnapshotPage(query.cursor, fingerprint, now)
        : this.createSnapshot(fingerprint, query, now);

    return this.buildPaginatedResult(
      rows,
      offset,
      query.limit,
      fingerprint,
      snapshotId
    );
  }
}
