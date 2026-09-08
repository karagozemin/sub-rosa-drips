#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createLogger } from "../packages/logging/src/index.cjs";

const diagnostics = createLogger("scripts.check-error-normalization");
const ROOT = new URL("..", import.meta.url).pathname;
const SCAN_ROOTS = ["packages", "services", "apps"];

const ALLOWED_FILES = new Set([
  "packages/errors/src/classify.ts",
  "packages/errors/src/normalize.ts",
  "packages/errors/src/redact.ts",
  "packages/errors/src/index.cjs",
]);

const PATTERNS = [
  {
    name: "instanceof Error ternary",
    re: /(?<![.\w])instanceof\s+Error\s*\?/g,
    hint: "Use normalizeError or getErrorMessage from @sub-rosa/errors instead of ad hoc ternary checks.",
  },
  {
    name: "instanceof MandateCapError ternary",
    re: /(?<![.\w])instanceof\s+MandateCapError\s*\?/g,
    hint: "Use getErrorMessage from @sub-rosa/errors instead of ad hoc ternary checks.",
  },
  {
    name: "raw String(error) coercion",
    re: /(?<![.\w])String\s*\(\s*(?:e|err|error)\s*\)/g,
    hint: "Use getErrorMessage from @sub-rosa/errors instead of raw String(error) conversion.",
  },
];

function isTestFile(relPath) {
  return (
    relPath.includes(".test.") ||
    relPath.includes(".spec.") ||
    relPath.includes("__tests__")
  );
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
      walk(full, out);
      continue;
    }
    if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Inspects file contents for unnormalized error handling antipatterns.
 */
export function findViolations(content, relPath) {
  if (ALLOWED_FILES.has(relPath)) return [];
  if (relPath.startsWith("packages/errors/")) return [];
  if (isTestFile(relPath)) return [];

  const hits = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, re, hint } of PATTERNS) {
      re.lastIndex = 0;
      if (re.test(line)) {
        hits.push({
          relPath,
          line: i + 1,
          pattern: name,
          text: line.trim(),
          hint,
        });
      }
    }
  }
  return hits;
}

/**
 * Scans the workspace tree for error normalization violations.
 */
export function scanTree(rootDir = ROOT) {
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

function main() {
  const violations = scanTree();
  diagnostics.info("error-normalization-guard", "\nError normalization guard");
  diagnostics.info("progress", "=".repeat(72));
  diagnostics.info("scanned", `  scanned: ${SCAN_ROOTS.join(", ")}`);
  diagnostics.info("allowed", `  allowed: packages/errors/**`);
  diagnostics.info("progress-2", "=".repeat(72));

  if (violations.length === 0) {
    diagnostics.info(
      "pass-standard-error-normalization",
      "PASS  standard unknown-error normalization enforced across the repository.",
    );
    process.exit(0);
  }

  diagnostics.error("fail", `FAIL  ${violations.length} unnormalized error handling violation(s):`);
  for (const v of violations) {
    diagnostics.error(
      "violation-entry",
      `  ${v.relPath}:${v.line}  [${v.pattern}]  ${v.text}\n    -> ${v.hint}`,
    );
  }
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
