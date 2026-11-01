import type { Request, Response, NextFunction } from "express";
import { ReportService } from "../services/report.service.js";
import { StoreRepository } from "../repositories/store.repository.js";
import {
  validateBrowseRequestsParams,
  validateDateRangeParams,
} from "../middleware/validation.middleware.js";

export class ReportController {
  private readonly reportService: ReportService;
  private readonly store: StoreRepository;

  constructor(reportService: ReportService, store: StoreRepository) {
    this.reportService = reportService;
    this.store = store;
  }

  public getSlaReport = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const { from, to } = validateDateRangeParams(
        req.query as Record<string, unknown>
      );
      const report = this.reportService.getSlaReport(from, to);
      res.status(200).json(report);
    } catch (err) {
      next(err);
    }
  };

  public browseRequests = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const params = validateBrowseRequestsParams(
        req.query as Record<string, unknown>
      );
      const result = this.reportService.browseRequests(params);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  public getMetadata = (_req: Request, res: Response): void => {
    const sites = Array.from(this.store.getSitesMap().values()).sort(
      (a, b) => a.id - b.id
    );
    const staff = Array.from(this.store.getStaffMap().entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.id - b.id);

    res.status(200).json({
      ready: this.store.isReady(),
      last_synced_at: this.store.getLastSyncedAt(),
      total_requests_cached: this.store.getRequestsMap().size,
      sites,
      staff,
    });
  };
}
