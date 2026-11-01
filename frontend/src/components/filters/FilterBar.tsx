import type {
  BrowseFilterState,
  SiteInfo,
  SortField,
  StaffInfo,
} from "../../types/report.types";

interface FilterBarProps {
  filters: BrowseFilterState;
  sites: SiteInfo[];
  staff: StaffInfo[];
  onChange: (patch: Partial<BrowseFilterState>) => void;
}

export function FilterBar({ filters, sites, staff, onChange }: FilterBarProps) {
  const applyPreset = (from: string, to: string) => {
    onChange({ from, to });
  };

  return (
    <section className="panel filter-panel">
      <div className="filter-header">
        <h2 className="panel-title">Report Parameters & Browse Filters</h2>
        <div className="preset-group">
          <span className="preset-label">Quick Presets:</span>
          <button
            type="button"
            className="btn btn-xs"
            onClick={() => applyPreset("2026-10-12", "2026-10-18")}
          >
            12–18 Oct 2026
          </button>
          <button
            type="button"
            className="btn btn-xs"
            onClick={() => applyPreset("2026-10-01", "2026-10-31")}
          >
            Oct 2026 (1 Month)
          </button>
          <button
            type="button"
            className="btn btn-xs"
            onClick={() => applyPreset("2026-05-01", "2026-10-31")}
          >
            May–Oct 2026 (6 Months)
          </button>
        </div>
      </div>

      <div className="filter-grid">
        <label className="form-field">
          <span>From Date (Site Local)</span>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => onChange({ from: e.target.value })}
          />
        </label>

        <label className="form-field">
          <span>To Date (Site Local)</span>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => onChange({ to: e.target.value })}
          />
        </label>

        <label className="form-field">
          <span>Site</span>
          <select
            value={filters.site_id}
            onChange={(e) => onChange({ site_id: e.target.value })}
          >
            <option value="">All Sites</option>
            {sites.map((s) => (
              <option key={s.id} value={String(s.id)}>
                #{s.id} — {s.name} ({s.timezone})
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Responder</span>
          <select
            value={filters.responder_id}
            onChange={(e) => onChange({ responder_id: e.target.value })}
          >
            <option value="">All Responders</option>
            {staff.map((st) => (
              <option key={st.id} value={String(st.id)}>
                {st.name} (#{st.id})
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Within SLA Target</span>
          <select
            value={filters.within_target}
            onChange={(e) => onChange({ within_target: e.target.value })}
          >
            <option value="">All</option>
            <option value="true">Within Target (true)</option>
            <option value="false">Missed Target (false)</option>
          </select>
        </label>

        <label className="form-field">
          <span>Completed Late</span>
          <select
            value={filters.late}
            onChange={(e) => onChange({ late: e.target.value })}
          >
            <option value="">All</option>
            <option value="true">Completed Late (true)</option>
            <option value="false">On Time (false)</option>
          </select>
        </label>

        <label className="form-field">
          <span>Sort Order</span>
          <select
            value={filters.sort}
            onChange={(e) => onChange({ sort: e.target.value as SortField })}
          >
            <option value="id">Request ID (Ascending)</option>
            <option value="-id">Request ID (Descending)</option>
            <option value="response_business_minutes">
              Response Minutes (Fastest First, Nulls Last)
            </option>
            <option value="-response_business_minutes">
              Response Minutes (Slowest First, Nulls Last)
            </option>
          </select>
        </label>

        <label className="form-field">
          <span>Page Size</span>
          <select
            value={String(filters.limit)}
            onChange={(e) => onChange({ limit: Number(e.target.value) })}
          >
            <option value="25">25 rows</option>
            <option value="50">50 rows</option>
            <option value="100">100 rows</option>
            <option value="200">200 rows</option>
          </select>
        </label>
      </div>
    </section>
  );
}
