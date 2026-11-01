import { isValidIsoDateString } from "../utils/timezone.utils.js";
import { BadRequestError } from "../services/report.service.js";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  MIN_PAGE_LIMIT,
  VALID_SORT_FIELDS,
} from "../types/report.types.js";

const VALID_SORTS = new Set(VALID_SORT_FIELDS);

function parseStrictPositiveInt(value, paramName) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new BadRequestError(`Invalid ${paramName}`);
  }
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num <= 0) {
    throw new BadRequestError(`Invalid ${paramName}`);
  }
  return num;
}

function parseStrictBoolean(value, paramName) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new BadRequestError(`Invalid ${paramName}: must be true or false`);
}

export function validateDateRangeParams(query) {
  const { from, to } = query;
  if (!isValidIsoDateString(from) || !isValidIsoDateString(to)) {
    throw new BadRequestError("Missing or invalid 'from' or 'to' date (expected YYYY-MM-DD)");
  }
  if (from > to) {
    throw new BadRequestError("'from' date must not be after 'to' date");
  }
  return { from, to };
}

export function validateBrowseRequestsParams(query) {
  const { from, to } = validateDateRangeParams(query);

  let site_id;
  if (query.site_id !== undefined) {
    site_id = parseStrictPositiveInt(query.site_id, "site_id");
  }

  let responder_id;
  if (query.responder_id !== undefined) {
    responder_id = parseStrictPositiveInt(query.responder_id, "responder_id");
  }

  let late;
  if (query.late !== undefined) {
    late = parseStrictBoolean(query.late, "late");
  }

  let within_target;
  if (query.within_target !== undefined) {
    within_target = parseStrictBoolean(query.within_target, "within_target");
  }

  let sort = "id";
  if (query.sort !== undefined) {
    if (typeof query.sort !== "string" || !VALID_SORTS.has(query.sort)) {
      throw new BadRequestError("Invalid sort parameter");
    }
    sort = query.sort;
  }

  let limit = DEFAULT_PAGE_LIMIT;
  if (query.limit !== undefined) {
    limit = parseStrictPositiveInt(query.limit, "limit");
    if (limit < MIN_PAGE_LIMIT || limit > MAX_PAGE_LIMIT) {
      throw new BadRequestError(
        `limit must be between ${MIN_PAGE_LIMIT} and ${MAX_PAGE_LIMIT}`
      );
    }
  }

  let cursor;
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== "string" || query.cursor.trim() === "") {
      throw new BadRequestError("Invalid cursor");
    }
    cursor = query.cursor;
  }

  return {
    from,
    to,
    site_id,
    responder_id,
    late,
    within_target,
    sort,
    limit,
    cursor,
  };
}
