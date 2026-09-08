const SOROBAN_CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;

function toTrimmedString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeRoundId(value: string | number | bigint): bigint {
  if (typeof value === "bigint") {
    if (value < 1n) throw new Error("roundId must be a positive integer");
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`roundId must be a positive safe integer, got ${JSON.stringify(value)}`);
    }
    return BigInt(value);
  }

  const trimmed = toTrimmedString(value);
  if (!trimmed) {
    throw new Error("roundId must be a non-empty decimal string");
  }

  try {
    const parsed = BigInt(trimmed);
    if (parsed < 1n) {
      throw new Error(`roundId must be a positive integer, got ${JSON.stringify(trimmed)}`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.includes("roundId")) {
      throw error;
    }
    throw new Error(`roundId must be a positive integer, got ${JSON.stringify(trimmed)}`);
  }
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
