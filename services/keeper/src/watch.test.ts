// Copyright (c) 2026 Sub Rosa contributors
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  discoverRoundIds,
  parseRoundIdSpec,
} from "./index.js";

test("parseRoundIdSpec handles singles and ranges", () => {
  assert.deepEqual(parseRoundIdSpec("1,3,5"), [1n, 3n, 5n]);
  assert.deepEqual(parseRoundIdSpec("1-3"), [1n, 2n, 3n]);
  assert.deepEqual(parseRoundIdSpec("2, 4-6"), [2n, 4n, 5n, 6n]);
});

test("discoverRoundIds stops at RoundNotFound", async () => {
  const reader = {
    getRound: async (id: bigint) => {
      if (id <= 3n) return { status: { tag: "Open" } };
      throw new Error("HostError: RoundNotFound(3)");
    },
  };

  const ids = await discoverRoundIds(reader as Pick<import("@sub-rosa/sdk").SubRosaClient, "getRound">, { from: 1n, maxProbe: 10 });
  assert.deepEqual(ids, [1n, 2n, 3n]);
});

test("discoverRoundIds returns empty when first round missing", async () => {
  const reader = {
    getRound: async () => {
      throw new Error("RoundNotFound");
    },
  };
  const ids = await discoverRoundIds(reader as Pick<import("@sub-rosa/sdk").SubRosaClient, "getRound">, { from: 1n, maxProbe: 5 });
  assert.deepEqual(ids, []);
});
