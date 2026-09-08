import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getBrowserEnv } from "./browser.js";
import { ConfigError } from "./errors.js";
import { readBrowserPublic } from "./readers.js";

describe("readBrowserPublic and getBrowserEnv", () => {
  it("enforces VITE_ prefix on browser-facing variables", () => {
    const val = readBrowserPublic({ VITE_RPC_URL: "https://rpc.example.com" }, "VITE_RPC_URL");
    assert.equal(val, "https://rpc.example.com");

    assert.throws(
      () => readBrowserPublic({ SECRET_KEY: "secret" }, "SECRET_KEY"),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /must start with VITE_ prefix/);
        return true;
      },
    );
  });

  it("reads browser environment with injection support", () => {
    const custom = { VITE_API: "https://api.example.com" };
    const env = getBrowserEnv(custom);
    assert.equal(env.VITE_API, "https://api.example.com");
  });
});
