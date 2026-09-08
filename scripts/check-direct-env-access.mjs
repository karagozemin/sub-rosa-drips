#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createLogger } from "../packages/logging/src/index.cjs";

const diagnostics = createLogger("scripts.check-direct-env-access");

const ROOT = new URL("..", import.meta.url).pathname;
const SCAN_ROOTS = ["packages", "services", "apps", "scripts"];
const ALLOWED = new Set([
  "packages/config/src/system.ts",
  "packages/config/src/browser.ts",
  "scripts/check-direct-env-access.test.mjs",
]);

const PATTERNS = [
  { name: "process.env", re: /(?<![.\w"'])process\.env\b/g },
  { name: "import.meta.env", re: /(?<![.\w"'])import\.meta\.env\b/g },
];

/**
 * Recursively walks a directory collecting source files.
 *
 * @param {string} dir Directory to traverse.
 * @param {string[]} out Accumulator of matching file paths.
 * @returns {string[]} Matching file paths.
 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git" || entry === "coverage") continue;
      walk(full, out);
      continue;
    }
    if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Searches file content for unapproved direct environment reads.
 *
 * @param {string} content Source code contents.
 * @param {string} relPath Path relative to repository root.
 * @returns {{ relPath: string, line: number, pattern: string, text: string }[]} Found violations.
 */
export function findViolations(content, relPath) {
  if (ALLOWED.has(relPath)) return [];

  /** @type {{ relPath: string, line: number, pattern: string, text: string }[]} */
  const hits = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      continue;
    }

    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      if (re.test(rawLine)) {
        hits.push({
          relPath,
          line: i + 1,
          pattern: name,
          text: trimmed,
        });
      }
    }
  }
  return hits;
}

/**
 * Scans configured repository trees for unapproved direct environment reads.
 *
 * @param {string} rootDir Base directory to scan.
 * @returns {{ relPath: string, line: number, pattern: string, text: string }[]} Found violations.
 */
export function scanTree(rootDir = ROOT) {
  /** @type {ReturnType<typeof findViolations>} */
  const all = [];
  for (const scanRoot of SCAN_ROOTS) {
    const abs = join(rootDir, scanRoot);
    try {
      statSync(abs);
    } catch {
      continue;
    }
    for (const file of walk(abs)) {
      const relPath = relative(rootDir, file).split("\\").join("/");
      const content = readFileSync(file, "utf-8");
      all.push(...findViolations(content, relPath));
    }
  }
  return all;
}

/**
 * Main command line execution routine.
 */
function main() {
  const violations = scanTree();
  diagnostics.info("direct-env-access-guard", "\nDirect environment access guard");
  diagnostics.info("progress", "=".repeat(72));
  diagnostics.info("scanned", `  scanned: ${SCAN_ROOTS.join(", ")}`);
  diagnostics.info("allowed", `  allowed: ${[...ALLOWED].join(", ")}`);
  diagnostics.info("progress-2", "=".repeat(72));

  if (violations.length === 0) {
    diagnostics.info("pass-no-direct-env-access", "PASS  no direct environment access outside @sub-rosa/config bootstrap adapters.");
    process.exit(0);
  }

  diagnostics.error("fail", `FAIL  ${violations.length} violation(s):`);
  for (const v of violations) {
    diagnostics.error("progress-3", `  ${v.relPath}:${v.line}  ${v.pattern}  ${v.text}`);
  }
  diagnostics.error("use-sub-rosa-config", "\nUse @sub-rosa/config (readers, defineSchema, getSystemEnv, getBrowserEnv) instead.");
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
