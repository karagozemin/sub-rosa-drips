// Copyright (c) 2026 Sub Rosa contributors
// settlement-guard.test.ts
//
// Tests for Issue #79 — keeper duplicate-settlement suppression.
//
// All tests are fully offline: no RPC, no real transactions, no Drand.
// The keeper is exercised through the SettlementGuard helper directly, and
// through a thin mock of the closeRound / settle code-path that mirrors
// keeper.ts's actual state-machine logic.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createSettlementGuard } from "./settlement-guard.js";
import type {
  DuplicateSkipEvent,
  SettlementGuard,
} from "./settlement-guard.js";

// ---------------------------------------------------------------------------
// Minimal mock helpers
// ---------------------------------------------------------------------------

/** Build a fake on-chain round object at a given status tag. */
function mockRound(tag: string) {
  return {
    status: { tag },
    reveal_round: 1n,
    reveal_deadline: BigInt(1_700_000_000 - 3600),
    winner: tag === "Cleared" ? "GABC" : undefined,
  };
}

/**
 * A tiny simulation of the settle phase in keeper.ts's closeRound, wired
 * through a SettlementGuard.  Returns a structured description of what
 * happened so tests can assert without parsing log strings.
 */
async function simulateSettle(
  guard: SettlementGuard,
  roundId: bigint,
  opts: {
    onChainStatus: string;
    /** If provided, sdk.settle() throws this error. */
    settleThrows?: Error;
    log?: (msg: string) => void;
  },
): Promise<{
  settled: boolean;
  skipped: boolean;
  skipEvent?: DuplicateSkipEvent;
  retriedAsRetryable: boolean;
  finalGuardStatus: string;
}> {
  const log = opts.log ?? (() => {});
  const result = {
    settled: false,
    skipped: false,
    skipEvent: undefined as DuplicateSkipEvent | undefined,
    retriedAsRetryable: false,
    finalGuardStatus: "",
  };

  // Mirror the guard check that a real keeper would do before sdk.settle().
  const check = guard.canSettle(roundId);
  if (!check.allowed) {
    result.skipped = true;
    result.skipEvent = check.event;
    log(
      `[settlement_skipped_duplicate] round=${roundId} reason=${check.event.skippedDuplicateReason} lastReason=${check.event.lastReason}`,
    );
    result.finalGuardStatus = guard.getEntry(roundId)!.status;
    return result;
  }

  // On-chain terminal statuses: guard them without dispatching a tx.
  if (opts.onChainStatus === "Settled" || opts.onChainStatus === "Voided") {
    guard.markTerminal(roundId, `on-chain status is ${opts.onChainStatus}`);
    result.finalGuardStatus = guard.getEntry(roundId)!.status;
    return result;
  }

  // Attempt settlement.
  guard.markSubmitted(roundId);
  try {
    if (opts.settleThrows) throw opts.settleThrows;
    // Mock successful settle — no real tx.
    result.settled = true;
    guard.markTerminal(roundId, "settled ok");
    log(`settled round ${roundId}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Classify: AlreadySettled is terminal; other errors are retryable.
    if (msg.includes("AlreadySettled") || msg.includes("WrongStatus")) {
      guard.markTerminal(roundId, `skipped: ${msg}`);
      result.skipped = true;
    } else {
      guard.markRetryable(roundId, msg);
      result.retriedAsRetryable = true;
    }
  }

  result.finalGuardStatus = guard.getEntry(roundId)!.status;
  return result;
}

// ---------------------------------------------------------------------------
// 1. Guard state-machine unit tests
// ---------------------------------------------------------------------------

describe("SettlementGuard state machine", () => {
  it("allows the first settlement attempt (pending → submitted → terminal)", () => {
    const guard = createSettlementGuard();
    const id = 1n;

    // Before any call, canSettle allows.
    const first = guard.canSettle(id);
    assert.equal(first.allowed, true);

    // After markSubmitted, canSettle blocks.
    guard.markSubmitted(id);
    const second = guard.canSettle(id);
    assert.equal(second.allowed, false);
    if (!second.allowed) {
      assert.equal(second.event.skippedDuplicateReason, "submitted");
      assert.equal(second.event.event, "settlement_skipped_duplicate");
      assert.equal(second.event.roundId, "1");
    }

    // After markTerminal, canSettle still blocks with "terminal".
    guard.markTerminal(id, "settled ok");
    const third = guard.canSettle(id);
    assert.equal(third.allowed, false);
    if (!third.allowed) {
      assert.equal(third.event.skippedDuplicateReason, "terminal");
    }
  });

  it("skips a round already in submitted status (duplicate observation)", () => {
    const guard = createSettlementGuard();
    const id = 42n;

    guard.markSubmitted(id);

    const check = guard.canSettle(id);
    assert.equal(check.allowed, false);
    if (!check.allowed) {
      assert.equal(check.event.skippedDuplicateReason, "submitted");
      assert.equal(check.event.roundId, "42");
      // Structured event must carry the field name the issue requires.
      assert.ok(
        "skippedDuplicateReason" in check.event,
        "event must include skippedDuplicateReason",
      );
    }
  });

  it("skips a terminal round without attempting another settle", () => {
    const guard = createSettlementGuard();
    const id = 7n;

    guard.markTerminal(id, "settled via concurrent keeper");

    const check = guard.canSettle(id);
    assert.equal(check.allowed, false);
    if (!check.allowed) {
      assert.equal(check.event.skippedDuplicateReason, "terminal");
      assert.equal(check.event.lastReason, "settled via concurrent keeper");
    }
  });

  it("makes a failed attempt retryable — does not permanently suppress it", () => {
    const guard = createSettlementGuard();
    const id = 99n;

    // Simulate: submitted, then a network timeout.
    guard.markSubmitted(id);
    guard.markRetryable(id, "rpc timeout");

    // Must be allowed again on the next polling cycle.
    const check = guard.canSettle(id);
    assert.equal(check.allowed, true, "retryable round must be re-allowed");
    assert.equal(guard.getEntry(id)!.status, "pending");
    assert.match(guard.getEntry(id)!.reason, /retryable/);
  });

  it("does not bleed state between independent rounds", () => {
    const guard = createSettlementGuard();

    guard.markSubmitted(10n);
    guard.markTerminal(10n, "settled ok");

    // Round 11 and 12 must remain independently settable.
    assert.equal(guard.canSettle(11n).allowed, true);
    assert.equal(guard.canSettle(12n).allowed, true);

    // Round 10 must still be terminal.
    assert.equal(guard.canSettle(10n).allowed, false);
  });

  it("getEntry returns undefined for an untracked round", () => {
    const guard = createSettlementGuard();
    assert.equal(guard.getEntry(999n), undefined);
  });

  it("entries() reflects all tracked rounds in insertion order", () => {
    const guard = createSettlementGuard();
    guard.canSettle(3n); // triggers getOrCreate
    guard.canSettle(1n);
    guard.canSettle(2n);

    const ids = guard.entries().map((e) => e.roundId);
    assert.deepEqual(ids, [3n, 1n, 2n]);
  });
});

// ---------------------------------------------------------------------------
// 2. Duplicate-settlement simulation tests (mirrors keeper.ts's settle phase)
// ---------------------------------------------------------------------------

describe("Keeper duplicate-settlement suppression (simulated)", () => {
  it("does not attempt a duplicate settle when the same round is observed twice", async () => {
    const guard = createSettlementGuard();
    const id = 5n;

    // First observation — round is Cleared, settle succeeds.
    const first = await simulateSettle(guard, id, { onChainStatus: "Cleared" });
    assert.equal(first.settled, true);
    assert.equal(first.skipped, false);

    // Second observation — same round, same polling cycle.
    const second = await simulateSettle(guard, id, { onChainStatus: "Cleared" });
    assert.equal(second.settled, false);
    assert.equal(second.skipped, true);
    assert.ok(second.skipEvent, "must emit a skip event");
    assert.equal(second.skipEvent!.skippedDuplicateReason, "terminal");
    assert.equal(second.finalGuardStatus, "terminal");
  });

  it("skips settlement when the round is already terminal on-chain (Settled)", async () => {
    const guard = createSettlementGuard();
    const id = 8n;

    const res = await simulateSettle(guard, id, { onChainStatus: "Settled" });
    // No tx dispatched (settled = false); guard moves to terminal.
    assert.equal(res.settled, false);
    assert.equal(res.finalGuardStatus, "terminal");
  });

  it("skips settlement when the round is already terminal on-chain (Voided)", async () => {
    const guard = createSettlementGuard();
    const id = 9n;

    const res = await simulateSettle(guard, id, { onChainStatus: "Voided" });
    assert.equal(res.settled, false);
    assert.equal(res.finalGuardStatus, "terminal");
  });

  it("contract AlreadySettled error marks the round terminal, not retryable", async () => {
    const guard = createSettlementGuard();
    const id = 15n;

    const res = await simulateSettle(guard, id, {
      onChainStatus: "Cleared",
      settleThrows: new Error("AlreadySettled"),
    });
    assert.equal(res.skipped, true);
    assert.equal(res.retriedAsRetryable, false);
    assert.equal(res.finalGuardStatus, "terminal");

    // And a subsequent observation must also be skipped.
    const again = await simulateSettle(guard, id, { onChainStatus: "Cleared" });
    assert.equal(again.skipped, true);
    assert.ok(again.skipEvent);
    assert.equal(again.skipEvent!.skippedDuplicateReason, "terminal");
  });

  it("retryable network error resets to pending so next cycle can retry", async () => {
    const guard = createSettlementGuard();
    const id = 20n;

    const first = await simulateSettle(guard, id, {
      onChainStatus: "Cleared",
      settleThrows: new Error("rpc connection timeout"),
    });
    assert.equal(first.retriedAsRetryable, true);
    assert.equal(first.finalGuardStatus, "pending");

    // Next cycle: allowed to retry.
    const retry = await simulateSettle(guard, id, { onChainStatus: "Cleared" });
    assert.equal(retry.settled, true);
    assert.equal(retry.finalGuardStatus, "terminal");
  });

  it("independent rounds are never affected by each other's state", async () => {
    const guard = createSettlementGuard();

    // Settle round 30 and mark it terminal.
    await simulateSettle(guard, 30n, { onChainStatus: "Cleared" });
    assert.equal(guard.getEntry(30n)!.status, "terminal");

    // Rounds 31 and 32 must still be allowed.
    const r31 = await simulateSettle(guard, 31n, { onChainStatus: "Cleared" });
    const r32 = await simulateSettle(guard, 32n, { onChainStatus: "Cleared" });

    assert.equal(r31.settled, true);
    assert.equal(r32.settled, true);

    // Round 30 is still blocked.
    const r30again = await simulateSettle(guard, 30n, {
      onChainStatus: "Cleared",
    });
    assert.equal(r30again.skipped, true);
  });

  it("skip event includes skippedDuplicateReason and roundId as a string", async () => {
    const guard = createSettlementGuard();
    const id = 77n;

    guard.markTerminal(id, "pre-settled externally");

    const check = guard.canSettle(id);
    assert.equal(check.allowed, false);
    if (!check.allowed) {
      const ev = check.event;
      assert.equal(typeof ev.roundId, "string", "roundId must be a string");
      assert.ok(
        "skippedDuplicateReason" in ev,
        "event must have skippedDuplicateReason field",
      );
      assert.equal(ev.event, "settlement_skipped_duplicate");
      assert.equal(ev.skippedDuplicateReason, "terminal");
      assert.equal(ev.lastReason, "pre-settled externally");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Bounded-retry regression guard
// ---------------------------------------------------------------------------

describe("Bounded retry invariant", () => {
  it("a round that always fails stays retryable — never permanently suppressed", async () => {
    const guard = createSettlementGuard();
    const id = 50n;
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const res = await simulateSettle(guard, id, {
        onChainStatus: "Cleared",
        settleThrows: new Error("transient rpc error"),
      });
      assert.equal(
        res.retriedAsRetryable,
        true,
        `attempt ${attempt + 1} must remain retryable`,
      );
      assert.equal(
        guard.getEntry(id)!.status,
        "pending",
        `guard must be pending after attempt ${attempt + 1}`,
      );
    }
  });
});