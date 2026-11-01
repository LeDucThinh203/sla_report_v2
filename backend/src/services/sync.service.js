import { StoreRepository } from "../repositories/store.repository.js";
import { HelpdeskApiError } from "./helpdesk.service.js";

export class SyncService {
  constructor(client, store, options = {}) {
    this.client = client;
    this.store = store;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.pollTimer = null;
    this.syncing = false;
    this.initialSyncPromise = null;
  }

  /**
   * Starts initial synchronization and schedules background polling for live changes.
   */
  start() {
    if (!this.initialSyncPromise) {
      this.initialSyncPromise = this.runFullSyncIntoStore(this.store)
        .then(() => {
          this.startPolling();
        })
        .catch((err) => {
          console.error("[SyncService] Initial sync failed, will retry in background:", err);
          this.startPolling();
        });
    }
    return this.initialSyncPromise;
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Performs a complete sync of sites, holidays, staff, and the entire change feed into `targetStore`.
   */
  async runFullSyncIntoStore(targetStore) {
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

      // Drain /v1/changes from the beginning
      let cursor = null;
      let hasMore = true;

      while (hasMore) {
        const page = await this.client.getChanges(cursor, 500);
        targetStore.applyChanges(page.data);
        if (page.next_cursor) {
          cursor = page.next_cursor;
          targetStore.setLatestCursor(cursor);
        }
        hasMore = Boolean(page.has_more && page.next_cursor);
      }

      targetStore.setLastSyncedAt(new Date().toISOString());
      targetStore.setReady(true);
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Polls `/v1/changes` from the latest cursor to pick up incremental updates within 60s.
   * Handles 410 Gone (expired cursor) by rebuilding a fresh store and swapping atomically.
   */
  async syncIncremental() {
    if (this.syncing) return;

    if (!this.store.isReady()) {
      await this.runFullSyncIntoStore(this.store);
      return;
    }

    this.syncing = true;
    try {
      let cursor = this.store.getLatestCursor();
      let hasMore = true;

      while (hasMore) {
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
    if (this.pollTimer || this.pollIntervalMs <= 0) return;
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

