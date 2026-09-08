// Copyright (c) 2026 Sub Rosa contributors
// queue-replay.test.ts
//
// Fixture-driven replay test for the keeper queue.  Exercises the queue
// processing contract (store + settlement-guard integration) by replaying a
// deterministic set of rounds with known states and expected outcomes.
//
// Coverage:
//   - Stable processing order  (rounds processed by roundId asc)
//   - Duplicate round-id suppression (store merges, does not duplicate)
//   - Terminal-round filtering (Settled / Voided rounds are not processed)
//   - Full queue replay       (each active round produces the expected
//     sequence of actions and state transitions)
//
// All tests are fully offline — no RPC, no Drand, no live network.

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { KeeperStore } from "./store.js";
import { createSettlementGuard, type SettlementGuard } from "./settlement-guard.js";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/** A round in the replay fixture. */
interface FixtureRound {
  roundId: bigint;
  /** The on-chain status the mock SDK should return for this round. */
  status: string;
}

/** An action recorded during queue replay. */
interface ReplayAction {
  roundId: bigint;
  kind:
    | "process" // keeper tick executed
    | "skip-terminal" // skipped because status is Settled/Voided
    | "settle-skip-duplicate" // settlement guard blocked a duplicate settle
    | "store-updated"; // store was updated after processing
  statusBefore: string;
  statusAfter: string;
}

/**
 * Fixture rounds in deliberately non-sorted order to test ordering.
 *
 * Round 1: Open       → will be processed (active)
 * Round 2: Revealing  → will be processed (active)
 * Round 3: Cleared    → will be processed (active)
 * Round 4: Settled    → terminal, skipped
 * Round 5: Voided     → terminal, skipped
 */
const FIXTURE: FixtureRound[] = [
  { roundId: 4n, status: "Settled" },
  { roundId: 1n, status: "Open" },
  { roundId: 5n, status: "Voided" },
  { roundId: 3n, status: "Cleared" },
  { roundId: 2n, status: "Revealing" },
];

// Expected active rounds in processing order (skipping Settled/Voided).
const EXPECTED_PROCESSING_ORDER = [1n, 2n, 3n];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_STORE_PATH = path.join(
  process.cwd(),
  ".test-queue-replay-store.json",
);

function cleanUp() {
  if (fs.existsSync(TEST_STORE_PATH)) {
    fs.unlinkSync(TEST_STORE_PATH);
  }
}

/** Determine whether a status is terminal (keeper should skip it). */
function isTerminalStatus(status: string): boolean {
  return status === "Settled" || status === "Voided";
}

/** Simulate one pass of keeper processing for a single round.  Records the
 *  action taken and returns the status the round transitions to.
 *
 *  This is a stand-in for the real keeper.ts `watchRound()` — it keeps the
 *  test deterministic by driving state transitions from the fixture rather
 *  than from real on-chain RPC calls.
 *
 *  NOTE: Terminal rounds are handled by `processQueue` and never reach this
 *  function, so we don't check for them here.
 */
async function simulateProcessRound(
  roundId: bigint,
  currentStatus: string,
  settlementGuard: SettlementGuard,
  actions: ReplayAction[],
): Promise<string> {
  // ── Simulate keeper actions based on current status ────────────────────
  let nextStatus = currentStatus;

  if (currentStatus === "Open") {
    // voidIfStale + keepRound (open + reveal)
    nextStatus = "Revealing";
  }

  // keepRound reveals; closeRound checks reveal deadline
  // For fixture purposes: if we're now "Revealing", proceed to clear.
  if (currentStatus === "Revealing" || nextStatus === "Revealing") {
    nextStatus = "Cleared";
  }

  // closeRound: settle a cleared round (real SAC transfers)
  if (currentStatus === "Cleared" || nextStatus === "Cleared") {
    // Guard against duplicate settles.
    const check = settlementGuard.canSettle(roundId);
    if (!check.allowed) {
      actions.push({
        roundId,
        kind: "settle-skip-duplicate",
        statusBefore: currentStatus,
        statusAfter: currentStatus,
      });
      return currentStatus;
    }

    // Only mark submitted when we actually "dispatch" a settle.
    // Use nextStatus here because the round may have cascaded from Open
    // through Revealing to Cleared (currentStatus would still be "Open"
    // but nextStatus tracks the evolving state).
    if (nextStatus === "Cleared") {
      settlementGuard.markSubmitted(roundId);
      nextStatus = "Settled";
      settlementGuard.markTerminal(roundId, "settled via fixture replay");
    }
  }

  actions.push({
    roundId,
    kind: "process",
    statusBefore: currentStatus,
    statusAfter: nextStatus,
  });

  return nextStatus;
}

/** Populate a store from the fixture. */
function populateStore(store: KeeperStore, fixture: FixtureRound[]): void {
  for (const r of fixture) {
    store.addRound(r.roundId, {
      lastStatus: r.status,
      contractId: "CTEST",
    });
  }
}

/** Run one round of queue processing and record actions. */
async function processQueue(
  store: KeeperStore,
  settlementGuard: SettlementGuard,
  contractId: string,
  actions: ReplayAction[],
): Promise<void> {
  const allRounds = store.listRounds().filter((r) => {
    if (r.contractId !== contractId) return false;
    return true;
  });

  for (const stored of allRounds) {
    const roundId = BigInt(stored.roundId);
    const statusBefore = stored.lastStatus;

    // Handle terminal rounds at the queue level: emit a skip action and
    // move on without calling simulateProcessRound.
    if (isTerminalStatus(statusBefore)) {
      actions.push({
        roundId,
        kind: "skip-terminal",
        statusBefore,
        statusAfter: statusBefore,
      });
      continue;
    }

    const statusAfter = await simulateProcessRound(
      roundId,
      statusBefore,
      settlementGuard,
      actions,
    );

    store.updateRound(roundId, { lastStatus: statusAfter });
    actions.push({
      roundId,
      kind: "store-updated",
      statusBefore,
      statusAfter,
    });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Queue fixture replay", () => {
  let store: KeeperStore;
  let guard: SettlementGuard;

  beforeEach(() => {
    cleanUp();
    store = new KeeperStore(TEST_STORE_PATH);
    guard = createSettlementGuard();
  });

  afterEach(cleanUp);

  // ── 1. Stable processing order ─────────────────────────────────────────

  it("orders active rounds by roundId in ascending order", () => {
    // Add rounds in reverse order.
    store.addRound(5n, { lastStatus: "Open" });
    store.addRound(3n, { lastStatus: "Open" });
    store.addRound(1n, { lastStatus: "Open" });
    store.addRound(4n, { lastStatus: "Open" });
    store.addRound(2n, { lastStatus: "Open" });

    const rounds = store.listRounds();
    assert.equal(rounds.length, 5);
    assert.equal(rounds[0].roundId, "1");
    assert.equal(rounds[1].roundId, "2");
    assert.equal(rounds[2].roundId, "3");
    assert.equal(rounds[3].roundId, "4");
    assert.equal(rounds[4].roundId, "5");
  });

  // ── 2. Duplicate round-id suppression ──────────────────────────────────

  it("suppresses duplicate round IDs — merges instead of duplicating", () => {
    store.addRound(42n, { lastStatus: "Open", contractId: "C1" });
    // Same round, different metadata — should merge, not duplicate.
    store.addRound(42n, { lastStatus: "Revealing", retryCount: 3 });

    const rounds = store.listRounds();
    assert.equal(rounds.length, 1, "must not create duplicate entries");
    assert.equal(rounds[0].roundId, "42");
    assert.equal(rounds[0].lastStatus, "Revealing", "last write wins");
    assert.equal(rounds[0].contractId, "C1", "original field preserved");
    assert.equal(rounds[0].retryCount, 3, "new field added");
  });

  it("does not double-count rounds when status is updated", () => {
    store.addRound(7n, { lastStatus: "Open" });
    store.addRound(8n, { lastStatus: "Revealing" });
    assert.equal(store.listRounds().length, 2);

    // Update round 7 — should not add a new entry.
    store.updateRound(7n, { lastStatus: "Cleared" });
    assert.equal(store.listRounds().length, 2);
    assert.equal(store.getRound(7n)?.lastStatus, "Cleared");
  });

  // ── 3. Terminal round filtering ────────────────────────────────────────

  it("filters Settled and Voided rounds from active processing", () => {
    populateStore(store, FIXTURE);

    const activeRounds = store.listRounds().filter((r) => {
      if (isTerminalStatus(r.lastStatus)) return false;
      return true;
    });

    assert.equal(activeRounds.length, 3, "expected 3 active rounds");
    const activeIds = activeRounds.map((r) => BigInt(r.roundId)).sort();
    assert.deepEqual(activeIds, EXPECTED_PROCESSING_ORDER);
  });

  // ── 4. Full queue replay ───────────────────────────────────────────────

  it("replays the fixture and produces the expected deterministic action sequence", async () => {
    populateStore(store, FIXTURE);

    const actions: ReplayAction[] = [];
    await processQueue(store, guard, "CTEST", actions);

    // Verify store structure after replay.
    assert.equal(store.listRounds().length, 5, "all 5 fixture rounds remain");

    // Verify only active rounds have their status advanced.
    const round1 = store.getRound(1n)!;
    assert.equal(
      round1.lastStatus,
      "Settled",
      "round 1 should have advanced from Open to Settled",
    );

    const round4 = store.getRound(4n)!;
    assert.equal(
      round4.lastStatus,
      "Settled",
      "round 4 started terminal and stayed Settled",
    );

    const round5 = store.getRound(5n)!;
    assert.equal(
      round5.lastStatus,
      "Voided",
      "round 5 started terminal and stayed Voided",
    );

    // Check that processing order matches expected.
    const processedRounds = actions
      .filter((a) => a.kind === "process")
      .map((a) => a.roundId);
    assert.deepEqual(
      processedRounds,
      EXPECTED_PROCESSING_ORDER,
      "active rounds processed in expected order",
    );

    // Check that terminal rounds were skipped.
    const skippedRounds = actions
      .filter((a) => a.kind === "skip-terminal")
      .map((a) => a.roundId);
    assert.deepEqual(
      skippedRounds.sort((a, b) => Number(a - b)),
      [4n, 5n],
      "terminal rounds were skipped",
    );
  });

  // ── 5. Duplicate settlement suppression via guard ──────────────────────

  it("does not settle the same round twice across replay cycles", async () => {
    // Start with a single Cleared round.
    store.addRound(10n, { lastStatus: "Cleared", contractId: "CTEST" });

    const actions: ReplayAction[] = [];

    // First cycle — should process and settle.
    await processQueue(store, guard, "CTEST", actions);

    const settleActions1 = actions.filter(
      (a) => a.kind === "process" && a.roundId === 10n,
    );
    assert.equal(settleActions1.length, 1, "round 10 processed once");

    // Second cycle — round is now Settled, should be skipped.
    actions.length = 0;
    await processQueue(store, guard, "CTEST", actions);

    const skipActions = actions.filter(
      (a) => a.kind === "skip-terminal" && a.roundId === 10n,
    );
    assert.ok(
      skipActions.length > 0,
      "second cycle should skip Settled round",
    );

    // Verify guard has the terminal entry.
    const entry = guard.getEntry(10n);
    assert.ok(entry, "guard should have an entry for round 10");
    assert.equal(entry!.status, "terminal");
  });

  it("guard prevents duplicate settle attempts within the same cycle", async () => {
    // Simulate: round has already been submitted (e.g. concurrent keeper).
    store.addRound(20n, { lastStatus: "Cleared", contractId: "CTEST" });
    guard.markSubmitted(20n); // Another keeper already submitted settle.

    const actions: ReplayAction[] = [];
    await processQueue(store, guard, "CTEST", actions);

    // The simulateProcessRound should see canSettle=false and emit
    // settle-skip-duplicate instead of a regular process action.
    const duplicateSkips = actions.filter(
      (a) => a.kind === "settle-skip-duplicate",
    );
    assert.ok(
      duplicateSkips.length > 0,
      "should emit settle-skip-duplicate when guard blocks",
    );

    // Round status in store should not have advanced to Settled.
    const round = store.getRound(20n)!;
    assert.equal(round.lastStatus, "Cleared", "store should not advance on guard block");
  });

  // ── 6. Cross-cycle state persistence ───────────────────────────────────

  it("preserves processing state across multiple queue replays", async () => {
    // Cycle 1: add rounds, process.
    store.addRound(30n, { lastStatus: "Open", contractId: "CTEST" });
    store.addRound(31n, { lastStatus: "Settled", contractId: "CTEST" });

    const cycle1: ReplayAction[] = [];
    await processQueue(store, guard, "CTEST", cycle1);

    const processed1 = cycle1.filter((a) => a.kind === "process");
    assert.equal(processed1.length, 1, "only round 30 processed");
    assert.equal(processed1[0]!.roundId, 30n);

    // Cycle 2: add another round, process again.
    store.addRound(32n, { lastStatus: "Cleared", contractId: "CTEST" });

    const cycle2: ReplayAction[] = [];
    await processQueue(store, guard, "CTEST", cycle2);

    // Round 30 should be terminal now (settled in cycle 1), so skipped.
    const processed2 = cycle2.filter((a) => a.kind === "process");
    const skipped2 = cycle2.filter((a) => a.kind === "skip-terminal");

    // Round 30 went through Open → Revealing → Cleared → Settled in cycle 1.
    // In cycle 2 it's Settled → skip.
    assert.ok(
      skipped2.some((a) => a.roundId === 30n),
      "round 30 should be skipped in cycle 2",
    );
    // Round 32 is Cleared → process.
    assert.ok(
      processed2.some((a) => a.roundId === 32n),
      "round 32 should be processed in cycle 2",
    );
  });
});
