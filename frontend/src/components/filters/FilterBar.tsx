interface DateRangeBarProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

export function FilterBar({ from, to, onChange }: DateRangeBarProps) {
  return (
    <section className="panel filter-panel">
      <div className="filter-header" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="panel-title">Report Date Range</h2>
          <p className="panel-subtitle">
            Select the date period to analyze SLA compliance and staff performance
          </p>
        </div>

        <div className="date-bar-controls">
          <div className="preset-group">
            <span className="preset-label">Quick Presets:</span>
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => onChange("2026-10-12", "2026-10-18")}
            >
              12–18 Oct 2026
            </button>
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => onChange("2026-10-01", "2026-10-31")}
            >
              Oct 2026 (1 Month)
            </button>
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => onChange("2026-05-01", "2026-10-31")}
            >
              May–Oct 2026 (6 Months)
            </button>
          </div>

          <div className="date-inputs-row">
            <label className="form-field-inline">
              <span>From Date:</span>
              <input
                type="date"
                value={from}
                onChange={(e) => onChange(e.target.value, to)}
              />
            </label>

            <label className="form-field-inline">
              <span>To Date:</span>
              <input
                type="date"
                value={to}
                onChange={(e) => onChange(from, e.target.value)}
              />
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
