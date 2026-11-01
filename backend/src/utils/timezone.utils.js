const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const formatterCache = new Map();

function getFormatter(timezone) {
  let fmt = formatterCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      hourCycle: "h23",
    });
    formatterCache.set(timezone, fmt);
  }
  return fmt;
}

/**
 * Converts a UTC timestamp (in seconds) to local wall-clock parts in the given IANA timezone.
 */
export function getZonedParts(utcSeconds, timezone) {
  const fmt = getFormatter(timezone);
  const parts = fmt.formatToParts(new Date(utcSeconds * 1000));
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;

  for (const p of parts) {
    switch (p.type) {
      case "year":
        year = Number(p.value);
        break;
      case "month":
        month = Number(p.value);
        break;
      case "day":
        day = Number(p.value);
        break;
      case "hour":
        hour = Number(p.value);
        if (hour === 24) hour = 0;
        break;
      case "minute":
        minute = Number(p.value);
        break;
      case "second":
        second = Number(p.value);
        break;
    }
  }

  const mm = month < 10 ? `0${month}` : `${month}`;
  const dd = day < 10 ? `0${day}` : `${day}`;
  const dateStr = `${year}-${mm}-${dd}`;

  // Use Date.UTC to compute exact day of week for this calendar date (0 = Sun .. 6 = Sat)
  const utcDayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const dayOfWeekKey = DAY_KEYS[utcDayIndex];

  return { year, month, day, hour, minute, second, dateStr, dayOfWeekKey };
}

/**
 * Converts an ISO string (e.g. "2026-10-06T02:15:07Z") to local YYYY-MM-DD in the site's timezone.
 */
export function isoToLocalDateString(isoStr, timezone) {
  const ms = Date.parse(isoStr);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid ISO timestamp: ${isoStr}`);
  }
  const utcSec = Math.floor(ms / 1000);
  return getZonedParts(utcSec, timezone).dateStr;
}

/**
 * Converts a holiday date from "DD/MM/YYYY" to "YYYY-MM-DD".
 */
export function parseHolidayDateToIso(ddmmyyyy) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmyyyy.trim());
  if (!match) {
    // If already YYYY-MM-DD, return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(ddmmyyyy.trim())) {
      return ddmmyyyy.trim();
    }
    throw new Error(`Invalid holiday date format: ${ddmmyyyy}`);
  }
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Converts a local wall-clock date and time (year, month, day, hour, minute, second)
 * in a specific IANA timezone to exact Unix epoch seconds.
 * Handles DST offsets accurately using iterative convergence.
 */
export function localWallClockToUtcSeconds(
  year,
  month,
  day,
  hour,
  minute,
  second,
  timezone
) {
  const targetAsUtcSeconds = Math.floor(
    Date.UTC(year, month - 1, day, hour, minute, second) / 1000
  );

  let guess = targetAsUtcSeconds;
  for (let i = 0; i < 3; i++) {
    const parts = getZonedParts(guess, timezone);
    const representedAsUtcSeconds = Math.floor(
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second
      ) / 1000
    );
    const diff = targetAsUtcSeconds - representedAsUtcSeconds;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

/**
 * Parses a deadline string "DD/MM/YYYY HH:mm" in site-local wall-clock time
 * into Unix epoch seconds.
 */
export function parseDueAtToUtcSeconds(dueAt, timezone) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    dueAt.trim()
  );
  if (!match) {
    throw new Error(`Invalid due_at format: ${dueAt}`);
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;

  return localWallClockToUtcSeconds(year, month, day, hour, minute, second, timezone);
}

/**
 * Parses "HH:mm" to [hour, minute].
 */
function parseHourMinute(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return [h || 0, m || 0];
}

/**
 * Advances a calendar date (year, month, day) by 1 day.
 */
function addOneCalendarDay(year, month, day) {
  const nextUtc = new Date(Date.UTC(year, month - 1, day + 1));
  const y = nextUtc.getUTCFullYear();
  const m = nextUtc.getUTCMonth() + 1;
  const d = nextUtc.getUTCDate();
  const mm = m < 10 ? `0${m}` : `${m}`;
  const dd = d < 10 ? `0${d}` : `${d}`;
  const dateStr = `${y}-${mm}-${dd}`;
  const dayOfWeekKey = DAY_KEYS[nextUtc.getUTCDay()];
  return { year: y, month: m, day: d, dateStr, dayOfWeekKey };
}

/**
 * Rule 4: Business-hours time from `created_at` (UTC seconds) to first response `at` (UTC seconds),
 * using the site's `business_hours` and `/v1/sites/{id}/holidays`, summed in seconds,
 * then floored to minutes. 0 if the response is earlier than or equal to `created_at`.
 */
export function calculateBusinessMinutes(
  startUtcSec,
  endUtcSec,
  site,
  holidayIsoDates
) {
  if (endUtcSec <= startUtcSec) {
    return 0;
  }

  const startParts = getZonedParts(startUtcSec, site.timezone);
  const endParts = getZonedParts(endUtcSec, site.timezone);

  let curYear = startParts.year;
  let curMonth = startParts.month;
  let curDay = startParts.day;
  let curDateStr = startParts.dateStr;
  let curDayOfWeek = startParts.dayOfWeekKey;

  let totalBusinessSeconds = 0;
  const businessHours = site.business_hours;

  // Iterate through each local calendar date from startParts.dateStr to endParts.dateStr inclusive
  while (curDateStr <= endParts.dateStr) {
    if (!holidayIsoDates.has(curDateStr)) {
      const window = businessHours[curDayOfWeek];
      if (window && window.open && window.close) {
        const [openH, openM] = parseHourMinute(window.open);
        const [closeH, closeM] = parseHourMinute(window.close);

        const windowStartSec = localWallClockToUtcSeconds(
          curYear,
          curMonth,
          curDay,
          openH,
          openM,
          0,
          site.timezone
        );
        const windowEndSec = localWallClockToUtcSeconds(
          curYear,
          curMonth,
          curDay,
          closeH,
          closeM,
          0,
          site.timezone
        );

        const overlapStart = Math.max(startUtcSec, windowStartSec);
        const overlapEnd = Math.min(endUtcSec, windowEndSec);

        if (overlapEnd > overlapStart) {
          totalBusinessSeconds += overlapEnd - overlapStart;
        }
      }
    }

    if (curDateStr === endParts.dateStr) {
      break;
    }

    const next = addOneCalendarDay(curYear, curMonth, curDay);
    curYear = next.year;
    curMonth = next.month;
    curDay = next.day;
    curDateStr = next.dateStr;
    curDayOfWeek = next.dayOfWeekKey;
  }

  return Math.floor(totalBusinessSeconds / 60);
}

/**
 * Validates that a string is a real calendar date in YYYY-MM-DD format.
 */
export function isValidIsoDateString(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

