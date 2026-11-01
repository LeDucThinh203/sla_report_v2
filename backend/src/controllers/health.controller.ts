import type { Request, Response } from "express";
import { StoreRepository } from "../repositories/store.repository.js";

export class HealthController {
  private readonly store: StoreRepository;

  constructor(store: StoreRepository) {
    this.store = store;
  }

  public getHealth = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true });
  };

  public getReady = (_req: Request, res: Response): void => {
    if (this.store.isReady()) {
      res.status(200).json({ ready: true });
    } else {
      res.status(503).json({ ready: false });
    }
  };
}

