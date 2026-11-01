export function getEnvConfig() {
  return {
    port: Number(process.env.PORT || 8080),
    helpdeskUrl: (process.env.HELPDESK_URL || "http://localhost:4010").replace(/\/+$/, ""),
    helpdeskToken: process.env.HELPDESK_TOKEN || "",
    syncPollIntervalMs: Number(process.env.SYNC_POLL_INTERVAL_MS || 5000),
    cursorTtlMs: Number(process.env.CURSOR_TTL_MS || 15 * 60 * 1000),
  };
}

