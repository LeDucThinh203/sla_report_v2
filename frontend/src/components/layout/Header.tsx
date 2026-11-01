import type { AppMetadataResponse } from "../../types/report.types";
import { formatTimestamp } from "../../utils/formatters";

interface HeaderProps {
  metadata: AppMetadataResponse | null;
  onRefresh: () => void;
  loading: boolean;
}

export function Header({ metadata, onRefresh, loading }: HeaderProps) {
  const isReady = metadata?.ready ?? false;

  return (
    <header className="app-header">
      <div className="header-inner">
        <div>
          <div className="header-eyebrow">Robust Tech House — Operations</div>
          <h1 className="header-title">Helpdesk SLA Performance Dashboard</h1>
        </div>
        <div className="header-actions">
          <div className={`sync-badge ${isReady ? "sync-ready" : "sync-warming"}`}>
            <span className="sync-dot" />
            <span>
              {isReady
                ? `Live Sync (${metadata?.total_requests_cached.toLocaleString() ?? 0} reqs · ${formatTimestamp(
                    metadata?.last_synced_at ?? null
                  )})`
                : "Warming up change feed..."}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh Now"}
          </button>
        </div>
      </div>
    </header>
  );
}

