export class HealthController {
  constructor(store) {
    this.store = store;
    this.getHealth = this.getHealth.bind(this);
    this.getReady = this.getReady.bind(this);
  }

  getHealth(_req, res) {
    res.status(200).json({ ok: true });
  }

  getReady(_req, res) {
    if (this.store.isReady()) {
      res.status(200).json({ ready: true });
    } else {
      res.status(503).json({ ready: false });
    }
  }
}

