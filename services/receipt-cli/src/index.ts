#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { createLogger, writeData } from '@sub-rosa/logging';
const diagnostics = createLogger("services.receipt-cli.src.index");
// receipt-cli — export a round receipt from RPC or verify a local file.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SubRosaClient, parseReceipt, serializeReceipt, verifyReceipt, redactReceipt } from "@sub-rosa/sdk";
import { runCommand, CommandError } from "@sub-rosa/command";
import { buildJsonOutput } from "./json-output.js";

function usage(): never {
  diagnostics.error("usage-receipt-cli-export-roundid-fetch-receipt-from-rpc", `
Usage:
  receipt-cli export <roundId>             Fetch receipt from RPC (uses env config)
  receipt-cli verify <receipt.json> [--json] [--verify-artifact-checksum <artifact-file>]
  receipt-cli redact <receipt.json> [out]  Redact sensitive fields for public demo

Options for "verify":
  --json                                  Print machine-readable verification output
  --verify-artifact-checksum <artifact-file>
                                          Verify the checksum of the required artifact file

Environment for "export":
  RPC_URL                  Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
  NETWORK_PASSPHRASE       Network passphrase (default: Test SDF Network ; September 2015)
  CONTRACT_ID              Round contract ID (C…)
`);
  throw new CommandError("Invalid receipt-cli invocation", 1);
}

async function cmdExport(roundIdStr: string): Promise<number> {
  const roundId = BigInt(roundIdStr);
  const rpcUrl = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
  const networkPassphrase =
    process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
  const contractId = process.env.CONTRACT_ID;
  if (!contractId) {
    diagnostics.error("contract-id-env-var-is-required-for-export", "CONTRACT_ID env var is required for export");
    return 1;
  }

  const client = new SubRosaClient({ rpcUrl, networkPassphrase, contractId });
  const receipt = await client.exportReceipt(roundId);
  const json = serializeReceipt(receipt);
  const filename = `round-${roundId}-receipt.json`;
  writeFileSync(filename, json, "utf-8");
  diagnostics.info("wrote", `Wrote ${filename}`);
  return 0;
}

async function cmdVerify(path: string, jsonMode: boolean, artifactPath?: string): Promise<number> {
  let rawJson: string;
  try {
    rawJson = readFileSync(path, "utf-8");
  } catch (e) {
    if (jsonMode) {
      writeData(JSON.stringify(buildJsonOutput(null, null, `Cannot read file: ${e}`), null, 2));
    } else {
      diagnostics.error("cannot-read", `Cannot read ${path}: ${e}`);
    }
    return 1;
  }

  let receipt;
  try {
    receipt = parseReceipt(rawJson);
  } catch (e) {
    if (jsonMode) {
      writeData(JSON.stringify(buildJsonOutput(null, null, `Invalid JSON: ${e}`), null, 2));
    } else {
      diagnostics.error("invalid-json", `Invalid JSON: ${e}`);
    }
    return 1;
  }

  const result = verifyReceipt(receipt);

  if (artifactPath) {
    let computedChecksum = "";
    try {
      const data = readFileSync(artifactPath);
      computedChecksum = createHash("sha256").update(data).digest("hex");
    } catch (e: any) {
      const message = `Cannot read artifact file: ${e.message}`;
      result.valid = false;
      result.issues.push({
        severity: "error",
        code: "missing_artifact_file",
        message,
        path: artifactPath,
      });
      if (jsonMode) {
        writeData(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
      } else {
        diagnostics.error("error", `Error: ${message}`);
      }
      return 1;
    }

    if (!receipt.artifactChecksum) {
      const message = "Missing checksum metadata in receipt";
      result.valid = false;
      result.issues.push({
        severity: "error",
        code: "missing_checksum_metadata",
        message,
      });
      if (jsonMode) {
        writeData(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
      } else {
        diagnostics.error("error-2", `Error: ${message}`);
      }
      return 1;
    }

    if (receipt.artifactChecksum !== computedChecksum) {
      const message = `Checksum mismatch. Expected: ${receipt.artifactChecksum}, computed: ${computedChecksum}`;
      result.valid = false;
      result.issues.push({
        severity: "error",
        code: "checksum_mismatch",
        message,
      });
      if (jsonMode) {
        writeData(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
      } else {
        diagnostics.error("error-3", `Error: ${message}`);
      }
      return 1;
    }
  }

  if (jsonMode) {
    writeData(JSON.stringify(buildJsonOutput(receipt, result, null), null, 2));
    return result.valid ? 0 : 1;
  }

  const status = result.valid ? "PASS" : "FAIL";
  diagnostics.info("verification", `Verification: ${status}`);
  if (artifactPath && result.valid) {
    diagnostics.info("artifact-verification-pass", "Artifact verification: PASS");
  }
  diagnostics.info("computed-winner", `Computed winner: ${result.computedWinner.address ?? "(none)"} = ${result.computedWinner.value ?? "(none)"}`);

  for (const issue of result.issues) {
    const icon = issue.severity === "error" ? "✖" : "⚠";
    const pathStr = issue.path ? ` [${issue.path}]` : "";
    diagnostics.info("progress-7", `  ${icon} [${issue.code}]${pathStr} ${issue.message}`);
  }

  return result.valid ? 0 : 1;
}

async function cmdRedact(inputPath: string, outputPath?: string): Promise<number> {
  let json: string;
  try {
    json = readFileSync(inputPath, "utf-8");
  } catch (e) {
    diagnostics.error("cannot-read-2", `Cannot read ${inputPath}: ${e}`);
    return 1;
  }

  let receipt;
  try {
    receipt = parseReceipt(json);
  } catch (e) {
    diagnostics.error("invalid-json-2", `Invalid JSON: ${e}`);
    return 1;
  }

  const redacted = redactReceipt(receipt);
  const out = serializeReceipt(redacted);
  const outPath = outputPath ?? inputPath.replace(/\.json$/, ".redacted.json");
  writeFileSync(outPath, out, "utf-8");
  diagnostics.info("wrote-redacted-receipt-to", `Wrote redacted receipt to ${outPath}`);
  return 0;
}

runCommand({
  name: "services.receipt-cli",
  description: "Export a round receipt from RPC, verify a local file, or redact sensitive fields",
  usage: "receipt-cli <export|verify|redact> [options]",
  options: {
    json: { type: "boolean" },
    "verify-artifact-checksum": { type: "string" },
  },
  async run(ctx) {
    const [cmd] = ctx.positionals;
    if (!cmd) {
      usage();
    }

    switch (cmd) {
      case "export": {
        const arg = ctx.positionals[1];
        if (!arg) usage();
        return await cmdExport(arg);
      }
      case "verify": {
        const path = ctx.positionals[1];
        if (!path) usage();
        const jsonMode = Boolean(ctx.options.json);
        const artifactPath = typeof ctx.options["verify-artifact-checksum"] === "string"
          ? ctx.options["verify-artifact-checksum"]
          : undefined;
        return await cmdVerify(path, jsonMode, artifactPath);
      }
      case "redact": {
        const arg = ctx.positionals[1];
        if (!arg) usage();
        return await cmdRedact(arg, ctx.positionals[2]);
      }
      default:
        usage();
    }
  },
});
