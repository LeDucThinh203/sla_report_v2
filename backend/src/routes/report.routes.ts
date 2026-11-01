import { Router } from "express";
import { ReportController } from "../controllers/report.controller.js";

export function createReportRouter(controller: ReportController): Router {
  const router = Router();
  router.get("/api/sla-report", controller.getSlaReport);
  router.get("/api/requests", controller.browseRequests);
  router.get("/api/metadata", controller.getMetadata);
  return router;
}
