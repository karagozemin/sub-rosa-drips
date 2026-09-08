// Copyright (c) 2026 Sub Rosa contributors
import { createLogger, type Logger } from '@sub-rosa/logging';
import { getErrorMessage } from "@sub-rosa/errors";
const diagnostics = createLogger("services.keeper.src.status");
import type { SubRosaClient } from "@sub-rosa/sdk";
import { fetchRoundSignature, type DrandClient } from "@sub-rosa/tlock";
import {
  resolveTimeContext,
  systemClock,
  systemTime,
  type Clock,
  type PartialTimeContext,
} from "@sub-rosa/time";

import { decideKeeperDryRunAction, type KeeperDryRunPhase } from "./dry-run.js";
import type { WatchedRound } from "./store.js";

export type RoundStatus =
  | "Unknown"
  | "Open"
  | "Revealing"
  | "Cleared"
  | "Settled"
  | "Voided"
  | "NotFound";

export type SettlementIndicator = "pending" | "submitted" | "terminal" | "none";

export interface RoundStatusView {
  roundId: string;
  status: RoundStatus;
  phase: KeeperDryRunPhase;
  nextAction: string;
  commitDeadline: number | null;
  revealDeadline: number | null;
  revealRound: number | null;
  revealReady: boolean;
  commitClosed: boolean;
  revealWindowOpen: boolean;
  voidableAfter: number | null;
  bidderCount: number | null;
  revealedCount: number | null;
  winner: string | null;
  winningValue: string | null;
  clearingRule: "HighestBid" | "LowestBid" | null;
  settlement: SettlementIndicator;
  lastKeeperAction: string | null;
  lastError: string | null;
  retryCount: number;
  updatedAt: string;
}

export interface KeeperServiceHealth {
  rpc: "ok" | "degraded" | "down";
  drand: "ok" | "degraded" | "down";
  reason?: string;
  checkedAt: string;
}

export interface KeeperStatusResponse {
  contractId: string;
  network: string;
  uptimeSeconds: number;
  rounds: RoundStatusView[];
  health: KeeperServiceHealth;
  now: string;
}

export type StatusReader = Pick<SubRosaClient, "getRound" | "getBidState">;

export interface BuildRoundStatusArgs {
  reader: StatusReader;
  drand: DrandClient;
  roundId: bigint;
  nowSeconds?: number;
  clock?: Clock;
  settlement?: SettlementIndicator;
  watched?: WatchedRound;
}

export interface BuildStatusSource {
  logger?: Logger;
  reader: StatusReader;
  drand: DrandClient;
  storeRounds: () => WatchedRound[];
  contractId: string;
  network: string;
  epochMs?: number;
  nowSeconds?: number;
  settleIndicator?: (roundId: bigint) => SettlementIndicator;
  /** Injectable wall clock. Default: systemClock. */
  time?: PartialTimeContext;
}

const VOID_GRACE_SECONDS = 3600;

async function countRevealed(
  reader: StatusReader,
  roundId: bigint,
  bidders: string[],
): Promise<number | null> {
  try {
    const states = await Promise.all(
      bidders.map((b) => reader.getBidState(roundId, b)),
    );
    return states.filter((s) => s.revealed_value != null).length;
  } catch {
    return null;
  }
}

export async function buildRoundStatus(
  args: BuildRoundStatusArgs,
): Promise<RoundStatusView> {
  const { reader, drand, roundId, watched, settlement = "none" } = args;
  const clock = args.clock ?? systemClock;
  const nowSeconds = args.nowSeconds ?? clock.nowSeconds();
  const ridStr = roundId.toString();

  let round;
  try {
    round = await reader.getRound(roundId);
  } catch (e) {
    const msg = getErrorMessage(e);
    const notFound = /RoundNotFound/i.test(msg);
    return {
      roundId: ridStr,
      status: notFound ? "NotFound" : "Unknown",
      phase: notFound ? "complete" : "awaiting-drand",
      nextAction: notFound ? "round does not exist" : "awaiting first keeper tick",
      commitDeadline: null,
      revealDeadline: null,
      revealRound: null,
      revealReady: false,
      commitClosed: false,
      revealWindowOpen: false,
      voidableAfter: null,
      bidderCount: null,
      revealedCount: null,
      winner: null,
      winningValue: null,
      clearingRule: null,
      settlement,
      lastKeeperAction: watched?.lastAction ?? null,
      lastError: watched?.lastError ?? null,
      retryCount: watched?.retryCount ?? 0,
      updatedAt: clock.toISOString(),
    };
  }

  const status = round.status.tag;
  const commitDeadline = Number(round.commit_deadline);
  const revealDeadline = Number(round.reveal_deadline);
  const revealRound = Number(round.reveal_round);
  const bidders = round.bidders ?? [];
  const revealedCount = await countRevealed(reader, roundId, bidders);

  const info = await drand.chain().info();
  const publishAtS = info.genesis_time + info.period * revealRound;

  const commitClosed = nowSeconds > commitDeadline;
  const revealWindowOpen =
    status === "Revealing" && nowSeconds <= revealDeadline;
  const voidableAfter = revealDeadline + VOID_GRACE_SECONDS;

  const phase = decideKeeperDryRunAction(
    { status: round.status, reveal_deadline: round.reveal_deadline },
    bidders.length,
    revealedCount,
    nowSeconds,
  );

  // R is the publisher clock: the keeper's signature-building step can only
  // happen once the Drand chain has reached R. We treat `now >= publishAtS`
  // as signal that R's signature is fetchable; an API replica may briefly lag.
  const revealReady = status === "Open" && nowSeconds >= publishAtS;

  let settlementIndicator = settlement;
  if (status === "Settled" || status === "Voided") {
    settlementIndicator = "terminal";
  }

  return {
    roundId: ridStr,
    status,
    phase: phase.currentPhase,
    nextAction: phase.nextAction,
    commitDeadline,
    revealDeadline,
    revealRound,
    revealReady,
    commitClosed,
    revealWindowOpen,
    voidableAfter,
    bidderCount: bidders.length,
    revealedCount,
    winner: round.winner ?? null,
    winningValue: round.winning_bid == null ? null : round.winning_bid.toString(),
    clearingRule: round.clearing_rule?.tag ?? null,
    settlement: settlementIndicator,
    lastKeeperAction: watched?.lastAction ?? null,
    lastError: watched?.lastError ?? null,
    retryCount: watched?.retryCount ?? 0,
    updatedAt: clock.toISOString(),
  };
}

async function signatureAvailable(
  drand: DrandClient,
  revealRound: number,
): Promise<boolean> {
  try {
    await fetchRoundSignature(drand, revealRound);
    return true;
  } catch {
    return false;
  }
}

export async function buildKeeperStatus(source: BuildStatusSource): Promise<KeeperStatusResponse> {
  const {
    reader,
    drand,
    storeRounds,
    contractId,
    network,
    settleIndicator,
    epochMs,
    nowSeconds,
  } = source;

  const { clock } = resolveTimeContext(systemTime, source.time);
  const health = await checkHealth(reader, drand, clock, source.logger);
  const nowMs = clock.nowMs();
  const startedAt = epochMs ?? nowMs;
  const watched = storeRounds();

  const rounds = await Promise.all(
    watched.map((w) =>
      buildRoundStatus({
        reader,
        drand,
        roundId: BigInt(w.roundId),
        watched: w,
        nowSeconds,
        clock,
        settlement: settleIndicator?.(BigInt(w.roundId)) ?? "none",
      }),
    ),
  );

  // Rounds that fail on-chain are still surfaced — we include any round whose
  // status is NotFound/Unknown so dashboards can see them rather than being
  // silently dropped. We just sort: active rounds first, then terminal.
  const statusOrder: Record<RoundStatus, number> = {
    Unknown: 0,
    Open: 1,
    Revealing: 2,
    Cleared: 3,
    Settled: 4,
    Voided: 5,
    NotFound: 6,
  };
  rounds.sort((a, b) => {
    const ao = statusOrder[a.status];
    const bo = statusOrder[b.status];
    if (ao !== bo) return ao - bo;
    return BigInt(a.roundId) < BigInt(b.roundId) ? -1 : 1;
  });

  return {
    contractId,
    network,
    uptimeSeconds: Math.max(0, Math.floor((nowMs - startedAt) / 1000)),
    rounds,
    health,
    now: clock.toISOString(),
  };
}

export async function checkHealth(
  reader: StatusReader,
  drand: DrandClient,
  clock: Clock = systemClock,
  logger: Logger = diagnostics,
): Promise<KeeperServiceHealth> {
  let rpc: "ok" | "degraded" | "down" = "ok";
  let drandStatus: "ok" | "degraded" | "down" = "ok";
  const reasons: string[] = [];

  try {
    await reader.getRound(0n);
  } catch (e) {
    const msg = getErrorMessage(e);
    if (/RoundNotFound|NotInitialized/i.test(msg)) {
    } else {
      rpc = "down";
      logger.error("keeper-health-rpc-probe-failed", "[keeper-health] rpc probe failed:", { "msg_0": msg });
      reasons.push("rpc: unavailable");
    }
  }

  try {
    await drand.chain().info();
  } catch (e) {
    drandStatus = "down";
    const msg = getErrorMessage(e);
    logger.error("keeper-health-drand-probe-failed", "[keeper-health] drand probe failed:", { "msg_0": msg });
    reasons.push("drand: unavailable");
  }

  const worst = rpc === "down" || drandStatus === "down" ? "down" : "ok";
  return {
    rpc,
    drand: drandStatus,
    ...(reasons.length ? { reason: reasons.join("; ") } : {}),
    checkedAt: clock.toISOString(),
  };
}
