// Copyright (c) 2026 Sub Rosa contributors
import { readFileSync } from "node:fs";

import { getErrorMessage } from "@sub-rosa/errors";
import { openIdentity } from "./auditor.js";
import { fromHex, toHex } from "./commitment.js";

interface ParsedArgs {
  auditorSecretHex: string;
  inputJson?: string;
  inputJsonFile?: string;
  blobHex?: string;
  label: string;
}

interface BlobEntry {
  label: string;
  blobHex?: string;
}

export interface RecoveryRow {
  label: string;
  identityHex?: string;
  identityUtf8?: string;
  error?: string;
}

export interface RecoveryResult {
  ok: true;
  source: "hex" | "json";
  rows: RecoveryRow[];
}

interface CliError {
  code: string;
  message: string;
}

export interface CliRun {
  exitCode: number;
  output: RecoveryResult | { ok: false; error: CliError };
}

const HEX_RE = /^(?:0x)?[0-9a-fA-F]+$/;

function normalizeHex(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function parseHexStrict(hex: string, field: string): Uint8Array {
  const clean = normalizeHex(hex.trim());
  if (!clean) throw new Error(`${field} must be non-empty hex`);
  if (!HEX_RE.test(clean)) throw new Error(`${field} must be valid hex`);
  if (clean.length % 2 !== 0)
    throw new Error(`${field} must have even hex length`);
  return fromHex(clean);
}

function parseArgs(argv: string[]): ParsedArgs {
  let auditorSecretHex = "";
  let inputJson: string | undefined;
  let inputJsonFile: string | undefined;
  let blobHex: string | undefined;
  let label = "blob-0";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    const consume = () => {
      if (!next || next.startsWith("--")) {
        throw new Error(`missing value for ${arg}`);
      }
      i += 1;
      return next;
    };

    if (arg === "--auditor-secret-hex") auditorSecretHex = consume();
    else if (arg === "--input-json") inputJson = consume();
    else if (arg === "--input-json-file") inputJsonFile = consume();
    else if (arg === "--blob-hex") blobHex = consume();
    else if (arg === "--label") label = consume();
    else if (arg === "--help" || arg === "-h") {
      throw new Error("help requested");
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!auditorSecretHex) {
    throw new Error("--auditor-secret-hex is required");
  }

  if (!inputJson && !inputJsonFile && !blobHex) {
    throw new Error(
      "provide one of --input-json, --input-json-file, or --blob-hex",
    );
  }

  return { auditorSecretHex, inputJson, inputJsonFile, blobHex, label };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function extractBlobsFromJson(value: unknown): BlobEntry[] {
  const root = asRecord(value);
  if (!root) throw new Error("input JSON must be an object");

  const trace = asRecord(root.trace) ?? root;

  const directBlobs = asRecord(trace.blobs);
  if (directBlobs) {
    return Object.entries(directBlobs).map(([label, blob]) => ({
      label,
      blobHex: typeof blob === "string" ? blob : undefined,
    }));
  }

  const bidders = Array.isArray(trace.bidders) ? trace.bidders : null;

  const auditor = asRecord(trace.auditor);
  const auditorBlobs = auditor ? asRecord(auditor.blobs) : null;
  if (auditorBlobs) {
    if (bidders) {
      return bidders.map((item, index) => {
        const row = asRecord(item);
        const label =
          row && typeof row.label === "string" && row.label.trim()
            ? row.label
            : `bidder-${index}`;
        const blob = auditorBlobs[label];
        return { label, blobHex: typeof blob === "string" ? blob : undefined };
      });
    }

    return Object.entries(auditorBlobs).map(([label, blob]) => ({
      label,
      blobHex: typeof blob === "string" ? blob : undefined,
    }));
  }
  if (bidders) {
    return bidders.map((item, index) => {
      const row = asRecord(item);
      if (!row) return { label: `bidder-${index}`, blobHex: undefined };
      const label =
        typeof row.label === "string" ? row.label : `bidder-${index}`;
      const blobHex =
        typeof row.blobHex === "string"
          ? row.blobHex
          : typeof row.auditorBlobHex === "string"
            ? row.auditorBlobHex
            : undefined;
      return { label, blobHex };
    });
  }

  throw new Error(
    "input JSON must contain blobs at trace.auditor.blobs, auditor.blobs, blobs, or bidders[*].blobHex",
  );
}

function recoverRows(
  entries: BlobEntry[],
  auditorSecret: Uint8Array,
): RecoveryRow[] {
  return entries.map(({ label, blobHex }) => {
    if (!blobHex || !blobHex.trim()) {
      return { label, error: "missing blob hex" };
    }

    try {
      const blob = parseHexStrict(blobHex, `blob ${label}`);
      const plain = openIdentity(blob, auditorSecret);
      return {
        label,
        identityHex: toHex(plain),
        identityUtf8: new TextDecoder().decode(plain),
      };
    } catch (error) {
      const message = getErrorMessage(error);
      return { label, error: message };
    }
  });
}

function loadInputJson(args: ParsedArgs, stdin: string): unknown {
  if (args.inputJsonFile) {
    const file = readFileSync(args.inputJsonFile, "utf8");
    return JSON.parse(file) as unknown;
  }

  const text = args.inputJson === "-" ? stdin : args.inputJson;
  if (!text) throw new Error("--input-json cannot be empty");
  return JSON.parse(text) as unknown;
}

export function runAuditorRecoveryCli(argv: string[], stdin = ""): CliRun {
  try {
    const args = parseArgs(argv);
    const auditorSecret = parseHexStrict(
      args.auditorSecretHex,
      "auditor secret",
    );
    if (auditorSecret.length !== 32) {
      return {
        exitCode: 1,
        output: {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "auditor secret must be 32 bytes (64 hex chars)",
          },
        },
      };
    }

    if (args.blobHex) {
      const rows = recoverRows(
        [{ label: args.label, blobHex: args.blobHex }],
        auditorSecret,
      );
      return { exitCode: 0, output: { ok: true, source: "hex", rows } };
    }

    const parsed = loadInputJson(args, stdin);
    const blobs = extractBlobsFromJson(parsed);
    if (blobs.length === 0) {
      return {
        exitCode: 1,
        output: {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "no bidder blobs found in JSON input",
          },
        },
      };
    }

    const rows = recoverRows(blobs, auditorSecret);
    return { exitCode: 0, output: { ok: true, source: "json", rows } };
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      exitCode: 1,
      output: {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message,
        },
      },
    };
  }
}

export function usage(): string {
  return [
    "Usage:",
    "  node --import tsx packages/tlock/src/recover-identities.cli.ts --auditor-secret-hex <hex32> --blob-hex <hex> [--label <name>]",
    "  node --import tsx packages/tlock/src/recover-identities.cli.ts --auditor-secret-hex <hex32> --input-json '<json>'",
    "  node --import tsx packages/tlock/src/recover-identities.cli.ts --auditor-secret-hex <hex32> --input-json-file <json-file>",
    "",
    "Input JSON supports:",
    "  - { auditor: { blobs: { [label]: hex } } }",
    "  - { trace: { auditor: { blobs: { [label]: hex } } } }",
    "  - { blobs: { [label]: hex } }",
    "  - { bidders: [{ label, blobHex | auditorBlobHex }] }",
  ].join("\n");
}
