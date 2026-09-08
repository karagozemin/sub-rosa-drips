// Copyright (c) 2026 Sub Rosa contributors
/**
 * Smoke test for the sealed-auction template (fixture / offline mode).
 *
 * Uses only node: built-ins — no @noble/hashes, no stellar-sdk, no network.
 * Avoids the pre-existing ERR_PACKAGE_PATH_NOT_EXPORTED issue caused by
 * @stellar/stellar-sdk → @noble/hashes/sha256 (legacy subpath) in Node ≥ 22.
 *
 * What is tested:
 *   1. The golden.json fixture is readable and has the expected receipt shape.
 *   2. Each bid entry has the expected sealed-bid / receipt fields.
 *   3. Commitment hash is verifiable offline using node:crypto sha256.
 *   4. Winner matches the highest bid in the fixture.
 *   5. The template process (FIXTURE=1) exits 0 and emits FIXTURE PASSED.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

// ---------------------------------------------------------------------------
// Helpers (mirrors @sub-rosa/tlock commitment logic without importing it)
// ---------------------------------------------------------------------------

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Encode a bid preimage the same way the contract does:
 *  sha256( be16(value) ‖ nonce )
 *  where be16 = value as a big-endian signed 16-byte integer.
 */
function computeCommitment(value: bigint, nonceHex: string): string {
  // big-endian 16-byte signed representation
  const buf = Buffer.alloc(16, 0);
  let v = value;
  for (let i = 15; i >= 0; i--) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  const nonce = Buffer.from(nonceHex, "hex");
  const preimage = Buffer.concat([buf, nonce]);
  return sha256Hex(preimage);
}

// ---------------------------------------------------------------------------
// Deterministic fixture (same file the template reads at runtime)
// ---------------------------------------------------------------------------
const FIXTURE_PATH = resolve(
  import.meta.dirname,
  "../../services/receipt-cli/src/fixtures/golden.json",
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

function loadFixture(): AnyObj {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as AnyObj;
}

// ---------------------------------------------------------------------------
// 1. Fixture file is readable and has the expected receipt shape
// ---------------------------------------------------------------------------
test("fixture: loads and has expected receipt shape", () => {
  const receipt = loadFixture();

  assert.strictEqual(receipt.version, 1, "version must be 1");
  assert.ok(typeof receipt.roundId === "string", "roundId must be a string");
  assert.ok(typeof receipt.clearingRule === "string", "clearingRule must be a string");
  assert.ok(typeof receipt.status === "string", "status must be a string");
  assert.ok(Array.isArray(receipt.bidders), "bidders must be an array");
  assert.ok(receipt.bidders.length > 0, "bidders array must be non-empty");
  assert.ok(typeof receipt.bids === "object" && receipt.bids !== null, "bids must be an object");

  // Deterministic round inputs
  assert.ok(typeof receipt.revealRound === "number", "revealRound must be a number");
  assert.ok(typeof receipt.commitDeadline === "string", "commitDeadline must be a string");
  assert.ok(typeof receipt.revealDeadline === "string", "revealDeadline must be a string");
  assert.ok(typeof receipt.itemRef === "string", "itemRef must be a string");
  assert.ok(typeof receipt.operator === "string", "operator must be a string");
});

// ---------------------------------------------------------------------------
// 2. Each bid entry has expected sealed-bid / receipt fields
// ---------------------------------------------------------------------------
test("fixture: each bid has commitment, escrow, and evidence", () => {
  const receipt = loadFixture();

  for (const bidder of receipt.bidders as string[]) {
    const bid = receipt.bids[bidder] as AnyObj | undefined;
    assert.ok(bid !== undefined, `bid entry missing for bidder ${bidder}`);
    assert.ok(
      typeof bid.commitment === "string" && /^[0-9a-f]{64}$/i.test(bid.commitment),
      `commitment must be 64-hex-char string for ${bidder}`,
    );
    assert.ok(typeof bid.escrow === "string", `escrow must be a string for ${bidder}`);
    assert.ok(
      typeof bid.evidence === "object" && bid.evidence !== null,
      `evidence missing for ${bidder}`,
    );
    // sealed-bid evidence shape: ciphertext key must exist (may be null for void bids)
    assert.ok("ciphertext" in bid.evidence, `evidence.ciphertext key missing for ${bidder}`);
  }
});

// ---------------------------------------------------------------------------
// 3. Commitment hash is verifiable offline (deterministic nonce + value)
// ---------------------------------------------------------------------------
test("fixture: commitment hash matches sha256(be16(value) || nonce) for every revealed bid", () => {
  const receipt = loadFixture();

  for (const bidder of receipt.bidders as string[]) {
    const bid = receipt.bids[bidder] as AnyObj;
    if (bid.revealedValue == null || bid.nonce == null) continue; // unrevealed — skip

    const value = BigInt(bid.revealedValue as string);
    const recomputed = computeCommitment(value, bid.nonce as string);
    assert.strictEqual(
      recomputed,
      (bid.commitment as string).toLowerCase(),
      `commitment mismatch for bidder ${bidder}: got ${recomputed}, expected ${bid.commitment}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Winner matches the highest bid (HighestBid clearing rule)
// ---------------------------------------------------------------------------
test("fixture: declared winner matches computed winner for HighestBid rule", () => {
  const receipt = loadFixture();
  assert.strictEqual(receipt.clearingRule, "HighestBid", "test assumes HighestBid rule");

  let bestAddr: string | null = null;
  let bestVal: bigint | null = null;

  for (const bidder of receipt.bidders as string[]) {
    const bid = receipt.bids[bidder] as AnyObj;
    if (!bid.valid || bid.revealedValue == null) continue;
    const v = BigInt(bid.revealedValue as string);
    if (bestVal === null || v > bestVal) {
      bestVal = v;
      bestAddr = bidder;
    }
  }

  assert.ok(bestAddr !== null, "at least one valid revealed bid must exist");
  assert.strictEqual(
    bestAddr,
    receipt.winner as string,
    `computed winner ${bestAddr} must match declared winner ${receipt.winner}`,
  );
  assert.strictEqual(
    String(bestVal),
    receipt.winningValue as string,
    "winning value must match",
  );
});

// ---------------------------------------------------------------------------
// 5. Template process smoke: FIXTURE=1 exits 0, prints expected output
// ---------------------------------------------------------------------------
test("template: fixture mode exits 0 and emits expected output", () => {
  const stdout = execFileSync(
    process.execPath,
    ["--import", "tsx", "sealed-auction.ts"],
    {
      cwd: resolve(import.meta.dirname),
      env: { ...process.env, FIXTURE: "1" },
      encoding: "utf8",
      timeout: 20_000,
    },
  );

  // Core pass signal
  assert.ok(
    stdout.includes("FIXTURE PASSED"),
    `Expected "FIXTURE PASSED" in stdout, got:\n${stdout}`,
  );
  // Phase sections exist (output shape)
  assert.ok(stdout.includes("Phase 1"), "Expected Phase 1 section");
  assert.ok(stdout.includes("Phase 5"), "Expected Phase 5 section");
  // Receipt verification passed
  assert.ok(stdout.includes("verdict: PASS"), "Expected verdict: PASS in output");
  // Receipt-oriented output: winner line present
  assert.ok(stdout.includes("computed winner:"), "Expected computed winner line");
});
