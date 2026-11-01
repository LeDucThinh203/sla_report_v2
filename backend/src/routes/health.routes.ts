import { Router } from "express";
import { HealthController } from "../controllers/health.controller.js";

export function createHealthRouter(controller: HealthController): Router {
  const router = Router();
  router.get("/health", controller.getHealth);
  router.get("/ready", controller.getReady);
  return router;
}

