import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import {
  EmptyEnvironmentVariableError,
  MalformedEnvironmentVariableError,
  MissingEnvironmentVariableError,
} from "./errors.js";
import {
  readBoolean,
  readEnum,
  readInteger,
  readNumber,
  readSecret,
  readStellarContractId,
  readStellarPublicKey,
  readStellarSecretKey,
  readString,
  readUrl,
} from "./readers.js";
import { isSecret } from "./secret.js";

const TEST_KEYPAIR = Keypair.random();
const VALID_PUBKEY = TEST_KEYPAIR.publicKey();
const VALID_SECRET = TEST_KEYPAIR.secret();
const VALID_CONTRACT = "CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX";

describe("readString", () => {
  it("reads present string and trims whitespace", () => {
    const val = readString({ NAME: "  sub-rosa  " }, "NAME");
    assert.equal(val, "sub-rosa");
  });

  it("returns default value when variable is missing", () => {
    const val = readString({}, "NAME", { default: "fallback" });
    assert.equal(val, "fallback");
  });

  it("throws MissingEnvironmentVariableError when required variable is absent", () => {
    assert.throws(
      () => readString({}, "NAME", { required: true }),
      (err: unknown) => {
        assert.ok(err instanceof MissingEnvironmentVariableError);
        assert.equal(err.key, "NAME");
        return true;
      },
    );
  });

  it("throws EmptyEnvironmentVariableError when variable contains only whitespace", () => {
    assert.throws(
      () => readString({ NAME: "   " }, "NAME", { required: true }),
      (err: unknown) => {
        assert.ok(err instanceof EmptyEnvironmentVariableError);
        assert.equal(err.key, "NAME");
        return true;
      },
    );
  });

  it("allows empty string when allowEmpty is true", () => {
    const val = readString({ NAME: "" }, "NAME", { allowEmpty: true });
    assert.equal(val, "");
  });
});

describe("readBoolean", () => {
  it("parses valid true representations", () => {
    assert.equal(readBoolean({ FLAG: "true" }, "FLAG"), true);
    assert.equal(readBoolean({ FLAG: "TRUE" }, "FLAG"), true);
    assert.equal(readBoolean({ FLAG: "1" }, "FLAG"), true);
  });

  it("parses valid false representations", () => {
    assert.equal(readBoolean({ FLAG: "false" }, "FLAG"), false);
    assert.equal(readBoolean({ FLAG: "FALSE" }, "FLAG"), false);
    assert.equal(readBoolean({ FLAG: "0" }, "FLAG"), false);
  });

  it("falls back to default boolean when omitted", () => {
    assert.equal(readBoolean({}, "FLAG", { default: true }), true);
    assert.equal(readBoolean({}, "FLAG", { default: false }), false);
  });

  it("throws MalformedEnvironmentVariableError on invalid boolean input", () => {
    assert.throws(
      () => readBoolean({ FLAG: "yes" }, "FLAG"),
      (err: unknown) => {
        assert.ok(err instanceof MalformedEnvironmentVariableError);
        assert.equal(err.key, "FLAG");
        return true;
      },
    );
  });
});

describe("readInteger", () => {
  it("parses valid base-10 integer", () => {
    assert.equal(readInteger({ PORT: "8080" }, "PORT"), 8080);
    assert.equal(readInteger({ COUNT: "-5" }, "COUNT"), -5);
  });

  it("applies default when missing", () => {
    assert.equal(readInteger({}, "PORT", { default: 3000 }), 3000);
  });

  it("rejects non-integer strings and floats", () => {
    assert.throws(
      () => readInteger({ PORT: "8080abc" }, "PORT"),
      (err: unknown) => {
        assert.ok(err instanceof MalformedEnvironmentVariableError);
        assert.equal(err.key, "PORT");
        return true;
      },
    );
    assert.throws(
      () => readInteger({ PORT: "80.5" }, "PORT"),
      (err: unknown) => {
        assert.ok(err instanceof MalformedEnvironmentVariableError);
        return true;
      },
    );
  });

  it("enforces min and max bounds", () => {
    assert.throws(
      () => readInteger({ PORT: "10" }, "PORT", { min: 1024 }),
      (err: unknown) => {
        assert.ok(err instanceof MalformedEnvironmentVariableError);
        assert.match(err.message, /at least 1024/);
        return true;
      },
    );
    assert.throws(
      () => readInteger({ PORT: "70000" }, "PORT", { max: 65535 }),
      (err: unknown) => {
        assert.ok(err instanceof MalformedEnvironmentVariableError);
        assert.match(err.message, /at most 65535/);
        return true;
      },
    );
  });
});

describe("readNumber", () => {
  it("parses positive floating point numbers", () => {
    assert.equal(readNumber({ PRICE: "0.15" }, "PRICE", { positive: true }), 0.15);
  });

  it("rejects non-positive numbers when positive is requested", () => {
    assert.throws(
      () => readNumber({ PRICE: "0" }, "PRICE", { positive: true }),
      (err: unknown) => {
        assert.ok(err instanceof MalformedEnvironmentVariableError);
        return true;
      },
    );
    assert.throws(
      () => readNumber({ PRICE: "-1.5" }, "PRICE", { positive: true }),
      (err: unknown) => {
        assert.ok(err instanceof MalformedEnvironmentVariableError);
        return true;
      },
    );
  });
});

describe("readUrl", () => {
  it("parses valid http/https URLs and normalizes trailing slashes", () => {
    assert.equal(
      readUrl({ RPC: "https://stellar.org/rpc/" }, "RPC"),
      "https://stellar.org/rpc",
    );
    assert.equal(
      readUrl({ RPC: "http://localhost:8000/" }, "RPC"),
      "http://localhost:8000",
    );
  });

  it("applies default URL when missing", () => {
    assert.equal(
      readUrl({}, "RPC", { default: "https://default.stellar.org" }),
      "https://default.stellar.org",
    );
  });

  it("rejects invalid URLs and unsupported protocols", () => {
    assert.throws(
      () => readUrl({ RPC: "not-a-url" }, "RPC"),
      (err: unknown) => {
        assert.ok(err instanceof MalformedEnvironmentVariableError);
        return true;
      },
    );
    assert.throws(
      () => readUrl({ RPC: "ftp://example.com" }, "RPC"),
      (err: unknown) => {
        assert.ok(err instanceof MalformedEnvironmentVariableError);
        return true;
      },
    );
  });

  it("rejects URLs with credentials when requireNoCredentials is set", () => {
    assert.throws(
      () => readUrl({ RPC: "https://user:pass@example.com" }, "RPC", { requireNoCredentials: true }),
      (err: unknown) => {
        assert.ok(err instanceof MalformedEnvironmentVariableError);
        assert.match(err.message, /must not contain credentials/);
        return true;
      },
    );
  });
});

describe("readEnum", () => {
  const NETWORKS = ["stellar:testnet", "stellar:pubnet"] as const;

  it("parses valid enum option", () => {
    assert.equal(readEnum({ NET: "stellar:testnet" }, "NET", NETWORKS), "stellar:testnet");
  });

  it("falls back to default enum", () => {
    assert.equal(readEnum({}, "NET", NETWORKS, { default: "stellar:pubnet" }), "stellar:pubnet");
  });

  it("rejects disallowed enum variant", () => {
    assert.throws(
      () => readEnum({ NET: "stellar:local" }, "NET", NETWORKS),
      (err: unknown) => {
        assert.ok(err instanceof MalformedEnvironmentVariableError);
        assert.match(err.message, /must be one of: stellar:testnet, stellar:pubnet/);
        return true;
      },
    );
  });
});

describe("Stellar identifiers and secrets", () => {
  it("validates Stellar public keys", () => {
    assert.equal(readStellarPublicKey({ PUB: VALID_PUBKEY }, "PUB"), VALID_PUBKEY);
    assert.throws(
      () => readStellarPublicKey({ PUB: "GNOTVALID" }, "PUB"),
      (err: unknown) => {
        assert.ok(err instanceof MalformedEnvironmentVariableError);
        assert.match(err.message, /must be a valid Stellar G\.\.\. account address/);
        return true;
      },
    );
  });

  it("validates Stellar contract addresses", () => {
    assert.equal(readStellarContractId({ CONTRACT: VALID_CONTRACT }, "CONTRACT"), VALID_CONTRACT);
    assert.throws(
      () => readStellarContractId({ CONTRACT: "CNOTVALID" }, "CONTRACT"),
      (err: unknown) => {
        assert.ok(err instanceof MalformedEnvironmentVariableError);
        assert.match(err.message, /must be a valid Stellar C\.\.\. contract address/);
        return true;
      },
    );
  });

  it("validates and wraps Stellar secret keys without exposing secret on error", () => {
    const wrapped = readStellarSecretKey({ SEC: VALID_SECRET }, "SEC", { required: true });
    assert.ok(isSecret(wrapped));
    assert.equal(wrapped.unwrap(), VALID_SECRET);
    assert.equal(wrapped.toString(), "[REDACTED]");

    assert.throws(
      () => readStellarSecretKey({ SEC: "SBADSECRET123" }, "SEC", { required: true }),
      (err: unknown) => {
        assert.ok(err instanceof MalformedEnvironmentVariableError);
        assert.match(err.message, /must be a valid Stellar secret key/);
        assert.ok(!err.message.includes("SBADSECRET123"));
        return true;
      },
    );
  });

  it("reads generic secrets as SecretValue container", () => {
    const wrapped = readSecret({ API_KEY: "my-api-key" }, "API_KEY", { required: true });
    assert.ok(isSecret(wrapped));
    assert.equal(wrapped.unwrap(), "my-api-key");
    assert.equal(wrapped.toString(), "[REDACTED]");
  });
});
