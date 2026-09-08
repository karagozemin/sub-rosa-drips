// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";
import { hexToBytes } from "./hex";
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
