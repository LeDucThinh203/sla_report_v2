import { StoreRepository } from "../repositories/store.repository.js";
import {
  CHANGE_FEED_PAGE_SIZE,
  DEFAULT_INITIAL_RETRY_DELAY_MS,
  DEFAULT_MAX_INITIAL_RETRY_DELAY_MS,
  DEFAULT_SYNC_POLL_INTERVAL_MS,
} from "../types/helpdesk.types.js";
import { HelpdeskApiError } from "./helpdesk.service.js";

export class SyncService {
  constructor(client, store, options = {}) {
    this.client = client;
    this.store = store;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_SYNC_POLL_INTERVAL_MS;
    this.initialRetryDelayMs =
      options.initialRetryDelayMs ?? DEFAULT_INITIAL_RETRY_DELAY_MS;
    this.maxInitialRetryDelayMs =
      options.maxInitialRetryDelayMs ?? DEFAULT_MAX_INITIAL_RETRY_DELAY_MS;
    this.pollTimer = null;
    this.syncing = false;
    this.stopped = false;
    this.initialSyncPromise = null;
    this.stagingStore = null;
    this.rebuildStore = null;
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
   * Step 1: Loads sites, staff, and per-site holidays into `store` if not yet populated.
   */
  async loadReferenceData(store) {
    if (store.getSitesMap().size > 0) return;

    const [sites, staff] = await Promise.all([
      this.client.getSites(),
      this.client.getStaff(),
    ]);

    store.setSites(sites);
    store.setStaffList(staff);

    await Promise.all(
      sites.map(async (site) => {
        const holidays = await this.client.getSiteHolidays(site.id);
        store.setHolidaysForSite(site.id, holidays);
      })
    );
  }

  /**
   * Step 2: Resets `store` to a clean state with fresh reference data when a cursor expires (410 Gone).
   */
  async recoverExpiredCursor(store) {
    const cleanStore = new StoreRepository();
    await this.loadReferenceData(cleanStore);
    store.replaceFrom(cleanStore);
  }

  /**
   * Step 3: Drains all pages of `/v1/changes` into `store`, handling mid-stream 410 cursor expiry.
   */
  async drainChangeFeed(store) {
    let cursor = store.getLatestCursor();
    let hasMore = true;

    while (hasMore && !this.stopped) {
      try {
        const page = await this.client.getChanges(cursor, CHANGE_FEED_PAGE_SIZE);
        store.applyChanges(page.data);
        if (page.next_cursor) {
          cursor = page.next_cursor;
          store.setLatestCursor(cursor);
        }
        hasMore = Boolean(page.has_more && page.next_cursor);
      } catch (err) {
        if (err instanceof HelpdeskApiError && err.status === 410) {
          await this.recoverExpiredCursor(store);
          cursor = null;
          hasMore = true;
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Step 4: Marks `workStore` ready and atomically commits it into `targetStore`.
   */
  commitSyncedStore(workStore, targetStore) {
    if (this.stopped) return;
    workStore.setLastSyncedAt(new Date().toISOString());
    workStore.setReady(true);
    if (workStore !== targetStore) {
      targetStore.replaceFrom(workStore);
      if (workStore === this.stagingStore) {
        this.stagingStore = null;
      }
    }
  }

  /**
   * Performs a complete sync of reference data and the change feed into `targetStore`.
   */
  async runFullSyncIntoStore(targetStore) {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const workStore =
        targetStore === this.store && !targetStore.isReady()
          ? (this.stagingStore ?? (this.stagingStore = new StoreRepository()))
          : targetStore;

      await this.loadReferenceData(workStore);
      await this.drainChangeFeed(workStore);
      this.commitSyncedStore(workStore, targetStore);
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Resumes or initiates a background store rebuild after an incremental 410 cursor expiry,
   * then swaps atomically into `this.store` once complete.
   */
  async resumeOrStartRebuildStore() {
    if (!this.rebuildStore) {
      this.rebuildStore = new StoreRepository();
    }
    await this.runFullSyncIntoStore(this.rebuildStore);
    if (this.rebuildStore.isReady() && !this.stopped) {
      this.store.replaceFrom(this.rebuildStore);
      this.rebuildStore = null;
    }
  }

  /**
   * Polls `/v1/changes` from the latest cursor to pick up incremental updates within 60s.
   * Buffers all pages of an incremental batch and applies them in a single atomic commit.
   */
  async syncIncremental() {
    if (this.syncing || this.stopped) return;

    if (!this.store.isReady()) {
      await this.runFullSyncIntoStore(this.store);
      return;
    }

    if (this.rebuildStore) {
      await this.resumeOrStartRebuildStore();
      return;
    }

    this.syncing = true;
    try {
      let cursor = this.store.getLatestCursor();
      let hasMore = true;
      const bufferedChanges = [];

      while (hasMore && !this.stopped) {
        const page = await this.client.getChanges(cursor, CHANGE_FEED_PAGE_SIZE);
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
        this.syncing = false;
        await this.resumeOrStartRebuildStore();
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
