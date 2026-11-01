import crypto from "node:crypto";

const CURSOR_SECRET = crypto.randomBytes(32);

export function buildFilterFingerprint(query) {
  return JSON.stringify({
    from: query.from,
    to: query.to,
    site_id: query.site_id ?? null,
    responder_id: query.responder_id ?? null,
    late: query.late ?? null,
    within_target: query.within_target ?? null,
    sort: query.sort,
  });
}

export function encodeCursor(payload) {
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", CURSOR_SECRET)
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

export function decodeAndVerifyCursor(cursorStr, expectedFingerprint) {
  if (!cursorStr || typeof cursorStr !== "string") return null;
  const parts = cursorStr.split(".");
  if (parts.length !== 2) return null;

  const [data, sig] = parts;
  if (!data || !sig) return null;

  const expectedSig = crypto
    .createHmac("sha256", CURSOR_SECRET)
    .update(data)
    .digest("base64url");

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.fp !== expectedFingerprint ||
      typeof parsed.sid !== "string" ||
      !Number.isSafeInteger(parsed.offset) ||
      parsed.offset < 0
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Compares two RequestReportRow items according to the contract sort rules:
 * `id` (default), `-id`, `response_business_minutes`, `-response_business_minutes`.
 * Nulls last; ties by `id` ascending.
 */
export function compareRequestRows(a, b, sort) {
  if (sort === "id") {
    return a.id - b.id;
  }
  if (sort === "-id") {
    return b.id - a.id;
  }

  // Sort by response_business_minutes (nulls always last; ties broken by id ascending)
  const aMin = a.response_business_minutes;
  const bMin = b.response_business_minutes;

  if (aMin === null && bMin === null) {
    return a.id - b.id;
  }
  if (aMin === null) {
    return 1; // null goes last
  }
  if (bMin === null) {
    return -1; // null goes last
  }

  if (aMin !== bMin) {
    return sort === "response_business_minutes" ? aMin - bMin : bMin - aMin;
  }

  return a.id - b.id;
}
