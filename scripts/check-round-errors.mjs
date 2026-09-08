#!/usr/bin/env node
import { createLogger } from '../packages/logging/src/index.cjs';
const diagnostics = createLogger("scripts.check-round-errors");
/**
 * Keep contracts/round/ERRORS.md in sync with enum Error in
 * contracts/round/src/types.rs.
 *
 * Parses both sources and fails if any variant/code exists in one but not
 * the other, or if the numeric code for a variant name differs.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TYPES = "contracts/round/src/types.rs";
const DEFAULT_DOC = "contracts/round/ERRORS.md";

/** @typedef {{ name: string, code: number }} ErrorVariant */

/**
 * @param {string} content
 * @returns {ErrorVariant[]}
 */
export function parseTypesRs(content) {
  const enumMatch = content.match(
    /#\[contracterror\][\s\S]*?pub enum Error \{([\s\S]*?)\n\}/,
  );
  if (!enumMatch) {
    throw new Error("Could not find `pub enum Error` in types.rs");
  }

  /** @type {ErrorVariant[]} */
  const variants = [];
  for (const line of enumMatch[1].split("\n")) {
    const match = line.match(/^\s+(\w+)\s*=\s*(\d+),?\s*(?:\/\/.*)?$/);
    if (match) {
      variants.push({ name: match[1], code: Number(match[2]) });
    }
  }
  if (variants.length === 0) {
    throw new Error("No Error variants parsed from types.rs");
  }
  return variants;
}

/**
 * @param {string} content
 * @returns {ErrorVariant[]}
 */
export function parseErrorsMd(content) {
  /** @type {ErrorVariant[]} */
  const variants = [];
  const re = /^\|\s*(\d+)\s*\|\s*`(\w+)`\s*\|/gm;
  let match;
  while ((match = re.exec(content)) !== null) {
    variants.push({ name: match[2], code: Number(match[1]) });
  }
  if (variants.length === 0) {
    throw new Error("No error table rows parsed from ERRORS.md");
  }
  return variants;
}

/**
 * @param {ErrorVariant[]} left
 * @param {ErrorVariant[]} right
 * @param {string} leftLabel
 * @param {string} rightLabel
 */
export function diffVariants(left, right, leftLabel, rightLabel) {
  const leftByName = new Map(left.map((v) => [v.name, v.code]));
  const rightByName = new Map(right.map((v) => [v.name, v.code]));
  /** @type {string[]} */
  const failures = [];

  for (const [name, code] of leftByName) {
    if (!rightByName.has(name)) {
      failures.push(`${name} (${code}) in ${leftLabel} but missing from ${rightLabel}`);
      continue;
    }
    const otherCode = rightByName.get(name);
    if (otherCode !== code) {
      failures.push(
        `${name} code mismatch: ${leftLabel}=${code}, ${rightLabel}=${otherCode}`,
      );
    }
  }

  for (const [name, code] of rightByName) {
    if (!leftByName.has(name)) {
      failures.push(`${name} (${code}) in ${rightLabel} but missing from ${leftLabel}`);
    }
  }

  return failures;
}

function loadFile(pathArg, fallback) {
  const path = pathArg || fallback;
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  if (!existsSync(absolute)) {
    return { content: null, path: absolute };
  }
  return { content: readFileSync(absolute, "utf-8"), path: absolute };
}

function main() {
  const typesPath = process.argv[2] || DEFAULT_TYPES;
  const docPath = process.argv[3] || DEFAULT_DOC;

  const typesFile = loadFile(typesPath, DEFAULT_TYPES);
  const docFile = loadFile(docPath, DEFAULT_DOC);

  if (typesFile.content === null) {
    diagnostics.error("fail-types-file-not-found", `[FAIL] types file not found: ${typesFile.path}`);
    process.exit(1);
  }
  if (docFile.content === null) {
    diagnostics.error("fail-errors-md-not-found", `[FAIL] ERRORS.md not found: ${docFile.path}`);
    process.exit(1);
  }

  const fromTypes = parseTypesRs(typesFile.content);
  const fromDoc = parseErrorsMd(docFile.content);

  diagnostics.info("round-contract-error-drift-check", `\nRound contract error drift check`);
  diagnostics.info("progress", "=".repeat(72));
  diagnostics.info("types-rs", `  types.rs : ${fromTypes.length} variants`);
  diagnostics.info("errors-md", `  ERRORS.md: ${fromDoc.length} rows`);

  const failures = diffVariants(fromTypes, fromDoc, "types.rs", "ERRORS.md");
  diagnostics.info("progress-2", "=".repeat(72));

  if (failures.length === 0) {
    diagnostics.info("pass-types-rs-and-errors-md-list-the-same-error-codes", "PASS  types.rs and ERRORS.md list the same error codes.");
    process.exit(0);
  }

  diagnostics.error("fail", `FAIL  ${failures.length} drift issue(s):`);
  for (const failure of failures) {
    diagnostics.error("progress-3", `  - ${failure}`);
  }
  diagnostics.error("update-contracts-round-src-types-rs-and-contracts-round", "\nUpdate contracts/round/src/types.rs and contracts/round/ERRORS.md together.");
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
