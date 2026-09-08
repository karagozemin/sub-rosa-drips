// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  APPRAISAL_MODEL,
  AppraisalInputError,
  appraise,
  inputsHash,
  parseAppraisalRequest,
} from "./appraisal.js";

test("appraisal is deterministic — identical inputs give identical output", () => {
  const req = {
    itemRef: "sub-rosa://grant/42",
    basePrice: 100,
    category: "grant",
    attributes: { quality: 80, demand: 60, scarcity: 40, risk: 20 },
  };
  const a = appraise(req);
  const b = appraise(req);
  assert.deepEqual(a, b);
  assert.equal(a.model, APPRAISAL_MODEL);
});

test("inputsHash ignores property order (canonical form)", () => {
  const h1 = inputsHash({ itemRef: "x", basePrice: 10, attributes: { demand: 1, quality: 2 } });
  const h2 = inputsHash({ basePrice: 10, attributes: { quality: 2, demand: 1 }, itemRef: "x" } as never);
  assert.equal(h1, h2);
});

test("higher risk lowers value; higher quality/demand/scarcity raises it", () => {
  const base = { itemRef: "i", basePrice: 100 };
  const lowRisk = appraise({ ...base, attributes: { risk: 0 } });
  const highRisk = appraise({ ...base, attributes: { risk: 100 } });
  assert.ok(highRisk.fairValue < lowRisk.fairValue);

  const weak = appraise({ ...base, attributes: { quality: 0, demand: 0, scarcity: 0 } });
  const strong = appraise({ ...base, attributes: { quality: 100, demand: 100, scarcity: 100 } });
  assert.ok(strong.fairValue > weak.fairValue);
});

test("confidence increases with the number of supplied attributes", () => {
  const base = { itemRef: "i", basePrice: 100 };
  const none = appraise(base);
  const all = appraise({ ...base, attributes: { quality: 50, demand: 50, scarcity: 50, risk: 50 } });
  assert.equal(none.confidence, 0.5);
  assert.equal(all.confidence, 1.0);
  // Wider band when less certain.
  assert.ok(none.high - none.low > all.high - all.low);
});

test("suggested max bid never exceeds fair value (preserves margin)", () => {
  const a = appraise({
    itemRef: "i",
    basePrice: 250,
    attributes: { quality: 90, demand: 90, scarcity: 90, risk: 10 },
  });
  assert.ok(a.suggestedMaxBid <= a.fairValue);
  assert.ok(a.low <= a.fairValue && a.fairValue <= a.high);
});

test("unknown category falls back to a neutral multiplier", () => {
  const known = appraise({ itemRef: "i", basePrice: 100, category: "spectrum" });
  const unknown = appraise({ itemRef: "i", basePrice: 100, category: "does-not-exist" });
  const none = appraise({ itemRef: "i", basePrice: 100 });
  assert.equal(unknown.fairValue, none.fairValue);
  assert.ok(known.fairValue > none.fairValue);
});

test("parseAppraisalRequest validates and clamps", () => {
  assert.throws(() => parseAppraisalRequest(null), AppraisalInputError);
  assert.throws(() => parseAppraisalRequest({ basePrice: 1 }), AppraisalInputError);
  assert.throws(() => parseAppraisalRequest({ itemRef: "x", basePrice: 0 }), AppraisalInputError);
  assert.throws(() => parseAppraisalRequest({ itemRef: "x", basePrice: -5 }), AppraisalInputError);
  assert.throws(
    () => parseAppraisalRequest({ itemRef: "x", basePrice: 1, attributes: { quality: "hi" } }),
    AppraisalInputError,
  );

  const parsed = parseAppraisalRequest({
    itemRef: "x",
    basePrice: 10,
    attributes: { quality: 250, risk: -10 },
  });
  assert.equal(parsed.attributes?.quality, 100);
  assert.equal(parsed.attributes?.risk, 0);
});
