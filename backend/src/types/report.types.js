export const VALID_SORT_FIELDS = [
  "id",
  "-id",
  "response_business_minutes",
  "-response_business_minutes",
];

export const DEFAULT_PAGE_LIMIT = 50;
export const MIN_PAGE_LIMIT = 1;
export const MAX_PAGE_LIMIT = 200;

export const DEFAULT_MAX_SNAPSHOTS = 1000;
export const DEFAULT_SNAPSHOT_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_REPORT_CACHE_ENTRIES = 50;
export const SNAPSHOT_ID_BYTES = 12;
