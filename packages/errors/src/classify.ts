import { scrubText } from "./redact.js";

const RETRYABLE_STATUSES = new Set([408, 425, 429, 502, 503, 504]);

const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const RETRYABLE_PHRASES = [
  "got 425",
  "too early",
  "not published yet",
  "rate limit",
  "network error",
  "fetch failed",
  "timed out",
  "connection refused",
  "connection reset",
  "drand round",
];

const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

/**
 * Extracts an identifier or numeric error code from an unknown value.
 */
export function extractErrorCode(value: unknown): string | number | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const obj = value as Record<string, unknown>;

  if (typeof obj.code === "string" || typeof obj.code === "number") {
    return obj.code;
  }
  if (typeof obj.status === "number" || typeof obj.status === "string") {
    return obj.status;
  }
  if (typeof obj.statusCode === "number" || typeof obj.statusCode === "string") {
    return obj.statusCode;
  }
  if (typeof obj.kind === "string") {
    return obj.kind;
  }

  if (obj.error && typeof obj.error === "object") {
    const nested = obj.error as Record<string, unknown>;
    if (typeof nested.code === "string" || typeof nested.code === "number") {
      return nested.code;
    }
  }

  if (obj.response && typeof obj.response === "object") {
    const res = obj.response as Record<string, unknown>;
    if (typeof res.status === "number") {
      return res.status;
    }
  }

  return undefined;
}

/**
 * Determines whether an error condition represents a transient, retryable failure.
 */
export function isRetryable(
  value: unknown,
  code?: string | number,
  message?: string,
): boolean {
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.retryable === "boolean") {
      return obj.retryable;
    }
    if (typeof obj.isRetryable === "boolean") {
      return obj.isRetryable;
    }
  }

  if (typeof code === "number") {
    if (RETRYABLE_STATUSES.has(code)) return true;
    if (NON_RETRYABLE_STATUSES.has(code)) return false;
  }
  if (typeof code === "string") {
    const num = Number(code);
    if (!Number.isNaN(num)) {
      if (RETRYABLE_STATUSES.has(num)) return true;
      if (NON_RETRYABLE_STATUSES.has(num)) return false;
    }
    if (RETRYABLE_CODES.has(code.toUpperCase())) {
      return true;
    }
  }

  if (message) {
    const lower = message.toLowerCase();
    for (const phrase of RETRYABLE_PHRASES) {
      if (lower.includes(phrase)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Derives a safe, user-facing error message omitting stack traces, credentials, and internal paths.
 */
export function getSafePublicMessage(
  name: string,
  rawMessage: string,
  code?: string | number,
): string {
  const scrubbed = scrubText(rawMessage);

  if (scrubbed.includes("Contract, #10") || code === 10 || code === "10") {
    return "Commit window closed. Create a fresh round, then commit before Drand reaches reveal.";
  }
  if (scrubbed.includes("Contract, #15") || code === 15 || code === "15") {
    return "Reveal window closed for this round. Create a new round and open + reveal soon after Drand R (within ~4 minutes).";
  }
  if (
    scrubbed.includes("got 425") ||
    scrubbed.includes("Error response fetching") ||
    code === 425 ||
    code === "425"
  ) {
    return "Drand R is not published yet. Wait for the countdown, then open + reveal.";
  }
  if (scrubbed.includes("trustline entry is missing")) {
    return "Wallet is missing the escrow asset trustline. Fund the testnet wallet or use the XLM demo contract.";
  }
  if (/RoundNotFound/i.test(scrubbed) || code === "RoundNotFound") {
    return "Round not found.";
  }

  const numericCode = typeof code === "number" ? code : Number(code);
  if (!Number.isNaN(numericCode)) {
    if (numericCode === 400) return "Bad request.";
    if (numericCode === 401) return "Authentication required.";
    if (numericCode === 403) return "Access denied.";
    if (numericCode === 404) return "Resource not found.";
    if (numericCode === 429) return "Rate limit exceeded. Please try again later.";
    if (numericCode === 500) return "Internal server error.";
    if (numericCode === 502) return "Bad gateway. The upstream service is temporarily unavailable.";
    if (numericCode === 503) return "Service temporarily unavailable. Please try again.";
    if (numericCode === 504) return "Gateway timeout. The upstream service took too long to respond.";
  }

  if (
    scrubbed.includes("fetch failed") ||
    scrubbed.includes("ECONNREFUSED") ||
    scrubbed.includes("ETIMEDOUT") ||
    scrubbed.includes("UND_ERR_CONNECT_TIMEOUT")
  ) {
    return "Network request failed. Please check your connection and try again.";
  }

  if (name === "SyntaxError" || scrubbed.includes("Unexpected token")) {
    return "Invalid response format.";
  }

  const cleanMessage = scrubbed
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0 && !line.trim().startsWith("at ")) ?? "";

  const sanitized = cleanMessage
    .replace(/(?:\/[a-zA-Z0-9_.-]+)+/g, "[path]")
    .replace(/(?:[a-zA-Z]:\\[a-zA-Z0-9_.-]+)+/g, "[path]");

  if (!sanitized.trim()) {
    return "An unexpected error occurred.";
  }

  return sanitized.trim();
}
