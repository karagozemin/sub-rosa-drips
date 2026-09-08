// Copyright (c) 2026 Sub Rosa contributors
import { useEffect, useState } from "react";
import { quicknet } from "@sub-rosa/tlock";
import { getErrorMessage } from "@sub-rosa/errors";
import { useTime } from "../lib/time";

const QUICKNET_GENESIS = 1_692_803_367;
const QUICKNET_PERIOD = 3;

export interface DrandCountdown {
  loading: boolean;
  error: string | null;
  currentRound: number | null;
  targetRound: number;
  /** Seconds until target round is expected; 0 when published or past. */
  secondsRemaining: number;
  /** Unix seconds when target round is expected. */
  targetTime: number;
  published: boolean;
}

function timeOfRound(round: number): number {
  return QUICKNET_GENESIS + QUICKNET_PERIOD * round;
}

function localCountdown(
  targetRound: number,
  nowSeconds: number,
): Omit<DrandCountdown, "loading" | "error"> {
  const targetTime = timeOfRound(targetRound);
  const currentRound = Math.floor((nowSeconds - QUICKNET_GENESIS) / QUICKNET_PERIOD);
  const published = currentRound >= targetRound;

  return {
    currentRound,
    targetRound,
    secondsRemaining: published ? 0 : Math.max(0, targetTime - nowSeconds),
    targetTime,
    published,
  };
}

export function useDrandCountdown(targetRound: number, pollMs = 1000): DrandCountdown {
  const { clock, scheduler } = useTime();
  const [state, setState] = useState<DrandCountdown>(() => ({
    loading: false,
    error: null,
    ...localCountdown(targetRound, clock.nowSeconds()),
  }));

  useEffect(() => {
    let cancelled = false;
    const client = quicknet();

    async function tick() {
      const fallback = localCountdown(targetRound, clock.nowSeconds());

      try {
        const info = await client.chain().info();
        const genesis = info.genesis_time;
        const period = info.period;
        const now = clock.nowSeconds();
        const currentRound = Math.floor((now - genesis) / period);
        const targetTime = genesis + period * targetRound;
        const published = currentRound >= targetRound;
        const secondsRemaining = published ? 0 : Math.max(0, targetTime - now);

        if (!cancelled) {
          setState({
            loading: false,
            error: null,
            currentRound,
            targetRound,
            secondsRemaining,
            targetTime,
            published,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setState({
            ...fallback,
            loading: false,
            error: getErrorMessage(e),
          });
        }
      }
    }

    void tick();
    const handle = scheduler.setInterval(() => void tick(), pollMs);
    return () => {
      cancelled = true;
      scheduler.clear(handle);
    };
  }, [targetRound, pollMs, clock, scheduler]);

  return state;
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "published";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
