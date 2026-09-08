import { useCallback, useEffect, useState } from "react";
import { getBrowserEnv } from "@sub-rosa/config/browser";
import type { DashboardData } from "../dashboard/types";
import { DASHBOARD_FIXTURE } from "../dashboard/fixture";
import { assertDashboardData } from "../dashboard/fixture-health-check";
import { useTime } from "../lib/time";

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const LIVE_POLL_INTERVAL_MS = 30 * 1000; // 30 seconds

export interface UseDashboardDataResult {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  refetch: () => void;
}

/**
 * Determine whether dashboard data fetched at `fetchedAt` should be treated
 * as stale relative to `nowMs`.
 *
 * A missing or unparseable `fetchedAt` is treated as stale rather than
 * fresh: `Date.parse()` returns `NaN` for invalid input, and every
 * comparison against `NaN` (including `>`) evaluates to `false` in
 * JavaScript -- so without an explicit check, malformed timestamp data
 * would silently be reported as fresh instead of triggering the staleness
 * warning it's meant to guard against.
 */
export function isStale(fetchedAt: string | null | undefined, nowMs: number): boolean {
  if (!fetchedAt) {
    return true;
  }

  const fetchedTime = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedTime)) {
    return true;
  }

  return nowMs - fetchedTime > STALE_THRESHOLD_MS;
}

export function useDashboardData(): UseDashboardDataResult {
  const { clock, scheduler } = useTime();
  const env = getBrowserEnv();
  const endpoint = env.VITE_DASHBOARD_ENDPOINT as string | undefined;
  const useFixture = !endpoint?.trim();

  const [state, setState] = useState<UseDashboardDataResult>(() => ({
    data: null,
    loading: true,
    error: null,
    stale: false,
    refetch: () => {},
  }));

  const fetchData = useCallback(async () => {
    if (useFixture) {
      setState((s) => ({
        ...s,
        data: DASHBOARD_FIXTURE,
        loading: false,
        error: null,
        stale: isStale(DASHBOARD_FIXTURE.meta.fetchedAt, clock.nowMs()),
      }));
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const response = await fetch(endpoint!);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json: unknown = await response.json();
      assertDashboardData(json);

      setState((s) => ({
        ...s,
        data: json,
        loading: false,
        error: null,
        stale: isStale(json.meta.fetchedAt, clock.nowMs()),
      }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState((s) => ({
        ...s,
        loading: false,
        error: `Failed to fetch dashboard data: ${message}`,
      }));
    }
  }, [endpoint, useFixture, clock]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      await fetchData();
    };

    void tick();

    let intervalHandle: ReturnType<typeof scheduler.setInterval> | undefined;
    if (!useFixture) {
      intervalHandle = scheduler.setInterval(() => void tick(), LIVE_POLL_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      if (intervalHandle !== undefined) {
        scheduler.clear(intervalHandle);
      }
    };
  }, [fetchData, useFixture, scheduler]);

  // Update stale status periodically
  useEffect(() => {
    if (!state.data) return;

    const checkStale = () => {
      setState((s) => {
        if (!s.data) return s;
        const nowStale = isStale(s.data.meta.fetchedAt, clock.nowMs());
        return nowStale !== s.stale ? { ...s, stale: nowStale } : s;
      });
    };

    const handle = scheduler.setInterval(checkStale, 60_000);
    return () => scheduler.clear(handle);
  }, [state.data, clock, scheduler]);

  return {
    ...state,
    refetch: fetchData,
  };
}
