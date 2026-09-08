import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REDACTED,
  isSensitiveKey,
  scrubText,
  collectSecrets,
  redactSensitive,
} from "./redact.js";

const VALID_STELLAR_SECRET = "S" + "B".repeat(55);

describe("redact - sensitive keys", () => {
  it("identifies sensitive key variants", () => {
    assert.equal(isSensitiveKey("secret"), true);
    assert.equal(isSensitiveKey("authToken"), true);
    assert.equal(isSensitiveKey("user_password"), true);
    assert.equal(isSensitiveKey("private_key"), true);
    assert.equal(isSensitiveKey("api_key"), true);
    assert.equal(isSensitiveKey("sessionCookie"), true);
    assert.equal(isSensitiveKey("seedPhrase"), true);
    assert.equal(isSensitiveKey("username"), false);
    assert.equal(isSensitiveKey("roundId"), false);
  });
});

describe("redact - scrubText", () => {
  it("redacts credentials from URLs", () => {
    const text = "connecting to https://alice:secretPass123@stellar.org/rpc";
    const scrubbed = scrubText(text);
    assert.equal(scrubbed, "connecting to https://[REDACTED]@stellar.org/rpc");
  });

  it("redacts sensitive query parameters", () => {
    const text = "GET /api?api_key=secretKey123&foo=bar&token=jwtTokenVal";
    const scrubbed = scrubText(text);
    assert.equal(scrubbed, "GET /api?api_key=[REDACTED]&foo=bar&token=[REDACTED]");
  });

  it("redacts bearer and basic authorization tokens", () => {
    const text = "Header Authorization: Bearer eyJhbGciOiJIUzI1Ni.secret and Basic dXNlcjpwYXNz";
    const scrubbed = scrubText(text);
    assert.equal(scrubbed, "Header Authorization: Bearer [REDACTED] and Basic [REDACTED]");
  });

  it("redacts Stellar secret keys", () => {
    const text = `Signing with secret ${VALID_STELLAR_SECRET} on testnet`;
    const scrubbed = scrubText(text);
    assert.equal(scrubbed, "Signing with secret [REDACTED] on testnet");
  });

  it("redacts PEM private keys", () => {
    const text = "Key content: -----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY----- trailing";
    const scrubbed = scrubText(text);
    assert.equal(scrubbed, "Key content: [REDACTED] trailing");
  });

  it("redacts dynamically collected secrets", () => {
    const secrets = new Set(["customSecretTokenValue"]);
    const text = "Found secret customSecretTokenValue in log";
    const scrubbed = scrubText(text, secrets);
    assert.equal(scrubbed, "Found secret [REDACTED] in log");
  });
});

describe("redact - collectSecrets", () => {
  it("gathers string secrets from sensitive keys recursively", () => {
    const secrets = new Set<string>();
    const obj = {
      user: "alice",
      token: "secretTokenVal123",
      nested: {
        apiKey: "mySuperSecretApiKey",
      },
    };
    collectSecrets(obj, secrets);
    assert.equal(secrets.has("secretTokenVal123"), true);
    assert.equal(secrets.has("mySuperSecretApiKey"), true);
  });
});

describe("redact - redactSensitive", () => {
  it("masks sensitive dictionary keys and values", () => {
    const obj = {
      username: "bob",
      password: "plaintextPassword",
      nested: {
        secret: "myKey",
        safeValue: 42,
      },
    };
    const redacted = redactSensitive(obj) as Record<string, unknown>;
    assert.equal(redacted.username, "bob");
    assert.equal(redacted.password, REDACTED);
    const nested = redacted.nested as Record<string, unknown>;
    assert.equal(nested.secret, REDACTED);
    assert.equal(nested.safeValue, 42);
  });

  it("handles circular references safely without blowing stack", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    const redacted = redactSensitive(circular) as Record<string, unknown>;
    assert.equal(redacted.name, "loop");
    assert.equal(redacted.self, "[Circular]");
  });

  it("handles primitives and special types gracefully", () => {
    assert.equal(redactSensitive(123n), "123");
    assert.equal(redactSensitive(null), null);
    assert.equal(redactSensitive(undefined), null);
    assert.equal(redactSensitive(true), true);
    assert.equal(redactSensitive(Symbol("test")), "[symbol]");
  });
});
