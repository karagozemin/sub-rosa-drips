import assert from "node:assert/strict";
import { x402HTTPClient } from "@x402/core/client";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, test } from "node:test";

import { createPaidFetch, X402PaymentError, AppraisalResponseParseError, MAX_PAYMENT_ERROR_DIAGNOSTIC_LENGTH, sanitizePaymentErrorDiagnostic } from "./client.js";

const TEST_SECRET = Keypair.random().secret();
const VALID_402_BODY = {
  x402Version: 2,
  resource: "https://example.com/appraise",
  accepts: [
    {
      scheme: "exact",
      network: "stellar:testnet",
      payTo: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      price: "0.10",
      asset: "USDC",
      maxTimeoutSeconds: 60,
      extra: {},
    },
  ],
  error: "Payment required",
  metadata: {},
};

function buildResponse(status: number, body: string | undefined, headers?: Record<string, string>) {
  const headersMap = new Headers(headers ?? {});
  return new Response(body ?? "", {
    status,
    headers: headersMap,
  });
}

describe("createPaidFetch response parsing", () => {
  test("bounds diagnostics and redacts credential fields", () => {
    const diagnostic = sanitizePaymentErrorDiagnostic(JSON.stringify({ token: "secret", detail: "x".repeat(1000) }));
    assert.ok(diagnostic.length <= MAX_PAYMENT_ERROR_DIAGNOSTIC_LENGTH);
    assert.doesNotMatch(diagnostic, /secret/);
  });
  test("throws a typed parse error for an unpaid empty response body", async () => {
    const paidFetch = createPaidFetch({ secret: TEST_SECRET });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => buildResponse(200, "");

    try {
      await assert.rejects(
        () => paidFetch("https://example.com/appraise"),
        (err: unknown) => {
          assert.ok(err instanceof AppraisalResponseParseError);
          assert.equal(err.status, 200);
          assert.equal(err.name, "AppraisalResponseParseError");
          assert.match(err.message, /invalid JSON body/i);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws a typed parse error for a paid non-JSON response body without exposing raw content", async () => {
    const paidFetch = createPaidFetch({ secret: TEST_SECRET });
    const originalFetch = globalThis.fetch;
    const originalGetPaymentRequiredResponse = x402HTTPClient.prototype.getPaymentRequiredResponse;
    const originalCreatePaymentPayload = x402HTTPClient.prototype.createPaymentPayload;
    const originalEncodePaymentSignatureHeader =
      x402HTTPClient.prototype.encodePaymentSignatureHeader;
    const originalGetPaymentSettleResponse = x402HTTPClient.prototype.getPaymentSettleResponse;

    x402HTTPClient.prototype.getPaymentRequiredResponse = () => VALID_402_BODY as never;
    x402HTTPClient.prototype.createPaymentPayload = async () => ({
      x402Version: 2,
      payload: "stub-payload",
      resource: "https://example.com/appraise",
      accepted: VALID_402_BODY.accepts[0],
      extensions: {},
    }) as never;
    x402HTTPClient.prototype.encodePaymentSignatureHeader = () => ({
      "X-PAYMENT": "stub-signature",
    });
    x402HTTPClient.prototype.getPaymentSettleResponse = () => ({
      transaction: "stub-tx",
      network: "stellar:testnet",
      payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    }) as never;

    let calls = 0;
    globalThis.fetch = async (_url, _init) => {
      calls += 1;
      if (calls === 1) {
        return buildResponse(402, JSON.stringify(VALID_402_BODY), {
          "x402-version": "2",
          "x402-payment-required": "1",
        });
      }
      if (calls === 2) {
        return buildResponse(200, "not-json");
      }
      throw new Error("unexpected extra fetch call");
    };

    try {
      await assert.rejects(
        () => paidFetch("https://example.com/appraise"),
        (err: unknown) => {
          assert.ok(err instanceof AppraisalResponseParseError);
          assert.equal(err.status, 200);
          assert.equal(err.name, "AppraisalResponseParseError");
          assert.doesNotMatch(err.message, /not-json|raw|payload/i);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
      x402HTTPClient.prototype.getPaymentRequiredResponse = originalGetPaymentRequiredResponse;
      x402HTTPClient.prototype.createPaymentPayload = originalCreatePaymentPayload;
      x402HTTPClient.prototype.encodePaymentSignatureHeader = originalEncodePaymentSignatureHeader;
      x402HTTPClient.prototype.getPaymentSettleResponse = originalGetPaymentSettleResponse;
    }
  });

  test("preserves x402 payment errors for non-JSON 402 responses", async () => {
    const paidFetch = createPaidFetch({ secret: TEST_SECRET });
    const originalFetch = globalThis.fetch;
    const originalGetPaymentRequiredResponse = x402HTTPClient.prototype.getPaymentRequiredResponse;
    x402HTTPClient.prototype.getPaymentRequiredResponse = () => {
      throw new Error("invalid x402 payment required response");
    };

    globalThis.fetch = async () => buildResponse(402, "not-json");

    try {
      await assert.rejects(
        () => paidFetch("https://example.com/appraise"),
        (err: unknown) => {
          assert.ok(err instanceof X402PaymentError);
          assert.match(err.message, /payment|402/i);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
      x402HTTPClient.prototype.getPaymentRequiredResponse = originalGetPaymentRequiredResponse;
    }
  });
});
