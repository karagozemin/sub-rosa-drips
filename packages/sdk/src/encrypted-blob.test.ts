// Copyright (c) 2026 Sub Rosa contributors
// Encrypted blob validation tests.
//
// These tests validate the helper/schema that accepts encrypted blob payloads
// (ciphertext, auditor_blob, evidence). Guardrails:
//   - Do not decrypt blobs in tests.
//   - Do not log raw blob contents.
//   - Keep limits conservative and configurable only if the codebase already
//     has config patterns.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateEncryptedBlob,
  MAX_CIPHERTEXT_BYTES,
  MAX_AUDITOR_BLOB_BYTES,
  tryDecodeHex,
  tryDecodeBase64,
} from "./encrypted-blob.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a Uint8Array of the given length filled with a repeating byte. */
const u8 = (len: number, fill = 0x42): Uint8Array =>
  new Uint8Array(len).fill(fill);

/** Encode raw bytes as a lowercase hex string. */
const hex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/**
 * Encode raw bytes as base64. Uses Buffer for consistency with the
 * rest of the codebase (lifecycle-e2e.ts, mandate.ts, etc.).
 */
function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

// ── Content-type validation ──────────────────────────────────────────────

test("rejects missing content type", () => {
  const result = validateEncryptedBlob(u8(10), "");
  assert.equal(result.valid, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "missing_content_type");
  assert.match(result.issues[0].message, /content type must be provided/);
});

test("rejects unsupported content type", () => {
  const result = validateEncryptedBlob(u8(10), "unsupported_blob_type");
  assert.equal(result.valid, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "unsupported_content_type");
  assert.match(result.issues[0].message, /unsupported content type/);
  assert.match(result.issues[0].message, /evidence_auditor_blob/);
});

// ── Empty blob validation ────────────────────────────────────────────────

test("rejects empty ciphertext (raw bytes)", () => {
  const result = validateEncryptedBlob(new Uint8Array(0), "ciphertext");
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "empty_blob");
  assert.match(result.issues[0].message, /ciphertext must not be empty/);
});

test("rejects empty auditor blob (raw bytes)", () => {
  const result = validateEncryptedBlob(new Uint8Array(0), "auditor_blob");
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "empty_blob");
  assert.match(result.issues[0].message, /auditor blob must not be empty/);
});

test("rejects empty hex-encoded evidence ciphertext", () => {
  const result = validateEncryptedBlob("", "evidence_ciphertext");
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "empty_blob");
});

test("rejects empty base64-encoded evidence auditor blob", () => {
  const result = validateEncryptedBlob("", "evidence_auditor_blob");
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "empty_blob");
});

// ── Valid blobs ──────────────────────────────────────────────────────────

test("accepts a valid ciphertext at the maximum boundary", () => {
  const result = validateEncryptedBlob(u8(MAX_CIPHERTEXT_BYTES), "ciphertext");
  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 0);
});

test("accepts a valid auditor blob at the maximum boundary", () => {
  const result = validateEncryptedBlob(u8(MAX_AUDITOR_BLOB_BYTES), "auditor_blob");
  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 0);
});

test("accepts a realistic ciphertext (age-armored tlock output)", () => {
  // Realistic tlock output is ~800-1500 bytes of age-armored ciphertext.
  const realistic = u8(1024, 0x61); // 'a' filler
  const result = validateEncryptedBlob(realistic, "ciphertext");
  assert.equal(result.valid, true);
});

test("accepts a realistic auditor blob (~72-200 bytes)", () => {
  // Typical auditor blob: 32-byte eph pub + 24-byte nonce + ~20 byte id + 16 AEAD tag = 92 bytes
  const realistic = u8(92);
  const result = validateEncryptedBlob(realistic, "auditor_blob");
  assert.equal(result.valid, true);
});

test("accepts a valid hex-encoded evidence ciphertext", () => {
  const raw = u8(512);
  const hexStr = hex(raw);
  const result = validateEncryptedBlob(hexStr, "evidence_ciphertext");
  assert.equal(result.valid, true);
});

test("accepts a valid hex-encoded evidence auditor blob", () => {
  const raw = u8(92);
  const hexStr = hex(raw);
  const result = validateEncryptedBlob(hexStr, "evidence_auditor_blob");
  assert.equal(result.valid, true);
});

test("accepts a valid base64-encoded evidence ciphertext", () => {
  const raw = u8(512);
  const b64Str = b64(raw);
  const result = validateEncryptedBlob(b64Str, "evidence_ciphertext");
  assert.equal(result.valid, true);
});

test("accepts a valid base64-encoded evidence auditor blob", () => {
  const raw = u8(92);
  const b64Str = b64(raw);
  const result = validateEncryptedBlob(b64Str, "evidence_auditor_blob");
  assert.equal(result.valid, true);
});

// ── Oversized blobs ──────────────────────────────────────────────────────

test("rejects oversized ciphertext (1 byte over limit)", () => {
  const result = validateEncryptedBlob(
    u8(MAX_CIPHERTEXT_BYTES + 1),
    "ciphertext",
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "blob_too_large");
  assert.match(result.issues[0].message, /exceeding the maximum of 4096/);
});

test("rejects oversized ciphertext (well over limit)", () => {
  const result = validateEncryptedBlob(
    u8(MAX_CIPHERTEXT_BYTES * 2),
    "ciphertext",
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "blob_too_large");
});

test("rejects oversized auditor blob", () => {
  const result = validateEncryptedBlob(
    u8(MAX_AUDITOR_BLOB_BYTES + 1),
    "auditor_blob",
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "blob_too_large");
  assert.match(result.issues[0].message, /exceeding the maximum of 1024/);
});

test("rejects oversized hex-encoded evidence ciphertext", () => {
  // Hex encoding doubles the byte count: 4097 raw bytes → 8194 hex chars.
  const raw = u8(MAX_CIPHERTEXT_BYTES + 1);
  const hexStr = hex(raw);
  const result = validateEncryptedBlob(hexStr, "evidence_ciphertext");
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "blob_too_large");
});

test("rejects oversized hex-encoded evidence auditor blob", () => {
  const raw = u8(MAX_AUDITOR_BLOB_BYTES + 1);
  const hexStr = hex(raw);
  const result = validateEncryptedBlob(hexStr, "evidence_auditor_blob");
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "blob_too_large");
});

// ── Invalid encoding ─────────────────────────────────────────────────────

test("rejects hex string with invalid characters (evidence ciphertext)", () => {
  const result = validateEncryptedBlob(
    "zzz_not_valid_hex_1234",
    "evidence_ciphertext",
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_encoding");
  assert.match(result.issues[0].message, /not valid hex/);
});

test("rejects hex string with odd length (evidence auditor blob)", () => {
  const result = validateEncryptedBlob("abc", "evidence_auditor_blob");
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_encoding");
});

test("rejects invalid base64 string (evidence ciphertext)", () => {
  const result = validateEncryptedBlob(
    "!!!invalid-base64!!!",
    "evidence_ciphertext",
    { encoding: "base64" },
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_encoding");
  assert.match(result.issues[0].message, /not valid base64 encoding/);
});

test("accepts 0x-prefixed hex evidence ciphertext", () => {
  const raw = u8(128);
  const result = validateEncryptedBlob("0x" + hex(raw), "evidence_ciphertext");
  assert.equal(result.valid, true);
});

test("rejects hex string with 0x prefix explicitly flagged as base64", () => {
  const result = validateEncryptedBlob(
    "0xabcd1234",
    "evidence_ciphertext",
    { encoding: "base64" },
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_encoding");
});

test("rejects base64 string with invalid characters", () => {
  const result = validateEncryptedBlob("AAAA-AAAA", "evidence_auditor_blob");
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_encoding");
});

test("rejects string with mixed valid/invalid hex characters", () => {
  const result = validateEncryptedBlob(
    "abcdefggggg", // 'g' is not valid hex
    "evidence_ciphertext",
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_encoding");
});

// ── Invalid type ─────────────────────────────────────────────────────────

test("rejects non-Uint8Array, non-string input", () => {
  const result = validateEncryptedBlob(
    null as unknown as Uint8Array,
    "ciphertext",
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_type");
});

test("rejects number input", () => {
  const result = validateEncryptedBlob(
    12345 as unknown as Uint8Array,
    "ciphertext",
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_type");
});

// ── tryDecodeHex / tryDecodeBase64 unit tests ────────────────────────────

test("tryDecodeHex decodes uppercase", () => {
  const result = tryDecodeHex("ABCD");
  assert.notEqual(result, null);
  assert.equal(result!.length, 2);
  assert.deepEqual([...result!.bytes], [0xab, 0xcd]);
});

test("tryDecodeHex decodes lowercase", () => {
  const result = tryDecodeHex("deadbeef");
  assert.notEqual(result, null);
  assert.equal(result!.length, 4);
});

test("tryDecodeHex handles 0x prefix", () => {
  const result = tryDecodeHex("0xdeadbeef");
  assert.notEqual(result, null);
  assert.equal(result!.length, 4);
});

test("tryDecodeHex rejects invalid characters", () => {
  assert.equal(tryDecodeHex("zzz"), null);
});

test("tryDecodeHex rejects odd length", () => {
  assert.equal(tryDecodeHex("a"), null);
});

test("tryDecodeBase64 decodes a valid string", () => {
  const result = tryDecodeBase64("AAAA");
  assert.notEqual(result, null);
  assert.equal(result!.length, 3);
});

test("tryDecodeBase64 rejects invalid characters", () => {
  assert.equal(tryDecodeBase64("AAAA-AAAA"), null);
});

test("tryDecodeBase64 rejects non-multiple-of-4 length", () => {
  assert.equal(tryDecodeBase64("AAA"), null);
});

// ── Optional maxBytes override ───────────────────────────────────────────

test("respects custom maxBytes override", () => {
  const result = validateEncryptedBlob(u8(100), "ciphertext", {
    maxBytes: 50,
  });
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "blob_too_large");
  assert.match(result.issues[0].message, /100 bytes, exceeding the maximum of 50/);
});

test("custom maxBytes can be more permissive than default", () => {
  const result = validateEncryptedBlob(u8(MAX_CIPHERTEXT_BYTES + 100), "ciphertext", {
    maxBytes: MAX_CIPHERTEXT_BYTES + 200,
  });
  assert.equal(result.valid, true);
});

test("forced hex does not fall back to base64", () => {
  const result = validateEncryptedBlob("/w==", "ciphertext", { encoding: "hex" });
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_encoding");
  assert.match(result.issues[0].message, /not valid hex encoding/);
});
test("forced base64 does not fall back to hex", () => {
  const result = validateEncryptedBlob("ff", "ciphertext", { encoding: "base64" });
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, "invalid_encoding");
  assert.match(result.issues[0].message, /not valid base64 encoding/);
});
test("ambiguous text uses the requested decoder for the decoded size limit", () => {
  assert.equal(validateEncryptedBlob("deadbeef", "ciphertext", { encoding: "hex", maxBytes: 4 }).valid, true);
  const base64 = validateEncryptedBlob("deadbeef", "ciphertext", { encoding: "base64", maxBytes: 4 });
  assert.equal(base64.valid, false);
  assert.equal(base64.issues[0].code, "blob_too_large");
  assert.equal(validateEncryptedBlob("deadbeef", "ciphertext", { maxBytes: 4 }).valid, true);
});
test("explicit decoders accept their valid input and auto-detection accepts both", () => {
  for (const [blob, encoding] of [["0xff", "hex"], ["/w==", "base64"]] as const) {
    assert.equal(validateEncryptedBlob(blob, "ciphertext", { encoding }).valid, true);
    assert.equal(validateEncryptedBlob(blob, "ciphertext").valid, true);
  }
});
