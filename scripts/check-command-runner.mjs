#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createLogger } from "@sub-rosa/logging";
import { runCommand } from "@sub-rosa/command";

const diagnostics = createLogger("scripts.check-command-runner");
const ROOT = new URL("..", import.meta.url).pathname;

const STATIC_TARGET_FILES = [
  "packages/tlock/src/recover-identities.cli.ts",
  "services/receipt-cli/src/index.ts",
  "services/keeper/src/run.ts",
  "services/keeper/src/watch.ts",
  "services/keeper/src/serve.ts",
  "services/keeper/src/queue.ts",
  "services/auction-template/sealed-auction.ts",
];

/**
 * Checks a script content for command runner compliance.
 * @param {string} content
 * @param {string} relPath
 * @returns {{ relPath: string, rule: string, message: string }[]}
 */
export function findViolations(content, relPath) {
  const violations = [];

  const importsRunCommand = /(?:import\s*\{[^}]*\brunCommand\b[^}]*\}|const\s*\{[^}]*\brunCommand\b[^}]*\}\s*=)/.test(content);
  const importsFromCommandPackage = /(?:['"]@sub-rosa\/command['"]|['"][^\x27"]*packages\/command)/.test(content);

  if (!importsRunCommand || !importsFromCommandPackage) {
    violations.push({
      relPath,
      rule: "missing-run-command-import",
      message: "File does not import runCommand from @sub-rosa/command",
    });
  }

  const callsRunCommand = /\brunCommand\s*\(/.test(content);
  if (!callsRunCommand) {
    violations.push({
      relPath,
      rule: "missing-run-command-call",
      message: "File does not call runCommand({ ... })",
    });
  }

  const hasRawProcessExit = /(?<![.\w])process\.exit\s*\(/.test(content);
  if (hasRawProcessExit) {
    violations.push({
      relPath,
      rule: "direct-process-exit",
      message: "File calls process.exit directly instead of delegating to runCommand",
    });
  }

  return violations;
}

/**
 * Discovers all operational scripts and checker targets in the repository.
 * @param {string} [rootDir=ROOT]
 * @returns {string[]}
 */
export function discoverTargetScripts(rootDir = ROOT) {
  const targets = new Set();

  for (const staticTarget of STATIC_TARGET_FILES) {
    const fullPath = join(rootDir, staticTarget);
    try {
      if (statSync(fullPath).isFile()) {
        targets.add(staticTarget);
      }
    } catch {}
  }

  const scriptsDir = join(rootDir, "scripts");
  try {
    for (const file of readdirSync(scriptsDir)) {
      if (/^(check-.*|run-ts-coverage)\.(js|mjs)$/.test(file) && !/\.test\./.test(file)) {
        targets.add(`scripts/${file}`);
      }
    }
  } catch {}

  for (const category of ["packages", "services"]) {
    const catDir = join(rootDir, category);
    try {
      for (const entry of readdirSync(catDir)) {
        const candidateScriptsDir = join(catDir, entry, "scripts");
        try {
          if (statSync(candidateScriptsDir).isDirectory()) {
            for (const scriptFile of readdirSync(candidateScriptsDir)) {
              if (/\.(ts|js|mjs)$/.test(scriptFile) && !/\.test\./.test(scriptFile)) {
                targets.add(`${category}/${entry}/scripts/${scriptFile}`);
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  return [...targets].sort();
}

/**
 * Scans all target scripts in the repository.
 * @param {string} [rootDir=ROOT]
 * @returns {{ relPath: string, rule: string, message: string }[]}
 */
export function scanTargetScripts(rootDir = ROOT) {
  const targets = discoverTargetScripts(rootDir);
  const violations = [];

  for (const relPath of targets) {
    const fullPath = join(rootDir, relPath);
    const content = readFileSync(fullPath, "utf-8");
    violations.push(...findViolations(content, relPath));
  }

  return violations;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCommand({
    name: "scripts.check-command-runner",
    description: "Enforce standardization on shared command runner",
    run(ctx) {
      const targets = discoverTargetScripts(ctx.repoRoot);
      const violations = scanTargetScripts(ctx.repoRoot);

      diagnostics.info("command-runner-guard", "\nCommand runner guard");
      diagnostics.info("separator", "=".repeat(72));
      diagnostics.info("target-count", `  scanned ${targets.length} operational targets across repository`);
      diagnostics.info("separator-2", "=".repeat(72));

      if (violations.length === 0) {
        diagnostics.info("pass", `PASS  all ${targets.length} scripts standardize on runCommand with no raw process.exit.`);
        return 0;
      }

      diagnostics.error("fail", `FAIL  ${violations.length} violation(s):`);
      for (const v of violations) {
        diagnostics.error("violation", `  ${v.relPath}: [${v.rule}] ${v.message}`);
      }
      return 1;
    },
  });
}
