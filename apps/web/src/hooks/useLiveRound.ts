import { useEffect, useState } from "react";
import type { Round, BidState } from "@sub-rosa/sdk";
import { getBrowserEnv } from "@sub-rosa/config/browser";
import { useTime } from "../lib/time";

const env = getBrowserEnv();
const RPC = env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK =
  env.VITE_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const CONTRACT = env.VITE_CONTRACT_ID as string | undefined;
const ROUND_ID = env.VITE_ROUND_ID
  ? BigInt(env.VITE_ROUND_ID)
  : undefined;

export interface LiveSnapshot {
  round: Round;
  bidders: string[];
  bidStates: Record<string, BidState>;
  polledAt: number;
}

export function useLiveRound(enabled: boolean, pollMs = 12_000) {
  const { clock, scheduler } = useTime();
  const [live, setLive] = useState<LiveSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !CONTRACT || ROUND_ID === undefined) return;

    let cancelled = false;

    async function poll() {
      try {
        const { SubRosaClient } = await import("@sub-rosa/sdk");
        const reader = new SubRosaClient({
          rpcUrl: RPC,
          networkPassphrase: NETWORK,
          contractId: CONTRACT!,
          publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        });
        const round = await reader.getRound(ROUND_ID!);
        const bidders = await reader.getBidders(ROUND_ID!);
        const bidStates: Record<string, BidState> = {};
        for (const b of bidders) {
          bidStates[b] = await reader.getBidState(ROUND_ID!, b);
        }
        if (!cancelled) {
          setLive({ round, bidders, bidStates, polledAt: clock.nowMs() });
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    poll();
    const handle = scheduler.setInterval(poll, pollMs);
    return () => {
      cancelled = true;
      scheduler.clear(handle);
    };
  }, [enabled, pollMs, clock, scheduler]);

  return { live, error, configured: Boolean(CONTRACT && ROUND_ID !== undefined) };
}
