// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";

import { DEMO_TRACE } from "./demo-trace.generated.js";
import {
  assertDemoTrace,
  DemoTraceHealthCheckError,
} from "./trace-health-check.js";
import {
  computeMilestoneChecksum,
  LIFE_CYCLE_PHASES_CHECKSUM,
  verifyMilestones,
} from "./demo-trace.checksum.js";

test("canonical generated demo trace contains every field required by the UI", () => {
  assert.doesNotThrow(() => assertDemoTrace(DEMO_TRACE));
});

test("health check identifies a missing required field by its trace path", () => {
  const invalidTrace = structuredClone(DEMO_TRACE) as unknown as {
    meta: { contractId?: string };
  };
  delete invalidTrace.meta.contractId;

  assert.throws(
    () => assertDemoTrace(invalidTrace),
    (error: unknown) => {
      assert.ok(error instanceof DemoTraceHealthCheckError);
      assert.match(error.message, /meta\.contractId must be a non-empty string/);
      return true;
    },
  );
});

test("health check requires an auditor evidence blob for every bidder", () => {
  const invalidTrace = structuredClone(DEMO_TRACE) as unknown as {
    auditor: { blobs: Record<string, string> };
  };
  delete invalidTrace.auditor.blobs["agent-alpha"];

  assert.throws(
    () => assertDemoTrace(invalidTrace),
    /auditor\.blobs\.agent-alpha must be a non-empty string/,
  );
});

test("health check requires at least one lifecycle event", () => {
  const invalidTrace = structuredClone(DEMO_TRACE) as unknown as {
    lifecycle: unknown[];
  };
  invalidTrace.lifecycle = [];

  assert.throws(
    () => assertDemoTrace(invalidTrace),
    /lifecycle must contain at least one item/,
  );
});

test("checksum matches the generated trace lifecycle phases", () => {
  assert.strictEqual(computeMilestoneChecksum(), LIFE_CYCLE_PHASES_CHECKSUM);
});

test("every required milestone phase is present in the trace lifecycle", () => {
  const phases = DEMO_TRACE.lifecycle.map((e: { phase: string }) => e.phase);
  const result = verifyMilestones(phases);
  assert.ok(
    result.ok,
    result.ok ? "" : `Missing milestones: ${result.missing.join(", ")}`,
  );
});

test("receipt milestone — settlement section is present", () => {
  assert.ok(
    "settlement" in DEMO_TRACE,
    "trace must have a settlement section (receipt)",
  );
  const settlement = (DEMO_TRACE as Record<string, unknown>).settlement;
  assert.ok(
    typeof settlement === "object" && settlement !== null,
    "settlement must be an object",
  );
});

test("checksum fails when a required milestone is removed from lifecycle", () => {
  const stripped = DEMO_TRACE.lifecycle.filter(
    (e: { phase: string }) => e.phase !== "open_reveal",
  );
  const phases = stripped.map((e: { phase: string }) => e.phase);
  const result = verifyMilestones(phases);
  assert.ok(!result.ok);
  assert.ok(result.ok === false && result.missing.includes("open_reveal"));
});
