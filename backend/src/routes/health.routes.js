import { Router } from "express";

export function createHealthRouter(controller) {
  const router = Router();
  router.get("/health", controller.getHealth);
  router.get("/ready", controller.getReady);
  return router;
}

