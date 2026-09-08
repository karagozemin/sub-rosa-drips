// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { BidState, Round } from "@sub-rosa/sdk";

import {
  buildKeeperDryRunSummary,
  decideKeeperDryRunAction,
  parseKeeperRunConfig,
  type KeeperDryRunReader,
} from "./dry-run.js";

const CONTRACT_ID =
  "CCW67TSA3JH6KABMZAWOS6J2GKY6BKBJ5TKQAMM6P3EXZ7OAFM2TJ5BQ";

const baseRound = {
  auditor_pubkey: Buffer.alloc(32),
  bidders: ["G1", "G2"],
  clearing_rule: { tag: "HighestBid", values: undefined },
  commit_deadline: 100n,
  item_ref: Buffer.alloc(32),
  operator: "GOPERATOR",
  reveal_deadline: 1_000n,
  reveal_round: 42n,
  status: { tag: "Open", values: undefined },
  winner: undefined,
  winning_bid: 0n,
} as Round;

const bidState = (revealed: boolean): BidState => ({
  commitment: Buffer.alloc(32),
  escrow: 1n,
  revealed_nonce: revealed ? Buffer.alloc(32) : undefined,
  revealed_value: revealed ? 1n : undefined,
  settled: false,
  valid: revealed,
});

describe("parseKeeperRunConfig", () => {
  test("dry-run does not require KEEPER_SECRET", () => {
    const config = parseKeeperRunConfig({
      ROUND_CONTRACT_ID: CONTRACT_ID,
      KEEPER_DRY_RUN: "true",
      ROUND_ID: "7",
    });

    assert.equal(config.dryRun, true);
    assert.equal(config.keeperSecret, undefined);
    assert.equal(config.roundId, 7n);
  });

  test("normal mode keeps KEEPER_SECRET required", () => {
    assert.throws(
      () => parseKeeperRunConfig({ ROUND_CONTRACT_ID: CONTRACT_ID }),
      /missing required env var KEEPER_SECRET/,
    );
  });

  test("requires a contract id in every mode", () => {
    assert.throws(
      () => parseKeeperRunConfig({ KEEPER_DRY_RUN: "true" }),
      /missing required env var ROUND_CONTRACT_ID/,
    );
  });

  test("reports invalid dry-run and numeric values clearly", () => {
    assert.throws(
      () =>
        parseKeeperRunConfig({
          ROUND_CONTRACT_ID: CONTRACT_ID,
          KEEPER_DRY_RUN: "sometimes",
        }),
      /KEEPER_DRY_RUN must be one of/,
    );
    assert.throws(
      () =>
        parseKeeperRunConfig({
          ROUND_CONTRACT_ID: CONTRACT_ID,
          KEEPER_DRY_RUN: "true",
          ROUND_ID: "zero",
        }),
      /ROUND_ID must be a positive integer/,
    );
    assert.throws(
      () =>
        parseKeeperRunConfig({
          ROUND_CONTRACT_ID: CONTRACT_ID,
          KEEPER_DRY_RUN: "true",
          MAX_WAIT_SECONDS: "-1",
        }),
      /MAX_WAIT_SECONDS must be a non-negative finite number/,
    );
  });
});

describe("decideKeeperDryRunAction", () => {
  test("maps each lifecycle state to its next safe action", () => {
    assert.deepEqual(
      decideKeeperDryRunAction(baseRound, 2, 0, 500),
      {
        currentPhase: "awaiting-drand",
        nextAction: "open reveal when the configured Drand round is published",
      },
    );
    assert.deepEqual(
      decideKeeperDryRunAction(baseRound, 2, 0, 5_000),
      { currentPhase: "stale-open", nextAction: "void stale round" },
    );
    assert.deepEqual(
      decideKeeperDryRunAction(
        { ...baseRound, status: { tag: "Revealing", values: undefined } },
        2,
        1,
        500,
      ),
      { currentPhase: "revealing", nextAction: "reveal 1 pending bidder" },
    );
    assert.deepEqual(
      decideKeeperDryRunAction(
        { ...baseRound, status: { tag: "Revealing", values: undefined } },
        2,
        2,
        500,
      ),
      {
        currentPhase: "awaiting-clear",
        nextAction: "wait for reveal deadline 1000",
      },
    );
    assert.deepEqual(
      decideKeeperDryRunAction(
        { ...baseRound, status: { tag: "Revealing", values: undefined } },
        2,
        1,
        1_001,
      ),
      { currentPhase: "ready-to-clear", nextAction: "clear round" },
    );
    assert.deepEqual(
      decideKeeperDryRunAction(
        { ...baseRound, status: { tag: "Cleared", values: undefined } },
        2,
        2,
      ),
      { currentPhase: "ready-to-settle", nextAction: "settle round" },
    );
    assert.deepEqual(
      decideKeeperDryRunAction(
        { ...baseRound, status: { tag: "Settled", values: undefined } },
        2,
        2,
      ),
      { currentPhase: "complete", nextAction: "none — round settled" },
    );
    assert.deepEqual(
      decideKeeperDryRunAction(
        { ...baseRound, status: { tag: "Voided", values: undefined } },
        2,
        0,
      ),
      {
        currentPhase: "complete",
        nextAction: "none — round voided and escrow refunded",
      },
    );
  });
});

describe("buildKeeperDryRunSummary", () => {
  test("returns a structured summary without calling mutation methods", async () => {
    const reads: string[] = [];
    let mutations = 0;
    const sdk = {
      async getRound(roundId: bigint | number) {
        reads.push(`round:${roundId}`);
        return {
          ...baseRound,
          status: { tag: "Revealing", values: undefined },
        };
      },
      async getBidState(roundId: bigint | number, bidder: string) {
        reads.push(`bid:${roundId}:${bidder}`);
        return bidState(bidder === "G1");
      },
      async openReveal() {
        mutations += 1;
      },
      async reveal() {
        mutations += 1;
      },
      async clear() {
        mutations += 1;
      },
      async settle() {
        mutations += 1;
      },
      async void() {
        mutations += 1;
      },
    };

    const summary = await buildKeeperDryRunSummary(
      sdk as KeeperDryRunReader,
      7n,
      500,
    );

    assert.deepEqual(summary, {
      mode: "dry-run",
      roundId: 7n,
      status: "Revealing",
      drandRound: 42n,
      bidderCount: 2,
      revealedCount: 1,
      currentPhase: "revealing",
      nextAction: "reveal 1 pending bidder",
      transactionsSubmitted: 0,
    });
    assert.deepEqual(reads, ["round:7", "bid:7:G1", "bid:7:G2"]);
    assert.equal(mutations, 0);
  });

  test("keeps the summary usable when revealed counts are unavailable", async () => {
    const reader: KeeperDryRunReader = {
      async getRound() {
        return {
          ...baseRound,
          status: { tag: "Revealing", values: undefined },
        };
      },
      async getBidState() {
        throw new Error("bid state unavailable");
      },
    };

    const summary = await buildKeeperDryRunSummary(reader, 1n, 500);

    assert.equal(summary.revealedCount, null);
    assert.equal(summary.currentPhase, "revealing");
    assert.equal(
      summary.nextAction,
      "inspect bidder states and reveal pending bids",
    );
    assert.equal(summary.transactionsSubmitted, 0);
  });
});
