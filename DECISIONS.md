# DECISIONS

## What I assumed

- **Business hours calculation granularity (Rule 4)**: Response time is summed in exact seconds within the site's `business_hours` (excluding dates in `/v1/sites/{id}/holidays`) from `created_at` to the first response's `at`, and only floored to whole minutes at the very end (`Math.floor(totalSeconds / 60)`). Partial seconds across multiple business days accumulate before flooring. Both `open` and `close` times in `business_hours` (e.g., `"08:00"` and `"18:00"`) represent local wall-clock intervals `[open, close)` on each non-holiday calendar date in the site's IANA timezone.
- **Chained or multiple reverts (Rule 2)**: *"An event with `reverts_id` undoes the event it points at. Ignore both the reverted event and the reverting event in every rule below."* Every event with a non-null `reverts_id` adds both `event.id` and `event.reverts_id` to an exclusion set before evaluating Rules 3–7.
- **Responder name from `/v1/staff` only (Rule 3)**: Rule 3 specifies showing the current name from `/v1/staff`, not `actor_name` on the event. `sla.service.js` strictly resolves `staffById.get(responderId) ?? null` and never falls back to `event.actor_name`. When two candidate `processing` events share the exact same `at` timestamp, ties are broken deterministically by `event.id` ascending.
- **Deadline evaluation and reopened requests (Rule 6)**: `due_at` values are formatted as `"DD/MM/YYYY HH:mm"` in site-local wall-clock time (`HH:mm:00`). Rule 6 states `completed_late` is `true` when the **last** `complete` event's `at` is strictly after (`>`) the `due_at` of the **latest** non-reverted event that has a `due_at` (evaluated independently across all non-reverted events on the request).
- **Deterministic output ordering**: `docs/contract.md` states key order and `requests` order in `/api/sla-report` do not matter, so `requests` and `responders` in `/api/sla-report` are sorted deterministically by `id` ascending.

## What I found in the API or data

- **Per-request event fetching vs. `/v1/changes` (Level 2)**: The Practice API contains **12,004 requests** and **45,921 events** across 3 sites (`11` Singapore, `12` Sydney, `13` Jakarta) and 15 staff members. Fetching `/v1/requests/{id}/events` individually would require 12,000+ HTTP requests and immediately hit `429 Too Many Requests`. Instead, draining `/v1/changes?limit=500` (~116 pages) streams all `request.created`, `request.updated`, `event.created`, and `staff.updated` records sequentially in **~23.9 seconds** on container startup.
- **Real data anomalies verified against the 7 rules**:
  - **Response earlier than `created_at`**: Request `#63467` in the Practice API has a first `processing` event (`at: 2026-09-12T10:33:00Z`) earlier than `created_at` (`2026-09-12T10:38:00Z`). Under Rule 4, `calculateBusinessMinutes` returns `0` (`within_target: true`).
  - **Reopen after `complete` with extended `due_at`**: Requests `#64116` and `#64398` have a `complete` event followed later by a `reopen` event that sets a new, extended `due_at`. Because Rule 6 defines the deadline as the `due_at` of the latest event that has one, evaluating the last `complete` event and the latest `due_at` event independently handles deadline extensions accurately.
  - **Site-specific schedules & Sydney DST**:
    - Site `11` (`Asia/Singapore`, `UTC+8`): Mon–Fri `08:00–18:00`, Sat/Sun closed, 5 holidays in 2026.
    - Site `12` (`Australia/Sydney`, `UTC+10` / `UTC+11`): Mon–Fri `07:30–17:00`, Sat/Sun closed, 2 holidays (`08/06/2026`, `05/10/2026`). Transitions from AEST (`UTC+10`) to AEDT (`UTC+11`) on October 4, 2026. Fixed UTC offsets would miscalculate October business hours and `due_at` deadlines by 1 hour; using `Intl.DateTimeFormat` with iterative wall-clock-to-UTC convergence (`localWallClockToUtcSeconds`) handles DST transitions accurately.
    - Site `13` (`Asia/Jakarta`, `UTC+7`): Mon–Fri `08:00–17:00`, **Saturday `08:00–12:00`**, Sunday closed, 7 holidays in 2026.
  - **Reverted events**: Found 195 reverting events (`reverts_id !== null`) in the live feed, all properly excluded along with their target events.
- **Rate limiting (`429 Retry-After`) and Expired Cursors (`410 Gone`)**: `HelpdeskClient` honors the `Retry-After` header with exponential backoff fallback for `429` and transient `5xx` responses. `SyncService` buffers multi-page incremental polls and commits them atomically to `StoreRepository`, and on `410 Gone` rebuilds a fresh staging store before swapping it in atomically.

## Measured Benchmarks (Docker Container on Port 8080)

- **Cold Bootstrap (`GET /ready` -> `200`)**: **23.87 seconds** for 12,004 requests & 45,921 events (target: `< 8 minutes`).
- **6-Month Report (`2026-05-01` to `2026-10-31`, 11,044 eligible requests)**: **957.21 ms** cold cache | **33.73 ms** warm cache (target: `< 10 seconds`).
- **1-Month Report (`2026-10-01` to `2026-10-31`, 1,910 eligible requests)**: **232.59 ms** cold cache | **8.85 ms** warm cache (target: `< 5 seconds`).
- **1-Week Report (`2026-10-12` to `2026-10-18`, 419 eligible requests)**: **399.35 ms** cold cache | **4.29 ms** warm cache.
- **Full 6-Month Cursor Walk (`GET /api/requests`, 56 pages of 200 rows = 11,044 rows)**: **239.48 ms** total (~4.28 ms/page), 0 duplicates, 0 omissions.

## How I used AI

- **Tools used**: Antigravity (AI coding assistant).
- **What I asked & how it helped**:
  - Audited `docs/rules.md`, `docs/contract.md`, and live Practice API edge cases (`#63467`, `#64116`, Sydney DST, Jakarta Saturday hours).
  - Structured the application with a pure ES Module JavaScript backend (`backend/src/`) and a React + TypeScript + Vite frontend (`frontend/src/`) bundled via a multi-stage `Dockerfile`.
  - Built comprehensive unit, integration, resilience, and 12,000-request benchmark tests in `backend/tests/`.
  - Implemented the additional Level 4 `GET /api/requests.csv` export endpoint (`backend/src/utils/csv.utils.js`, `ReportService.exportRequestsCsv`, `validateExportRequestsCsvParams`) and the frontend **Download CSV** button (`RequestsTable.tsx`, `buildRequestsCsvUrl`), along with automated CSV contract and escaping tests.
- **What came back wrong & what I changed**:
  - Initially, incremental change-feed polling applied each page to the store inside the pagination loop, which could expose partial multi-page updates to a concurrent report reader. I refactored `SyncService.syncIncremental()` to buffer all pages in a poll cycle and apply them atomically in a single store version bump.
  - Initially, cursor snapshots in `ReportService` only evicted by count (`MAX_SNAPSHOTS = 200`). I added TTL expiration (`15 minutes`), upper-bound offset validation (`offset >= rows.length` -> `400`), and LRU refresh on active walks.
  - When adding CSV export validation, sharing `validateBrowseRequestsParams` directly would have validated or rejected `limit` and `cursor` query parameters on `/api/requests.csv`. I extracted `validateExportRequestsCsvParams(query)` to validate only the filter and sort parameters (`from`, `to`, `site_id`, `responder_id`, `late`, `within_target`, `sort`) while completely ignoring `limit` and `cursor`, and composed `validateBrowseRequestsParams` on top of it.

## Additional Client Requirement: Monthly CSV Export (`GET /api/requests.csv`)

- **Requirement overview**:
  1. The finance team requested a CSV export of the request list for monthly Excel reporting.
  2. Added `GET /api/requests.csv`, accepting the exact same filtering (`from`, `to`, `site_id`, `responder_id`, `late`, `within_target`) and sorting (`sort`: `id`, `-id`, `response_business_minutes`, `-response_business_minutes`) parameters as `GET /api/requests`.
  3. Any `limit` and `cursor` query parameters passed to `GET /api/requests.csv` are ignored (`validateExportRequestsCsvParams` in `backend/src/middleware/validation.middleware.js`).
  4. The endpoint exports **all** matching requests in full (never truncated to page size), sorted according to the requested `sort` parameter (defaulting to `id` ascending, with `null` values last and ties broken by `id` ascending), and responds with `Content-Type: text/csv`.
  5. The CSV header is exact:
     `id,site_id,responder_id,responder,response_business_minutes,within_target,completed_late`
  6. Boolean fields (`within_target`, `completed_late`) are serialized as `true` or `false`.
  7. `null` (or `undefined`) values are serialized as empty CSV fields (`""`).
  8. Fields containing commas (`,`), double quotes (`"`), or line breaks (`\r`, `\n`) are enclosed in double quotes with internal double quotes doubled (`""`) per RFC 4180 (`escapeCsvField` in `backend/src/utils/csv.utils.js`).
  9. Added a **Download CSV** button in the header of the Browse Requests section (`frontend/src/components/tables/RequestsTable.tsx`) that builds `/api/requests.csv?...` via `buildRequestsCsvUrl(filters)` (`frontend/src/services/report.api.ts`) using all currently selected filters and sorting, exporting the full matching dataset rather than only the currently displayed page.
- **Reuse of existing SLA evaluation, filtering, and sorting logic**:
  - `ReportService.exportRequestsCsv(query)` in `backend/src/services/report.service.js` calls the existing version-cached `this.getSlaReport(query.from, query.to)` (which delegates to `buildSlaReport` in `sla.service.js` for Rules 1–7), passes the resulting request rows through the existing `this.filterRows(baseReport.requests, query)` and `this.sortRows(filtered, query.sort)` methods, and serializes the sorted array with `serializeRequestsToCsv(sorted)`. Because `getSlaReport` is keyed by `store.getVersion()`, any live Helpdesk API changes synced via `/v1/changes` immediately invalidate stale cache entries and are reflected in subsequent CSV exports.
- **Automated tests performed (`backend/tests/report.test.js`)**:
  - Verified exact CSV header, `Content-Type: text/csv`, `true`/`false` booleans, empty fields for `null` values, filtering (`site_id`, `within_target`), sorting (`-response_business_minutes` with tie-breaking and nulls last), and confirmed that `limit=1&cursor=invalid_cursor` are ignored.
  - Verified RFC 4180 escaping when responder names contain commas and double quotes (`Lim, Alice "The Ace"` -> `"Lim, Alice ""The Ace"""`) or embedded newlines (`Benjamin\nTan` -> `"Benjamin\nTan"`), and verified that live `store.upsertStaff` updates are immediately reflected in the CSV output.
  - Verified full-dataset export across 255 matching requests in a single call (exceeding the 200-row pagination maximum of `GET /api/requests`).
- **Trade-offs and limitations**:
  - `serializeRequestsToCsv` builds the complete CSV body in memory before sending. For the 6-month Practice API dataset (~11,044 eligible requests, ~420 KB CSV payload), in-memory serialization completes in ~5 ms with negligible memory overhead. If the dataset scaled to hundreds of thousands of rows per export, buffering the entire string in memory would increase peak heap usage, and streaming rows via a Node.js `Readable` stream would be preferable.

## Trade-offs and what I would do next

- **In-memory store vs. persistent database (PostgreSQL / SQLite)**:
  - *Trade-off*: Storing all synced entities in an in-memory `StoreRepository` keeps memory footprint small (< 45 MB for 12k requests and 46k events), avoids external container dependencies, and computes 6-month SLA reports in < 1 second cold. However, a container restart requires re-draining `/v1/changes` (~24 seconds).
  - *Next step*: Persist the synced entities and change-feed cursor in SQLite or PostgreSQL so container restarts resume incrementally from the last cursor.
- **Deduplicated Snapshot-backed cursor pagination on `/api/requests`**:
  - *Trade-off*: To strictly satisfy the `docs/contract.md` requirement that any row existing and matching the filter for the entire walk appears **exactly once** even if its `response_business_minutes` mutates mid-walk, page 1 captures an immutable sorted row snapshot (`sid`) deduplicated by `(storeVersion, filterFingerprint)`, bounded by `MAX_SNAPSHOTS = 1000` and a 15-minute TTL, and signs `(filterFingerprint, sid, offset)` with HMAC-SHA256. Deduplicating by `(storeVersion, filterFingerprint)` prevents repeated Page-1 requests from evicting active walks, while strictly reading from the immutable snapshot guarantees zero duplicate or skipped rows under concurrent mutations. Tampered, mismatched, out-of-range, or expired cursors strictly return `400`.
  - *Next step*: Materialize evaluated SLA fields incrementally on each request as events arrive so cold report generation requires zero event-list re-evaluation.
- **Full-dataset CSV export (`GET /api/requests.csv`)**:
  - *Trade-off*: `ReportService.exportRequestsCsv` reuses `getSlaReport(from, to)`, `filterRows`, and `sortRows` while ignoring `limit` and `cursor` parameters so that all matching rows are exported in a single consistent snapshot tied to the current `storeVersion`. Building the CSV string in-memory via `serializeRequestsToCsv` is fast (~5 ms for 11,000 rows) and avoids any dependency on external CSV libraries while strictly enforcing RFC 4180 escaping (commas, double quotes, and CR/LF line breaks), `true`/`false` boolean formatting, and empty fields for `null`.
  - *Next step*: If dataset sizes grew to hundreds of thousands of rows, stream the sorted rows through a Node.js `Readable` stream to keep peak response buffer allocation constant.

