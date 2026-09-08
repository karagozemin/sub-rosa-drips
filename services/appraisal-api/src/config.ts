// Copyright (c) 2026 Sub Rosa contributors
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  DEFAULT_TESTNET_RPC_URL,
  STELLAR_PUBNET_CAIP2,
  STELLAR_TESTNET_CAIP2,
  getNetworkPassphrase,
  getUsdcAddress,
} from "@x402/stellar";
import type { Network } from "@x402/core/types";

export class AppraisalConfigError extends Error {
  readonly name = "AppraisalConfigError";

  constructor(
    readonly variable: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${variable}: ${message}`, options);
  }
}

export interface AppraisalServerConfig {
  /** Facilitator secret key (S...). XLM-funded; sponsors the fee and submits settlement. */
  facilitatorSecret: string;
  /** Resource-server address (G...) that receives the USDC payment. Needs a USDC trustline. */
  payTo: string;
  /** SEP-41 token contract (C...) used for payment. Defaults to USDC for `network`. */
  asset: string;
  /** Price per call, decimal units of the asset (e.g. 0.10). */
  price: number;
  /** CAIP-2 network id. */
  network: Network;
  /** Stellar network passphrase matching `network` when parsed from env. */
  networkPassphrase?: string;
  /** Soroban RPC URL. Pubnet requires an explicit URL. */
  rpcUrl: string;
  /** HTTP port. */
  port: number;
}

type AppraisalNetwork =
  | typeof STELLAR_TESTNET_CAIP2
  | typeof STELLAR_PUBNET_CAIP2;

const requiredEnv = (
  env: Record<string, string | undefined>,
  name: string,
): string => {
  const value = env[name]?.trim();
  if (!value) {
    throw new AppraisalConfigError(name, "missing required env var");
  }
  return value;
};

const optionalEnv = (
  env: Record<string, string | undefined>,
  name: string,
): string | undefined => env[name]?.trim() || undefined;

function parseNetwork(value: string | undefined): AppraisalNetwork {
  const network = value ?? STELLAR_TESTNET_CAIP2;
  if (
    network !== STELLAR_TESTNET_CAIP2 &&
    network !== STELLAR_PUBNET_CAIP2
  ) {
    throw new AppraisalConfigError(
      "X402_NETWORK",
      `unsupported network ${JSON.stringify(network)}; expected ${STELLAR_TESTNET_CAIP2} or ${STELLAR_PUBNET_CAIP2}`,
    );
  }
  return network;
}

function parsePositiveNumber(
  value: string | undefined,
  name: string,
  defaultValue: number,
): number {
  if (value == null) return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppraisalConfigError(
      name,
      `must be a finite number greater than 0, got ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

function parsePort(value: string | undefined): number {
  if (value == null) return 4021;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new AppraisalConfigError(
      "PORT",
      `must be an integer between 1 and 65535, got ${JSON.stringify(value)}`,
    );
  }
  return port;
}

function parseRpcUrl(
  value: string | undefined,
  network: AppraisalNetwork,
): string {
  if (!value) {
    if (network === STELLAR_PUBNET_CAIP2) {
      throw new AppraisalConfigError(
        "RPC_URL",
        "is required when X402_NETWORK=stellar:pubnet",
      );
    }
    return DEFAULT_TESTNET_RPC_URL;
  }

  let url: URL;
  try {
    url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
  } catch (cause) {
    throw new AppraisalConfigError(
      "RPC_URL",
      `must be a valid http(s) URL, got ${JSON.stringify(value)}`,
      { cause },
    );
  }

  if (url.username || url.password) {
    throw new AppraisalConfigError(
      "RPC_URL",
      "must not contain credentials",
    );
  }

  return url.toString().replace(/\/$/, "");
}

function validateFacilitatorSecret(secret: string): void {
  try {
    Keypair.fromSecret(secret);
  } catch (cause) {
    throw new AppraisalConfigError(
      "FACILITATOR_SECRET",
      "must be a valid Stellar secret key",
      { cause },
    );
  }
}

function validatePayTo(payTo: string): void {
  if (!StrKey.isValidEd25519PublicKey(payTo)) {
    throw new AppraisalConfigError(
      "PAY_TO",
      "must be a valid Stellar G... account address",
    );
  }
}

function validateAsset(asset: string): void {
  if (!StrKey.isValidContract(asset)) {
    throw new AppraisalConfigError(
      "PAYMENT_ASSET",
      "must be a valid Stellar C... contract address",
    );
  }
}

export function configFromEnv(
  env: Record<string, string | undefined> = process.env,
): AppraisalServerConfig {
  const facilitatorSecret = requiredEnv(env, "FACILITATOR_SECRET");
  const payTo = requiredEnv(env, "PAY_TO");
  const network = parseNetwork(optionalEnv(env, "X402_NETWORK"));
  const expectedPassphrase = getNetworkPassphrase(network);
  const configuredPassphrase = optionalEnv(env, "NETWORK_PASSPHRASE");
  if (configuredPassphrase && configuredPassphrase !== expectedPassphrase) {
    throw new AppraisalConfigError(
      "NETWORK_PASSPHRASE",
      `does not match X402_NETWORK=${network}`,
    );
  }

  const asset = optionalEnv(env, "PAYMENT_ASSET") ?? getUsdcAddress(network);
  validateFacilitatorSecret(facilitatorSecret);
  validatePayTo(payTo);
  validateAsset(asset);

  return {
    facilitatorSecret,
    payTo,
    asset,
    price: parsePositiveNumber(optionalEnv(env, "PRICE"), "PRICE", 0.1),
    network,
    networkPassphrase: expectedPassphrase,
    rpcUrl: parseRpcUrl(optionalEnv(env, "RPC_URL"), network),
    port: parsePort(optionalEnv(env, "PORT")),
  };
}
