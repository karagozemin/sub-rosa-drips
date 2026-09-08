// Copyright (c) 2026 Sub Rosa contributors
// Schema-fixture tests.
//
// These tests pin the *shape* and the *user-displayable error strings* of the
// appraisal API validation layer. Anything an integrator needs to display or
// generate a request from gets covered here, because the fixtures double as
// documentation.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  APPRAISAL_MODEL,
  AppraisalInputError,
  MAX_CATEGORY_LENGTH,
  MAX_ITEMREF_LENGTH,
  appraise,
  inputsHash,
  parseAppraisalRequest,
} from "./appraisal.js";
import {
  invalidScoreValues,
  missingFields,
  oversizedText,
  validRequest,
  validResponse,
  wrongTypes,
} from "./fixtures/index.js";

/**
 * Capture the error thrown by `fn`. `assert.throws` (without the validator
 * form) returns `void`, which TypeScript flags as an error — so we use this
 * thin helper to drive the same assertions ergonomically.
 */
function captureError(fn: () => void): Error {
  try {
    fn();
  } catch (e) {
    if (e instanceof Error) return e;
    throw new Error(`expected an Error, got ${typeof e}: ${String(e)}`);
  }
  throw new Error("expected function to throw, but it returned normally");
}

describe("appraisal schema fixtures load", () => {
  test("every fixture parses as JSON", () => {
    for (const f of [
      validRequest,
      validResponse,
      missingFields,
      wrongTypes,
      oversizedText,
      invalidScoreValues,
    ]) {
      assert.equal(typeof f.value, "object");
      assert.ok(f.value !== null, `fixture ${f.description} must be an object`);
      assert.match(f.path, /\.json$/);
    }
  });

  test("valid-response carries the appraisal model id", () => {
    assert.equal(validResponse.value.model, APPRAISAL_MODEL);
  });

  test("valid-response inputsHash matches the canonical request hash", () => {
    // Re-hash directly from the request fixture so any drift in the canonical
    // serializer is caught immediately.
    assert.equal(
      validResponse.value.inputsHash,
      inputsHash(validRequest.value as never),
    );
  });
});

describe("valid request fixture", () => {
  test("parses cleanly and preserves the canonical inputsHash", () => {
    const parsed = parseAppraisalRequest(validRequest.value as never);
    assert.equal(parsed.itemRef, "sub-rosa://grant/42");
    assert.equal(parsed.basePrice, 100);
    assert.equal(parsed.category, "grant");
    assert.equal(inputsHash(parsed), inputsHash(validRequest.value as never));
  });

  test("produces the exact appraisal the response fixture documents", () => {
    const appraisal = appraise(parseAppraisalRequest(validRequest.value as never));
    assert.equal(appraisal.fairValue, 121.42);
    assert.equal(appraisal.low, 121.42);
    assert.equal(appraisal.high, 121.42);
    assert.equal(appraisal.confidence, 1);
    assert.equal(appraisal.suggestedMaxBid, 115.35);
    assert.equal(appraisal.itemRef, validRequest.value.itemRef);
    assert.equal(appraisal.inputsHash, validResponse.value.inputsHash);
    assert.equal(appraisal.rationale.length, 4);
  });
});

describe("missing fields fixture", () => {
  test("rejects with a stable error message naming itemRef", () => {
    const err = captureError(() => parseAppraisalRequest(missingFields.value));
    assert.ok(err instanceof AppraisalInputError);
    assert.equal(err.message, "itemRef must be a non-empty string");
  });
});

describe("wrong types fixture — full validation cascade", () => {
  test("first field check (itemRef) reports the type violation", () => {
    const err = captureError(() => parseAppraisalRequest(wrongTypes.value));
    assert.ok(err instanceof AppraisalInputError);
    assert.equal(err.message, "itemRef must be a non-empty string");
  });

  test("with itemRef repaired, basePrice type violation surfaces next", () => {
    const patched = {
      itemRef: "ok",
      basePrice: wrongTypes.value.basePrice, // "100"
      category: wrongTypes.value.category,
      attributes: wrongTypes.value.attributes,
    };
    const err = captureError(() => parseAppraisalRequest(patched));
    assert.ok(err instanceof AppraisalInputError);
    assert.equal(err.message, "basePrice must be a finite number > 0");
  });

  test("category as object surfaces `category must be a string`", () => {
    const err = captureError(() =>
      parseAppraisalRequest({
        itemRef: "ok",
        basePrice: 100,
        category: wrongTypes.value.category, // { name: "grant" }
      }),
    );
    assert.ok(err instanceof AppraisalInputError);
    assert.equal(err.message, "category must be a string");
  });

  test("attributes as bare string surfaces `attributes must be an object`", () => {
    const err = captureError(() =>
      parseAppraisalRequest({
        itemRef: "ok",
        basePrice: 100,
        attributes: wrongTypes.value.attributes, // "high"
      }),
    );
    assert.ok(err instanceof AppraisalInputError);
    assert.equal(err.message, "attributes must be an object");
  });
});

describe("oversized text fixture", () => {
  test("rejects itemRef strings past the documented length bound", () => {
    const itemRef = (oversizedText.value as { itemRef: string }).itemRef;
    assert.ok(itemRef.length > MAX_ITEMREF_LENGTH, "fixture must exceed bound");

    const err = captureError(() => parseAppraisalRequest(oversizedText.value));
    assert.ok(err instanceof AppraisalInputError);
    assert.equal(
      err.message,
      `itemRef must be at most ${MAX_ITEMREF_LENGTH} characters`,
    );
  });

  test("category length bound is enforced when itemRef is valid", () => {
    const oversizedCategory = {
      itemRef: "ok",
      basePrice: 100,
      category: "x".repeat(MAX_CATEGORY_LENGTH + 1),
    };
    const err = captureError(() => parseAppraisalRequest(oversizedCategory));
    assert.ok(err instanceof AppraisalInputError);
    assert.equal(
      err.message,
      `category must be at most ${MAX_CATEGORY_LENGTH} characters`,
    );
  });

  test("exactly-MAX_ITEMREF_LENGTH itemRef is accepted (off-by-one guard)", () => {
    const req = parseAppraisalRequest({
      itemRef: "a".repeat(MAX_ITEMREF_LENGTH),
      basePrice: 100,
    });
    assert.equal(req.itemRef.length, MAX_ITEMREF_LENGTH);
  });

  test("exactly-MAX_CATEGORY_LENGTH category is accepted (off-by-one guard)", () => {
    const req = parseAppraisalRequest({
      itemRef: "ok",
      basePrice: 100,
      category: "c".repeat(MAX_CATEGORY_LENGTH),
    });
    assert.equal(req.category?.length, MAX_CATEGORY_LENGTH);
  });
});

describe("invalid score values fixture — full cascade", () => {
  test("first bad score (quality as string) is reported", () => {
    const err = captureError(() =>
      parseAppraisalRequest(invalidScoreValues.value),
    );
    assert.ok(err instanceof AppraisalInputError);
    assert.match(err.message, /^attributes\.quality must be a number$/);
  });

  test("quality repaired → demand null surfaces next", () => {
    const patched = {
      itemRef: (invalidScoreValues.value as { itemRef: string }).itemRef,
      basePrice: (invalidScoreValues.value as { basePrice: number }).basePrice,
      attributes: { quality: 50, demand: null, scarcity: { score: 80 }, risk: true },
    };
    const err = captureError(() => parseAppraisalRequest(patched));
    assert.ok(err instanceof AppraisalInputError);
    assert.equal(err.message, "attributes.demand must be a number");
  });

  test("quality+demand repaired → scarcity as object surfaces next", () => {
    const patched = {
      itemRef: "i",
      basePrice: 100,
      attributes: { quality: 50, demand: 50, scarcity: { score: 80 }, risk: true },
    };
    const err = captureError(() => parseAppraisalRequest(patched));
    assert.ok(err instanceof AppraisalInputError);
    assert.equal(err.message, "attributes.scarcity must be a number");
  });

  test("quality+demand+scarcity repaired → risk boolean surfaces last", () => {
    const patched = {
      itemRef: "i",
      basePrice: 100,
      attributes: { quality: 50, demand: 50, scarcity: 50, risk: true },
    };
    const err = captureError(() => parseAppraisalRequest(patched));
    assert.ok(err instanceof AppraisalInputError);
    assert.equal(err.message, "attributes.risk must be a number");
  });

  test("numeric scores out of [0,100] are clamped (intentional scoring semantic)", () => {
    const req = parseAppraisalRequest({
      itemRef: "i",
      basePrice: 100,
      attributes: { quality: -50, demand: 9999 },
    });
    assert.equal(req.attributes?.quality, 0);
    assert.equal(req.attributes?.demand, 100);
  });
});
