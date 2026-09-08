import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NormalizedError,
  normalizeError,
  getErrorMessage,
  getPublicErrorMessage,
  isRetryableError,
  toAssertableError,
  toOperatorDiagnostics,
} from "./normalize.js";

const VALID_STELLAR_SECRET = "S" + "B".repeat(55);

class CustomDomainError extends Error {
  readonly kind = "domain_failure";
  readonly code = "ERR_DOMAIN";
  constructor(msg: string) {
    super(msg);
    this.name = "CustomDomainError";
  }
}

describe("normalizeError - Native Error instances", () => {
  it("normalizes standard Error preserving name, message, and stack", () => {
    const original = new Error("something went wrong");
    const normalized = normalizeError(original);

    assert.equal(normalized instanceof NormalizedError, true);
    assert.equal(normalized instanceof Error, true);
    assert.equal(normalized.name, "Error");
    assert.equal(normalized.message, "something went wrong");
    assert.equal(typeof normalized.stack, "string");
    assert.equal(normalized.retryable, false);
    assert.equal(normalized.raw, original);
  });

  it("preserves custom domain error class name, kind, and codes", () => {
    const original = new CustomDomainError("contract execution failed");
    const normalized = normalizeError(original);

    assert.equal(normalized.name, "CustomDomainError");
    assert.equal(normalized.message, "contract execution failed");
    assert.equal(normalized.code, "ERR_DOMAIN");
    assert.equal(normalized.raw, original);
  });
});

describe("normalizeError - Thrown primitive values", () => {
  it("normalizes thrown strings", () => {
    const normalized = normalizeError("connection reset by peer");
    assert.equal(normalized.name, "Error");
    assert.equal(normalized.message, "connection reset by peer");
    assert.equal(normalized.retryable, true);
  });

  it("normalizes null and undefined gracefully", () => {
    const normNull = normalizeError(null);
    assert.equal(normNull.message, "Unknown error (null)");
    assert.equal(normNull.publicMessage, "An unknown error occurred.");

    const normUndefined = normalizeError(undefined);
    assert.equal(normUndefined.message, "Unknown error (undefined)");
  });

  it("normalizes numbers, bigints, and symbols", () => {
    assert.equal(normalizeError(404).message, "404");
    assert.equal(normalizeError(100n).message, "100");
    assert.equal(normalizeError(Symbol("test_sym")).message, "Symbol(test_sym)");
  });

  it("normalizes functions", () => {
    function badFn() {}
    const normalized = normalizeError(badFn);
    assert.equal(normalized.message, "[Function badFn]");
  });
});

describe("normalizeError - Plain objects & RPC responses", () => {
  it("normalizes plain objects with error message and code", () => {
    const raw = {
      message: "Rate limit exceeded",
      code: 429,
      endpoint: "https://horizon-testnet.stellar.org",
    };
    const normalized = normalizeError(raw);

    assert.equal(normalized.message, "Rate limit exceeded");
    assert.equal(normalized.code, 429);
    assert.equal(normalized.retryable, true);
    assert.deepEqual(normalized.context, {
      endpoint: "https://horizon-testnet.stellar.org",
    });
  });

  it("normalizes nested RPC error shapes", () => {
    const rpcFailure = {
      error: {
        code: -32603,
        message: "Internal RPC simulation error",
      },
    };
    const normalized = normalizeError(rpcFailure);
    assert.equal(normalized.code, -32603);
    assert.equal(normalized.message, "Internal RPC simulation error");
  });

  it("safely handles hostile objects with throwing getters", () => {
    const hostile = {
      get message() {
        throw new Error("trap");
      },
    };
    const normalized = normalizeError(hostile);
    assert.equal(normalized.name, "Error");
    assert.equal(typeof normalized.message, "string");
  });
});

describe("normalizeError - Nested causes & Cycle safety", () => {
  it("preserves nested cause chains", () => {
    const root = new Error("root failure");
    const middle = new Error("middle layer", { cause: root });
    const top = new Error("top level failed", { cause: middle });

    const normalized = normalizeError(top);
    assert.equal(normalized.message, "top level failed");
    assert.equal(normalized.cause?.message, "middle layer");
    assert.equal(normalized.cause?.cause?.message, "root failure");
  });

  it("prevents infinite recursion on circular causes", () => {
    const first: Record<string, unknown> = { name: "FirstError", message: "first error" };
    const second: Record<string, unknown> = { name: "SecondError", message: "second error" };
    first.cause = second;
    second.cause = first;

    const normalized = normalizeError(first);
    assert.equal(normalized.message, "first error");
    assert.equal(normalized.cause?.message, "second error");
    assert.equal(normalized.cause?.cause?.name, "CircularError");
  });
});

describe("normalizeError - Secret redaction in context and messages", () => {
  it("redacts credentials from error messages and context objects", () => {
    const raw = {
      message: `Failed auth with secret ${VALID_STELLAR_SECRET}`,
      authToken: "sensitiveAuthTokenValue",
      apiKey: "secretApiKeyVal",
      safeMeta: "ok",
    };
    const normalized = normalizeError(raw);

    assert.equal(normalized.message.includes(VALID_STELLAR_SECRET), false);
    assert.match(normalized.message, /\[REDACTED\]/);
    assert.equal(normalized.context?.authToken, "[REDACTED]");
    assert.equal(normalized.context?.apiKey, "[REDACTED]");
    assert.equal(normalized.context?.safeMeta, "ok");
  });
});

describe("toAssertable - Snapshot-free assertions", () => {
  it("exports a stable assertable representation omitting stack", () => {
    const err = new Error("verification failed");
    (err as unknown as { code: string }).code = "VERIFY_ERR";
    const assertable = toAssertableError(err);

    assert.deepEqual(assertable, {
      name: "Error",
      message: "verification failed",
      code: "VERIFY_ERR",
      retryable: false,
      publicMessage: "verification failed",
    });
    assert.equal("stack" in assertable, false);
  });
});

describe("toOperatorDiagnostics", () => {
  it("generates operator diagnostic view with cause chain", () => {
    const cause = new Error("inner failure");
    const top = new Error("outer failure", { cause });
    const diagnostics = toOperatorDiagnostics(top);

    assert.equal(diagnostics.name, "Error");
    assert.equal(diagnostics.message, "outer failure");
    assert.equal(typeof diagnostics.stack, "string");
    assert.equal(diagnostics.causes?.length, 1);
    assert.equal(diagnostics.causes?.[0].message, "inner failure");
  });
});

describe("Convenience helper functions", () => {
  it("getErrorMessage and getPublicErrorMessage return expected strings", () => {
    const err = new Error("Contract, #10 execution reverted");
    assert.equal(getErrorMessage(err), "Contract, #10 execution reverted");
    assert.match(getPublicErrorMessage(err), /Commit window closed/);
  });

  it("isRetryableError identifies retryable conditions", () => {
    assert.equal(isRetryableError(new Error("fetch failed")), true);
    assert.equal(isRetryableError(new Error("invalid user input")), false);
  });
});
