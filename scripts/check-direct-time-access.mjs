#!/usr/bin/env node
import { createLogger } from '../packages/logging/src/index.cjs';
const diagnostics = createLogger("scripts.check-direct-time-access");
/**
 * Fail when first-party code calls wall-clock or timer globals directly.
 * Allowed only in packages/time/src/system.ts and packages/time/src/fake*.ts.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { runCommand } from "@sub-rosa/command";

const ROOT = new URL("..", import.meta.url).pathname;
const SCAN_ROOTS = ["packages", "services", "apps"];
const ALLOWED = new Set([
  "packages/time/src/system.ts",
  "packages/time/src/fake-clock.ts",
  "packages/time/src/fake-scheduler.ts",
  "packages/time/src/types.ts",
]);

const PATTERNS = [
  { name: "Date.now(", re: /(?<![.\w])Date\.now\s*\(/g },
  { name: "new Date(", re: /(?<![.\w])new\s+Date\s*\(/g },
  { name: "setTimeout(", re: /(?<![.\w])setTimeout\s*\(/g },
  { name: "setInterval(", re: /(?<![.\w])setInterval\s*\(/g },
  { name: "clearTimeout(", re: /(?<![.\w])clearTimeout\s*\(/g },
  { name: "clearInterval(", re: /(?<![.\w])clearInterval\s*\(/g },
];

/** @param {string} dir */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
      walk(full, out);
      continue;
    }
    if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * @param {string} content
 * @param {string} relPath
 */
export function findViolations(content, relPath) {
  if (ALLOWED.has(relPath)) return [];

  /** @type {{ relPath: string, line: number, pattern: string, text: string }[]} */
  const hits = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      if (re.test(line)) {
        hits.push({
          relPath,
          line: i + 1,
          pattern: name,
          text: line.trim(),
        });
      }
    }
  }
  return hits;
}

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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCommand({
    name: "scripts.check-direct-time-access",
    description: "Fail when first-party code calls wall-clock or timer globals directly",
    run(ctx) {
      const violations = scanTree(ctx.repoRoot);
      diagnostics.info("direct-time-access-guard", "\nDirect time-access guard");
      diagnostics.info("progress", "=".repeat(72));
      diagnostics.info("scanned", `  scanned: ${SCAN_ROOTS.join(", ")}`);
      diagnostics.info("allowed", `  allowed: ${[...ALLOWED].join(", ")}`);
      diagnostics.info("progress-2", "=".repeat(72));

      if (violations.length === 0) {
        diagnostics.info("pass-no-direct-date-timer-usage-outside-sub-rosa-time", "PASS  no direct Date/timer usage outside @sub-rosa/time.");
        return 0;
      }

      diagnostics.error("fail", `FAIL  ${violations.length} violation(s):`);
      for (const v of violations) {
        diagnostics.error("progress-3", `  ${v.relPath}:${v.line}  ${v.pattern}  ${v.text}`);
      }
      diagnostics.error("use-sub-rosa-time-systemtime-fakeclock-fakescheduler-in", "\nUse @sub-rosa/time (systemTime, FakeClock, FakeScheduler) instead.");
      return 1;
    },
  });
}
