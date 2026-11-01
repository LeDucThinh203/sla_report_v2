import { test, describe } from "node:test";
import assert from "node:assert/strict";
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

const SINGAPORE_SITE = {
  id: 11,
  name: "Bluebay Tower Singapore",
  timezone: "Asia/Singapore", // UTC+8
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

const SYDNEY_SITE = {
  id: 12,
  name: "Bluebay House Sydney",
  timezone: "Australia/Sydney", // UTC+10 / UTC+11 (DST starts first Sunday of Oct)
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

const JAKARTA_SITE = {
  id: 13,
  name: "Bluebay Plaza Jakarta",
  timezone: "Asia/Jakarta", // UTC+7
  business_hours: {
    mon: { open: "08:00", close: "17:00" },
    tue: { open: "08:00", close: "17:00" },
    wed: { open: "08:00", close: "17:00" },
    thu: { open: "08:00", close: "17:00" },
    fri: { open: "08:00", close: "17:00" },
    sat: { open: "08:00", close: "12:00" },
    sun: null,
  },
};

describe("Rule 1: Which requests count & timezone date conversion", () => {
  test("converts UTC created_at to site local date across Singapore, Sydney, and Jakarta", () => {
    const iso = "2026-09-30T16:30:00Z";
    assert.equal(isoToLocalDateString(iso, JAKARTA_SITE.timezone), "2026-09-30");
    assert.equal(isoToLocalDateString(iso, SINGAPORE_SITE.timezone), "2026-10-01");
    assert.equal(isoToLocalDateString(iso, SYDNEY_SITE.timezone), "2026-10-01");
  });

  test("filters out canceled, deleted_at, merged_into_id, and out-of-range requests", () => {
    const baseReq = {
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

describe("Rule 2: Undone events & chained reverts", () => {
  test("ignores both reverted event and reverting event, including multiple/chained reverts", () => {
    const events = [
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
      {
        id: 103,
        status: "complete",
        at: 1800,
        actor_id: 302,
        actor_name: "Bob",
        due_at: null,
        reverts_id: null,
      },
      {
        id: 104,
        status: "processing",
        at: 1900,
        actor_id: 302,
        actor_name: "Bob",
        due_at: null,
        reverts_id: 103, // reverts complete event 103
      },
    ];

    const active = filterActiveEvents(events);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, 102);
    assert.equal(active[0].actor_id, 302);
  });
});

describe("Rule 3 & Rule 4: First response, business hours, weekends, holidays & equal timestamps", () => {
  test("calculates business minutes within a single workday and floors seconds to minutes", () => {
    const startSec = Math.floor(Date.parse("2026-10-06T01:00:00Z") / 1000);
    const endSec = startSec + 42 * 60 + 59; // 42m 59s -> 42m

    const mins = calculateBusinessMinutes(startSec, endSec, SINGAPORE_SITE, new Set());
    assert.equal(mins, 42);
  });

  test("sums partial seconds across multiple days before flooring to minutes", () => {
    // Day 1 (Tue 2026-10-06): created at 17:59:30 SGT (09:59:30Z) -> 30 seconds before 18:00 close
    // Day 2 (Wed 2026-10-07): responded at 08:00:40 SGT (00:00:40Z) -> 40 seconds after 08:00 open
    // Total seconds = 30 + 40 = 70 seconds -> floor(70 / 60) = 1 minute!
    const startSec = Math.floor(Date.parse("2026-10-06T09:59:30Z") / 1000);
    const endSec = Math.floor(Date.parse("2026-10-07T00:00:40Z") / 1000);

    const mins = calculateBusinessMinutes(startSec, endSec, SINGAPORE_SITE, new Set());
    assert.equal(mins, 1);
  });

  test("returns 0 if response is earlier than created_at", () => {
    const startSec = Math.floor(Date.parse("2026-10-06T02:00:00Z") / 1000);
    const endSec = startSec - 120;
    assert.equal(calculateBusinessMinutes(startSec, endSec, SINGAPORE_SITE, new Set()), 0);
  });

  test("excludes overnight non-business hours, weekends, and holidays across multiple days", () => {
    // Thursday 2026-10-08 17:00 SGT (09:00 UTC) -> 1 hour left on Thursday (closes 18:00)
    // Friday 2026-10-09 is a Holiday ("09/10/2026") -> 0 hours counted
    // Saturday 2026-10-10 & Sunday 2026-10-11 are closed in Singapore -> 0 hours counted
    // Monday 2026-10-12 opens 08:00 SGT, response at 08:30 SGT (00:30 UTC) -> 30 mins
    // Total expected = 60 + 30 = 90 minutes.
    const startSec = Math.floor(Date.parse("2026-10-08T09:00:00Z") / 1000);
    const endSec = Math.floor(Date.parse("2026-10-12T00:30:00Z") / 1000);
    const holidays = new Set([parseHolidayDateToIso("09/10/2026")]);

    const mins = calculateBusinessMinutes(startSec, endSec, SINGAPORE_SITE, holidays);
    assert.equal(mins, 90);
  });

  test("counts Jakarta Saturday morning business hours (08:00-12:00)", () => {
    // Saturday 2026-10-10 in Jakarta (UTC+7): open 08:00 (01:00Z) to 12:00 (05:00Z)
    const startSec = Math.floor(Date.parse("2026-10-10T00:30:00Z") / 1000); // 07:30 WIB (before open)
    const endSec = Math.floor(Date.parse("2026-10-10T06:00:00Z") / 1000); // 13:00 WIB (after close)
    const mins = calculateBusinessMinutes(startSec, endSec, JAKARTA_SITE, new Set());
    assert.equal(mins, 240); // Full 4 hours window
  });

  test("handles Sydney DST transition accurately (Oct 4, 2026)", () => {
    // Friday 2 Oct 2026 in Sydney is AEST (UTC+10). Close is 17:00 AEST = 07:00Z.
    // Created Friday 2 Oct 2026 at 16:00 AEST (06:00Z) -> 60 mins on Friday.
    // Sat 3 Oct & Sun 4 Oct (DST transition day) closed.
    // Mon 5 Oct 2026 is Labour Day holiday ("05/10/2026") -> closed.
    // Tue 6 Oct 2026 is AEDT (UTC+11). Open is 07:30 AEDT = 2026-10-05T20:30:00Z.
    // Responded Tue 6 Oct at 08:00 AEDT = 2026-10-05T21:00:00Z -> 30 mins on Tuesday.
    // Total = 60 + 30 = 90 mins.
    const startSec = Math.floor(Date.parse("2026-10-02T06:00:00Z") / 1000);
    const endSec = Math.floor(Date.parse("2026-10-05T21:00:00Z") / 1000);
    const holidays = new Set([parseHolidayDateToIso("05/10/2026")]);
    const mins = calculateBusinessMinutes(startSec, endSec, SYDNEY_SITE, holidays);
    assert.equal(mins, 90);
  });

  test("ignores System events (actor_id: null), uses current staff name, and breaks equal timestamp ties by id", () => {
    const req = {
      id: 500,
      site_id: 11,
      status: "processing",
      priority: "High",
      created_at: "2026-10-06T01:00:00Z", // 09:00 SGT
      deleted_at: null,
      merged_into_id: null,
    };
    const baseAt = Math.floor(Date.parse("2026-10-06T01:00:00Z") / 1000);
    const events = [
      {
        id: 1,
        status: "processing",
        at: baseAt + 300, // 5 mins later, System event
        actor_id: null,
        actor_name: "System",
        due_at: null,
        reverts_id: null,
      },
      {
        id: 3,
        status: "processing",
        at: baseAt + 1800, // Same timestamp as id 2, higher id
        actor_id: 305,
        actor_name: "Second Actor",
        due_at: null,
        reverts_id: null,
      },
      {
        id: 2,
        status: "processing",
        at: baseAt + 1800, // Same timestamp as id 3, lower id wins
        actor_id: 304,
        actor_name: "Old Name",
        due_at: null,
        reverts_id: null,
      },
    ];
    const staffMap = new Map([
      [304, "Benjamin Tan Updated"],
      [305, "Second Actor"],
    ]);
    const row = evaluateRequestSla(req, events, SINGAPORE_SITE, new Set(), staffMap);

    assert.equal(row.responder_id, 304);
    assert.equal(row.responder, "Benjamin Tan Updated");
    assert.equal(row.response_business_minutes, 30);
    assert.equal(row.within_target, true);

    // Verify Rule 3 strictly does NOT fallback to event.actor_name if staff is missing from /v1/staff
    const emptyStaffRow = evaluateRequestSla(req, events, SINGAPORE_SITE, new Set(), new Map());
    assert.equal(emptyStaffRow.responder_id, 304);
    assert.equal(emptyStaffRow.responder, null);
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
  test("evaluates completed_late using last complete event and latest due_at event (even if due_at is updated on a reopen event after complete)", () => {
    const req = {
      id: 600,
      site_id: 11,
      status: "processing", // reopened!
      priority: "Medium",
      created_at: "2026-10-06T01:00:00Z",
      deleted_at: null,
      merged_into_id: null,
    };

    const deadline1Sec = parseDueAtToUtcSeconds("07/10/2026 10:00", SINGAPORE_SITE.timezone);
    const deadline2Sec = parseDueAtToUtcSeconds("07/10/2026 12:00", SINGAPORE_SITE.timezone);

    // Complete occurred at 11:00 SGT (after deadline1 10:00, but before deadline2 12:00 set on later reopen event)
    const completeAtSec = deadline1Sec + 3600;

    const events = [
      {
        id: 1,
        status: "processing",
        at: deadline1Sec - 7200,
        actor_id: 304,
        actor_name: "Benjamin Tan",
        due_at: "07/10/2026 10:00",
        reverts_id: null,
      },
      {
        id: 2,
        status: "complete",
        at: completeAtSec,
        actor_id: 304,
        actor_name: "Benjamin Tan",
        due_at: null,
        reverts_id: null,
      },
      {
        id: 3,
        status: "processing", // Reopened and extended deadline to 12:00
        at: completeAtSec + 1800,
        actor_id: 304,
        actor_name: "Benjamin Tan",
        due_at: "07/10/2026 12:00",
        reverts_id: null,
      },
    ];

    const staffMap = new Map([[304, "Benjamin Tan"]]);
    const rowExtended = evaluateRequestSla(req, events, SINGAPORE_SITE, new Set(), staffMap);
    // Because the latest event with due_at is event 3 (12:00), completeAt (11:00) <= 12:00 -> completed_late: false
    assert.equal(rowExtended.completed_late, false);

    // Now add a second complete event 1 second after deadline2Sec (12:00:01)
    const eventsSecondCompleteLate = [
      ...events,
      {
        id: 4,
        status: "complete",
        at: deadline2Sec + 1,
        actor_id: 304,
        actor_name: "Benjamin Tan",
        due_at: null,
        reverts_id: null,
      },
    ];
    const rowLate = evaluateRequestSla(
      req,
      eventsSecondCompleteLate,
      SINGAPORE_SITE,
      new Set(),
      staffMap
    );
    assert.equal(rowLate.completed_late, true);
  });

  test("returns nulls when there is no first response or no complete/deadline", () => {
    const req = {
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
    const req1 = {
      id: 41210,
      site_id: 11,
      status: "complete",
      priority: "High",
      created_at: "2026-10-06T01:00:00Z",
      deleted_at: null,
      merged_into_id: null,
    };
    const req2 = {
      id: 41214,
      site_id: 11,
      status: "pending",
      priority: "Low",
      created_at: "2026-10-06T02:00:00Z",
      deleted_at: null,
      merged_into_id: null,
    };

    const baseSec = Math.floor(Date.parse("2026-10-06T01:00:00Z") / 1000);
    const eventsByReq = new Map([
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
    const holidaysMap = new Map([[11, new Set()]]);
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
