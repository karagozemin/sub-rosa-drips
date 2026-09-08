// Copyright (c) 2026 Sub Rosa contributors
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeTime } from "@sub-rosa/time";

import { errorMatches, errorName, waitForRound } from "./index.js";

test("errorMatches detects idempotent contract error codes in any shape", () => {
  assert.equal(errorMatches(new Error("RevealAlreadyOpen"), ["RevealAlreadyOpen"]), true);
  assert.equal(errorMatches(new Error("HostError: ... AlreadyRevealed(32)"), ["AlreadyRevealed"]), true);
  assert.equal(errorMatches({ message: "HashMismatch" }, ["HashMismatch"]), true);
  assert.equal(errorMatches({ error: { code: "RevealWindowClosed" } }, ["RevealWindowClosed"]), true);
  assert.equal(errorMatches(new Error("InvalidDrandSignature"), ["AlreadyRevealed"]), false);
});

test("errorName extracts a readable message", () => {
  assert.equal(errorName(new Error("boom")), "boom");
  assert.equal(errorName({ message: "x" }), JSON.stringify({ message: "x" }));
});

test("waitForRound returns false for a future round when not allowed to wait", async () => {
  const { clock, scheduler } = createFakeTime(1_000_000_000_000);
  const nowS = clock.nowSeconds();
  const fakeDrand = {
    chain: () => ({
      info: async () => ({ genesis_time: nowS, period: 3 }),
    }),
  } as never;

  const ok = await waitForRound(
    {
      sdk: {} as never,
      drand: fakeDrand,
      maxWaitSeconds: 0,
      time: { clock, scheduler },
    },
    1_000_000,
  );
  assert.equal(ok, false);
});

test("waitForRound returns true immediately for an already-published round", async () => {
  const { clock, scheduler } = createFakeTime(1_000_000_000_000);
  const nowS = clock.nowSeconds();
  const fakeDrand = {
    chain: () => ({
      info: async () => ({ genesis_time: nowS - 10_000, period: 3 }),
    }),
  } as never;

  const ok = await waitForRound(
    {
      sdk: {} as never,
      drand: fakeDrand,
      maxWaitSeconds: 0,
      time: { clock, scheduler },
    },
    1,
  );
  assert.equal(ok, true);
});
