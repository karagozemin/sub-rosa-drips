import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspect } from "node:util";
import { isSecret, secret, SecretValue } from "./secret.js";

describe("SecretValue", () => {
  it("unwraps raw sensitive string", () => {
    const sensitive = "super-secret-stellar-key-12345";
    const wrapped = secret(sensitive);
    assert.equal(wrapped.unwrap(), sensitive);
  });

  it("redacts string conversion", () => {
    const wrapped = secret("raw-token");
    assert.equal(wrapped.toString(), "[REDACTED]");
    assert.equal(`${wrapped}`, "[REDACTED]");
    assert.equal(String(wrapped), "[REDACTED]");
  });

  it("redacts JSON serialization", () => {
    const payload = { token: secret("secret-abc"), name: "sub-rosa" };
    const serialized = JSON.stringify(payload);
    assert.equal(serialized, JSON.stringify({ token: "[REDACTED]", name: "sub-rosa" }));
    assert.ok(!serialized.includes("secret-abc"));
  });

  it("redacts node util.inspect output", () => {
    const wrapped = secret("private-key");
    const inspected = inspect(wrapped);
    assert.equal(inspected, "[REDACTED]");
    assert.ok(!inspected.includes("private-key"));
  });

  it("identifies SecretValue instances with isSecret predicate", () => {
    const wrapped = new SecretValue("test");
    assert.ok(isSecret(wrapped));
    assert.ok(isSecret(secret("test")));
    assert.ok(!isSecret("plain string"));
    assert.ok(!isSecret({}));
    assert.ok(!isSecret(null));
    assert.ok(!isSecret(undefined));
  });

  it("freezes instance preventing modification", () => {
    const wrapped = secret("data");
    assert.ok(Object.isFrozen(wrapped));
  });
});
