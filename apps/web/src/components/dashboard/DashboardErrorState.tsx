// Copyright (c) 2026 Sub Rosa contributors
export function DashboardErrorState({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="dashboard-error-state" role="alert">
      <div className="dashboard-error-icon">
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
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      </div>
      <h2>Failed to Load Dashboard</h2>
      <p className="dashboard-error-message">{error}</p>
      <button type="button" className="primary-action" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
