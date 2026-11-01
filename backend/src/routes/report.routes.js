import { Router } from "express";

export function createReportRouter(controller) {
  const router = Router();
  router.get("/api/sla-report", controller.getSlaReport);
  router.get("/api/requests.csv", controller.exportRequestsCsv);
  router.get("/api/requests", controller.browseRequests);
  router.get("/api/metadata", controller.getMetadata);
  return router;
}

