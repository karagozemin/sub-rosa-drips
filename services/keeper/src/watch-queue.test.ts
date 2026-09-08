// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { KeeperStore } from "./store.js";

describe("Watch Mode Queue / Store Integration", () => {
  const TEST_STORE_PATH = path.join(process.cwd(), ".test-keeper-watch-store.json");

  function cleanUp() {
    if (fs.existsSync(TEST_STORE_PATH)) {
      fs.unlinkSync(TEST_STORE_PATH);
    }
  }

  it("should resume rounds properly from the store", () => {
    cleanUp();
    const store = new KeeperStore(TEST_STORE_PATH);

    // Simulate previous run saving state
    store.addRound("10", { lastStatus: "Open", contractId: "C123" });
    store.addRound("11", { lastStatus: "Revealing", contractId: "C123" });

    // Simulate restart
    const resumedStore = new KeeperStore(TEST_STORE_PATH);
    const rounds = resumedStore.listRounds();

    assert.strictEqual(rounds.length, 2);
    assert.strictEqual(rounds[0].roundId, "10");
    assert.strictEqual(rounds[1].roundId, "11");

    // Active round filtering logic identical to watch.ts
    const activeRounds = rounds.filter((r) => {
      if (r.contractId && r.contractId !== "C123") return false;
      if (r.lastStatus === "Settled" || r.lastStatus === "Voided") return false;
      return true;
    });

    // Both should be resumed and active
    assert.strictEqual(activeRounds.length, 2);
    cleanUp();
  });

  it("should filter out completed rounds (Settled or Voided) from active polling", () => {
    cleanUp();
    const store = new KeeperStore(TEST_STORE_PATH);

    store.addRound("10", { lastStatus: "Open", contractId: "C123" });
    store.addRound("11", { lastStatus: "Settled", contractId: "C123" });
    store.addRound("12", { lastStatus: "Voided", contractId: "C123" });

    const rounds = store.listRounds();

    // All 3 remain in the store for record-keeping
    assert.strictEqual(rounds.length, 3);

    // Cleanup / Pruning from active poll:
    const activeRounds = rounds.filter((r) => {
      if (r.contractId && r.contractId !== "C123") return false;
      if (r.lastStatus === "Settled" || r.lastStatus === "Voided") return false;
      return true;
    });

    // Only round 10 should be polled
    assert.strictEqual(activeRounds.length, 1);
    assert.strictEqual(activeRounds[0].roundId, "10");
    cleanUp();
  });
});
