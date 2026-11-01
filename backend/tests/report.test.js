import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { StoreRepository } from "../src/repositories/store.repository.js";
import { ReportService } from "../src/services/report.service.js";

const SITE_11 = {
  id: 11,
  name: "Singapore HQ",
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
};

const SITE_12 = {
  id: 12,
  name: "Sydney Office",
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
};

function createPopulatedStore() {
  const store = new StoreRepository();
  store.setSites([SITE_11, SITE_12]);
  store.setHolidaysForSite(11, []);
  store.setHolidaysForSite(12, []);
  store.setStaffList([
    { id: 301, name: "Alice Lim" },
    { id: 302, name: "Benjamin Tan" },
  ]);

  const baseSec = Math.floor(Date.parse("2026-10-06T01:00:00Z") / 1000); // 09:00 SGT

  // Request 10 (site 11): 30 mins response, within_target: true, completed_late: false
  store.upsertRequest({
    id: 10,
    site_id: 11,
    status: "complete",
    priority: "High",
    created_at: "2026-10-06T01:00:00Z",
    deleted_at: null,
    merged_into_id: null,
  });
  store.upsertEvent(10, {
    id: 1001,
    status: "processing",
    at: baseSec + 30 * 60,
    actor_id: 301,
    actor_name: "Alice Lim",
    due_at: "07/10/2026 10:00",
    reverts_id: null,
  });
  store.upsertEvent(10, {
    id: 1002,
    status: "complete",
    at: baseSec + 60 * 60,
    actor_id: 301,
    actor_name: "Alice Lim",
    due_at: null,
    reverts_id: null,
  });

  // Request 15 (site 12): 30 mins response (tie with Request 10!), within_target: true, completed_late: false
  store.upsertRequest({
    id: 15,
    site_id: 12,
    status: "complete",
    priority: "High",
    created_at: "2026-10-06T01:00:00Z",
    deleted_at: null,
    merged_into_id: null,
  });
  store.upsertEvent(15, {
    id: 1501,
    status: "processing",
    at: baseSec + 30 * 60,
    actor_id: 301,
    actor_name: "Alice Lim",
    due_at: "07/10/2026 10:00",
    reverts_id: null,
  });
  store.upsertEvent(15, {
    id: 1502,
    status: "complete",
    at: baseSec + 60 * 60,
    actor_id: 301,
    actor_name: "Alice Lim",
    due_at: null,
    reverts_id: null,
  });

  // Request 20 (site 11): 90 mins response, High priority -> within_target: false, completed_late: true
  store.upsertRequest({
    id: 20,
    site_id: 11,
    status: "complete",
    priority: "High",
    created_at: "2026-10-06T01:00:00Z",
    deleted_at: null,
    merged_into_id: null,
  });
  store.upsertEvent(20, {
    id: 2001,
    status: "processing",
    at: baseSec + 90 * 60,
    actor_id: 302,
    actor_name: "Benjamin Tan",
    due_at: "06/10/2026 10:00", // 02:00 UTC -> baseSec + 3600
    reverts_id: null,
  });
  store.upsertEvent(20, {
    id: 2002,
    status: "complete",
    at: baseSec + 120 * 60, // after 10:00 SGT deadline
    actor_id: 302,
    actor_name: "Benjamin Tan",
    due_at: null,
    reverts_id: null,
  });

  // Request 30 (site 11): No response -> nulls
  store.upsertRequest({
    id: 30,
    site_id: 11,
    status: "pending",
    priority: "Low",
    created_at: "2026-10-06T01:00:00Z",
    deleted_at: null,
    merged_into_id: null,
  });

  // Request 35 (site 12): No response -> nulls (tie with Request 30!)
  store.upsertRequest({
    id: 35,
    site_id: 12,
    status: "pending",
    priority: "Low",
    created_at: "2026-10-06T01:00:00Z",
    deleted_at: null,
    merged_into_id: null,
  });

  store.setReady(true);
  return store;
}

describe("API Contract: /api/sla-report and /api/requests (Level 1 & Level 4)", () => {
  test("validates date range params on /api/sla-report (returns 400 on invalid)", async () => {
    const store = createPopulatedStore();
    const server = createApp({ store }).listen(0);
    try {
      await new Promise((resolve) => server.once("listening", resolve));
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const base = `http://127.0.0.1:${port}`;

      assert.equal((await fetch(`${base}/api/sla-report`)).status, 400);
      assert.equal(
        (await fetch(`${base}/api/sla-report?from=01-10-2026&to=2026-10-31`)).status,
        400
      );
      assert.equal(
        (await fetch(`${base}/api/sla-report?from=2026-02-30&to=2026-03-01`)).status,
        400
      );
      assert.equal(
        (await fetch(`${base}/api/sla-report?from=2026-10-31&to=2026-10-01`)).status,
        400
      );

      const res = await fetch(`${base}/api/sla-report?from=2026-10-01&to=2026-10-31`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.from, "2026-10-01");
      assert.equal(body.to, "2026-10-31");
      assert.equal(body.requests.length, 5);
      assert.equal(body.responders.length, 2);
    } finally {
      server.close();
    }
  });

  test("supports all filters (site_id, responder_id, late, within_target), sorts (nulls last, tie-break id asc), and cursor rules", async () => {
    const store = createPopulatedStore();
    const reportService = new ReportService(store, { maxSnapshots: 5, snapshotTtlMs: 5000 });
    const server = createApp({ store, reportService }).listen(0);
    try {
      await new Promise((resolve) => server.once("listening", resolve));
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const base = `http://127.0.0.1:${port}`;

      // 1. Sort by -response_business_minutes: 90 (20), then tied 30s broken by id asc (10, 15), then nulls broken by id asc (30, 35)
      const resSortDesc = await fetch(
        `${base}/api/requests?from=2026-10-01&to=2026-10-31&sort=-response_business_minutes`
      );
      assert.equal(resSortDesc.status, 200);
      const bodySortDesc = await resSortDesc.json();
      assert.deepEqual(
        bodySortDesc.data.map((r) => r.id),
        [20, 10, 15, 30, 35]
      );

      // 2. Sort by -id: [35, 30, 20, 15, 10]
      const resSortIdDesc = await fetch(
        `${base}/api/requests?from=2026-10-01&to=2026-10-31&sort=-id`
      );
      assert.deepEqual(
        (await resSortIdDesc.json()).data.map((r) => r.id),
        [35, 30, 20, 15, 10]
      );

      // 3. Filter by site_id=12 -> [15, 35]
      const resSite = await fetch(
        `${base}/api/requests?from=2026-10-01&to=2026-10-31&site_id=12`
      );
      assert.deepEqual(
        (await resSite.json()).data.map((r) => r.id),
        [15, 35]
      );

      // 4. Filter by responder_id=302 -> [20]
      const resResp = await fetch(
        `${base}/api/requests?from=2026-10-01&to=2026-10-31&responder_id=302`
      );
      assert.deepEqual(
        (await resResp.json()).data.map((r) => r.id),
        [20]
      );

      // 5. Filter by late=true -> [20], late=false -> [10, 15]
      const resLateTrue = await fetch(
        `${base}/api/requests?from=2026-10-01&to=2026-10-31&late=true`
      );
      assert.deepEqual(
        (await resLateTrue.json()).data.map((r) => r.id),
        [20]
      );
      const resLateFalse = await fetch(
        `${base}/api/requests?from=2026-10-01&to=2026-10-31&late=false`
      );
      assert.deepEqual(
        (await resLateFalse.json()).data.map((r) => r.id),
        [10, 15]
      );

      // 6. Filter by within_target=true -> [10, 15], within_target=false -> [20]
      const resWithinTrue = await fetch(
        `${base}/api/requests?from=2026-10-01&to=2026-10-31&within_target=true`
      );
      assert.deepEqual(
        (await resWithinTrue.json()).data.map((r) => r.id),
        [10, 15]
      );

      // 7. Walk pages with limit=2 and verify every item appears EXACTLY once even if data mutates mid-walk!
      const seenIds = [];
      let cursor = null;
      let pageNum = 0;
      let firstCursorIssued = null;
      do {
        pageNum++;
        const url = new URL(`${base}/api/requests`);
        url.searchParams.set("from", "2026-10-01");
        url.searchParams.set("to", "2026-10-31");
        url.searchParams.set("sort", "response_business_minutes");
        url.searchParams.set("limit", "2");
        if (cursor) url.searchParams.set("cursor", cursor);

        const pageRes = await fetch(url);
        assert.equal(pageRes.status, 200);
        const pageBody = await pageRes.json();
        for (const item of pageBody.data) {
          seenIds.push(item.id);
        }
        if (pageNum === 1) {
          firstCursorIssued = pageBody.next_cursor;
          // Mutate Request 10's response time after page 1 so it would shift after Request 20 if not snapshotted
          const baseSec = Math.floor(Date.parse("2026-10-06T01:00:00Z") / 1000);
          store.upsertEvent(10, {
            id: 1001,
            status: "processing",
            at: baseSec + 180 * 60,
            actor_id: 301,
            actor_name: "Alice Lim",
            due_at: "07/10/2026 10:00",
            reverts_id: null,
          });
        }
        cursor = pageBody.next_cursor;
      } while (cursor !== null);

      assert.deepEqual(seenIds, [10, 15, 20, 30, 35]);

      // 8. Using a valid cursor with mismatched filter parameters returns 400
      const mismatchRes = await fetch(
        `${base}/api/requests?from=2026-10-01&to=2026-10-31&site_id=11&sort=response_business_minutes&cursor=${encodeURIComponent(
          firstCursorIssued
        )}`
      );
      assert.equal(mismatchRes.status, 400);

      // 9. Tampered cursor returns 400
      const badCursorRes = await fetch(
        `${base}/api/requests?from=2026-10-01&to=2026-10-31&cursor=tampered-cursor`
      );
      assert.equal(badCursorRes.status, 400);

      // 10. Invalid limit (0 or 201) or invalid sort returns 400
      assert.equal(
        (await fetch(`${base}/api/requests?from=2026-10-01&to=2026-10-31&limit=0`)).status,
        400
      );
      assert.equal(
        (await fetch(`${base}/api/requests?from=2026-10-01&to=2026-10-31&limit=201`)).status,
        400
      );
      assert.equal(
        (await fetch(`${base}/api/requests?from=2026-10-01&to=2026-10-31&sort=invalid`)).status,
        400
      );
    } finally {
      server.close();
    }
  });

  test("expires old cursor snapshots past TTL and returns 400", async () => {
    const store = createPopulatedStore();
    const shortTtlService = new ReportService(store, { snapshotTtlMs: 25 });
    const page1 = shortTtlService.browseRequests({
      from: "2026-10-01",
      to: "2026-10-31",
      sort: "id",
      limit: 1,
    });
    assert.ok(page1.next_cursor);

    await new Promise((r) => setTimeout(r, 40));

    assert.throws(
      () =>
        shortTtlService.browseRequests({
          from: "2026-10-01",
          to: "2026-10-31",
          sort: "id",
          limit: 1,
          cursor: page1.next_cursor,
        }),
      { name: "BadRequestError" }
    );
  });
});
