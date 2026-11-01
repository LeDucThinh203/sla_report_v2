# DECISIONS

## What I assumed

- **Business hours calculation granularity**: Rule 4 states that response time is summed in seconds within the site's `business_hours` (excluding holidays in `/v1/sites/{id}/holidays`) from `created_at` to the first response's `at`, then floored to whole minutes (`Math.floor(totalSeconds / 60)`). I assumed both `open` and `close` times in `business_hours` (e.g., `"08:00"` and `"18:00"`) have `:00` seconds and represent local wall-clock intervals `[open, close)` on each non-holiday calendar date in the site's IANA timezone.
- **Chained or duplicate reverts**: Rule 2 states *"An event with `reverts_id` undoes the event it points at. Ignore both the reverted event and the reverting event in every rule below."* I collected every event that has a non-null `reverts_id` and added both `event.id` and `event.reverts_id` to an exclusion set before evaluating Rules 3–7.
- **Responder name from `/v1/staff` only**: Rule 3 specifies showing the current name from `/v1/staff`, not `actor_name` on the event. `sla.service.js` strictly looks up `staffById.get(responderId) ?? null` and never falls back to `event.actor_name`.
- **Deadline seconds precision**: `due_at` values are formatted as `"DD/MM/YYYY HH:mm"` in site-local wall-clock time. I parsed them as `HH:mm:00` in the site's timezone. Rule 6 states `completed_late` is `true` when the last `complete` event's `at` is **strictly after** (`>`) the deadline timestamp.
- **Responder summary ordering**: `docs/contract.md` states key order and `requests` order do not matter, so `requests` and `responders` in `/api/sla-report` are sorted deterministically by `id` ascending.

## What I found in the API or data

- **Per-request event fetching vs. `/v1/changes`**: Fetching `/v1/requests/{id}/events` individually for ~12,000 requests over 6 months would require 12,000+ HTTP requests and immediately trigger `429 Too Many Requests` rate limits. Instead, `/v1/changes?limit=500` streams all `request.created`, `request.updated`, `event.created`, and `staff.updated` records sequentially in batches of 500. Draining `/v1/changes` populates the entire dataset in a fraction of the time and avoids flooding the API.
- **Rate limiting (`429 Retry-After`)**: All Helpdesk API endpoints enforce rate limits. I implemented automatic retry logic in `HelpdeskClient` that reads the `Retry-After` response header (or falls back to exponential backoff) and also retries transient `5xx` errors.
- **Expired change-feed cursors (`410 Gone`)**: Cursors from `/v1/changes` expire after 15 minutes. In `SyncService.syncIncremental()`, if the API returns `410`, the service builds a fresh `StoreRepository` instance from scratch and atomically swaps it into the active store so in-flight report requests never see partial state.
- **Daylight Saving Time (DST) in Sydney (`Australia/Sydney`)**: Unlike Singapore (`UTC+8`) and Jakarta (`UTC+7`), Sydney transitions between AEST (`UTC+10`) and AEDT (`UTC+11`) on the first Sunday of October. Using fixed UTC offsets would miscalculate October business hours and deadlines by 1 hour. I used Node's built-in `Intl.DateTimeFormat` with `formatToParts` and iterative wall-clock-to-UTC convergence (`localWallClockToUtcSeconds`) to handle DST transitions without external libraries.

## How I used AI

- **Tools used**: Antigravity (AI pair-programming assistant).
- **What I asked & how it helped**:
  - Analyzed the starter kit (`docs/rules.md`, `docs/contract.md`, `docs/api.md`) to verify all edge cases across the 7 rules.
  - Scaffolded the project structure separating `backend/` (Node.js 22 + Express 5 ES Modules + `node --test`) and `frontend/` (React 18 + Vite + TypeScript) while preserving the single `app` service contract in `docker-compose.yml` via a multi-stage `Dockerfile`.
  - Assisted in writing unit and integration tests for timezone conversions, DST boundaries, `reverts_id` filtering, keyset cursor pagination, and the 12,000-request performance benchmark.
- **What came back wrong & what I changed**:
  - Initially, the backend used TypeScript which required a compilation step (`tsc`) before running `node --test`. I converted the backend to pure ES Module JavaScript (`"type": "module"`) matching the official `starters/node-express` kit so `node src/server.js` and `node --test` execute directly without build overhead or extra devDependencies.

## Trade-offs and what I would do next

- **In-memory store vs. external database (PostgreSQL / Redis)**:
  - *Trade-off*: To stay within the 3-hour cap and keep deployment simple and fast, all synced requests, events, sites, holidays, and staff are held in an in-memory `StoreRepository` with version-based report caching. For ~12,000 requests and ~50,000 events, memory usage is under 40 MB and 6-month SLA reports compute in ~1.6 seconds cold (<1 ms cached). However, restarting the container requires re-draining `/v1/changes`.
  - *Next step*: Persist the synced entities and latest `cursor` in PostgreSQL or SQLite so container restarts resume incrementally from the last cursor instead of re-syncing from sequence 0.
- **Snapshot-backed cursor pagination on `/api/requests`**:
  - *Trade-off*: To guarantee that any row that exists and matches the filter for the entire walk appears **exactly once** even if its `response_business_minutes` or other rows change mid-walk, page 1 creates a bounded in-memory sorted snapshot identified by `sid`, and `next_cursor` is HMAC-SHA256 signed over `(filterFingerprint, sid, offset)`. Tampered, mismatched, or unknown cursors immediately return `400`.
  - *Next step*: Pre-compute and incrementally maintain each request's evaluated `RequestReportRow` on `event.created` / `request.updated` / `staff.updated` events so uncached report generation is $O(N)$ field reads rather than re-evaluating event lists.
