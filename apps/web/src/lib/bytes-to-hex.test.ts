// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";
import { bytesToHex } from "./hex";

test("bytesToHex handles an empty byte array", () => {
  assert.equal(bytesToHex(new Uint8Array()), "");
});

test("bytesToHex preserves zero padding and emits lowercase hex", () => {
  assert.equal(bytesToHex(new Uint8Array([0, 0, 0x0f, 0x10, 0xff])), "00000f10ff");
});

test("bytesToHex encodes every byte without mutating the input", () => {
  const input = Uint8Array.from({ length: 256 }, (_, i) => i);
  const original = input.slice();
  const output = bytesToHex(input);
  assert.equal(output.length, 512);
  assert.match(output, /^[0-9a-f]+$/);
  assert.deepEqual(Buffer.from(output, "hex"), Buffer.from(original));
  assert.deepEqual(input, original);
});
