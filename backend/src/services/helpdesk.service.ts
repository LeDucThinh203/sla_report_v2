import type {
  HelpdeskChangesResponse,
  HelpdeskHoliday,
  HelpdeskPagedEventsResponse,
  HelpdeskPagedRequestsResponse,
  HelpdeskRequest,
  HelpdeskSite,
  HelpdeskStaff,
  HelpdeskStatus,
} from "../types/helpdesk.types.js";

export class HelpdeskApiError extends Error {
  public readonly status: number;
  public readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "HelpdeskApiError";
    this.status = status;
    this.body = body;
  }
}

export interface HelpdeskClientOptions {
  baseUrl?: string;
  token?: string;
  maxRetries?: number;
}

export class HelpdeskClient {
  public readonly baseUrl: string;
  public readonly token: string;
  private readonly maxRetries: number;

  constructor({
    baseUrl = process.env.HELPDESK_URL || "http://localhost:4010",
    token = process.env.HELPDESK_TOKEN || "",
    maxRetries = 5,
  }: HelpdeskClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.maxRetries = maxRetries;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async get<T = unknown>(
    pathname: string,
    params: Record<string, string | number | undefined | null> = {}
  ): Promise<T> {
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

      return (await res.json()) as T;
    }
  }

  public async getSites(): Promise<HelpdeskSite[]> {
    const res = await this.get<{ data: HelpdeskSite[] }>("/v1/sites");
    return res.data;
  }

  public async getSiteHolidays(siteId: number): Promise<HelpdeskHoliday[]> {
    const res = await this.get<{ data: HelpdeskHoliday[] }>(
      `/v1/sites/${siteId}/holidays`
    );
    return res.data;
  }

  public async getStaff(): Promise<HelpdeskStaff[]> {
    const res = await this.get<{ data: HelpdeskStaff[] }>("/v1/staff");
    return res.data;
  }

  public async getStatuses(): Promise<HelpdeskStatus[]> {
    const res = await this.get<{ data: HelpdeskStatus[] }>("/v1/statuses");
    return res.data;
  }

  public async getChanges(
    cursor?: string | null,
    limit = 500
  ): Promise<HelpdeskChangesResponse> {
    return this.get<HelpdeskChangesResponse>("/v1/changes", {
      cursor: cursor ?? undefined,
      limit,
    });
  }

  public async getRequestsPage(params: {
    page?: number;
    per_page?: number;
    created_from?: string;
    created_to?: string;
    status?: string;
  } = {}): Promise<HelpdeskPagedRequestsResponse> {
    return this.get<HelpdeskPagedRequestsResponse>("/v1/requests", params);
  }

  public async getRequestById(id: number): Promise<HelpdeskRequest> {
    const res = await this.get<{ data?: HelpdeskRequest } & HelpdeskRequest>(
      `/v1/requests/${id}`
    );
    return res.data ?? res;
  }

  public async getRequestEventsPage(
    requestId: number,
    page = 1
  ): Promise<HelpdeskPagedEventsResponse> {
    return this.get<HelpdeskPagedEventsResponse>(
      `/v1/requests/${requestId}/events`,
      { page }
    );
  }
}

