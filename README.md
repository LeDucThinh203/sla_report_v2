# Helpdesk Performance Dashboard (`sla-report-v2`)

A full-stack Helpdesk SLA Performance Dashboard built with **Node.js 22, Express 5, TypeScript, React 18, and Vite**. It computes exact business-hours response times, SLA target compliance, late completion metrics, responder breakdowns, and cursor-paginated request browsing across multiple timezones (`Asia/Singapore`, `Australia/Sydney`, `Asia/Jakarta`).

---

## Tech Stack

- **Backend**: Node.js 22, Express 5, TypeScript, native `Intl.DateTimeFormat` timezone engine, native `node:test` runner (zero heavy external runtime dependencies).
- **Frontend**: React 18, TypeScript, Vite, responsive SaaS CSS.
- **DevOps**: Docker (multi-stage build serving both API and static SPA on port `8080`) & Docker Compose.

---

## Architecture & Directory Structure

```text
sla-report-v2/
├── backend/
│   ├── src/
│   │   ├── config/env.ts                # Environment configuration
│   │   ├── controllers/                 # Express route handlers (/health, /ready, /api/*)
│   │   ├── middleware/                  # Strict query validation & error handling
│   │   ├── repositories/store.repository.ts # Versioned in-memory data store
│   │   ├── routes/                      # Express routers
│   │   ├── services/
│   │   │   ├── helpdesk.service.ts      # Rate-limit aware Helpdesk API client (429 Retry-After)
│   │   │   ├── sync.service.ts          # Initial & live incremental /v1/changes sync + 410 recovery
│   │   │   ├── sla.service.ts           # Pure implementation of all 7 SLA business rules
│   │   │   └── report.service.ts        # Version-cached SLA report & keyset cursor pagination
│   │   ├── types/                       # TypeScript interfaces
│   │   ├── utils/
│   │   │   ├── timezone.utils.ts        # IANA timezone wall-clock & business-hours calculator
│   │   │   └── pagination.utils.ts      # HMAC-signed keyset cursor encoder/decoder
│   │   ├── app.ts                       # Express app factory
│   │   └── server.ts                    # HTTP server & background sync starter
│   ├── tests/                           # Unit, integration, sync & 12k benchmark tests
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── components/                  # Header, SummaryCards, FilterBar, RespondersTable, RequestsTable
│   │   ├── hooks/useReport.ts           # Data fetching & live polling hook
│   │   ├── pages/Dashboard.tsx          # Main dashboard view
│   │   ├── services/report.api.ts       # Frontend API client
│   │   ├── styles/global.css            # Clean SaaS dashboard styling
│   │   ├── types/report.types.ts
│   │   └── utils/formatters.ts
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── app/entrypoint.sh                    # Container entrypoint supporting `start` and `test`
├── docs/                                # Official specification (rules.md, contract.md, api.md)
├── Dockerfile                           # Multi-stage build for backend + frontend
├── docker-compose.yml                   # Official compose definition exposing port 8080
├── DECISIONS.md                         # Engineering decisions, assumptions & trade-offs
└── .env.example                         # Environment template
```

---

## Setup & Running with Docker

1. **Configure Environment Variables**:
   Copy `.env.example` to `.env` and fill in your Helpdesk Practice API URL and Bearer token:
   ```bash
   cp .env.example .env
   ```
   Edit `.env`:
   ```env
   HELPDESK_URL=https://your-practice-api-url.example.com
   HELPDESK_TOKEN=your_bearer_token_here
   ```

2. **Build and Start the Application**:
   ```bash
   docker compose up --build
   ```
   The application (both REST API and React Dashboard) will be available at:
   **http://localhost:8080**

3. **Run the Automated Test Suite**:
   ```bash
   docker compose run --rm app test
   ```

---

## Running Locally Without Docker

If Node.js 22+ is installed on your machine:

```bash
# 1. Build Frontend
cd frontend
npm install
npm run build

# 2. Build & Test Backend
cd ../backend
npm install
npm test

# 3. Start Server on port 8080 (reads HELPDESK_URL and HELPDESK_TOKEN from environment)
npm start
```

---

## Implemented Levels & Endpoints

- **Level 1 — Accurate SLA Report (`GET /api/sla-report?from=YYYY-MM-DD&to=YYYY-MM-DD`)**:
  Implements all 7 rules in `docs/rules.md`: site-local date filtering, canceled/deleted/merged filtering, `reverts_id` event pair exclusion, earliest non-System `processing` event responder lookup with current `/v1/staff` name, exact business-hours & holiday response minutes (floored from seconds), priority target thresholds (`60`/`240`/`480`), and `completed_late` evaluation against the latest `due_at` deadline.
- **Level 2 — High Performance (`GET /ready`)**:
  Bootstraps state via `/v1/sites`, `/v1/sites/{id}/holidays`, `/v1/staff`, and `/v1/changes?limit=500`, respecting `429 Retry-After` headers. Computes a 6-month report across 12,000 requests in ~1.6 seconds (and <1ms on subsequent cached reads when store version is unchanged).
- **Level 3 — Live Updates**:
  Polls `/v1/changes?cursor=...&limit=500` every 5 seconds in the background. Automatically handles `410 Gone` expired cursors by rebuilding a fresh store and performing an atomic swap.
- **Level 4 — Filtering, Sorting & Cursor Pagination (`GET /api/requests`)**:
  Supports `from`, `to`, `site_id`, `responder_id`, `late`, `within_target`, `sort` (`id`, `-id`, `response_business_minutes`, `-response_business_minutes` with nulls last and tie-break by `id` ascending), `limit` (`1..200`), and HMAC-signed keyset cursors (`cursor`).
