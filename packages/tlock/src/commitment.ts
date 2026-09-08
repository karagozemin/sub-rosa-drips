// SPDX-License-Identifier: MIT
// Commitment byte encoding — byte-for-byte identical to the Round contract.
//
// The contract computes H = sha256(value.to_be_bytes() ‖ nonce.to_array()),
// where `value: i128` (16-byte big-endian two's complement) and `nonce` is a
// 32-byte array. The sealed tlock payload is this exact 48-byte preimage, so a
// decrypted bid is directly usable as the contract reveal input.

import { sha256 } from "@noble/hashes/sha2.js";

export const VALUE_BYTES = 16;
export const NONCE_BYTES = 32;
export const PREIMAGE_BYTES = VALUE_BYTES + NONCE_BYTES;

const I128_MAX = (1n << 127n) - 1n;
const I128_MIN = -(1n << 127n);
const TWO_128 = 1n << 128n;

/// Encode an i128 as 16-byte big-endian two's complement (matches Rust).
export function i128ToBeBytes(value: bigint): Uint8Array {
  if (value < I128_MIN || value > I128_MAX) {
    throw new RangeError(`value ${value} out of i128 range`);
  }
  let u = value & (TWO_128 - 1n); // two's complement wrap
  const out = new Uint8Array(VALUE_BYTES);
  for (let i = VALUE_BYTES - 1; i >= 0; i--) {
    out[i] = Number(u & 0xffn);
    u >>= 8n;
  }
  return out;
}

/// Decode 16-byte big-endian two's complement back to a signed i128.
export function beBytesToI128(bytes: Uint8Array): bigint {
  if (bytes.length !== VALUE_BYTES) {
    throw new Error(`expected ${VALUE_BYTES} bytes, got ${bytes.length}`);
  }
  let u = 0n;
  for (const b of bytes) u = (u << 8n) | BigInt(b);
  return u >= 1n << 127n ? u - TWO_128 : u;
}

/// The 48-byte commitment preimage = be16(value) ‖ nonce32. This is exactly the
/// payload sealed by tlock and the input the contract hashes at reveal.
export function encodeBidPreimage(value: bigint, nonce: Uint8Array): Uint8Array {
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`nonce must be ${NONCE_BYTES} bytes, got ${nonce.length}`);
  }
  const out = new Uint8Array(PREIMAGE_BYTES);
  out.set(i128ToBeBytes(value), 0);
  out.set(nonce, VALUE_BYTES);
  return out;
}

export function decodeBidPreimage(preimage: Uint8Array): {
  value: bigint;
  nonce: Uint8Array;
} {
  if (preimage.length !== PREIMAGE_BYTES) {
    throw new Error(
      `preimage must be ${PREIMAGE_BYTES} bytes, got ${preimage.length}`,
    );
  }
  return {
    value: beBytesToI128(preimage.slice(0, VALUE_BYTES)),
    nonce: preimage.slice(VALUE_BYTES),
  };
}

/// H = sha256(be16(value) ‖ nonce). 32 bytes.
export function commitment(value: bigint, nonce: Uint8Array): Uint8Array {
  return sha256(encodeBidPreimage(value, nonce));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const HEX_RE = /^[0-9a-fA-F]*$/;

/**
 * Returns true if `hex` (optionally `0x` or `0X` prefixed) is a valid, even-length hexadecimal string.
 */
export function isValidHex(hex: string): boolean {
  if (typeof hex !== "string") return false;
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  return clean.length % 2 === 0 && HEX_RE.test(clean);
}

export function fromHex(hex: string): Uint8Array {
  if (typeof hex !== "string") {
    throw new Error("hex must be a string");
  }
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("odd hex length");
  if (!HEX_RE.test(clean)) {
    throw new Error("invalid hex characters");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
