import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findViolations } from "./check-direct-env-access.mjs";

describe("findViolations", () => {
  it("allows packages/config/src/system.ts", () => {
    const hits = findViolations(
      "export function getSystemEnv() { return process.env; }",
      "packages/config/src/system.ts",
    );
    assert.equal(hits.length, 0);
  });

  it("allows packages/config/src/browser.ts", () => {
    const hits = findViolations(
      "export function getBrowserEnv() { return import.meta.env; }",
      "packages/config/src/browser.ts",
    );
    assert.equal(hits.length, 0);
  });

  it("flags process.env access in service and package code", () => {
    const hits = findViolations(
      "const port = process.env.PORT;\nconst host = process.env['HOST'];",
      "services/keeper/src/serve.ts",
    );
    assert.equal(hits.length, 2);
    assert.equal(hits[0].pattern, "process.env");
    assert.equal(hits[1].pattern, "process.env");
  });

  it("flags import.meta.env access in browser code", () => {
    const hits = findViolations(
      "const rpc = import.meta.env.VITE_RPC_URL;",
      "apps/web/src/lib/chain.ts",
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].pattern, "import.meta.env");
  });

  it("ignores string literals mentioning process.env", () => {
    const hits = findViolations(
      'define: { "process.env": "{}" }',
      "apps/web/vite.config.ts",
    );
    assert.equal(hits.length, 0);
  });

  it("ignores comment lines mentioning process.env", () => {
    const hits = findViolations(
      "// Default fallback when process.env is unset\n/* process.env.FOO */\n * process.env.BAR",
      "packages/sdk/src/client.ts",
    );
    assert.equal(hits.length, 0);
  });
});
