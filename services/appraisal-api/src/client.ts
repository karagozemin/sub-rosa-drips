// Copyright (c) 2026 Sub Rosa contributors
// x402 paid-fetch client.
//
// Wraps a single HTTP call with the x402 handshake: try the request, and if the
// server answers 402, sign the Soroban auth entry authorizing the USDC transfer
// and retry with the `X-PAYMENT` header. Returns both the resource body and the
// on-chain settlement receipt. This is what an autonomous bidder agent uses to
// pay the appraisal API per call.

import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { Network, PaymentRequired, SettleResponse } from "@x402/core/types";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme as ClientStellarScheme } from "@x402/stellar/exact/client";

export interface PaidClientConfig {
  /** Payer secret key (S...). Needs a USDC trustline + balance. */
  secret: string;
  /** CAIP-2 network id (default stellar:testnet). */
  network?: Network;
  /** Optional custom Soroban RPC URL. */
  rpcUrl?: string;
}

export interface PaidResult<T = unknown> {
  status: number;
  body: T;
  /** Present when a payment was made and settled on-chain. */
  settlement?: SettleResponse;
}

export const MAX_PAYMENT_ERROR_DIAGNOSTIC_LENGTH = 512;
const SENSITIVE_FIELD = /("?(?:secret|token|password|authorization|privateKey|private_key|apiKey|api_key)"?\s*:\s*)"?[^,}\s]+/gi;

/** Bound provider diagnostics and redact common credential fields before display/logging. */
export function sanitizePaymentErrorDiagnostic(body: string): string {
  return body.slice(0, MAX_PAYMENT_ERROR_DIAGNOSTIC_LENGTH).replace(SENSITIVE_FIELD, '$1[REDACTED]');
}

export class AppraisalResponseParseError extends Error {
  readonly name = "AppraisalResponseParseError";
  readonly status: number;

  constructor(status: number, options?: ErrorOptions) {
    super(`appraisal api returned ${status} with invalid JSON body`, options);
    this.status = status;
  }
}

export class X402PaymentError extends Error {
  readonly name = "X402PaymentError";
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new AppraisalResponseParseError(res.status);
  }

  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new AppraisalResponseParseError(res.status, { cause });
  }
}

/** Build a paid-fetch function bound to a payer wallet. */
export function createPaidFetch(config: PaidClientConfig) {
  const network = config.network ?? "stellar:testnet";
  const signer = createEd25519Signer(config.secret, network);
  const rpcConfig = config.rpcUrl ? { url: config.rpcUrl } : undefined;
  const core = new x402Client().register(
    "stellar:*",
    new ClientStellarScheme(signer, rpcConfig),
  );
  const http = new x402HTTPClient(core);

  return async function paidFetch<T = unknown>(
    url: string,
    init: RequestInit = {},
  ): Promise<PaidResult<T>> {
    const first = await fetch(url, init);
    if (first.status !== 402) {
      return { status: first.status, body: await parseJsonResponse<T>(first) };
    }

    // 402 → build the signed payment and retry.
    let bodyForParse: unknown;
    try {
      bodyForParse = await parseJsonResponse<unknown>(first.clone());
    } catch (error) {
      if (error instanceof AppraisalResponseParseError) {
        bodyForParse = undefined;
      } else {
        throw error;
      }
    }

    let paymentRequired: PaymentRequired;
    try {
      paymentRequired = http.getPaymentRequiredResponse(
        (name) => first.headers.get(name),
        bodyForParse,
      );
    } catch {
      throw new X402PaymentError(
        `x402 payment required response was invalid (${first.status})`,
        first.status,
      );
    }

    const payload = await http.createPaymentPayload(paymentRequired);
    const payHeaders = http.encodePaymentSignatureHeader(payload);

    const paid = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), ...payHeaders },
    });
    const body = await parseJsonResponse<T>(paid);

    if (paid.status !== 200) {
      throw new X402PaymentError(`paid request failed (${paid.status})`, paid.status);
    }
    const settlement = http.getPaymentSettleResponse((name) => paid.headers.get(name));
    return { status: paid.status, body, settlement };
  };
}
