// Copyright (c) 2026 Sub Rosa contributors
import { useEffect, useState } from "react";
import { validatePublicConfig, type ConfigIssue } from "../lib/config";

const BANNER_STORAGE_KEY = "subrosa-config-banner-dismissed";

export function ConfigBanner() {
  const [issues, setIssues] = useState<ConfigIssue[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setIssues(validatePublicConfig());
    try {
      const stored = globalThis.sessionStorage?.getItem(BANNER_STORAGE_KEY);
      if (stored === "1") setDismissed(true);
    } catch {
      // Keep the banner usable when browser storage is blocked.
    }
  }, []);

  if (issues.length === 0 || dismissed) return null;

  return (
    <aside className="config-banner" role="alert">
      <div className="config-banner-body">
        <span className="config-banner-icon" aria-hidden="true">!</span>
        <div className="config-banner-content">
          <strong>Public config needs attention</strong>
          <ul>
            {issues.map((issue) => (
              <li key={issue.key}>{issue.message}</li>
            ))}
          </ul>
        </div>
      </div>
      <button
        type="button"
        className="config-banner-dismiss"
        aria-label="Dismiss"
        onClick={() => {
          setDismissed(true);
          try {
            globalThis.sessionStorage?.setItem(BANNER_STORAGE_KEY, "1");
          } catch {
            // Dismissal still applies to the current mounted banner.
          }
        }}
      >
        &times;
      </button>
    </aside>
  );
}
