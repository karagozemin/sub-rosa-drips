// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";
import { shortAddr, shortHash, usdc, phaseIcon } from "./format";

for (const { name, format, width, overhead } of [
  { name: "shortAddr", format: shortAddr, width: 6, overhead: 3 },
  { name: "shortHash", format: shortHash, width: 10, overhead: 1 },
]) {
  test(`${name} preserves empty and short strings`, () => {
    assert.equal(format(""), "");
    assert.equal(format("abc"), "abc");
  });
  for (const n of [width, 2, 4]) {
    test(`${name} preserves its boundary and truncates above it at width ${n}`, () => {
      const boundary = "a".repeat(n * 2 + overhead);
      assert.equal(format(boundary, n), boundary);
      const input = "ABCDEFGHIJ0123456789abcdefghijklmnopqrstuvwxyz";
      assert.equal(format(input, n), `${input.slice(0, n)}…${input.slice(-n)}`);
      const above = boundary + "z";
      assert.equal(format(above, n), `${above.slice(0, n)}…${above.slice(-n)}`);
    });
  }
  test(`${name} uses its default width`, () => {
    const input = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    assert.equal(format(input), `${input.slice(0, width)}…${input.slice(-width)}`);
  });
}

for (const [value, expected] of [[0, "0.00"], [1, "1.00"], [1234.5, "1,234.50"],
  [-42.125, "-42.13"], [9.999, "10.00"]] as const) {
  test(`usdc formats ${value}`, () => assert.equal(usdc(value), expected));
}

test("phaseIcon maps every supported phase", () => {
  assert.equal(phaseIcon("done"), "✓");
  assert.equal(phaseIcon("active"), "●");
  assert.equal(phaseIcon("pending"), "○");
});
