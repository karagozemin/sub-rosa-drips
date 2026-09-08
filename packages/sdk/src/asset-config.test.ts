// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StrKey } from "@stellar/stellar-sdk";

import {
  AssetConfigError,
  validateAssetConfig,
  validateAssetConfigs,
  ASSET_FIXTURES,
  type AssetConfig,
} from "./asset-config.js";

describe("validateAssetConfig - valid fixtures", () => {
  it("accepts native XLM config", () => {
    const result = validateAssetConfig(ASSET_FIXTURES.valid.native);
    assert.equal(result.type, "native");
    assert.equal(result.code, "XLM");
    assert.equal(result.decimals, 7);
  });

  it("accepts native config with boundary 0 decimals", () => {
    const result = validateAssetConfig({ type: "native", decimals: 0 });
    assert.equal(result.type, "native");
    assert.equal(result.decimals, 0);
  });

  it("accepts native config with boundary 7 decimals", () => {
    const result = validateAssetConfig({ type: "native", decimals: 7 });
    assert.equal(result.type, "native");
    assert.equal(result.decimals, 7);
  });

  it("accepts full SAC USDC config", () => {
    const result = validateAssetConfig(ASSET_FIXTURES.valid.sac);
    assert.equal(result.type, "sac");
    assert.equal(result.code, "USDC");
    assert.equal(result.contractId, ASSET_FIXTURES.valid.sac.contractId);
    assert.ok(StrKey.isValidEd25519PublicKey(result.issuer!));
    assert.equal(result.decimals, 7);
  });

  it("accepts minimal SAC config without code/issuer/decimals", () => {
    const result = validateAssetConfig(ASSET_FIXTURES.valid.sacMinimal);
    assert.equal(result.type, "sac");
    assert.equal(result.contractId, ASSET_FIXTURES.valid.sacMinimal.contractId);
    assert.equal(result.code, undefined);
  });

  it("accepts SAC config with boundary 0 decimals", () => {
    const result = validateAssetConfig({
      type: "sac",
      contractId: ASSET_FIXTURES.valid.sacMinimal.contractId,
      decimals: 0,
    });
    assert.equal(result.type, "sac");
    assert.equal(result.decimals, 0);
  });

  it("accepts SAC config with boundary 18 decimals", () => {
    const result = validateAssetConfig({
      type: "sac",
      contractId: ASSET_FIXTURES.valid.sacMinimal.contractId,
      decimals: 18,
    });
    assert.equal(result.type, "sac");
    assert.equal(result.decimals, 18);
  });

  it("accepts SAC config with metadata", () => {
    const result = validateAssetConfig(ASSET_FIXTURES.valid.sacWithMetadata);
    assert.equal(result.type, "sac");
    assert.deepEqual(result.metadata, {
      name: "USD Coin",
      website: "https://example.com",
    });
  });
});

describe("validateAssetConfig - invalid fixtures", () => {
  it("rejects malformed issuer address", () => {
    assert.throws(
      () => validateAssetConfig(ASSET_FIXTURES.invalid.malformedIssuer),
      (e: AssetConfigError) => {
        assert.equal(e.field, "issuer");
        assert.match(e.message, /invalid issuer/);
        return true;
      },
    );
  });

  it("rejects malformed contract ID", () => {
    assert.throws(
      () => validateAssetConfig(ASSET_FIXTURES.invalid.malformedContractId),
      (e: AssetConfigError) => {
        assert.equal(e.field, "contractId");
        assert.match(e.message, /invalid contract ID/);
        return true;
      },
    );
  });

  it("rejects unsupported asset type", () => {
    assert.throws(
      () => validateAssetConfig(ASSET_FIXTURES.invalid.unsupportedType),
      (e: AssetConfigError) => {
        assert.equal(e.field, "type");
        assert.match(e.message, /unsupported asset type/);
        return true;
      },
    );
  });

  it("rejects SAC config missing contractId", () => {
    assert.throws(
      () => validateAssetConfig(ASSET_FIXTURES.invalid.missingContractId),
      (e: AssetConfigError) => {
        assert.equal(e.field, "contractId");
        assert.match(e.message, /contractId is required/);
        return true;
      },
    );
  });

  it("rejects native decimals exceeding MAX_STROOPS_DECIMALS", () => {
    assert.throws(
      () => validateAssetConfig(ASSET_FIXTURES.invalid.nativeInvalidDecimals),
      (e: AssetConfigError) => {
        assert.equal(e.field, "decimals");
        assert.match(e.message, /decimals must be 0-7/);
        return true;
      },
    );
  });

  it("rejects native negative decimals", () => {
    assert.throws(
      () => validateAssetConfig({ type: "native", decimals: -1 }),
      (e: AssetConfigError) => {
        assert.equal(e.field, "decimals");
        assert.match(e.message, /decimals must be 0-7/);
        return true;
      },
    );
  });

  it("rejects decimals exceeding MAX_TOKEN_DECIMALS", () => {
    assert.throws(
      () => validateAssetConfig(ASSET_FIXTURES.invalid.invalidDecimals),
      (e: AssetConfigError) => {
        assert.equal(e.field, "decimals");
        assert.match(e.message, /decimals must be 0-18/);
        return true;
      },
    );
  });

  it("rejects negative decimals", () => {
    assert.throws(
      () => validateAssetConfig(ASSET_FIXTURES.invalid.negativeDecimals),
      (e: AssetConfigError) => {
        assert.equal(e.field, "decimals");
        assert.match(e.message, /decimals must be 0-18/);
        return true;
      },
    );
  });

  it("rejects asset code longer than 12 characters", () => {
    assert.throws(
      () => validateAssetConfig(ASSET_FIXTURES.invalid.invalidCodeTooLong),
      (e: AssetConfigError) => {
        assert.equal(e.field, "code");
        assert.match(e.message, /1-12 alphanumeric/);
        return true;
      },
    );
  });

  it("rejects empty asset code", () => {
    assert.throws(
      () => validateAssetConfig(ASSET_FIXTURES.invalid.invalidCodeEmpty),
      (e: AssetConfigError) => {
        assert.equal(e.field, "code");
        assert.match(e.message, /1-12 alphanumeric/);
        return true;
      },
    );
  });

  it("rejects null input", () => {
    assert.throws(
      () => validateAssetConfig(ASSET_FIXTURES.invalid.nullInput),
      AssetConfigError,
    );
  });

  it("rejects non-object input", () => {
    assert.throws(
      () => validateAssetConfig(ASSET_FIXTURES.invalid.nonObjectInput),
      AssetConfigError,
    );
  });

  it("rejects array input", () => {
    assert.throws(
      () => validateAssetConfig(ASSET_FIXTURES.invalid.arrayInput),
      AssetConfigError,
    );
  });

  it("rejects config missing type field", () => {
    assert.throws(
      () => validateAssetConfig(ASSET_FIXTURES.invalid.missingType),
      AssetConfigError,
    );
  });

  it("rejects non-object metadata", () => {
    assert.throws(
      () => validateAssetConfig(ASSET_FIXTURES.invalid.invalidMetadata),
      (e: AssetConfigError) => {
        assert.equal(e.field, "metadata");
        assert.match(e.message, /metadata must be a plain object/);
        return true;
      },
    );
  });
});

describe("validateAssetConfigs", () => {
  it("accepts an array of valid configs", () => {
    const results = validateAssetConfigs([
      ASSET_FIXTURES.valid.native,
      ASSET_FIXTURES.valid.sac,
    ]);
    assert.equal(results.length, 2);
    assert.equal(results[0]!.type, "native");
    assert.equal(results[1]!.type, "sac");
  });

  it("prefixes error field with array index on failure", () => {
    assert.throws(
      () =>
        validateAssetConfigs([
          ASSET_FIXTURES.valid.native,
          ASSET_FIXTURES.invalid.malformedContractId,
        ]),
      (e: AssetConfigError) => {
        assert.equal(e.field, "[1].contractId");
        return true;
      },
    );
  });

  it("rejects empty array gracefully", () => {
    const results = validateAssetConfigs([]);
    assert.deepEqual(results, []);
  });
});

describe("AssetConfigError", () => {
  it("sets name, field and message", () => {
    const err = new AssetConfigError("decimals", "must be 0-18");
    assert.equal(err.name, "AssetConfigError");
    assert.equal(err.field, "decimals");
    assert.equal(err.message, "decimals: must be 0-18");
  });

  it("preserves cause", () => {
    const cause = new Error("root");
    const err = new AssetConfigError("type", "bad type", { cause });
    assert.equal(err.cause, cause);
  });
});

describe("asset-specific decimal limits", () => {
  for (const [type, maximum] of [["native", 7], ["sac", 18]] as const) {
    const base = type === "native" ? ASSET_FIXTURES.valid.native : ASSET_FIXTURES.valid.sac;
    for (const decimals of [0, maximum]) {
      it(`accepts ${type} decimals=${decimals}`, () => {
        assert.equal(validateAssetConfig({ ...base, decimals }).decimals, decimals);
      });
    }
    for (const decimals of [-1, maximum + 1]) {
      it(`rejects ${type} decimals=${decimals}`, () => {
        assert.throws(() => validateAssetConfig({ ...base, decimals }), (error: unknown) => {
          assert.ok(error instanceof AssetConfigError);
          assert.equal(error.field, "decimals");
          assert.ok(error.message.includes(`0-${maximum}`));
          return true;
        });
      });
    }
  }
  it("retains SAC support above the native precision limit", () => {
    assert.equal(validateAssetConfig({ ...ASSET_FIXTURES.valid.sac, decimals: 8 }).decimals, 8);
  });
});
