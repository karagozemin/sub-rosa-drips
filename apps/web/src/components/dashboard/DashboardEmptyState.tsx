// Copyright (c) 2026 Sub Rosa contributors
export function DashboardEmptyState() {
  return (
    <div className="dashboard-empty-state">
      <div className="dashboard-empty-icon">
        <svg
          aria-hidden="true"
          focusable="false"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h2>No Round Data Available</h2>
      <p>
        The dashboard could not find any round data to display. This might mean:
      </p>
      <ul>
        <li>No rounds have been created yet</li>
        <li>The configured endpoint returned no data</li>
        <li>The data source is temporarily unavailable</li>
      </ul>
      <p className="dashboard-empty-hint">
        If using a custom endpoint, verify <code>VITE_DASHBOARD_ENDPOINT</code> is set correctly.
      </p>
    </div>
  );
}
