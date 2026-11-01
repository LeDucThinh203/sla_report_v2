import { createApp } from "./app.js";
import { getEnvConfig } from "./config/env.js";
import { StoreRepository } from "./repositories/store.repository.js";
import { HelpdeskClient } from "./services/helpdesk.service.js";
import { ReportService } from "./services/report.service.js";
import { SyncService } from "./services/sync.service.js";

const config = getEnvConfig();
const store = new StoreRepository();
const client = new HelpdeskClient({
  baseUrl: config.helpdeskUrl,
  token: config.helpdeskToken,
});
const syncService = new SyncService(client, store, {
  pollIntervalMs: config.syncPollIntervalMs,
});
const reportService = new ReportService(store);

const app = createApp({ store, reportService });

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${config.port}`);
  syncService.start().catch((err) => {
    console.error("Failed to start background sync:", err);
  });
});
