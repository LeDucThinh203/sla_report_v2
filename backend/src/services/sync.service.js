import { StoreRepository } from "../repositories/store.repository.js";
import { HelpdeskApiError } from "./helpdesk.service.js";

export class SyncService {
  constructor(client, store, options = {}) {
    this.client = client;
    this.store = store;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? 1000;
    this.maxInitialRetryDelayMs = options.maxInitialRetryDelayMs ?? 10000;
    this.pollTimer = null;
    this.syncing = false;
    this.stopped = false;
    this.initialSyncPromise = null;
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Starts initial synchronization with automatic exponential backoff retry until `/ready` becomes `true`,
   * then transitions into background incremental polling.
   */
  start() {
    this.stopped = false;
    if (!this.initialSyncPromise) {
      this.initialSyncPromise = this.ensureInitialSyncWithRetry().then(() => {
        if (!this.stopped) {
          this.startPolling();
        }
      });
    }
    return this.initialSyncPromise;
  }

  stop() {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Retries initial synchronization until `this.store.isReady()` is true (or `stop()` is called).
   * Preserves partial progress if the failure occurred mid-stream in `/v1/changes`.
   */
  async ensureInitialSyncWithRetry() {
    let attempt = 0;
    while (!this.stopped && !this.store.isReady()) {
      attempt++;
      try {
        await this.runFullSyncIntoStore(this.store);
      } catch (err) {
        if (this.stopped) break;
        const delay = Math.min(
          this.initialRetryDelayMs * Math.pow(2, Math.min(attempt - 1, 4)),
          this.maxInitialRetryDelayMs
        );
        console.error(
          `[SyncService] Initial sync attempt #${attempt} failed (${
            err instanceof Error ? err.message : String(err)
          }). Retrying in ${delay}ms...`
        );
        await this.sleep(delay);
      }
    }
  }

  /**
   * Performs a complete sync of sites, holidays, staff, and the change feed into `targetStore`.
   * If `targetStore` already has a cursor from an interrupted attempt, resumes from that cursor
   * unless it expired (410), in which case it resets from the beginning.
   */
  async runFullSyncIntoStore(targetStore) {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const [sites, staff] = await Promise.all([
        this.client.getSites(),
        this.client.getStaff(),
      ]);

      targetStore.setSites(sites);
      targetStore.setStaffList(staff);

      // Fetch holidays for all sites concurrently
      await Promise.all(
        sites.map(async (site) => {
          const holidays = await this.client.getSiteHolidays(site.id);
          targetStore.setHolidaysForSite(site.id, holidays);
        })
      );

      // Drain /v1/changes (resume from targetStore.getLatestCursor() if partially synced)
      let cursor = targetStore.getLatestCursor();
      let hasMore = true;

      while (hasMore && !this.stopped) {
        try {
          const page = await this.client.getChanges(cursor, 500);
          targetStore.applyChanges(page.data);
          if (page.next_cursor) {
            cursor = page.next_cursor;
            targetStore.setLatestCursor(cursor);
          }
          hasMore = Boolean(page.has_more && page.next_cursor);
        } catch (err) {
          if (err instanceof HelpdeskApiError && err.status === 410) {
            // Cursor expired during bootstrap: restart feed from beginning
            cursor = null;
            targetStore.setLatestCursor(null);
            continue;
          }
          throw err;
        }
      }

      if (!this.stopped) {
        targetStore.setLastSyncedAt(new Date().toISOString());
        targetStore.setReady(true);
      }
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Polls `/v1/changes` from the latest cursor to pick up incremental updates within 60s.
   * Handles 410 Gone (expired cursor) by rebuilding a fresh store and swapping atomically.
   */
  async syncIncremental() {
    if (this.syncing || this.stopped) return;

    if (!this.store.isReady()) {
      await this.runFullSyncIntoStore(this.store);
      return;
    }

    this.syncing = true;
    try {
      let cursor = this.store.getLatestCursor();
      let hasMore = true;

      while (hasMore && !this.stopped) {
        const page = await this.client.getChanges(cursor, 500);
        if (page.data.length > 0) {
          this.store.applyChanges(page.data);
        }
        if (page.next_cursor) {
          cursor = page.next_cursor;
          this.store.setLatestCursor(cursor);
        }
        hasMore = Boolean(page.has_more && page.next_cursor && page.data.length > 0);
      }

      this.store.setLastSyncedAt(new Date().toISOString());
    } catch (err) {
      if (err instanceof HelpdeskApiError && err.status === 410) {
        // Cursor expired after 15 minutes: rebuild into a temporary store and swap atomically
        this.syncing = false;
        const freshStore = new StoreRepository();
        await this.runFullSyncIntoStore(freshStore);
        this.store.replaceFrom(freshStore);
        return;
      }
      throw err;
    } finally {
      this.syncing = false;
    }
  }

  startPolling() {
    if (this.pollTimer || this.pollIntervalMs <= 0 || this.stopped) return;
    this.pollTimer = setInterval(() => {
      this.syncIncremental().catch((err) => {
        console.error("[SyncService] Incremental sync error:", err);
      });
    }, this.pollIntervalMs);
    if (typeof this.pollTimer.unref === "function") {
      this.pollTimer.unref();
    }
  }
}
