import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { StoreRepository } from "../src/repositories/store.repository.js";
import { HelpdeskClient } from "../src/services/helpdesk.service.js";
import { SyncService } from "../src/services/sync.service.js";
import { ReportService } from "../src/services/report.service.js";

describe("Level 2 & Level 3: Change-feed Sync, 410 Cursor Expiry & 12k Benchmark", () => {
  test("syncs initial changes, applies live incremental changes, and recovers from 410 expired cursor", async () => {
    let staffName = "Original Name";
    let force410Once = false;

    const mockApi = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      res.setHeader("Content-Type", "application/json");

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

    await new Promise<void>((resolve) => mockApi.listen(0, resolve));
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

      // 1. Initial full sync
      await syncService.runFullSyncIntoStore(store);
      assert.equal(store.isReady(), true);

      const report1 = reportService.getSlaReport("2026-10-01", "2026-10-31");
      assert.equal(report1.requests.length, 1);
      assert.equal(report1.requests[0].responder, "Original Name");

      // 2. Incremental live sync picks up staff.updated
      await syncService.syncIncremental();
      const report2 = reportService.getSlaReport("2026-10-01", "2026-10-31");
      assert.equal(report2.requests[0].responder, "Updated Live Name");

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

  test("computes 6-month SLA report across 12,000 requests well under 10s requirement", () => {
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
    ]);
    store.setHolidaysForSite(11, []);
    store.setStaffList([
      { id: 301, name: "Agent One" },
      { id: 302, name: "Agent Two" },
    ]);

    const baseSec = Math.floor(Date.parse("2026-05-04T01:00:00Z") / 1000);
    for (let i = 1; i <= 12000; i++) {
      // Spread across May - Oct 2026 (180 days)
      const dayOffset = i % 180;
      const reqSec = baseSec + dayOffset * 86400;
      const createdIso = new Date(reqSec * 1000).toISOString();

      store.upsertRequest({
        id: i,
        site_id: 11,
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
        actor_id: i % 2 === 0 ? 301 : 302,
        actor_name: "Agent",
        due_at: "31/10/2026 18:00",
        reverts_id: null,
      });

      store.upsertEvent(i, {
        id: i * 10 + 2,
        status: "complete",
        at: reqSec + 55 * 60,
        actor_id: i % 2 === 0 ? 301 : 302,
        actor_name: "Agent",
        due_at: null,
        reverts_id: null,
      });
    }
    store.setReady(true);

    const reportService = new ReportService(store);
    const t0 = performance.now();
    const report = reportService.getSlaReport("2026-05-01", "2026-10-31");
    const elapsedMs = performance.now() - t0;

    assert.equal(report.requests.length, 12000);
    assert.equal(report.responders.length, 2);
    // Level 2 requires < 10,000 ms for 6 months; verify ours runs under 2,000 ms
    assert.ok(
      elapsedMs < 2000,
      `Expected 12k requests report under 2000ms, took ${elapsedMs.toFixed(1)}ms`
    );
  });
});

