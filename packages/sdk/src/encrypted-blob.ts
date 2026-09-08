// SPDX-License-Identifier: MIT
// Encrypted blob validation — size, content-type, and encoding checks.
//
// The contract enforces a 4096-byte maximum for ciphertext (Soroban Temporary
// storage limit). Auditor blobs have no on-chain limit beyond the general
// contract payload limit, but realistically a sealed identity (ECIES X25519 +
// XChaCha20-Poly1305) is ~56–200 bytes. Both limits are conservative and keep
// the per-bid storage well under the per-entry cost.
//
// These validation functions give callers early, clear feedback before paying
// gas for a contract call that would revert with PayloadTooLarge (error 33).

import { SubRosaClientConfigError } from "./errors.js";

// ── Blob size limits (bytes) ─────────────────────────────────────────────

/**
 * Maximum allowed size for a tlock ciphertext blob.
 *
 * The Soroban contract enforces this limit on-chain (PayloadTooLarge, error 33).
 * 4096 bytes matches the maximum Temporary storage entry size for a single
 * bid's ciphertext in the Round contract.
 *
 * @default 4096
 */
export const MAX_CIPHERTEXT_BYTES = 4096;

/**
 * Maximum allowed size for an encrypted auditor identity blob.
 *
 * An auditor blob is an ECIES sealed box: 32-byte ephemeral public key +
 * 24-byte nonce + ciphertext (+16 AEAD tag). Typical identity strings are
 * 20–100 bytes, producing blobs of 92–172 bytes. The 1024 limit leaves
 * generous room for longer identities well below the Temporary storage cap.
 *
 * @default 1024
 */
export const MAX_AUDITOR_BLOB_BYTES = 1024;

// ── Content types ────────────────────────────────────────────────────────

/**
 * Discriminated union for the kind of encrypted blob being validated.
 *
 * - `ciphertext`: tlock-encrypted bid payload (raw Uint8Array / Buffer).
 * - `auditor_blob`: ECIES-encrypted bidder identity (raw Uint8Array / Buffer).
 * - `evidence_ciphertext`: hex-encoded ciphertext from a receipt evidence block.
 * - `evidence_auditor_blob`: hex-encoded auditor blob from a receipt evidence block.
 */
export type BlobContentType =
  | "ciphertext"
  | "auditor_blob"
  | "evidence_ciphertext"
  | "evidence_auditor_blob";

const CONTENT_TYPE_SET: ReadonlySet<string> = new Set([
  "ciphertext",
  "auditor_blob",
  "evidence_ciphertext",
  "evidence_auditor_blob",
]);

const HUMAN_LABELS: Record<BlobContentType, string> = {
  ciphertext: "ciphertext",
  auditor_blob: "auditor blob",
  evidence_ciphertext: "evidence ciphertext",
  evidence_auditor_blob: "evidence auditor blob",
};

// ── Validation result ────────────────────────────────────────────────────

export interface BlobValidationIssue {
  /** Machine-readable code. */
  code: string;
  /** Human-readable explanation. */
  message: string;
}

export interface BlobValidationResult {
  /** `true` when all checks pass. */
  valid: boolean;
  /** Ordered list of issues found. */
  issues: BlobValidationIssue[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

const HEX_RE = /^[0-9a-f]+$/i;
const BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isHex(s: string): boolean {
  return HEX_RE.test(s);
}

function isBase64(s: string): boolean {
  return BASE64_RE.test(s) && s.length % 4 === 0;
}

/**
 * Return the maximum allowed bytes for a given content type.
 * `evidence_*` types are hex-encoded strings, so their byte limit refers to
 * the *decoded* payload size (i.e. the underlying raw blob).
 */
function maxBytesForType(contentType: BlobContentType): number {
  switch (contentType) {
    case "ciphertext":
    case "evidence_ciphertext":
      return MAX_CIPHERTEXT_BYTES;
    case "auditor_blob":
    case "evidence_auditor_blob":
      return MAX_AUDITOR_BLOB_BYTES;
  }
}

/**
 * Parse the hex-encoded string representation of a blob into raw bytes.
 * Returns `null` if the string is not valid hex.
 */
export function tryDecodeHex(s: string): { bytes: Uint8Array; length: number } | null {
  const hex = s.startsWith("0x") ? s.slice(2) : s;
  if (!isHex(hex)) return null;
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return { bytes, length: bytes.length };
}

/**
 * Decode the base64-encoded string representation of a blob into raw bytes.
 * Returns `null` if the string is not valid base64.
 */
export function tryDecodeBase64(s: string): { bytes: Uint8Array; length: number } | null {
  if (!isBase64(s)) return null;
  // Buffer.from with base64 never throws — invalid chars are silently skipped.
  // The isBase64 regex above already guarantees the string is well-formed.
  const bytes = new Uint8Array(Buffer.from(s, "base64"));
  return { bytes, length: bytes.length };
}

// ── Validator ────────────────────────────────────────────────────────────

/**
 * Validate an encrypted blob for size, content-type, and encoding.
 *
 * Supports two calling modes:
 *
 * **Raw bytes** — pass a `Uint8Array` or `Buffer` (the typical SDK path):
 * ```ts
 * validateEncryptedBlob(ciphertext, "ciphertext");
 * ```
 *
 * **Hex/base64 string** — pass a string encoding (e.g. from a receipt):
 * ```ts
 * validateEncryptedBlob("abcd1234...", "evidence_ciphertext");
 * ```
 *
 * @param blob — The encrypted blob as raw bytes or a hex/base64 string.
 * @param contentType — Discriminates which kind of blob (determines the
 *   size limit applied).
 * @param options — Optional overrides.
 */
export function validateEncryptedBlob(
  blob: Uint8Array | string,
  contentType: string,
  options?: {
    /** Override the max size for this call (bytes). */
    maxBytes?: number;
    /** Expected encoding for string blobs. Default: auto-detect hex then base64. */
    encoding?: "hex" | "base64";
  },
): BlobValidationResult {
  const issues: BlobValidationIssue[] = [];
  const add = (code: string, message: string) =>
    issues.push({ code, message });

  // ── Content type ────────────────────────────────────────────────────
  if (!contentType) {
    add("missing_content_type", "content type must be provided");
    return { valid: false, issues };
  }
  if (!CONTENT_TYPE_SET.has(contentType)) {
    add(
      "unsupported_content_type",
      `unsupported content type "${contentType}"; expected one of: ${[...CONTENT_TYPE_SET].join(", ")}`,
    );
    // Can't proceed — we don't know what limits to apply.
    return { valid: false, issues };
  }
  const ct = contentType as BlobContentType;

  // ── Determine raw size and encoding validity ────────────────────────
  let rawBytes: Uint8Array;
  let byteLength: number;

  if (typeof blob === "string") {
    const encoding = options?.encoding;
    let hexDecoded: ReturnType<typeof tryDecodeHex> = null;
    let b64Decoded: ReturnType<typeof tryDecodeBase64> = null;

    if (encoding === "hex") {
      hexDecoded = tryDecodeHex(blob);
    } else if (encoding === "base64") {
      b64Decoded = tryDecodeBase64(blob);
    } else {
      hexDecoded = tryDecodeHex(blob);
      b64Decoded = hexDecoded ? null : tryDecodeBase64(blob);
    }

    if (hexDecoded) {
      rawBytes = hexDecoded.bytes;
      byteLength = hexDecoded.length;
    } else if (b64Decoded) {
      rawBytes = b64Decoded.bytes;
      byteLength = b64Decoded.length;
    } else {
      // Not valid hex or base64.
      add(
        "invalid_encoding",
        `${HUMAN_LABELS[ct]} is not valid ${encoding ?? "hex or base64"} encoding (length=${blob.length})`,
      );
      return { valid: false, issues };
    }
  } else if (blob instanceof Uint8Array) {
    rawBytes = blob;
    byteLength = blob.length;
  } else {
    add("invalid_type", "blob must be a Uint8Array, Buffer, or hex/base64 string");
    return { valid: false, issues };
  }

  // ── Empty check ─────────────────────────────────────────────────────
  if (byteLength === 0) {
    add("empty_blob", `${HUMAN_LABELS[ct]} must not be empty`);
    // Empty blob fails size checks too, but report empty as the primary issue.
    return { valid: false, issues };
  }

  // ── Size check ──────────────────────────────────────────────────────
  const max = options?.maxBytes ?? maxBytesForType(ct);
  if (byteLength > max) {
    add(
      "blob_too_large",
      `${HUMAN_LABELS[ct]} is ${byteLength} bytes, exceeding the maximum of ${max} bytes`,
    );
  }

  return { valid: issues.length === 0, issues };
}
