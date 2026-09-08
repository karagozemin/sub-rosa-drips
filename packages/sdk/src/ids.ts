// SPDX-License-Identifier: MIT
const SOROBAN_CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;

function toTrimmedString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeRoundId(value: string | number | bigint): bigint {
  if (typeof value === "bigint") {
    if (value <= 0n) {
      throw new Error(`roundId must be a positive integer, got ${value}`);
    }
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`roundId must be a positive integer, got ${value}`);
    }
    return BigInt(value);
  }

  const trimmed = toTrimmedString(value);
  if (!trimmed) {
    throw new Error("roundId must be a non-empty decimal string");
  }

  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`roundId must be a positive integer, got ${JSON.stringify(trimmed)}`);
  }

  const parsed = BigInt(trimmed);
  if (parsed <= 0n) {
    throw new Error(`roundId must be a positive integer, got ${JSON.stringify(trimmed)}`);
  }
  return parsed;
}

export function normalizeSorobanContractId(value: string): string {
  const trimmed = toTrimmedString(value);
  if (!trimmed) {
    throw new Error("contractId must be a non-empty Soroban contract id");
  }

  const normalized = trimmed.toUpperCase();
  if (!SOROBAN_CONTRACT_ID_RE.test(normalized)) {
    throw new Error(
      `contractId must be a valid Soroban contract id (C + 55 base32 chars), got ${JSON.stringify(trimmed)}`,
    );
  }

  return normalized;
}
