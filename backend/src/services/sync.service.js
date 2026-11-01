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
    this.stagingCursor = null;
    this.stagingStore = null;
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
   * Stages all data in a temporary buffer if `targetStore` is not yet ready so that `targetStore`
   * transitions to ready atomically only after the entire initial change feed has been drained.
   */
  async runFullSyncIntoStore(targetStore) {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const workStore =
        targetStore === this.store && !targetStore.isReady()
          ? (this.stagingStore ?? (this.stagingStore = new StoreRepository()))
          : targetStore;

      if (workStore.getSitesMap().size === 0) {
        const [sites, staff] = await Promise.all([
          this.client.getSites(),
          this.client.getStaff(),
        ]);

        workStore.setSites(sites);
        workStore.setStaffList(staff);

        await Promise.all(
          sites.map(async (site) => {
            const holidays = await this.client.getSiteHolidays(site.id);
            workStore.setHolidaysForSite(site.id, holidays);
          })
        );
      }

      let cursor = workStore.getLatestCursor();
      let hasMore = true;

      while (hasMore && !this.stopped) {
        try {
          const page = await this.client.getChanges(cursor, 500);
          workStore.applyChanges(page.data);
          if (page.next_cursor) {
            cursor = page.next_cursor;
            workStore.setLatestCursor(cursor);
          }
          hasMore = Boolean(page.has_more && page.next_cursor);
        } catch (err) {
          if (err instanceof HelpdeskApiError && err.status === 410) {
            // Cursor expired during bootstrap: reset workStore and restart feed from beginning
            const sites = Array.from(workStore.getSitesMap().values());
            const staff = Array.from(workStore.getStaffMap().entries()).map(
              ([id, name]) => ({ id, name })
            );
            const holidaysSnapshot = new Map(workStore.getHolidaysBySiteMap());
            const cleanStore = new StoreRepository();
            cleanStore.setSites(sites);
            cleanStore.setStaffList(staff);
            for (const [siteId, set] of holidaysSnapshot.entries()) {
              cleanStore.setHolidaysForSite(
                siteId,
                Array.from(set).map((date) => ({ date, name: "" }))
              );
            }
            workStore.replaceFrom(cleanStore);
            cursor = null;
            continue;
          }
          throw err;
        }
      }

      if (!this.stopped) {
        workStore.setLastSyncedAt(new Date().toISOString());
        workStore.setReady(true);
        if (workStore !== targetStore) {
          targetStore.replaceFrom(workStore);
          this.stagingStore = null;
        }
      }
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Polls `/v1/changes` from the latest cursor to pick up incremental updates within 60s.
   * Buffers all pages of an incremental batch and applies them in a single atomic commit
   * so concurrent report readers never observe half-applied multi-page updates.
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
      const bufferedChanges = [];

      while (hasMore && !this.stopped) {
        const page = await this.client.getChanges(cursor, 500);
        if (page.data.length > 0) {
          bufferedChanges.push(...page.data);
        }
        if (page.next_cursor) {
          cursor = page.next_cursor;
        }
        hasMore = Boolean(page.has_more && page.next_cursor && page.data.length > 0);
      }

      if (!this.stopped) {
        if (bufferedChanges.length > 0) {
          this.store.applyChanges(bufferedChanges);
        }
        if (cursor) {
          this.store.setLatestCursor(cursor);
        }
        this.store.setLastSyncedAt(new Date().toISOString());
      }
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
