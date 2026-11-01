import {
  validateBrowseRequestsParams,
  validateDateRangeParams,
} from "../middleware/validation.middleware.js";

export class ReportController {
  constructor(reportService, store) {
    this.reportService = reportService;
    this.store = store;
    this.getSlaReport = this.getSlaReport.bind(this);
    this.browseRequests = this.browseRequests.bind(this);
    this.getMetadata = this.getMetadata.bind(this);
  }

  getSlaReport(req, res, next) {
    try {
      const { from, to } = validateDateRangeParams(req.query);
      const report = this.reportService.getSlaReport(from, to);
      res.status(200).json(report);
    } catch (err) {
      next(err);
    }
  }

  browseRequests(req, res, next) {
    try {
      const params = validateBrowseRequestsParams(req.query);
      const result = this.reportService.browseRequests(params);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  getMetadata(_req, res) {
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
  }
}

