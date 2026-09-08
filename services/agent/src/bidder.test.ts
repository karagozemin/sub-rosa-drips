// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";

import { Keypair } from "@stellar/stellar-sdk";

import { bidFromAppraisal, createSessionMandate, usdcToStroops } from "./mandate.js";
import { createFakeTime } from "@sub-rosa/time";

test("two agents with different appraisal inputs produce different bid sizes under same cap", () => {
  const { clock } = createFakeTime(1_700_000_000_000);
  const common = {
    contractId: "CCONTRACT123456789012345678901234567890123456789012345678901234",
    roundId: 7n,
    itemRef: "sub-rosa://rfp/x",
    basePriceUsdc: 500,
    category: "spectrum" as const,
    maxBidStroops: usdcToStroops(200),
    maxEscrowStroops: usdcToStroops(200),
    maxAppraisalSpendStroops: usdcToStroops(1),
    appraisalPriceStroops: usdcToStroops(0.1),
    commitDeadline: clock.nowSeconds() + 3600,
    clock,
  };

  // Suggested max bids (USDC) that stay under the shared cap and differ.
  const strongSuggested = 75;
  const weakSuggested = 35;

  const m1 = createSessionMandate({ ...common, principalSecret: Keypair.random().secret() }).mandate;
  const m2 = createSessionMandate({ ...common, principalSecret: Keypair.random().secret() }).mandate;

  const b1 = bidFromAppraisal(strongSuggested, m1);
  const b2 = bidFromAppraisal(weakSuggested, m2);
  assert.ok(b1.bidValue > b2.bidValue);
  assert.ok(b1.bidValue <= usdcToStroops(200));
  assert.ok(b2.bidValue <= usdcToStroops(200));
});
