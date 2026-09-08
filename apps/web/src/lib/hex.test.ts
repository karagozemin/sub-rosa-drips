// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";

import { bytesToHex, hexToBytes } from "./hex";

test("hexToBytes rejects empty input", () => {
  assert.throws(() => hexToBytes(""), {
    name: "Error",
    message: "invalid hex string",
  });
});

test("hexToBytes rejects whitespace-only input", () => {
  assert.throws(() => hexToBytes("   "), {
    name: "Error",
    message: "invalid hex string",
  });
  assert.throws(() => hexToBytes("\t\n"), {
    name: "Error",
    message: "invalid hex string",
  });
});

test("hexToBytes rejects prefix-only inputs", () => {
  assert.throws(() => hexToBytes("0x"), {
    name: "Error",
    message: "invalid hex string",
  });
  assert.throws(() => hexToBytes("0X"), {
    name: "Error",
    message: "invalid hex string",
  });
  assert.throws(() => hexToBytes("  0x  "), {
    name: "Error",
    message: "invalid hex string",
  });
  assert.throws(() => hexToBytes("  0X  "), {
    name: "Error",
    message: "invalid hex string",
  });
});

test("hexToBytes rejects odd-length inputs", () => {
  assert.throws(() => hexToBytes("1"), {
    name: "Error",
    message: "invalid hex string",
  });
  assert.throws(() => hexToBytes("0x1"), {
    name: "Error",
    message: "invalid hex string",
  });
  assert.throws(() => hexToBytes("123"), {
    name: "Error",
    message: "invalid hex string",
  });
  assert.throws(() => hexToBytes("0x123"), {
    name: "Error",
    message: "invalid hex string",
  });
});

test("hexToBytes rejects non-hex characters", () => {
  assert.throws(() => hexToBytes("0xzz"), {
    name: "Error",
    message: "invalid hex string",
  });
  assert.throws(() => hexToBytes("0x12g4"), {
    name: "Error",
    message: "invalid hex string",
  });
  assert.throws(() => hexToBytes("0x12 34"), {
    name: "Error",
    message: "invalid hex string",
  });
  assert.throws(() => hexToBytes("invalidhex"), {
    name: "Error",
    message: "invalid hex string",
  });
});

test("hexToBytes decodes valid unprefixed hex", () => {
  assert.deepEqual(hexToBytes("00"), new Uint8Array([0x00]));
  assert.deepEqual(hexToBytes("ff"), new Uint8Array([0xff]));
  assert.deepEqual(
    hexToBytes("deadbeef"),
    new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
  );
  assert.deepEqual(
    hexToBytes("0123456789abcdef"),
    new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]),
  );
});

test("hexToBytes decodes valid prefixed hex", () => {
  assert.deepEqual(hexToBytes("0x00"), new Uint8Array([0x00]));
  assert.deepEqual(hexToBytes("0xff"), new Uint8Array([0xff]));
  assert.deepEqual(
    hexToBytes("0xdeadbeef"),
    new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
  );
  assert.deepEqual(
    hexToBytes("0XDEADBEEF"),
    new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
  );
  assert.deepEqual(
    hexToBytes("0x0123456789abcdef"),
    new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]),
  );
});

test("hexToBytes trims surrounding whitespace around valid hex", () => {
  assert.deepEqual(
    hexToBytes("  0xdeadbeef  "),
    new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
  );
  assert.deepEqual(
    hexToBytes("  deadbeef  "),
    new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
  );
});

test("bytesToHex encodes byte arrays correctly", () => {
  assert.equal(bytesToHex(new Uint8Array([])), "");
  assert.equal(bytesToHex(new Uint8Array([0x00])), "00");
  assert.equal(bytesToHex(new Uint8Array([0xff])), "ff");
  assert.equal(
    bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef])),
    "deadbeef",
  );
});

test("hexToBytes and bytesToHex round-trip", () => {
  const original = "deadbeef0123456789abcdef";
  assert.equal(bytesToHex(hexToBytes(original)), original);
  assert.equal(bytesToHex(hexToBytes(`0x${original}`)), original);
});

for (const value of ["", "  ", "0x", "0X", " 0x ", "a", "0xabc", "xz", "00 gg"]) {
  test(`rejects invalid hex ${JSON.stringify(value)}`, () => {
    assert.throws(() => hexToBytes(value), /^Error: invalid hex string$/);
  });
}
for (const value of ["00aBff", "0x00abff", "0X00ABFF", " 00abff "]) {
  test(`decodes valid hex ${JSON.stringify(value)}`, () => {
    assert.deepEqual(hexToBytes(value), new Uint8Array([0, 171, 255]));
  });
}
