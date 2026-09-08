import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readInteger, readString } from "./readers.js";
import { defineSchema } from "./schema.js";

describe("defineSchema", () => {
  interface ServerConfig {
    readonly host: string;
    readonly port: number;
  }

  const parseServerConfig = defineSchema<ServerConfig>((env) => ({
    host: readString(env, "TEST_HOST", { default: "127.0.0.1" }),
    port: readInteger(env, "TEST_PORT", { default: 8080 }),
  }));

  it("produces an immutable frozen configuration object", () => {
    const config = parseServerConfig({ TEST_HOST: "0.0.0.0", TEST_PORT: "9000" });
    assert.equal(config.host, "0.0.0.0");
    assert.equal(config.port, 9000);
    assert.ok(Object.isFrozen(config));
    assert.throws(() => {
      (config as any).host = "changed";
    });
  });

  it("supports dependency injection without touching process state", () => {
    const injected = { TEST_HOST: "test.local", TEST_PORT: "443" };

    const config = parseServerConfig(injected);
    assert.equal(config.host, "test.local");
    assert.equal(config.port, 443);
  });
});
