// SPDX-License-Identifier: MIT
import { StrKey } from "@stellar/stellar-sdk";

export class AssetConfigError extends Error {
  readonly name = "AssetConfigError";

  constructor(
    readonly field: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${field}: ${message}`, options);
  }
}

export type AssetType = "native" | "sac";

export interface AssetConfig {
  type: AssetType;
  code?: string;
  issuer?: string;
  contractId?: string;
  decimals?: number;
  metadata?: Record<string, unknown>;
}

const MAX_STROOPS_DECIMALS = 7;
const MAX_TOKEN_DECIMALS = 18;

const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new AssetConfigError(
      field,
      `must be a string, got ${typeof value}`,
    );
  }
  return value;
}

function validateNumber(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new AssetConfigError(
      field,
      `must be a safe integer, got ${typeof value === "number" ? value : typeof value}`,
    );
  }
  return value;
}

export function validateAssetConfig(
  input: unknown,
): AssetConfig {
  if (!isPlainObject(input)) {
    throw new AssetConfigError(
      "type",
      "asset config must be a non-null object",
    );
  }

  const raw = input as Record<string, unknown>;

  const type = validateString(raw.type, "type");
  if (!type) {
    throw new AssetConfigError("type", "asset type is required");
  }

  const config: AssetConfig = { type: type as AssetType };

  if (type !== "native" && type !== "sac") {
    throw new AssetConfigError(
      "type",
      `unsupported asset type "${type}"; expected "native" or "sac"`,
    );
  }

  const code = validateString(raw.code, "code");
  if (code !== undefined) {
    if (!ASSET_CODE_RE.test(code)) {
      throw new AssetConfigError(
        "code",
        `invalid asset code "${code}"; must be 1-12 alphanumeric characters`,
      );
    }
    config.code = code;
  }

  const issuer = validateString(raw.issuer, "issuer");
  if (issuer !== undefined) {
    if (!StrKey.isValidEd25519PublicKey(issuer)) {
      throw new AssetConfigError(
        "issuer",
        `invalid issuer address "${issuer}"; must be a valid Stellar G... account`,
      );
    }
    config.issuer = issuer;
  }

  const contractId = validateString(raw.contractId, "contractId");
  if (contractId !== undefined) {
    if (!StrKey.isValidContract(contractId)) {
      throw new AssetConfigError(
        "contractId",
        `invalid contract ID "${contractId}"; must be a valid Stellar C... address`,
      );
    }
    config.contractId = contractId;
  }

  if (type === "sac" && !contractId) {
    throw new AssetConfigError(
      "contractId",
      "contractId is required for SAC assets",
    );
  }

  const decimals = validateNumber(raw.decimals, "decimals");
  if (decimals !== undefined) {
    const maxDecimals =
      type === "native" ? MAX_STROOPS_DECIMALS : MAX_TOKEN_DECIMALS;
    if (decimals < 0 || decimals > maxDecimals) {
      throw new AssetConfigError(
        "decimals",
        `decimals must be 0-${maxDecimals}, got ${decimals}`,
      );
    }
    config.decimals = decimals;
  }

  if (raw.metadata !== undefined) {
    if (!isPlainObject(raw.metadata)) {
      throw new AssetConfigError(
        "metadata",
        "metadata must be a plain object",
      );
    }
    config.metadata = raw.metadata as Record<string, unknown>;
  }

  return config;
}

export function validateAssetConfigs(input: unknown[]): AssetConfig[] {
  return input.map((item, i) => {
    try {
      return validateAssetConfig(item);
    } catch (e) {
      if (e instanceof AssetConfigError) {
        throw new AssetConfigError(
          `[${i}].${e.field}`,
          e.message,
        );
      }
      throw e;
    }
  });
}

export const ASSET_FIXTURES = {
  valid: {
    native: {
      type: "native" as const,
      code: "XLM",
      decimals: 7,
    },
    sac: {
      type: "sac" as const,
      code: "USDC",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      issuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      decimals: 7,
    },
    sacMinimal: {
      type: "sac" as const,
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    },
    sacWithMetadata: {
      type: "sac" as const,
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      code: "USDC",
      decimals: 7,
      metadata: { name: "USD Coin", website: "https://example.com" },
    },
  },
  invalid: {
    malformedIssuer: {
      type: "sac",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      issuer: "GARBAGE_NOT_A_KEY",
    },
    malformedContractId: {
      type: "sac",
      contractId: "NOT_A_CONTRACT_ID",
    },
    unsupportedType: {
      type: "liquidity_pool",
    },
    missingContractId: {
      type: "sac",
      code: "USDC",
    },
    invalidDecimals: {
      type: "sac",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      decimals: 255,
    },
    nativeInvalidDecimals: {
      type: "native",
      decimals: 8,
    },
    negativeDecimals: {
      type: "sac",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      decimals: -1,
    },
    invalidCodeTooLong: {
      type: "sac",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      code: "THIS_CODE_IS_WAY_TOO_LONG",
    },
    invalidCodeEmpty: {
      type: "sac",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      code: "",
    },
    nullInput: null,
    nonObjectInput: "just a string",
    arrayInput: [],
    missingType: {
      code: "USDC",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    },
    invalidMetadata: {
      type: "sac",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      metadata: "not an object",
    },
  },
} as const;
