// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeTime } from "@sub-rosa/time";

import { Keypair } from "@stellar/stellar-sdk";

import {
  assertAppraisalSpendAllowed,
  assertBidWithinMandate,
  bidFromAppraisal,
  createSessionMandate,
  mandateDigest,
  MandateCapError,
  MandateError,
  remainingAppraisalSpend,
  stroopsToUsdc,
  usdcToStroops,
  verifySessionMandate,
} from "./mandate.js";

const baseParams = () => {
  const principal = Keypair.random();
  const session = Keypair.random();
  const { clock } = createFakeTime(1_700_000_000_000);
  return {
    principalSecret: principal.secret(),
    principalPub: principal.publicKey(),
    sessionSecret: session.secret(),
    contractId: "CCONTRACT123456789012345678901234567890123456789012345678901234",
    roundId: 1n,
    itemRef: "sub-rosa://demo/item",
    basePriceUsdc: 500,
    category: "spectrum" as const,
    maxBidStroops: usdcToStroops(100),
    maxEscrowStroops: usdcToStroops(120),
    maxAppraisalSpendStroops: usdcToStroops(1),
    appraisalPriceStroops: usdcToStroops(0.1),
    commitDeadline: clock.nowSeconds() + 3600,
    clock,
  };
};

test("createSessionMandate + verifySessionMandate round-trip", () => {
  const p = baseParams();
  const { mandate } = createSessionMandate(p);
  verifySessionMandate(mandate, {
    contractId: p.contractId,
    roundId: p.roundId,
    clock: p.clock,
  });
  assert.equal(mandate.principal, p.principalPub);
});

test("tampered mandate fails verification", () => {
  const p = baseParams();
  const { mandate } = createSessionMandate(p);
  mandate.maxBidStroops = String(usdcToStroops(999));
  assert.throws(() => verifySessionMandate(mandate, { clock: p.clock }), MandateError);
});

test("assertBidWithinMandate enforces maxBid and bid<=escrow", () => {
  const { mandate } = createSessionMandate(baseParams());
  assert.throws(
    () => assertBidWithinMandate(mandate, usdcToStroops(150), usdcToStroops(150)),
    MandateCapError,
  );
  assert.throws(
    () => assertBidWithinMandate(mandate, usdcToStroops(50), usdcToStroops(40)),
    MandateCapError,
  );
  assert.doesNotThrow(() =>
    assertBidWithinMandate(mandate, usdcToStroops(50), usdcToStroops(50)),
  );
});

test("assertAppraisalSpendAllowed caps per-call and cumulative spend", () => {
  const { mandate } = createSessionMandate(baseParams());
  assert.throws(
    () => assertAppraisalSpendAllowed(mandate, usdcToStroops(0.2)),
    MandateCapError,
  );
  assert.throws(
    () => assertAppraisalSpendAllowed(mandate, usdcToStroops(0.1), usdcToStroops(0.95)),
    MandateCapError,
  );
});

test("bidFromAppraisal clamps to mandate maxBid", () => {
  const p = baseParams();
  p.maxBidStroops = usdcToStroops(40);
  p.maxEscrowStroops = usdcToStroops(50);
  const { mandate } = createSessionMandate(p);
  const { bidValue, escrow } = bidFromAppraisal(999, mandate);
  assert.equal(bidValue, usdcToStroops(40));
  assert.equal(escrow, usdcToStroops(40));
});

test("usdcToStroops converts and hardens input", () => {
  assert.equal(usdcToStroops(1), 10_000_000n);
  assert.equal(usdcToStroops(0.1), 1_000_000n);
  assert.equal(usdcToStroops(0), 0n);
  assert.throws(() => usdcToStroops(Number.NaN), MandateError);
  assert.throws(() => usdcToStroops(Number.POSITIVE_INFINITY), MandateError);
  assert.throws(() => usdcToStroops(-1), MandateError);
});

test("stroopsToUsdc converts and hardens input", () => {
  assert.equal(stroopsToUsdc(10_000_000n), 1);
  assert.equal(stroopsToUsdc(1_500_000n), 0.15);
  assert.equal(stroopsToUsdc(0n), 0);
  assert.throws(() => stroopsToUsdc(123 as unknown as bigint), MandateError);
  assert.throws(() => stroopsToUsdc(-1n), MandateError);
});

test("remainingAppraisalSpend tracks remaining budget", () => {
  const p = baseParams();
  p.maxAppraisalSpendStroops = usdcToStroops(1);
  const { mandate } = createSessionMandate(p);
  assert.equal(remainingAppraisalSpend(mandate), usdcToStroops(1));
  assert.equal(
    remainingAppraisalSpend(mandate, usdcToStroops(0.4)),
    usdcToStroops(0.6),
  );
  assert.throws(
    () => remainingAppraisalSpend(mandate, usdcToStroops(1.5)),
    MandateCapError,
  );
  assert.throws(
    () => remainingAppraisalSpend(mandate, -1n as unknown as bigint),
    MandateError,
  );
});

test("createSessionMandate rejects unsafe numeric fields", () => {
  const p = baseParams();
  assert.throws(
    () => createSessionMandate({ ...p, basePriceUsdc: Number.NaN }),
    (error: unknown) => error instanceof MandateError && error.message === "invalid mandate basePriceUsdc",
  );
  assert.throws(
    () => createSessionMandate({ ...p, commitDeadline: p.commitDeadline + 0.5 }),
    (error: unknown) => error instanceof MandateError && error.message === "invalid mandate commitDeadline",
  );
  assert.throws(
    () => createSessionMandate({ ...p, roundId: 1.5 }),
    (error: unknown) => error instanceof MandateError && error.message === "invalid mandate roundId",
  );
});

test("verifySessionMandate rejects a signed mandate with unsafe fields", () => {
  const p = baseParams();
  const { mandate } = createSessionMandate(p);
  const { signature: _signature, ...payload } = mandate;
  const malformed = {
    ...payload,
    basePriceUsdc: Number.MAX_SAFE_INTEGER + 1,
    signature: Keypair.fromSecret(p.principalSecret)
      .sign(mandateDigest({ ...payload, basePriceUsdc: Number.MAX_SAFE_INTEGER + 1 }))
      .toString("base64"),
  };
  assert.throws(
    () => verifySessionMandate(malformed, { clock: p.clock }),
    (error: unknown) => error instanceof MandateError && error.message === "invalid mandate basePriceUsdc",
  );
});

test("verifySessionMandate rejects malformed stroop strings", () => {
  const p = baseParams();
  const { mandate } = createSessionMandate(p);
  const { signature: _signature, ...payload } = mandate;
  const malformedPayload = { ...payload, maxBidStroops: "1.5" };
  const malformed = {
    ...malformedPayload,
    signature: Keypair.fromSecret(p.principalSecret)
      .sign(mandateDigest(malformedPayload))
      .toString("base64"),
  };
  assert.throws(
    () => verifySessionMandate(malformed, { clock: p.clock }),
    (error: unknown) => error instanceof MandateError && error.message === "invalid mandate maxBidStroops",
  );
});

test("verifySessionMandate rejects when issuedAt > expiresAt", () => {
  const p = baseParams();
  const { mandate } = createSessionMandate(p);
  const { signature: _sig, ...payload } = mandate;
  const tamperedPayload = { ...payload, issuedAt: payload.expiresAt + 10 };
  const tampered = {
    ...tamperedPayload,
    signature: Keypair.fromSecret(p.principalSecret).sign(mandateDigest(tamperedPayload)).toString("base64"),
  };
  assert.throws(
    () => verifySessionMandate(tampered, { clock: p.clock }),
    (error: unknown) => error instanceof MandateError && /issuedAt.*expiresAt/.test((error as Error).message),
  );
});

test("verifySessionMandate rejects when issuedAt > commitDeadline", () => {
  const p = baseParams();
  const { mandate } = createSessionMandate(p);
  const { signature: _sig, ...payload } = mandate;
  const tamperedPayload = { ...payload, commitDeadline: payload.issuedAt - 10 };
  const tampered = {
    ...tamperedPayload,
    signature: Keypair.fromSecret(p.principalSecret).sign(mandateDigest(tamperedPayload)).toString("base64"),
  };
  assert.throws(
    () => verifySessionMandate(tampered, { clock: p.clock }),
    (error: unknown) => error instanceof MandateError && /issuedAt.*commitDeadline/.test((error as Error).message),
  );
});

test("verifySessionMandate rejects when commitDeadline > expiresAt", () => {
  const p = baseParams();
  const { mandate } = createSessionMandate(p);
  const { signature: _sig, ...payload } = mandate;
  const tamperedPayload = { ...payload, commitDeadline: payload.expiresAt + 10 };
  const tampered = {
    ...tamperedPayload,
    signature: Keypair.fromSecret(p.principalSecret).sign(mandateDigest(tamperedPayload)).toString("base64"),
  };
  assert.throws(
    () => verifySessionMandate(tampered, { clock: p.clock }),
    (error: unknown) => error instanceof MandateError && /commitDeadline.*expiresAt/.test((error as Error).message),
  );
});

test("verifySessionMandate allows equality boundaries (issuedAt == commitDeadline == expiresAt)", () => {
  const p = baseParams();
  // Make commitDeadline equal to expiresAt at creation (already is), then tamper to set all three equal
  const { mandate } = createSessionMandate(p);
  const { signature: _sig, ...payload } = mandate;
  const equalTime = payload.expiresAt;
  const tamperedPayload = { ...payload, issuedAt: equalTime, commitDeadline: equalTime, expiresAt: equalTime };
  const tampered = {
    ...tamperedPayload,
    signature: Keypair.fromSecret(p.principalSecret).sign(mandateDigest(tamperedPayload)).toString("base64"),
  };
  assert.doesNotThrow(() => verifySessionMandate(tampered, { clock: p.clock }));
});

test("createSessionMandate rejects timestamp ordering violations at creation", () => {
  const p = baseParams();
  assert.throws(
    () => createSessionMandate({ ...p, commitDeadline: p.clock.nowSeconds() - 10 }),
    (error: unknown) => error instanceof MandateError && /issuedAt.*commitDeadline/.test((error as Error).message),
  );
  assert.throws(
    () => createSessionMandate({ ...p, commitDeadline: p.clock.nowSeconds() + 7200, ttlSeconds: 3600 }),
    (error: unknown) => error instanceof MandateError && /commitDeadline.*expiresAt/.test((error as Error).message),
  );
});
