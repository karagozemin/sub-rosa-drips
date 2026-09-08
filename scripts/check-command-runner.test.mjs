import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { findViolations, discoverTargetScripts, scanTargetScripts } from "./check-command-runner.mjs";

describe("findViolations", () => {
  it("flags missing runCommand import", () => {
    const hits = findViolations(
      'runCommand({ name: "test", run: () => 0 });',
      "packages/test/scripts/foo.ts",
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].rule, "missing-run-command-import");
  });

  it("flags missing runCommand call", () => {
    const hits = findViolations(
      'import { runCommand } from "@sub-rosa/command";\nconsole.log("done");',
      "packages/test/scripts/foo.ts",
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].rule, "missing-run-command-call");
  });

  it("flags direct process.exit calls in operational scripts", () => {
    const hits = findViolations(
      'import { runCommand } from "@sub-rosa/command";\nrunCommand({ run: () => process.exit(1) });',
      "packages/test/scripts/foo.ts",
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].rule, "direct-process-exit");
  });

  it("passes compliant ESM command runner script", () => {
    const hits = findViolations(
      'import { runCommand } from "@sub-rosa/command";\nrunCommand({ name: "test", run: () => 0 });',
      "packages/test/scripts/foo.ts",
    );
    assert.equal(hits.length, 0);
  });

  it("passes compliant CJS command runner script", () => {
    const hits = findViolations(
      'const { runCommand } = require("@sub-rosa/command");\nrunCommand({ name: "test", run: () => 0 });',
      "scripts/check-test.js",
    );
    assert.equal(hits.length, 0);
  });
});

describe("discoverTargetScripts", () => {
  it("discovers all root check scripts and operational service scripts", () => {
    const targets = discoverTargetScripts();
    assert.ok(targets.includes("scripts/check-links.js"));
    assert.ok(targets.includes("scripts/check-command-runner.mjs"));
    assert.ok(targets.includes("services/keeper/src/run.ts"));
    assert.ok(targets.includes("services/receipt-cli/src/index.ts"));
    assert.ok(targets.includes("packages/sdk/scripts/live-smoke.ts"));
  });
});

describe("scanTargetScripts", () => {
  it("passes on the current repository tree with zero violations", () => {
    const violations = scanTargetScripts();
    assert.equal(
      violations.length,
      0,
      violations.map((v) => `${v.relPath}: [${v.rule}] ${v.message}`).join("\n"),
    );
  });
});
