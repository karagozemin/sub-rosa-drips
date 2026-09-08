// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeUrl, validatePublicConfig } from "./config";

const VALID_ENV: Record<string, string> = {
  VITE_RPC_URL: "https://custom-soroban.example.com",
  VITE_NETWORK_PASSPHRASE: "Test Custom Network",
  VITE_CONTRACT_ID: "CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX",
  VITE_ESCROW_TOKEN_LABEL: "USDC",
  VITE_ROUND_ID: "42",
};

test("valid config returns no issues", () => {
  const issues = validatePublicConfig(VALID_ENV);
  assert.equal(issues.length, 0);
});

test("valid config with optional keys missing returns no critical issues", () => {
  const env = {
    VITE_RPC_URL: "https://custom-soroban.example.com",
    VITE_NETWORK_PASSPHRASE: "Custom Network",
    VITE_CONTRACT_ID: "CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX",
  };
  const issues = validatePublicConfig(env);

  const critical = issues.filter((i) => i.key !== "VITE_ESCROW_TOKEN_LABEL" && i.key !== "VITE_ROUND_ID");
  assert.equal(critical.length, 0);
});

test("missing critical keys are reported", () => {
  const issues = validatePublicConfig({});
  const keys = issues.map((i) => i.key);
  assert.ok(keys.includes("VITE_RPC_URL"));
  assert.ok(keys.includes("VITE_NETWORK_PASSPHRASE"));
  assert.ok(keys.includes("VITE_CONTRACT_ID"));
});

test("missing VITE_CONTRACT_ID reports the correct message", () => {
  const issues = validatePublicConfig({
    VITE_RPC_URL: "https://soroban-testnet.stellar.org",
    VITE_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  });
  assert.ok(
    issues.some(
      (i) =>
        i.key === "VITE_CONTRACT_ID" &&
        i.message.includes("VITE_CONTRACT_ID is missing"),
    ),
  );
});

test("empty string values are treated as missing", () => {
  const issues = validatePublicConfig({
    VITE_RPC_URL: "",
    VITE_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    VITE_CONTRACT_ID: "  ",
  });
  assert.ok(issues.some((i) => i.key === "VITE_RPC_URL"));
  assert.ok(issues.some((i) => i.key === "VITE_CONTRACT_ID"));
});

test("missing optional keys report a non-blocking message", () => {
  const env = {
    VITE_RPC_URL: "https://custom-rpc.example.com",
    VITE_NETWORK_PASSPHRASE: "Custom Network",
    VITE_CONTRACT_ID: "CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX",
  };
  const issues = validatePublicConfig(env);
  assert.ok(issues.some((i) => i.key === "VITE_ESCROW_TOKEN_LABEL"));
  assert.ok(issues.some((i) => i.key === "VITE_ROUND_ID"));
});

test("placeholder default values are flagged", () => {
  const env = {
    VITE_RPC_URL: "https://soroban-testnet.stellar.org",
    VITE_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    VITE_CONTRACT_ID: "CC2QMOXZERI6UOR67YKSORT7QTUHQ5QUGMHQBYVP23YM3NMUNNOEOGZY",
  };
  const issues = validatePublicConfig(env);
  assert.ok(
    issues.some(
      (i) =>
        i.key === "VITE_CONTRACT_ID" &&
        i.message.includes("default/example value"),
    ),
  );
});

test("non-placeholder values are not flagged as placeholders", () => {
  const env = {
    VITE_RPC_URL: "https://custom-soroban.example.com",
    VITE_NETWORK_PASSPHRASE: "Custom Network",
    VITE_CONTRACT_ID: "CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX",
    VITE_ESCROW_TOKEN_LABEL: "USDC",
    VITE_ROUND_ID: "42",
  };
  const issues = validatePublicConfig(env);
  const placeholder = issues.filter((i) => i.message.includes("default/example value"));
  assert.equal(placeholder.length, 0);
});

test("custom config with no optional keys still passes critical check", () => {
  const env = {
    VITE_RPC_URL: "https://custom-rpc.example.com",
    VITE_NETWORK_PASSPHRASE: "Custom Network",
    VITE_CONTRACT_ID: "CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX",
  };
  const issues = validatePublicConfig(env);
  const critical = issues.filter(
    (i) => i.key !== "VITE_ESCROW_TOKEN_LABEL" && i.key !== "VITE_ROUND_ID",
  );
  assert.equal(critical.length, 0);
});


// --- URL normalization regression tests ---

test("normalizeUrl strips a single trailing slash", () => {
  assert.equal(normalizeUrl("https://soroban-testnet.stellar.org/"), "https://soroban-testnet.stellar.org");
});

test("normalizeUrl strips multiple trailing slashes", () => {
  assert.equal(normalizeUrl("https://soroban-testnet.stellar.org///"), "https://soroban-testnet.stellar.org");
});

test("normalizeUrl preserves URL without trailing slash", () => {
  assert.equal(normalizeUrl("https://soroban-testnet.stellar.org"), "https://soroban-testnet.stellar.org");
});

test("normalizeUrl trims surrounding whitespace", () => {
  assert.equal(normalizeUrl("  https://soroban-testnet.stellar.org/  "), "https://soroban-testnet.stellar.org");
});

test("VITE_RPC_URL with trailing slash is not flagged as invalid", () => {
  const issues = validatePublicConfig({
    VITE_RPC_URL: "https://soroban-testnet.stellar.org/",
    VITE_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    VITE_CONTRACT_ID: "CC2QMOXZERI6UOR67YKSORT7QTUHQ5QUGMHQBYVP23YM3NMUNNOEOGZY",
  });
  const urlIssues = issues.filter((i) => i.key === "VITE_RPC_URL" && i.message.includes("valid URL"));
  assert.equal(urlIssues.length, 0);
});

test("VITE_RPC_URL with trailing slash is still flagged as placeholder default", () => {
  const issues = validatePublicConfig({
    VITE_RPC_URL: "https://soroban-testnet.stellar.org/",
    VITE_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    VITE_CONTRACT_ID: "CC2QMOXZERI6UOR67YKSORT7QTUHQ5QUGMHQBYVP23YM3NMUNNOEOGZY",
  });
  assert.ok(
    issues.some(
      (i) =>
        i.key === "VITE_RPC_URL" &&
        i.message.includes("default/example value"),
    ),
  );
});

test("invalid VITE_RPC_URL without protocol is reported", () => {
  const issues = validatePublicConfig({
    VITE_RPC_URL: "not-a-valid-url",
    VITE_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    VITE_CONTRACT_ID: "CC2QMOXZERI6UOR67YKSORT7QTUHQ5QUGMHQBYVP23YM3NMUNNOEOGZY",
  });
  assert.ok(
    issues.some(
      (i) =>
        i.key === "VITE_RPC_URL" &&
        i.message.includes("not a valid URL"),
    ),
  );
});

test("invalid VITE_RPC_URL with non-http protocol is reported", () => {
  const issues = validatePublicConfig({
    VITE_RPC_URL: "ftp://soroban-testnet.stellar.org",
    VITE_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    VITE_CONTRACT_ID: "CC2QMOXZERI6UOR67YKSORT7QTUHQ5QUGMHQBYVP23YM3NMUNNOEOGZY",
  });
  assert.ok(
    issues.some(
      (i) =>
        i.key === "VITE_RPC_URL" &&
        i.message.includes("not a valid URL"),
    ),
  );
});

test("VITE_RPC_URL with http (not https) passes validation", () => {
  const issues = validatePublicConfig({
    VITE_RPC_URL: "http://localhost:8000",
    VITE_NETWORK_PASSPHRASE: "Custom Network",
    VITE_CONTRACT_ID: "CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX",
  });
  const urlIssues = issues.filter((i) => i.key === "VITE_RPC_URL" && i.message.includes("valid URL"));
  assert.equal(urlIssues.length, 0);
});

test("invalid VITE_RPC_URL error message is actionable", () => {
  const issues = validatePublicConfig({
    VITE_RPC_URL: "garbage",
    VITE_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    VITE_CONTRACT_ID: "CC2QMOXZERI6UOR67YKSORT7QTUHQ5QUGMHQBYVP23YM3NMUNNOEOGZY",
  });
  const msg = issues.find((i) => i.key === "VITE_RPC_URL")!.message;
  assert.ok(msg.includes("must start with http:// or https://"));
});
