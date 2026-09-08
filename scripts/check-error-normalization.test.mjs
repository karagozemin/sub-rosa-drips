import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findViolations } from "./check-error-normalization.mjs";

describe("findViolations - check-error-normalization", () => {
  it("allows packages/errors/src/normalize.ts", () => {
    const hits = findViolations(
      "const x = err instanceof Error ? err.message : String(err);",
      "packages/errors/src/normalize.ts",
    );
    assert.equal(hits.length, 0);
  });

  it("allows test files to perform assertions on errors", () => {
    const hits = findViolations(
      "const msg = e instanceof Error ? e.message : String(e);",
      "packages/sdk/src/client.test.ts",
    );
    assert.equal(hits.length, 0);
  });

  it("flags instanceof Error ternary in production code", () => {
    const hits = findViolations(
      "const msg = e instanceof Error ? e.message : String(e);",
      "apps/web/src/hooks/useLiveRound.ts",
    );
    assert.equal(hits.length >= 1, true);
    assert.equal(hits[0].pattern, "instanceof Error ternary");
  });

  it("flags raw String(error) coercion in production code", () => {
    const hits = findViolations(
      "return String(e);",
      "services/keeper/src/keeper.ts",
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].pattern, "raw String(error) coercion");
  });

  it("allows proper use of getErrorMessage and normalizeError", () => {
    const hits = findViolations(
      "const message = getErrorMessage(error);\nconst normalized = normalizeError(error);",
      "packages/sdk/src/preflight.ts",
    );
    assert.equal(hits.length, 0);
  });
});
