// Copyright (c) 2026 Sub Rosa contributors
// Permissionless reveal keeper.
//
// Once Drand round R is published, *anyone* can force a sealed round open and
// reveal every bid — no operator, no bidder cooperation. This keeper does
// exactly that, idempotently:
//
//   1. wait until round R is available,
//   2. open the reveal window with R's real Drand signature (verified on-chain),
//   3. read the deterministic bidder index, decrypt each seal with R,
//   4. submit each reveal.
//
// Every step tolerates "already done" states (another keeper, or the operator,
// may have acted first) by checking on-chain state first and treating the
// matching contract errors as skips rather than failures. No relayer, no agent,
// no mock — just the SDK over real RPC and the live Drand beacon.

import type { SubRosaClient } from "@sub-rosa/sdk";
import { getErrorMessage } from "@sub-rosa/errors";
import { openBid, fetchRoundSignature, type DrandClient } from "@sub-rosa/tlock";
import { compareRoundIds } from "./store.js";
import {
  resolveTimeContext,
  systemTime,
  type PartialTimeContext,
  type TimeContext,
} from "@sub-rosa/time";

export type KeeperLogger = (msg: string) => void;

export interface KeeperDeps {
  /** A funded signer. The keeper role is permissionless — any account works. */
  sdk: SubRosaClient;
  drand: DrandClient;
  log?: KeeperLogger;
  /** Max seconds to wait for round R. Default 0: act only if R is already out. */
  maxWaitSeconds?: number;
  /** Poll cadence while waiting for R (ms). Default 3000. */
  pollMs?: number;
  /** Injectable wall clock and scheduler. Default: systemTime. */
  time?: PartialTimeContext;
}

export interface SkipRecord {
  bidder: string;
  reason: string;
}

export interface KeeperResult {
  roundId: bigint;
  finalStatus: string;
  /** True if this run moved the round into Revealing (vs. it was already open). */
  openedReveal: boolean;
  revealed: string[];
  skipped: SkipRecord[];
}

// Contract error codes that mean "someone already did this" — safe to skip.
const IDEMPOTENT_OPEN = ["RevealAlreadyOpen", "WrongStatus", "AlreadyCleared"];
const IDEMPOTENT_REVEAL = ["AlreadyRevealed"];

export function errorName(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return getErrorMessage(e);
  }
}

export function errorMatches(e: unknown, names: string[]): boolean {
  let blob = errorName(e);
  try {
    blob += " " + JSON.stringify(e);
  } catch {
    /* ignore */
  }
  return names.some((n) => blob.includes(n));
}

function keeperTime(deps: KeeperDeps): TimeContext {
  return resolveTimeContext(systemTime, deps.time);
}

/** Wait until Drand round R should be published. Returns false if R is still in
 *  the future after `maxWaitSeconds`. */
export async function waitForRound(
  deps: KeeperDeps,
  round: number,
): Promise<boolean> {
  const { drand, log = () => {}, maxWaitSeconds = 0, pollMs = 3000 } = deps;
  const { clock, scheduler } = keeperTime(deps);
  const info = await drand.chain().info();
  const publishAtMs = (info.genesis_time + info.period * round) * 1000;
  const giveUpAtMs = clock.nowMs() + maxWaitSeconds * 1000;

  while (clock.nowMs() < publishAtMs) {
    if (clock.nowMs() >= giveUpAtMs) return false;
    const remainS = Math.ceil((publishAtMs - clock.nowMs()) / 1000);
    log(`waiting ~${remainS}s for Drand round ${round}…`);
    await scheduler.sleep(Math.min(pollMs, Math.max(250, publishAtMs - clock.nowMs())));
  }
  return true;
}

/** Run one full keeper pass over a round: open (if needed) + reveal all. */
export async function keepRound(
  deps: KeeperDeps,
  roundId: bigint | number,
): Promise<KeeperResult> {
  const { sdk, drand, log = () => {} } = deps;
  const rid = BigInt(roundId);
  const result: KeeperResult = {
    roundId: rid,
    finalStatus: "",
    openedReveal: false,
    revealed: [],
    skipped: [],
  };

  let round = await sdk.getRound(rid);
  log(`round ${rid}: status=${round.status.tag} R=${round.reveal_round}`);

  // ── Phase A: open the reveal window with R's real Drand signature ──────
  if (round.status.tag === "Open") {
    const R = Number(round.reveal_round);
    const available = await waitForRound(deps, R);
    if (!available) {
      log(`Drand round ${R} not published yet; nothing to open this pass`);
      result.finalStatus = round.status.tag;
      return result;
    }

    // R's wall-clock time has arrived, but an API replica may lag a beat before
    // it serves the beacon — retry briefly rather than bailing.
    const pollMs = deps.pollMs ?? 3000;
    let signature: Uint8Array | undefined;
    const { scheduler } = keeperTime(deps);
    for (let attempt = 0; attempt < 5 && !signature; attempt++) {
      try {
        signature = await fetchRoundSignature(drand, R);
      } catch (e) {
        log(`Drand round ${R} not servable yet (try ${attempt + 1}/5): ${errorName(e)}`);
        await scheduler.sleep(pollMs);
      }
    }
    if (!signature) {
      log(`gave up fetching Drand round ${R} this pass`);
      result.finalStatus = round.status.tag;
      return result;
    }

    try {
      await sdk.openReveal(rid, signature);
      result.openedReveal = true;
      log(`open_reveal OK (round ${rid} via Drand R=${R})`);
    } catch (e) {
      if (errorMatches(e, IDEMPOTENT_OPEN)) {
        log(`open_reveal already done (${errorName(e)}); continuing`);
      } else {
        throw e;
      }
    }
    round = await sdk.getRound(rid);
  }

  // ── Phase B: decrypt every seal and reveal it ─────────────────────────
  if (round.status.tag === "Revealing") {
    const bidders: string[] = [];
    for await (const addr of sdk.bidders(rid)) bidders.push(addr);
    log(`revealing ${bidders.length} bidder(s)`);

    for (const bidder of bidders) {
      let state;
      try {
        state = await sdk.getBidState(rid, bidder);
      } catch (e) {
        result.skipped.push({ bidder, reason: `state read failed: ${errorName(e)}` });
        continue;
      }
      // Option<i128> None decodes as null/undefined; a revealed bid is a bigint.
      if (state.revealed_value != null) {
        result.skipped.push({ bidder, reason: "already revealed" });
        continue;
      }

      const seal = await sdk.getSeal(rid, bidder);
      if (!seal) {
        result.skipped.push({ bidder, reason: "seal expired/absent" });
        continue;
      }

      let opened;
      try {
        opened = await openBid(new Uint8Array(seal.ciphertext), drand);
      } catch (e) {
        result.skipped.push({ bidder, reason: `decrypt failed: ${errorName(e)}` });
        continue;
      }

      try {
        await sdk.reveal({
          roundId: rid,
          bidder,
          value: opened.value,
          nonce: opened.nonce,
        });
        result.revealed.push(bidder);
        log(`revealed ${bidder} = ${opened.value}`);
      } catch (e) {
        if (errorMatches(e, IDEMPOTENT_REVEAL)) {
          result.skipped.push({ bidder, reason: "already revealed (race)" });
        } else if (errorMatches(e, ["HashMismatch"])) {
          // A reveal that does not hash to H is rejected by the contract; the
          // canonical value is whatever we decrypted, so this only happens for a
          // corrupt seal — record and move on.
          result.skipped.push({ bidder, reason: "hash mismatch (corrupt seal)" });
        } else if (errorMatches(e, ["RevealWindowClosed"])) {
          result.skipped.push({ bidder, reason: "reveal window closed" });
        } else {
          throw e;
        }
      }
    }
    round = await sdk.getRound(rid);
  } else if (round.status.tag !== "Open") {
    log(`round ${rid} is ${round.status.tag}; nothing to reveal`);
  }

  result.finalStatus = round.status.tag;
  return result;
}

export interface CloseResult {
  roundId: bigint;
  cleared: boolean;
  settled: boolean;
  voided: boolean;
  winner?: string;
  finalStatus: string;
  skipped: string[];
}

/** Drive a revealed round to completion: clear (after the reveal deadline) then
 *  settle. Permissionless and idempotent — re-running on an already cleared or
 *  settled round skips rather than erroring. */
export async function closeRound(
  deps: KeeperDeps,
  roundId: bigint | number,
): Promise<CloseResult> {
  const { sdk, log = () => {} } = deps;
  const { clock } = keeperTime(deps);
  const rid = BigInt(roundId);
  const result: CloseResult = {
    roundId: rid,
    cleared: false,
    settled: false,
    voided: false,
    winner: undefined,
    finalStatus: "",
    skipped: [],
  };

  let round = await sdk.getRound(rid);
  log(`round ${rid}: status=${round.status.tag} (close)`);

  // ── Phase C: clear once the reveal window has closed ──────────────────
  if (round.status.tag === "Revealing") {
    const now = clock.nowSeconds();
    if (now <= Number(round.reveal_deadline)) {
      result.skipped.push(`reveal window open until ${round.reveal_deadline}`);
      result.finalStatus = round.status.tag;
      return result;
    }
    try {
      const winner = await sdk.clear(rid);
      result.cleared = true;
      result.winner = winner;
      if (winner === undefined) {
        result.voided = true;
        log(`cleared → no valid bids; round voided + refunded`);
      } else {
        log(`cleared → winner ${winner}`);
      }
    } catch (e) {
      if (errorMatches(e, ["AlreadyCleared", "RevealStillOpen", "WrongStatus", "RoundVoided"])) {
        result.skipped.push(`clear skipped: ${errorName(e)}`);
      } else {
        throw e;
      }
    }
    round = await sdk.getRound(rid);
  }

  // ── Phase D: settle a cleared round (real SAC transfers) ──────────────
  if (round.status.tag === "Cleared") {
    try {
      await sdk.settle(rid);
      result.settled = true;
      log(`settled round ${rid}`);
    } catch (e) {
      if (errorMatches(e, ["AlreadySettled", "NotCleared", "WrongStatus"])) {
        result.skipped.push(`settle skipped: ${errorName(e)}`);
      } else {
        throw e;
      }
    }
    round = await sdk.getRound(rid);
  } else if (round.status.tag === "Settled") {
    result.skipped.push("already settled");
  } else if (round.status.tag === "Voided") {
    result.skipped.push("voided (escrow refunded at clear)");
  }

  if (result.winner === undefined && round.winner != null) {
    result.winner = round.winner;
  }
  result.finalStatus = round.status.tag;
  return result;
}

/** Matches `VOID_GRACE` in the Round contract (seconds after reveal_deadline). */
export const VOID_GRACE_SECONDS = 3600;

export interface VoidResult {
  roundId: bigint;
  voided: boolean;
  skipped: string[];
  finalStatus: string;
}

/** Liveness safety valve: void an Open round if R never arrived and grace elapsed. */
export async function voidIfStale(
  deps: KeeperDeps,
  roundId: bigint | number,
): Promise<VoidResult> {
  const { sdk, log = () => {} } = deps;
  const { clock } = keeperTime(deps);
  const rid = BigInt(roundId);
  const result: VoidResult = {
    roundId: rid,
    voided: false,
    skipped: [],
    finalStatus: "",
  };

  let round = await sdk.getRound(rid);
  if (round.status.tag !== "Open") {
    result.skipped.push(`status ${round.status.tag}`);
    result.finalStatus = round.status.tag;
    return result;
  }

  const now = clock.nowSeconds();
  const voidAfter = Number(round.reveal_deadline) + VOID_GRACE_SECONDS;
  if (now <= voidAfter) {
    result.skipped.push(`void not yet allowed until ${voidAfter}`);
    result.finalStatus = round.status.tag;
    return result;
  }

  try {
    await sdk.void(rid);
    result.voided = true;
    log(`voided round ${rid} (Drand liveness / grace elapsed)`);
  } catch (e) {
    if (errorMatches(e, ["NotVoidable", "WrongStatus", "AlreadyCleared"])) {
      result.skipped.push(errorName(e));
    } else {
      throw e;
    }
  }
  round = await sdk.getRound(rid);
  result.finalStatus = round.status.tag;
  return result;
}

/** Parse `1,2,5` or `1-5` into round ids. */
export function parseRoundIdSpec(spec: string): bigint[] {
  const ids = new Set<bigint>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (part.includes("-")) {
      const [a, b] = part.split("-", 2).map((s) => BigInt(s.trim()));
      for (let i = a; i <= b; i++) ids.add(i);
    } else {
      ids.add(BigInt(part));
    }
  }
  return [...ids].sort((x, y) => compareRoundIds(x, y));
}

export async function discoverRoundIds(
  reader: Pick<SubRosaClient, "getRound">,
  opts: { from?: bigint; maxProbe?: number } = {},
): Promise<bigint[]> {
  const from = opts.from ?? 1n;
  const maxProbe = opts.maxProbe ?? 64;
  const ids: bigint[] = [];
  for (let i = 0n; i < BigInt(maxProbe); i++) {
    const id = from + i;
    try {
      await reader.getRound(id);
      ids.push(id);
    } catch (e) {
      if (errorMatches(e, ["RoundNotFound"])) break;
      throw e;
    }
  }
  return ids;
}

export interface WatchTickResult {
  roundId: bigint;
  keep?: KeeperResult;
  close?: CloseResult;
  void?: VoidResult;
  finalStatus: string;
}

/** One non-blocking watch pass: void-if-stale → keep → close. */
export async function watchRound(
  deps: KeeperDeps,
  roundId: bigint | number,
): Promise<WatchTickResult> {
  const rid = BigInt(roundId);
  const tick: WatchTickResult = { roundId: rid, finalStatus: "" };

  const voidRes = await voidIfStale(deps, rid);
  if (voidRes.voided) tick.void = voidRes;

  let round = await deps.sdk.getRound(rid);
  if (round.status.tag === "Open" || round.status.tag === "Revealing") {
    tick.keep = await keepRound(
      { ...deps, maxWaitSeconds: 0 },
      rid,
    );
    round = await deps.sdk.getRound(rid);
  }

  if (
    round.status.tag === "Revealing" ||
    round.status.tag === "Cleared"
  ) {
    tick.close = await closeRound(deps, rid);
    round = await deps.sdk.getRound(rid);
  }

  tick.finalStatus = round.status.tag;
  return tick;
}
