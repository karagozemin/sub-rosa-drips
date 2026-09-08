// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeRoundId, normalizeSorobanContractId } from "./ids.js";

describe("normalizeRoundId", () => {
  it("accepts trimmed decimal strings and numeric values", () => {
    assert.equal(normalizeRoundId(" 42 "), 42n);
    assert.equal(normalizeRoundId("001"), 1n);
    assert.equal(normalizeRoundId(7), 7n);
    assert.equal(normalizeRoundId(7n), 7n);
    assert.equal(normalizeRoundId(1), 1n);
    assert.equal(normalizeRoundId(1n), 1n);
    assert.equal(normalizeRoundId(Number.MAX_SAFE_INTEGER), BigInt(Number.MAX_SAFE_INTEGER));
    assert.equal(normalizeRoundId(BigInt(Number.MAX_SAFE_INTEGER) + 100n), BigInt(Number.MAX_SAFE_INTEGER) + 100n);
  });

  it("rejects malformed values with explicit errors", () => {
    assert.throws(() => normalizeRoundId(""), /roundId/);
    assert.throws(() => normalizeRoundId("   "), /roundId/);
    assert.throws(() => normalizeRoundId("0"), /positive integer/);
    assert.throws(() => normalizeRoundId("-1"), /positive integer/);
    assert.throws(() => normalizeRoundId("1.5"), /positive integer/);
    assert.throws(() => normalizeRoundId("abc"), /positive integer/);
    assert.throws(() => normalizeRoundId("0x10"), /positive integer/);
    assert.throws(() => normalizeRoundId("+5"), /positive integer/);
  });

  it("rejects zero and negative number or bigint inputs", () => {
    assert.throws(() => normalizeRoundId(0), /positive integer/);
    assert.throws(() => normalizeRoundId(-1), /positive integer/);
    assert.throws(() => normalizeRoundId(-42), /positive integer/);
    assert.throws(() => normalizeRoundId(0n), /positive integer/);
    assert.throws(() => normalizeRoundId(-1n), /positive integer/);
    assert.throws(() => normalizeRoundId(-42n), /positive integer/);
  });

  it("rejects unsafe, fractional, and non-finite numbers", () => {
    assert.throws(() => normalizeRoundId(1.5), /positive integer/);
    assert.throws(() => normalizeRoundId(0.1), /positive integer/);
    assert.throws(() => normalizeRoundId(NaN), /positive integer/);
    assert.throws(() => normalizeRoundId(Infinity), /positive integer/);
    assert.throws(() => normalizeRoundId(-Infinity), /positive integer/);
    assert.throws(() => normalizeRoundId(Number.MAX_SAFE_INTEGER + 1), /positive integer/);
    assert.throws(() => normalizeRoundId(Number.MAX_SAFE_INTEGER + 2), /positive integer/);
    assert.throws(() => normalizeRoundId(Number.MIN_SAFE_INTEGER), /positive integer/);
  });
});

describe("normalizeSorobanContractId", () => {
  it("trims and canonicalizes valid contract ids", () => {
    const source = "CCW67TSA3JH6KABMZAWOS6J2GKY6BKBJ5TKQAMM6P3EXZ7OAFM2TJ5BQ";
    assert.equal(normalizeSorobanContractId(`  ${source.toLowerCase()}  `), source);
  });

  it("rejects malformed or empty contract ids", () => {
    assert.throws(() => normalizeSorobanContractId(""), /contractId/);
    assert.throws(() => normalizeSorobanContractId("   "), /contractId/);
    assert.throws(() => normalizeSorobanContractId("not-a-contract-id"), /contractId/);
    assert.throws(() => normalizeSorobanContractId("CCW67TSA3JH6KABMZAWOS6J2GKY6BKBJ5TKQAMM6P3EXZ7OAFM2TJ5BQ!"), /contractId/);
    assert.throws(() => normalizeSorobanContractId("C123"), /contractId/);
  });
});

describe("normalizeRoundId numeric boundaries", () => {
  for (const value of [0, -0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, 0n, -1n]) {
    it(`rejects ${String(value)} (${typeof value})`, () => {
      assert.throws(() => normalizeRoundId(value), /roundId must be a positive/);
    });
  }
  it("preserves safe numbers and arbitrary-precision positive bigint/string IDs", () => {
    assert.equal(normalizeRoundId(1), 1n);
    assert.equal(normalizeRoundId(Number.MAX_SAFE_INTEGER), BigInt(Number.MAX_SAFE_INTEGER));
    const large = 2n ** 100n;
    assert.equal(normalizeRoundId(large), large);
    assert.equal(normalizeRoundId(large.toString()), large);
  });
});
