export class HelpdeskApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "HelpdeskApiError";
    this.status = status;
    this.body = body;
  }
}

export class HelpdeskClient {
  constructor({
    baseUrl = process.env.HELPDESK_URL || "http://localhost:4010",
    token = process.env.HELPDESK_TOKEN || "",
    maxRetries = 5,
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.maxRetries = maxRetries;
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async get(pathname, params = {}) {
    const url = new URL(this.baseUrl + pathname);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    let attempt = 0;
    while (true) {
      attempt++;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
        },
      });

      if (res.status === 429 && attempt <= this.maxRetries) {
        const retryAfterHeader = res.headers.get("Retry-After");
        const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
        const waitMs =
          !Number.isNaN(retryAfterSec) && retryAfterSec > 0
            ? retryAfterSec * 1000 + 100
            : Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await this.sleep(waitMs);
        continue;
      }

      if (res.status >= 500 && res.status < 600 && attempt <= 3) {
        await this.sleep(500 * attempt);
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new HelpdeskApiError(
          `Helpdesk API GET ${url} failed: ${res.status} ${body}`,
          res.status,
          body
        );
      }

      return await res.json();
    }
  }

  async getSites() {
    const res = await this.get("/v1/sites");
    return res.data;
  }

  async getSiteHolidays(siteId) {
    const res = await this.get(`/v1/sites/${siteId}/holidays`);
    return res.data;
  }

  async getStaff() {
    const res = await this.get("/v1/staff");
    return res.data;
  }

  async getStatuses() {
    const res = await this.get("/v1/statuses");
    return res.data;
  }

  async getChanges(cursor = null, limit = 500) {
    return this.get("/v1/changes", {
      cursor: cursor ?? undefined,
      limit,
    });
  }

  async getRequestsPage(params = {}) {
    return this.get("/v1/requests", params);
  }

  async getRequestById(id) {
    const res = await this.get(`/v1/requests/${id}`);
    return res.data ?? res;
  }

  async getRequestEventsPage(requestId, page = 1) {
    return this.get(`/v1/requests/${requestId}/events`, { page });
  }
}

