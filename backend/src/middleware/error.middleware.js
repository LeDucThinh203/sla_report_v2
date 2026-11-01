import { BadRequestError, ServiceUnavailableError } from "../services/report.service.js";

export function errorHandler(err, _req, res, _next) {
  if (err instanceof BadRequestError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof ServiceUnavailableError) {
    res.status(503).json({ error: err.message });
    return;
  }
  console.error("[Unhandled Error]:", err);
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
}

