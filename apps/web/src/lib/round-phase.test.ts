// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";
import type { RoundStatus } from "../dashboard/types";
import { classifyRoundPhase, type RoundPhase } from "./round-phase";

const expected: Record<RoundStatus, readonly [RoundPhase, RoundPhase]> = {
  Open: ["Open", "Reveal"],
  Revealing: ["Reveal", "Reveal"],
  Cleared: ["Reveal", "Reveal"],
  Settled: ["Settled", "Settled"],
  Voided: ["Settled", "Settled"],
};
for (const status of Object.keys(expected) as RoundStatus[]) {
  for (const drandPublished of [false, true]) {
    test(`${status} with drandPublished=${drandPublished}`, () => {
      assert.equal(classifyRoundPhase({ status, drandPublished }),
        expected[status][drandPublished ? 1 : 0]);
    });
  }
}
