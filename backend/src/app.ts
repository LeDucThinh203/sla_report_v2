import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HealthController } from "./controllers/health.controller.js";
import { ReportController } from "./controllers/report.controller.js";
import { errorHandler } from "./middleware/error.middleware.js";
import { StoreRepository } from "./repositories/store.repository.js";
import { createHealthRouter } from "./routes/health.routes.js";
import { createReportRouter } from "./routes/report.routes.js";
import { ReportService } from "./services/report.service.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface CreateAppOptions {
  store?: StoreRepository;
  reportService?: ReportService;
  staticDir?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const store = options.store ?? new StoreRepository();
  const reportService = options.reportService ?? new ReportService(store);

  const healthController = new HealthController(store);
  const reportController = new ReportController(reportService, store);

  // Enable permissive CORS for local development if frontend dev server runs separately
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(createHealthRouter(healthController));
  app.use(createReportRouter(reportController));

  // Resolve static frontend directory:
  // 1. Explicit options.staticDir
  // 2. Built frontend inside ../../frontend/dist
  // 3. Built public inside ../public
  const candidates = [
    options.staticDir,
    path.resolve(here, "..", "..", "frontend", "dist"),
    path.resolve(here, "..", "..", "..", "frontend", "dist"),
    path.resolve(here, "..", "public"),
    path.resolve(here, "..", "..", "public"),
    path.resolve(here, "..", "..", "starters", "node-express", "public"),
    path.resolve(here, "..", "..", "..", "starters", "node-express", "public"),
  ].filter((p): p is string => Boolean(p && fs.existsSync(p)));

  if (candidates.length > 0) {
    const staticRoot = candidates[0];
    app.use(express.static(staticRoot));
  }

  app.use(errorHandler);

  return app;
}
