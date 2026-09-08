import type { BidState, Round, SubRosaClient } from "@sub-rosa/sdk";
import { systemClock } from "@sub-rosa/time";
import { getSystemEnv } from "@sub-rosa/config";

import { VOID_GRACE_SECONDS } from "./keeper.js";

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

export interface KeeperRunConfig {
  contractId: string;
  roundId: bigint;
  rpcUrl: string;
  networkPassphrase: string;
  dryRun: boolean;
  keeperSecret?: string;
  maxWaitSeconds: number;
}

export type KeeperDryRunPhase =
  | "awaiting-drand"
  | "stale-open"
  | "revealing"
  | "awaiting-clear"
  | "ready-to-clear"
  | "ready-to-settle"
  | "complete";

export interface KeeperDryRunDecision {
  currentPhase: KeeperDryRunPhase;
  nextAction: string;
}

export interface KeeperDryRunSummary extends KeeperDryRunDecision {
  mode: "dry-run";
  roundId: bigint;
  status: Round["status"]["tag"];
  drandRound: bigint;
  bidderCount: number;
  revealedCount: number | null;
  transactionsSubmitted: 0;
}

export type KeeperDryRunReader = Pick<
  SubRosaClient,
  "getRound" | "getBidState"
>;

function requiredEnv(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

function parseBooleanEnv(value: string | undefined, name: string): boolean {
  if (value == null || value.trim() === "") return false;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(
    `${name} must be one of true/false, 1/0, yes/no, or on/off`,
  );
}

function parseRoundId(value: string | undefined): bigint {
  const raw = value?.trim() || "1";
  try {
    const roundId = BigInt(raw);
    if (roundId < 1n) throw new Error();
    return roundId;
  } catch {
    throw new Error(`ROUND_ID must be a positive integer, got ${JSON.stringify(raw)}`);
  }
}

function parseMaxWaitSeconds(value: string | undefined): number {
  const raw = value?.trim() || "0";
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(
      `MAX_WAIT_SECONDS must be a non-negative finite number, got ${JSON.stringify(raw)}`,
    );
  }
  return seconds;
}

export function parseKeeperRunConfig(
  env: Record<string, string | undefined> = getSystemEnv(),
): KeeperRunConfig {
  const dryRun = parseBooleanEnv(env.KEEPER_DRY_RUN, "KEEPER_DRY_RUN");
  const keeperSecret = env.KEEPER_SECRET?.trim() || undefined;
  if (!dryRun && !keeperSecret) {
    throw new Error(
      "missing required env var KEEPER_SECRET (not required when KEEPER_DRY_RUN=true)",
    );
  }

  return {
    contractId: requiredEnv(env, "ROUND_CONTRACT_ID"),
    roundId: parseRoundId(env.ROUND_ID),
    rpcUrl: env.RPC_URL?.trim() || DEFAULT_RPC_URL,
    networkPassphrase:
      env.NETWORK_PASSPHRASE?.trim() || DEFAULT_NETWORK_PASSPHRASE,
    dryRun,
    ...(keeperSecret ? { keeperSecret } : {}),
    maxWaitSeconds: parseMaxWaitSeconds(env.MAX_WAIT_SECONDS),
  };
}

export function decideKeeperDryRunAction(
  round: Pick<Round, "status" | "reveal_deadline">,
  bidderCount: number,
  revealedCount: number | null,
  nowSeconds = systemClock.nowSeconds(),
): KeeperDryRunDecision {
  switch (round.status.tag) {
    case "Open": {
      const voidAfter = Number(round.reveal_deadline) + VOID_GRACE_SECONDS;
      return nowSeconds > voidAfter
        ? { currentPhase: "stale-open", nextAction: "void stale round" }
        : {
            currentPhase: "awaiting-drand",
            nextAction: "open reveal when the configured Drand round is published",
          };
    }
    case "Revealing": {
      if (nowSeconds > Number(round.reveal_deadline)) {
        return { currentPhase: "ready-to-clear", nextAction: "clear round" };
      }
      const pending =
        revealedCount == null ? null : Math.max(0, bidderCount - revealedCount);
      if (pending == null || pending > 0) {
        return {
          currentPhase: "revealing",
          nextAction:
            pending == null
              ? "inspect bidder states and reveal pending bids"
              : `reveal ${pending} pending bidder${pending === 1 ? "" : "s"}`,
        };
      }
      return {
        currentPhase: "awaiting-clear",
        nextAction: `wait for reveal deadline ${round.reveal_deadline}`,
      };
    }
    case "Cleared":
      return { currentPhase: "ready-to-settle", nextAction: "settle round" };
    case "Settled":
      return { currentPhase: "complete", nextAction: "none — round settled" };
    case "Voided":
      return {
        currentPhase: "complete",
        nextAction: "none — round voided and escrow refunded",
      };
  }
}

async function countRevealedBids(
  reader: KeeperDryRunReader,
  roundId: bigint,
  bidders: string[],
): Promise<number | null> {
  try {
    const states: BidState[] = await Promise.all(
      bidders.map((bidder) => reader.getBidState(roundId, bidder)),
    );
    return states.filter((state) => state.revealed_value != null).length;
  } catch {
    return null;
  }
}

export async function buildKeeperDryRunSummary(
  reader: KeeperDryRunReader,
  roundId: bigint | number,
  nowSeconds = systemClock.nowSeconds(),
): Promise<KeeperDryRunSummary> {
  const rid = BigInt(roundId);
  const round = await reader.getRound(rid);
  const bidderCount = round.bidders.length;
  const revealedCount = await countRevealedBids(
    reader,
    rid,
    round.bidders,
  );
  const decision = decideKeeperDryRunAction(
    round,
    bidderCount,
    revealedCount,
    nowSeconds,
  );

  return {
    mode: "dry-run",
    roundId: rid,
    status: round.status.tag,
    drandRound: round.reveal_round,
    bidderCount,
    revealedCount,
    ...decision,
    transactionsSubmitted: 0,
  };
}
