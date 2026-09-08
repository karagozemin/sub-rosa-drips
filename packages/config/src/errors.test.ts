import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ConfigError,
  EmptyEnvironmentVariableError,
  MalformedEnvironmentVariableError,
  MissingEnvironmentVariableError,
} from "./errors.js";

describe("ConfigError hierarchy", () => {
  it("formats error messages with key prefix and code", () => {
    const error = new ConfigError("TEST_VAR", "something failed", "MALFORMED");
    assert.equal(error.key, "TEST_VAR");
    assert.equal(error.variable, "TEST_VAR");
    assert.equal(error.code, "MALFORMED");
    assert.equal(error.message, "TEST_VAR: something failed");
    assert.ok(error instanceof Error);
    assert.ok(error instanceof ConfigError);
  });

  it("distinguishes missing environment variables", () => {
    const error = new MissingEnvironmentVariableError("PORT");
    assert.equal(error.key, "PORT");
    assert.equal(error.code, "MISSING");
    assert.equal(error.message, "PORT: required environment variable is missing");
    assert.ok(error instanceof ConfigError);
    assert.ok(error instanceof MissingEnvironmentVariableError);
  });

  it("distinguishes empty environment variables", () => {
    const error = new EmptyEnvironmentVariableError("RPC_URL");
    assert.equal(error.key, "RPC_URL");
    assert.equal(error.code, "EMPTY");
    assert.equal(error.message, "RPC_URL: environment variable cannot be empty");
    assert.ok(error instanceof ConfigError);
    assert.ok(error instanceof EmptyEnvironmentVariableError);
  });

  it("distinguishes malformed environment variables", () => {
    const cause = new Error("inner parser error");
    const error = new MalformedEnvironmentVariableError("TIMEOUT", "must be an integer", { cause });
    assert.equal(error.key, "TIMEOUT");
    assert.equal(error.code, "MALFORMED");
    assert.equal(error.message, "TIMEOUT: must be an integer");
    assert.equal(error.cause, cause);
    assert.ok(error instanceof ConfigError);
    assert.ok(error instanceof MalformedEnvironmentVariableError);
  });
});
