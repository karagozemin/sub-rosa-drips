import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractErrorCode,
  getSafePublicMessage,
  isRetryable,
} from "./classify.js";

const VALID_STELLAR_SECRET = "S" + "B".repeat(55);

describe("classify - extractErrorCode", () => {
  it("extracts direct code property", () => {
    assert.equal(extractErrorCode({ code: "ECONNRESET" }), "ECONNRESET");
    assert.equal(extractErrorCode({ code: 404 }), 404);
  });

  it("extracts status or statusCode property", () => {
    assert.equal(extractErrorCode({ status: 503 }), 503);
    assert.equal(extractErrorCode({ statusCode: 400 }), 400);
  });

  it("extracts kind property", () => {
    assert.equal(extractErrorCode({ kind: "rpc_error" }), "rpc_error");
  });

  it("extracts nested rpc/error code", () => {
    assert.equal(extractErrorCode({ error: { code: -32603 } }), -32603);
    assert.equal(extractErrorCode({ response: { status: 502 } }), 502);
  });

  it("returns undefined for values without codes", () => {
    assert.equal(extractErrorCode(null), undefined);
    assert.equal(extractErrorCode("simple string"), undefined);
    assert.equal(extractErrorCode({}), undefined);
  });
});

describe("classify - isRetryable", () => {
  it("respects explicit retryable property", () => {
    assert.equal(isRetryable({ retryable: true }), true);
    assert.equal(isRetryable({ retryable: false, status: 503 }), false);
    assert.equal(isRetryable({ isRetryable: true }), true);
  });

  it("classifies HTTP statuses correctly", () => {
    assert.equal(isRetryable(null, 429), true);
    assert.equal(isRetryable(null, 502), true);
    assert.equal(isRetryable(null, 503), true);
    assert.equal(isRetryable(null, 504), true);
    assert.equal(isRetryable(null, 425), true);
    assert.equal(isRetryable(null, 400), false);
    assert.equal(isRetryable(null, 404), false);
  });

  it("classifies network error codes correctly", () => {
    assert.equal(isRetryable(null, "ECONNRESET"), true);
    assert.equal(isRetryable(null, "ETIMEDOUT"), true);
    assert.equal(isRetryable(null, "UND_ERR_CONNECT_TIMEOUT"), true);
    assert.equal(isRetryable(null, "ENOENT"), false);
  });

  it("detects retryable keywords in messages", () => {
    assert.equal(isRetryable(null, undefined, "drand round 1234 not servable yet"), true);
    assert.equal(isRetryable(null, undefined, "got 425 too early"), true);
    assert.equal(isRetryable(null, undefined, "rate limit exceeded"), true);
    assert.equal(isRetryable(null, undefined, "invalid signature"), false);
  });
});

describe("classify - getSafePublicMessage", () => {
  it("translates Soroban contract codes into clear user instructions", () => {
    const msg10 = getSafePublicMessage("Error", "Transaction failed with Contract, #10");
    assert.match(msg10, /Commit window closed/);

    const msg15 = getSafePublicMessage("Error", "Contract, #15 execution failed");
    assert.match(msg15, /Reveal window closed/);

    const msg425 = getSafePublicMessage("Error", "got 425 from Drand provider");
    assert.match(msg425, /Drand R is not published yet/);

    const msgTrustline = getSafePublicMessage("Error", "op_no_trustline: trustline entry is missing");
    assert.match(msgTrustline, /Wallet is missing the escrow asset trustline/);

    const msgNotFound = getSafePublicMessage("Error", "RoundNotFound at key");
    assert.equal(msgNotFound, "Round not found.");
  });

  it("sanitizes file paths and stack traces from unhandled errors", () => {
    const raw = "Crash in /Users/secretuser/project/file.ts:42\n    at Object.run (/Users/secretuser/project/file.ts:42:10)";
    const publicMsg = getSafePublicMessage("Error", raw);
    assert.equal(publicMsg.includes("/Users"), false);
    assert.equal(publicMsg.includes("at Object.run"), false);
  });

  it("redacts credentials and private keys from public messages", () => {
    const raw = `Failed to sign with secret ${VALID_STELLAR_SECRET}`;
    const publicMsg = getSafePublicMessage("Error", raw);
    assert.equal(publicMsg.includes(VALID_STELLAR_SECRET), false);
    assert.match(publicMsg, /\[REDACTED\]/);
  });
});
