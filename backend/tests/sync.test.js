import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { StoreRepository } from "../src/repositories/store.repository.js";
import { HelpdeskClient } from "../src/services/helpdesk.service.js";
import { SyncService } from "../src/services/sync.service.js";
import { ReportService } from "../src/services/report.service.js";

describe("Level 2 & Level 3: Change-feed Sync, 429 Retry-After, 410 Expiry, Multi-page Atomic Sync & 12k Benchmark", () => {
  test("syncs initial changes, handles 429 Retry-After, applies multi-page live changes atomically, and recovers from 410 expired cursor", async () => {
    let staffName = "Original Name";
    let force410Once = false;
    let force429Once = true;

    const mockApi = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      res.setHeader("Content-Type", "application/json");

      if (force429Once && url.pathname === "/v1/sites") {
        force429Once = false;
        res.statusCode = 429;
        res.setHeader("Retry-After", "0.05");
        res.end(JSON.stringify({ error: "rate limited" }));
        return;
      }

      if (url.pathname === "/v1/sites") {
        res.end(
          JSON.stringify({
            data: [
              {
                id: 11,
                name: "Singapore",
                timezone: "Asia/Singapore",
                business_hours: {
                  mon: { open: "08:00", close: "18:00" },
                  tue: { open: "08:00", close: "18:00" },
                  wed: { open: "08:00", close: "18:00" },
                  thu: { open: "08:00", close: "18:00" },
                  fri: { open: "08:00", close: "18:00" },
                  sat: null,
                  sun: null,
                },
              },
            ],
          })
        );
        return;
      }

      if (url.pathname === "/v1/sites/11/holidays") {
        res.end(JSON.stringify({ data: [{ date: "10/08/2026", name: "National Day" }] }));
        return;
      }

      if (url.pathname === "/v1/staff") {
        res.end(JSON.stringify({ data: [{ id: 304, name: staffName }] }));
        return;
      }

      if (url.pathname === "/v1/changes") {
        const cursor = url.searchParams.get("cursor");
        if (force410Once && cursor) {
          force410Once = false;
          res.statusCode = 410;
          res.end(JSON.stringify({ error: "cursor expired" }));
          return;
        }

        const baseSec = Math.floor(Date.parse("2026-10-06T01:00:00Z") / 1000);
        if (!cursor) {
          res.end(
            JSON.stringify({
              data: [
                {
                  seq: 1,
                  type: "request.created",
                  at: "2026-10-06T01:00:00Z",
                  request: {
                    id: 100,
                    site_id: 11,
                    status: "processing",
                    priority: "High",
                    created_at: "2026-10-06T01:00:00Z",
                    deleted_at: null,
                    merged_into_id: null,
                  },
                },
                {
                  seq: 2,
                  type: "event.created",
                  at: "2026-10-06T01:20:00Z",
                  request_id: 100,
                  event: {
                    id: 5001,
                    status: "processing",
                    at: baseSec + 20 * 60,
                    actor_id: 304,
                    actor_name: "Original Name",
                    due_at: "07/10/2026 10:00",
                    reverts_id: null,
                  },
                },
              ],
              next_cursor: "cursor-seq-2",
              has_more: false,
            })
          );
          return;
        }

        // Simulate a 2-page incremental sync batch (cursor-seq-2 -> cursor-seq-3 -> cursor-seq-4)
        if (cursor === "cursor-seq-2") {
          res.end(
            JSON.stringify({
              data: [
                {
                  seq: 3,
                  type: "staff.updated",
                  at: "2026-10-06T02:00:00Z",
                  staff: { id: 304, name: "Updated Live Name" },
                },
              ],
              next_cursor: "cursor-seq-3",
              has_more: true,
            })
          );
          return;
        }

        if (cursor === "cursor-seq-3") {
          res.end(
            JSON.stringify({
              data: [
                {
                  seq: 4,
                  type: "event.created",
                  at: "2026-10-06T03:00:00Z",
                  request_id: 100,
                  event: {
                    id: 5002,
                    status: "complete",
                    at: baseSec + 90 * 60,
                    actor_id: 304,
                    actor_name: "Updated Live Name",
                    due_at: null,
                    reverts_id: null,
                  },
                },
              ],
              next_cursor: "cursor-seq-4",
              has_more: false,
            })
          );
          return;
        }

        res.end(
          JSON.stringify({
            data: [],
            next_cursor: cursor,
            has_more: false,
          })
        );
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
    });

    await new Promise((resolve) => mockApi.listen(0, resolve));
    const addr = mockApi.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    try {
      const store = new StoreRepository();
      const client = new HelpdeskClient({
        baseUrl: `http://127.0.0.1:${port}`,
        token: "test-token",
      });
      const syncService = new SyncService(client, store, { pollIntervalMs: 0 });
      const reportService = new ReportService(store);

      // 1. Initial full sync (includes 429 retry)
      await syncService.runFullSyncIntoStore(store);
      assert.equal(store.isReady(), true);

      const report1 = reportService.getSlaReport("2026-10-01", "2026-10-31");
      assert.equal(report1.requests.length, 1);
      assert.equal(report1.requests[0].responder, "Original Name");
      assert.equal(report1.requests[0].completed_late, null);
      const versionBeforeIncremental = store.getVersion();

      // 2. Multi-page incremental live sync picks up both staff.updated and event.created in one atomic commit
      await syncService.syncIncremental();
      assert.equal(store.getVersion(), versionBeforeIncremental + 1);
      const report2 = reportService.getSlaReport("2026-10-01", "2026-10-31");
      assert.equal(report2.requests[0].responder, "Updated Live Name");
      assert.equal(report2.requests[0].completed_late, false);

      // 3. Simulate 410 cursor expiry and verify atomic resync recovery
      staffName = "Recovered After 410 Name";
      force410Once = true;
      await syncService.syncIncremental();
      const report3 = reportService.getSlaReport("2026-10-01", "2026-10-31");
      assert.equal(report3.requests[0].responder, "Recovered After 410 Name");
    } finally {
      mockApi.close();
    }
  });

  test("automatically retries failed initial sync and transitions /ready to true only after full feed is drained", async () => {
    let failCount = 0;

    const flakyServer = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      res.setHeader("Content-Type", "application/json");

      if (failCount < 2) {
        failCount++;
        res.statusCode = 503;
        res.end(JSON.stringify({ error: "temporary upstream outage" }));
        return;
      }

      if (url.pathname === "/v1/sites") {
        res.end(
          JSON.stringify({
            data: [
              {
                id: 11,
                name: "Singapore",
                timezone: "Asia/Singapore",
                business_hours: {
                  mon: { open: "08:00", close: "18:00" },
                  tue: null,
                  wed: null,
                  thu: null,
                  fri: null,
                  sat: null,
                  sun: null,
                },
              },
            ],
          })
        );
        return;
      }
      if (url.pathname === "/v1/sites/11/holidays") {
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      if (url.pathname === "/v1/staff") {
        res.end(JSON.stringify({ data: [{ id: 304, name: "Benjamin Tan" }] }));
        return;
      }
      if (url.pathname === "/v1/changes") {
        res.end(JSON.stringify({ data: [], next_cursor: "c1", has_more: false }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    await new Promise((resolve) => flakyServer.listen(0, resolve));
    const addr = flakyServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    try {
      const store = new StoreRepository();
      const client = new HelpdeskClient({
        baseUrl: `http://127.0.0.1:${port}`,
        token: "test",
        maxRetries: 0,
      });
      const syncService = new SyncService(client, store, {
        pollIntervalMs: 0,
        initialRetryDelayMs: 20,
        maxInitialRetryDelayMs: 50,
      });

      assert.equal(store.isReady(), false);
      await syncService.start();
      assert.equal(store.isReady(), true);
      assert.ok(failCount >= 2);
      syncService.stop();
    } finally {
      flakyServer.close();
    }
  });

  test("computes 6-month SLA report across 12,000 requests and 3 sites (SG, SYD, JKT) well under 10s requirement", () => {
    const store = new StoreRepository();
    store.setSites([
      {
        id: 11,
        name: "Singapore",
        timezone: "Asia/Singapore",
        business_hours: {
          mon: { open: "08:00", close: "18:00" },
          tue: { open: "08:00", close: "18:00" },
          wed: { open: "08:00", close: "18:00" },
          thu: { open: "08:00", close: "18:00" },
          fri: { open: "08:00", close: "18:00" },
          sat: null,
          sun: null,
        },
      },
      {
        id: 12,
        name: "Sydney",
        timezone: "Australia/Sydney",
        business_hours: {
          mon: { open: "07:30", close: "17:00" },
          tue: { open: "07:30", close: "17:00" },
          wed: { open: "07:30", close: "17:00" },
          thu: { open: "07:30", close: "17:00" },
          fri: { open: "07:30", close: "17:00" },
          sat: null,
          sun: null,
        },
      },
      {
        id: 13,
        name: "Jakarta",
        timezone: "Asia/Jakarta",
        business_hours: {
          mon: { open: "08:00", close: "17:00" },
          tue: { open: "08:00", close: "17:00" },
          wed: { open: "08:00", close: "17:00" },
          thu: { open: "08:00", close: "17:00" },
          fri: { open: "08:00", close: "17:00" },
          sat: { open: "08:00", close: "12:00" },
          sun: null,
        },
      },
    ]);
    store.setHolidaysForSite(11, [{ date: "10/08/2026", name: "National Day" }]);
    store.setHolidaysForSite(12, [{ date: "05/10/2026", name: "Labour Day" }]);
    store.setHolidaysForSite(13, [{ date: "17/08/2026", name: "Independence Day" }]);
    store.setStaffList([
      { id: 301, name: "Agent One" },
      { id: 302, name: "Agent Two" },
      { id: 303, name: "Agent Three" },
    ]);

    const baseSec = Math.floor(Date.parse("2026-05-04T01:00:00Z") / 1000);
    const siteIds = [11, 12, 13];
    for (let i = 1; i <= 12000; i++) {
      const dayOffset = i % 180;
      const reqSec = baseSec + dayOffset * 86400;
      const createdIso = new Date(reqSec * 1000).toISOString();

      store.upsertRequest({
        id: i,
        site_id: siteIds[i % 3],
        status: "complete",
        priority: i % 3 === 0 ? "High" : i % 3 === 1 ? "Medium" : "Low",
        created_at: createdIso,
        deleted_at: null,
        merged_into_id: null,
      });

      store.upsertEvent(i, {
        id: i * 10 + 1,
        status: "processing",
        at: reqSec + 25 * 60,
        actor_id: 301 + (i % 3),
        actor_name: "Agent",
        due_at: "31/10/2026 18:00",
        reverts_id: null,
      });

      store.upsertEvent(i, {
        id: i * 10 + 2,
        status: "complete",
        at: reqSec + 55 * 60,
        actor_id: 301 + (i % 3),
        actor_name: "Agent",
        due_at: null,
        reverts_id: null,
      });
    }
    store.setReady(true);

    const reportService = new ReportService(store);

    // Cold cache measurement
    const t0Cold = performance.now();
    const reportCold = reportService.getSlaReport("2026-05-01", "2026-10-31");
    const coldMs = performance.now() - t0Cold;

    // Warm cache measurement
    const t0Warm = performance.now();
    const reportWarm = reportService.getSlaReport("2026-05-01", "2026-10-31");
    const warmMs = performance.now() - t0Warm;

    assert.equal(reportCold.requests.length, 12000);
    assert.equal(reportCold.responders.length, 3);
    assert.equal(reportWarm.requests.length, 12000);
    assert.ok(coldMs < 2500, `Expected cold 6m report under 2500ms, took ${coldMs.toFixed(2)}ms`);
    assert.ok(warmMs < 5, `Expected warm 6m report under 5ms, took ${warmMs.toFixed(3)}ms`);
  });
});
