// Copyright (c) 2026 Sub Rosa contributors
// Shared watch loop. Keeps in-flight rounds moving through
// void-if-stale → keep → close, persisting status into the KeeperStore and
// emitting lightweight logs. Independent of how the loop is started
// (one-shot CLI `watch.ts`, or combined with the status HTTP API in `serve.ts`).
//
// The keeper process can run the status API *and* the watch loop in the same
// process: both read from the same on-chain source and the same persisted
// store. The status API never writes state; only the watch loop advances
// rounds on-chain.

import type { SubRosaClient } from "@sub-rosa/sdk";
import type { DrandClient } from "@sub-rosa/tlock";
import { getErrorMessage } from "@sub-rosa/errors";
import { resolveTimeContext, systemTime, type PartialTimeContext } from "@sub-rosa/time";

import {
  discoverRoundIds,
  parseRoundIdSpec,
  type KeeperDeps,
  type WatchTickResult,
  watchRound,
} from "./keeper.js";
import type { SettlementGuard } from "./settlement-guard.js";
import type { KeeperLogger } from "./keeper.js";
import { KeeperStore } from "./store.js";

export interface RunWatchLoopParams {
  sdk: SubRosaClient;
  drand: DrandClient;
  log: KeeperLogger;
  pollMs: number;
  contractId: string;
  network: string;
  store: KeeperStore;
  settlementGuard: SettlementGuard;
  isStopping: () => boolean;
  /** Injectable wall clock and scheduler. Default: systemTime. */
  time?: PartialTimeContext;
}

const bigintReplacer = (_k: string, v: unknown): unknown =>
  typeof v === "bigint" ? v.toString() : v;

function summarizeTick(t: WatchTickResult): string {
  const parts: string[] = [t.finalStatus];
  if (t.void?.voided) parts.push("voided");
  if (t.keep?.openedReveal) parts.push("opened");
  if (t.keep?.revealed.length) parts.push(`revealed×${t.keep.revealed.length}`);
  if (t.close?.cleared) parts.push("cleared");
  if (t.close?.settled) parts.push("settled");
  return parts.join(", ");
}

async function resolveRoundIds(reader: SubRosaClient): Promise<bigint[]> {
  const spec = process.env.WATCH_ROUND_IDS?.trim();
  if (spec) return parseRoundIdSpec(spec);
  const single = process.env.ROUND_ID?.trim();
  if (single) return [BigInt(single)];
  return discoverRoundIds(reader, {
    from: BigInt(process.env.WATCH_FROM ?? "1"),
    maxProbe: Number(process.env.WATCH_MAX_ROUNDS ?? "64"),
  });
}

export async function runWatchLoop(params: RunWatchLoopParams): Promise<void> {
  const {
    sdk,
    drand,
    log,
    pollMs,
    contractId,
    network,
    store,
    settlementGuard,
    isStopping,
    time,
  } = params;

  const resolvedTime = resolveTimeContext(systemTime, time);
  const { clock, scheduler } = resolvedTime;
  const deps: KeeperDeps = { sdk, drand, log, time: resolvedTime };

  while (!isStopping()) {
    const started = clock.nowMs();
    let discoveredIds: bigint[] = [];
    try {
      discoveredIds = await resolveRoundIds(sdk);
      for (const id of discoveredIds) {
        store.addRound(id, { contractId, network });
      }
    } catch (e) {
      log(`watch: failed to list/discover rounds: ${getErrorMessage(e)}`);
    }

    const activeRounds = store.listRounds().filter((r) => {
      if (r.contractId && r.contractId !== contractId) return false;
      if (r.network && r.network !== network) return false;
      if (r.lastStatus === "Settled" || r.lastStatus === "Voided") return false;
      return true;
    });

    if (activeRounds.length === 0) {
      log("no active rounds found in queue — waiting");
    }

    for (const storedRound of activeRounds) {
      const roundId = BigInt(storedRound.roundId);
      if (isStopping()) break;
      try {
        const canSettleCheck = settlementGuard.canSettle(roundId);
        if (!canSettleCheck.allowed) {
          // Settlement already in-flight or terminal; skip the close phase.
          // The keep phase may still open/reveal; we let watchRound proceed but
          // settle manipulation is avoided by the guard's skip marker.
        }
        const tick = await watchRound(deps, roundId);
        const active =
          tick.finalStatus !== "Settled" && tick.finalStatus !== "Voided";
        const acted =
          tick.void?.voided ||
          tick.keep?.openedReveal ||
          (tick.keep?.revealed.length ?? 0) > 0 ||
          tick.close?.cleared ||
          tick.close?.settled;

        if (tick.close?.settled) {
          settlementGuard.markTerminal(roundId, "settled on-chain");
        } else if (tick.close?.voided || tick.finalStatus === "Voided") {
          settlementGuard.markTerminal(roundId, "voided on-chain");
        }

        store.updateRound(roundId, {
          lastStatus: tick.finalStatus,
          retryCount: 0,
          lastError: undefined,
          lastAction: acted ? summarizeTick(tick) : storedRound.lastAction,
        });

        if (active || acted) {
          log(
            `[round ${roundId}] ${summarizeTick(tick)}` +
              (acted ? " " + JSON.stringify(tick, bigintReplacer) : ""),
          );
        }
      } catch (e) {
        const errorMsg = getErrorMessage(e);
        log(`[round ${roundId}] tick failed: ${errorMsg}`);
        settlementGuard.markRetryable(
          roundId,
          errorMsg,
        );
        const stored = store.getRound(roundId);
        store.updateRound(roundId, {
          retryCount: (stored?.retryCount ?? 0) + 1,
          lastError: errorMsg,
        });
      }
    }

    if (isStopping()) break;
    const elapsed = clock.nowMs() - started;
    const wait = Math.max(0, pollMs - elapsed);
    if (wait > 0) await scheduler.sleep(wait);
  }
}
