export const VALID_REQUEST_STATUSES = ["pending", "processing", "complete", "canceled"];
export const VALID_PRIORITIES = ["Low", "Medium", "High"];
export const DAY_OF_WEEK_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const CHANGE_TYPES = [
  "request.created",
  "event.created",
  "request.updated",
  "staff.updated",
];

// Sync & Helpdesk API client constants
export const CHANGE_FEED_PAGE_SIZE = 500;
export const DEFAULT_SYNC_POLL_INTERVAL_MS = 5000;
export const DEFAULT_INITIAL_RETRY_DELAY_MS = 1000;
export const DEFAULT_MAX_INITIAL_RETRY_DELAY_MS = 10000;
export const DEFAULT_CLIENT_MAX_RETRIES = 5;
export const DEFAULT_SERVER_ERROR_MAX_RETRIES = 3;
export const DEFAULT_SERVER_ERROR_BACKOFF_MS = 500;
export const DEFAULT_RATE_LIMIT_BASE_DELAY_MS = 1000;
export const DEFAULT_RATE_LIMIT_MAX_DELAY_MS = 10000;
export const RETRY_AFTER_PADDING_MS = 100;
