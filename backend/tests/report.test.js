import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { StoreRepository } from "../src/repositories/store.repository.js";

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

function createPopulatedStore() {
  const store = new StoreRepository();
  store.setSites([SITE_11]);
  store.setHolidaysForSite(11, []);
  store.setStaffList([
    { id: 301, name: "Alice Lim" },
    { id: 302, name: "Benjamin Tan" },
  ]);

  const baseSec = Math.floor(Date.parse("2026-10-06T01:00:00Z") / 1000); // 09:00 SGT

  // Request 10: 30 mins response, within_target: true, completed_late: false
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

  // Request 20: 90 mins response, High priority -> within_target: false, completed_late: true
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

  // Request 30: No response -> nulls
  store.upsertRequest({
    id: 30,
    site_id: 11,
    status: "pending",
    priority: "Low",
    created_at: "2026-10-06T01:00:00Z",
    deleted_at: null,
    merged_into_id: null,
  });

  store.setReady(true);
  return store;
}

describe("API Contract: /api/sla-report and /api/requests", () => {
  test("validates date range params on /api/sla-report (returns 400 on invalid)", async () => {
    const store = createPopulatedStore();
    const server = createApp({ store }).listen(0);
    try {
      await new Promise((resolve) => server.once("listening", resolve));
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const base = `http://127.0.0.1:${port}`;

      // Missing params
      assert.equal((await fetch(`${base}/api/sla-report`)).status, 400);
      // Invalid date format
      assert.equal(
        (await fetch(`${base}/api/sla-report?from=01-10-2026&to=2026-10-31`)).status,
        400
      );
      // Invalid calendar date (Feb 30)
      assert.equal(
        (await fetch(`${base}/api/sla-report?from=2026-02-30&to=2026-03-01`)).status,
        400
      );
      // from > to
      assert.equal(
        (await fetch(`${base}/api/sla-report?from=2026-10-31&to=2026-10-01`)).status,
        400
      );

      // Valid request
      const res = await fetch(`${base}/api/sla-report?from=2026-10-01&to=2026-10-31`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.from, "2026-10-01");
      assert.equal(body.to, "2026-10-31");
      assert.equal(body.requests.length, 3);
      assert.equal(body.responders.length, 2);
    } finally {
      server.close();
    }
  });

  test("supports filtering, sorting (nulls last), and cursor pagination on /api/requests", async () => {
    const store = createPopulatedStore();
    const server = createApp({ store }).listen(0);
    try {
      await new Promise((resolve) => server.once("listening", resolve));
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const base = `http://127.0.0.1:${port}`;

      // Sort by -response_business_minutes: 90 (id 20), 30 (id 10), null (id 30 - nulls last!)
      const resSortDesc = await fetch(
        `${base}/api/requests?from=2026-10-01&to=2026-10-31&sort=-response_business_minutes`
      );
      assert.equal(resSortDesc.status, 200);
      const bodySortDesc = await resSortDesc.json();
      assert.deepEqual(
        bodySortDesc.data.map((r) => r.id),
        [20, 10, 30]
      );

      // Walk pages with limit=1 and verify every item appears EXACTLY once even if data mutates mid-walk!
      const seenIds = [];
      let cursor = null;
      let pageNum = 0;
      do {
        pageNum++;
        const url = new URL(`${base}/api/requests`);
        url.searchParams.set("from", "2026-10-01");
        url.searchParams.set("to", "2026-10-31");
        url.searchParams.set("sort", "response_business_minutes");
        url.searchParams.set("limit", "1");
        if (cursor) url.searchParams.set("cursor", cursor);

        const pageRes = await fetch(url);
        assert.equal(pageRes.status, 200);
        const pageBody = await pageRes.json();
        for (const item of pageBody.data) {
          seenIds.push(item.id);
        }
        cursor = pageBody.next_cursor;

        // Mutate Request 10's response time after page 1 so it would shift after Request 20 if not snapshotted
        if (pageNum === 1) {
          const baseSec = Math.floor(Date.parse("2026-10-06T01:00:00Z") / 1000);
          store.upsertEvent(10, {
            id: 1001,
            status: "processing",
            at: baseSec + 180 * 60, // Changed from 30m to 180m mid-walk!
            actor_id: 301,
            actor_name: "Alice Lim",
            due_at: "07/10/2026 10:00",
            reverts_id: null,
          });
        }
      } while (cursor !== null);

      assert.deepEqual(seenIds, [10, 20, 30]);

      // Invalid cursor returns 400
      const badCursorRes = await fetch(
        `${base}/api/requests?from=2026-10-01&to=2026-10-31&cursor=tampered-cursor`
      );
      assert.equal(badCursorRes.status, 400);

      // Invalid limit returns 400
      const badLimitRes = await fetch(
        `${base}/api/requests?from=2026-10-01&to=2026-10-31&limit=201`
      );
      assert.equal(badLimitRes.status, 400);
    } finally {
      server.close();
    }
  });
});

