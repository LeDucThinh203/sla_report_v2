import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { HelpdeskEvent, HelpdeskRequest, HelpdeskSite } from "../src/types/helpdesk.types.js";
import {
  calculateBusinessMinutes,
  isoToLocalDateString,
  parseDueAtToUtcSeconds,
  parseHolidayDateToIso,
} from "../src/utils/timezone.utils.js";
import {
  buildSlaReport,
  evaluateRequestSla,
  filterActiveEvents,
  isRequestEligible,
  isWithinSlaTarget,
} from "../src/services/sla.service.js";

const SINGAPORE_SITE: HelpdeskSite = {
  id: 11,
  name: "Bluebay Tower Singapore",
  timezone: "Asia/Singapore", // UTC+8
  business_hours: {
    mon: { open: "08:00", close: "18:00" },
    tue: { open: "08:00", close: "18:00" },
    wed: { open: "08:00", close: "18:00" },
    thu: { open: "08:00", close: "18:00" },
    fri: { open: "08:00", close: "18:00" },
    sat: { open: "09:00", close: "13:00" },
    sun: null,
  },
};

const SYDNEY_SITE: HelpdeskSite = {
  id: 12,
  name: "Harbour View Sydney",
  timezone: "Australia/Sydney", // UTC+10 / UTC+11 (DST starts first Sunday of Oct)
  business_hours: {
    mon: { open: "08:30", close: "17:30" },
    tue: { open: "08:30", close: "17:30" },
    wed: { open: "08:30", close: "17:30" },
    thu: { open: "08:30", close: "17:30" },
    fri: { open: "08:30", close: "17:30" },
    sat: null,
    sun: null,
  },
};

const JAKARTA_SITE: HelpdeskSite = {
  id: 13,
  name: "Sudirman Plaza Jakarta",
  timezone: "Asia/Jakarta", // UTC+7
  business_hours: {
    mon: { open: "08:00", close: "17:00" },
    tue: { open: "08:00", close: "17:00" },
    wed: { open: "08:00", close: "17:00" },
    thu: { open: "08:00", close: "17:00" },
    fri: { open: "08:00", close: "17:00" },
    sat: null,
    sun: null,
  },
};

describe("Rule 1: Which requests count & timezone date conversion", () => {
  test("converts UTC created_at to site local date across Singapore, Sydney, and Jakarta", () => {
    // 2026-09-30T16:30:00Z:
    // - Jakarta (UTC+7): 2026-09-30 23:30:00 -> 2026-09-30
    // - Singapore (UTC+8): 2026-10-01 00:30:00 -> 2026-10-01
    // - Sydney (UTC+10 on Sep 30): 2026-10-01 02:30:00 -> 2026-10-01
    const iso = "2026-09-30T16:30:00Z";
    assert.equal(isoToLocalDateString(iso, JAKARTA_SITE.timezone), "2026-09-30");
    assert.equal(isoToLocalDateString(iso, SINGAPORE_SITE.timezone), "2026-10-01");
    assert.equal(isoToLocalDateString(iso, SYDNEY_SITE.timezone), "2026-10-01");
  });

  test("filters out canceled, deleted_at, merged_into_id, and out-of-range requests", () => {
    const baseReq: HelpdeskRequest = {
      id: 1,
      site_id: 11,
      status: "processing",
      priority: "High",
      created_at: "2026-09-30T16:30:00Z", // 2026-10-01 00:30 SGT
      deleted_at: null,
      merged_into_id: null,
    };

    assert.equal(isRequestEligible(baseReq, SINGAPORE_SITE, "2026-10-01", "2026-10-31"), true);
    assert.equal(isRequestEligible(baseReq, JAKARTA_SITE, "2026-10-01", "2026-10-31"), false);

    assert.equal(
      isRequestEligible({ ...baseReq, status: "canceled" }, SINGAPORE_SITE, "2026-10-01", "2026-10-31"),
      false
    );
    assert.equal(
      isRequestEligible(
        { ...baseReq, deleted_at: "2026-10-02T00:00:00Z" },
        SINGAPORE_SITE,
        "2026-10-01",
        "2026-10-31"
      ),
      false
    );
    assert.equal(
      isRequestEligible(
        { ...baseReq, merged_into_id: 999 },
        SINGAPORE_SITE,
        "2026-10-01",
        "2026-10-31"
      ),
      false
    );
  });
});

describe("Rule 2: Undone events", () => {
  test("ignores both reverted event and reverting event", () => {
    const events: HelpdeskEvent[] = [
      {
        id: 100,
        status: "processing",
        at: 1000,
        actor_id: 301,
        actor_name: "Alice",
        due_at: null,
        reverts_id: null,
      },
      {
        id: 101,
        status: "pending",
        at: 1200,
        actor_id: 301,
        actor_name: "Alice",
        due_at: null,
        reverts_id: 100, // reverts event 100
      },
      {
        id: 102,
        status: "processing",
        at: 1500,
        actor_id: 302,
        actor_name: "Bob",
        due_at: null,
        reverts_id: null,
      },
    ];

    const active = filterActiveEvents(events);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, 102);
    assert.equal(active[0].actor_id, 302);
  });
});

describe("Rule 3 & Rule 4: First response, business hours, weekends & holidays", () => {
  test("calculates business minutes within a single workday and floors seconds to minutes", () => {
    // 2026-10-06 is Tuesday.
    // Created at 2026-10-06 09:00:00 SGT (01:00:00Z)
    // First response at 2026-10-06 09:42:59 SGT (42m 59s -> floor to 42m)
    const startSec = Math.floor(Date.parse("2026-10-06T01:00:00Z") / 1000);
    const endSec = startSec + 42 * 60 + 59;

    const mins = calculateBusinessMinutes(startSec, endSec, SINGAPORE_SITE, new Set());
    assert.equal(mins, 42);
  });

  test("returns 0 if response is earlier than created_at", () => {
    const startSec = Math.floor(Date.parse("2026-10-06T02:00:00Z") / 1000);
    const endSec = startSec - 120;
    assert.equal(calculateBusinessMinutes(startSec, endSec, SINGAPORE_SITE, new Set()), 0);
  });

  test("excludes overnight non-business hours, Sundays, and holidays", () => {
    // Friday 2026-10-09 17:00 SGT (09:00 UTC) -> 1 hour left on Friday (closes 18:00)
    // Saturday 2026-10-10 is a Holiday ("10/10/2026") -> 0 hours counted
    // Sunday 2026-10-11 is closed (sun: null) -> 0 hours counted
    // Monday 2026-10-12 opens 08:00 SGT, response at 08:30 SGT (00:30 UTC) -> 30 mins
    // Total expected = 60 + 30 = 90 minutes.
    const startSec = Math.floor(Date.parse("2026-10-09T09:00:00Z") / 1000);
    const endSec = Math.floor(Date.parse("2026-10-12T00:30:00Z") / 1000);
    const holidays = new Set([parseHolidayDateToIso("10/10/2026")]);

    const mins = calculateBusinessMinutes(startSec, endSec, SINGAPORE_SITE, holidays);
    assert.equal(mins, 90);
  });

  test("handles Sydney DST transition accurately (Oct 4, 2026)", () => {
    // In Australia/Sydney, DST starts Sunday 4 Oct 2026 at 02:00 AEST (UTC+10) -> 03:00 AEDT (UTC+11).
    // Monday 5 Oct 2026 is AEDT (UTC+11).
    // 08:30 AEDT on 2026-10-05 is 2026-10-04T21:30:00Z.
    // 09:15 AEDT on 2026-10-05 is 2026-10-04T22:15:00Z.
    const startSec = Math.floor(Date.parse("2026-10-04T21:30:00Z") / 1000);
    const endSec = Math.floor(Date.parse("2026-10-04T22:15:00Z") / 1000);
    const mins = calculateBusinessMinutes(startSec, endSec, SYDNEY_SITE, new Set());
    assert.equal(mins, 45);
  });

  test("ignores System events (actor_id: null) when finding first response and uses current staff name", () => {
    const req: HelpdeskRequest = {
      id: 500,
      site_id: 11,
      status: "processing",
      priority: "High",
      created_at: "2026-10-06T01:00:00Z", // 09:00 SGT
      deleted_at: null,
      merged_into_id: null,
    };
    const baseAt = Math.floor(Date.parse("2026-10-06T01:00:00Z") / 1000);
    const events: HelpdeskEvent[] = [
      {
        id: 1,
        status: "processing",
        at: baseAt + 300, // 5 mins later, but System event!
        actor_id: null,
        actor_name: "System",
        due_at: null,
        reverts_id: null,
      },
      {
        id: 2,
        status: "processing",
        at: baseAt + 1800, // 30 mins later, real staff member
        actor_id: 304,
        actor_name: "Old Name",
        due_at: null,
        reverts_id: null,
      },
    ];
    const staffMap = new Map<number, string>([[304, "Benjamin Tan Updated"]]);
    const row = evaluateRequestSla(req, events, SINGAPORE_SITE, new Set(), staffMap);

    assert.equal(row.responder_id, 304);
    assert.equal(row.responder, "Benjamin Tan Updated");
    assert.equal(row.response_business_minutes, 30);
    assert.equal(row.within_target, true);
  });
});

describe("Rule 5: Within target thresholds", () => {
  test("checks exact boundary minutes for High (60), Medium (240), Low/null (480)", () => {
    assert.equal(isWithinSlaTarget(60, "High"), true);
    assert.equal(isWithinSlaTarget(61, "High"), false);

    assert.equal(isWithinSlaTarget(240, "Medium"), true);
    assert.equal(isWithinSlaTarget(241, "Medium"), false);

    assert.equal(isWithinSlaTarget(480, "Low"), true);
    assert.equal(isWithinSlaTarget(481, "Low"), false);

    assert.equal(isWithinSlaTarget(480, null), true);
    assert.equal(isWithinSlaTarget(481, null), false);
  });
});

describe("Rule 6 & Rule 7: Completed late and Nulls", () => {
  test("evaluates completed_late using last complete event and latest due_at event (even if reopened)", () => {
    const req: HelpdeskRequest = {
      id: 600,
      site_id: 11,
      status: "processing", // reopened!
      priority: "Medium",
      created_at: "2026-10-06T01:00:00Z",
      deleted_at: null,
      merged_into_id: null,
    };

    // Deadline 1: 07/10/2026 10:00 SGT
    // Deadline 2 (latest): 07/10/2026 12:00 SGT
    const deadline2Sec = parseDueAtToUtcSeconds("07/10/2026 12:00", SINGAPORE_SITE.timezone);

    const events: HelpdeskEvent[] = [
      {
        id: 1,
        status: "processing",
        at: deadline2Sec - 7200,
        actor_id: 304,
        actor_name: "Benjamin Tan",
        due_at: "07/10/2026 10:00",
        reverts_id: null,
      },
      {
        id: 2,
        status: "processing",
        at: deadline2Sec - 3600,
        actor_id: 304,
        actor_name: "Benjamin Tan",
        due_at: "07/10/2026 12:00", // updated deadline
        reverts_id: null,
      },
      {
        id: 3,
        status: "complete",
        at: deadline2Sec, // Exactly on deadline -> NOT strictly after -> false
        actor_id: 304,
        actor_name: "Benjamin Tan",
        due_at: null,
        reverts_id: null,
      },
      {
        id: 4,
        status: "processing", // Reopened
        at: deadline2Sec + 60,
        actor_id: 304,
        actor_name: "Benjamin Tan",
        due_at: null,
        reverts_id: null,
      },
    ];

    const staffMap = new Map([[304, "Benjamin Tan"]]);
    const rowOnTime = evaluateRequestSla(req, events, SINGAPORE_SITE, new Set(), staffMap);
    assert.equal(rowOnTime.completed_late, false);

    // Now add a later complete event 1 second after deadline2Sec
    const eventsLate: HelpdeskEvent[] = [
      ...events,
      {
        id: 5,
        status: "complete",
        at: deadline2Sec + 1,
        actor_id: 304,
        actor_name: "Benjamin Tan",
        due_at: null,
        reverts_id: null,
      },
    ];
    const rowLate = evaluateRequestSla(req, eventsLate, SINGAPORE_SITE, new Set(), staffMap);
    assert.equal(rowLate.completed_late, true);
  });

  test("returns nulls when there is no first response or no complete/deadline", () => {
    const req: HelpdeskRequest = {
      id: 700,
      site_id: 11,
      status: "pending",
      priority: null,
      created_at: "2026-10-06T01:00:00Z",
      deleted_at: null,
      merged_into_id: null,
    };

    const row = evaluateRequestSla(req, [], SINGAPORE_SITE, new Set(), new Map());
    assert.deepEqual(row, {
      id: 700,
      site_id: 11,
      responder_id: null,
      responder: null,
      response_business_minutes: null,
      within_target: null,
      completed_late: null,
    });
  });

  test("aggregates responder summaries accurately in buildSlaReport", () => {
    const req1: HelpdeskRequest = {
      id: 41210,
      site_id: 11,
      status: "complete",
      priority: "High",
      created_at: "2026-10-06T01:00:00Z",
      deleted_at: null,
      merged_into_id: null,
    };
    const req2: HelpdeskRequest = {
      id: 41214,
      site_id: 11,
      status: "pending",
      priority: "Low",
      created_at: "2026-10-06T02:00:00Z",
      deleted_at: null,
      merged_into_id: null,
    };

    const baseSec = Math.floor(Date.parse("2026-10-06T01:00:00Z") / 1000);
    const eventsByReq = new Map<number, Map<number, HelpdeskEvent>>([
      [
        41210,
        new Map([
          [
            1,
            {
              id: 1,
              status: "processing",
              at: baseSec + 42 * 60,
              actor_id: 304,
              actor_name: "Ben",
              due_at: "07/10/2026 10:00",
              reverts_id: null,
            },
          ],
          [
            2,
            {
              id: 2,
              status: "complete",
              at: baseSec + 60 * 60,
              actor_id: 304,
              actor_name: "Ben",
              due_at: null,
              reverts_id: null,
            },
          ],
        ]),
      ],
    ]);

    const sitesMap = new Map([[11, SINGAPORE_SITE]]);
    const holidaysMap = new Map([[11, new Set<string>()]]);
    const staffMap = new Map([[304, "Benjamin Tan"]]);

    const report = buildSlaReport(
      "2026-10-01",
      "2026-10-31",
      [req1, req2],
      eventsByReq,
      sitesMap,
      holidaysMap,
      staffMap
    );

    assert.equal(report.from, "2026-10-01");
    assert.equal(report.to, "2026-10-31");
    assert.equal(report.requests.length, 2);
    assert.equal(report.responders.length, 1);
    assert.deepEqual(report.responders[0], {
      id: 304,
      name: "Benjamin Tan",
      requests: 1,
      within_target: 1,
      completed_late: 0,
    });
  });
});
