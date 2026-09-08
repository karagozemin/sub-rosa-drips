#!/usr/bin/env node
import { createLogger } from '../packages/logging/src/index.cjs';
const diagnostics = createLogger("scripts.run-ts-coverage");
/**
 * Collect Node.js test-runner line coverage across packages/* and services/*,
 * include unexecuted source files as uncovered, and fail when the
 * covered/total line ratio is below threshold.
 *
 * Aggregation is weighted by executable line counts (not a mean of percentages).
 *
 * Usage (repo root):
 *   node scripts/run-ts-coverage.mjs
 *   pnpm coverage:test
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFIG_PATH = resolve(ROOT, "coverage.config.json");

/**
 * @typedef {{ covered: number, total: number, percent: number }} LineTotals
 * @typedef {{ workspace: string } & LineTotals} WorkspaceCoverage
 */

export function loadConfig(configPath = CONFIG_PATH) {
  const raw = JSON.parse(readFileSync(configPath, "utf8"));
  return {
    lineThresholdPercent: Number(raw.lineThresholdPercent),
    workspaces: raw.workspaces,
  };
}

export function testFilesForWorkspace(relPath, root = ROOT) {
  const pkgPath = resolve(root, relPath, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(`Missing package.json: ${relPath}`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const testScript = pkg.scripts?.test;
  if (!testScript) {
    throw new Error(`No test script in ${relPath}`);
  }
  const marker = "--test ";
  const idx = testScript.indexOf(marker);
  if (idx === -1) {
    throw new Error(`Could not parse test script in ${relPath}: ${testScript}`);
  }
  return testScript.slice(idx + marker.length).trim().split(/\s+/);
}

/** Count non-empty, non-comment-only lines as a coarse executable-line proxy. */
export function countSourceLines(source) {
  let total = 0;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("//")) continue;
    if (
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("*/")
    ) {
      continue;
    }
    total += 1;
  }
  return total;
}

/**
 * Parse LCOV into a map of relative path → { covered, total }.
 * @param {string} lcov
 * @returns {Map<string, { covered: number, total: number }>}
 */
export function parseLcov(lcov) {
  /** @type {Map<string, { covered: number, total: number }>} */
  const files = new Map();
  let current = null;
  let covered = 0;
  let total = 0;

  const flush = () => {
    if (current != null) {
      files.set(current, { covered, total });
    }
    current = null;
    covered = 0;
    total = 0;
  };

  for (const rawLine of lcov.split(/\r?\n/)) {
    if (rawLine.startsWith("SF:")) {
      flush();
      current = rawLine.slice(3).replace(/\\/g, "/");
    } else if (rawLine.startsWith("LH:")) {
      covered = Number(rawLine.slice(3));
    } else if (rawLine.startsWith("LF:")) {
      total = Number(rawLine.slice(3));
    } else if (rawLine === "end_of_record") {
      flush();
    }
  }
  flush();
  return files;
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
export function listSourceFiles(dir) {
  /** @type {string[]} */
  const out = [];
  const walk = (abs) => {
    for (const entry of readdirSync(abs)) {
      const full = join(abs, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === "node_modules" || entry === "dist" || entry === "coverage") {
          continue;
        }
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts") && !entry.endsWith(".js") && !entry.endsWith(".mjs")) {
        continue;
      }
      if (entry.endsWith(".d.ts")) continue;
      if (/\.test\.(ts|js|mjs)$/.test(entry)) continue;
      out.push(relative(dir, full).replace(/\\/g, "/"));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/**
 * Merge instrumented LCOV totals with every source file on disk.
 * Unexecuted files contribute their source-line count as uncovered.
 * @param {Map<string, { covered: number, total: number }>} lcovFiles
 * @param {string[]} sourceFiles relative to workspace root (e.g. src/foo.ts)
 * @param {(rel: string) => string} readSource
 * @returns {LineTotals}
 */
export function aggregateWorkspaceLines(lcovFiles, sourceFiles, readSource) {
  let covered = 0;
  let total = 0;

  /** @type {Map<string, { covered: number, total: number }>} */
  const normalized = new Map();
  for (const [path, stats] of lcovFiles) {
    const key = path.replace(/^\.\//, "");
    normalized.set(key, stats);
  }

  for (const rel of sourceFiles) {
    const key = rel.replace(/^\.\//, "");
    const hit =
      normalized.get(key) ||
      normalized.get(key.replace(/^src\//, "")) ||
      [...normalized.entries()].find(([p]) => p.endsWith(`/${key}`) || p.endsWith(key))?.[1];

    if (hit) {
      covered += hit.covered;
      total += hit.total;
      continue;
    }
    const lines = countSourceLines(readSource(rel));
    total += lines;
  }

  const percent = total === 0 ? 100 : (covered / total) * 100;
  return { covered, total, percent };
}

/**
 * Weighted aggregate across workspaces: sum(covered) / sum(total).
 * @param {Array<{ covered: number, total: number }>} rows
 * @returns {LineTotals}
 */
export function aggregateCoverage(rows) {
  const covered = rows.reduce((sum, row) => sum + row.covered, 0);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const percent = total === 0 ? 100 : (covered / total) * 100;
  return { covered, total, percent };
}

function sourceRootsForWorkspace(cwd) {
  const src = resolve(cwd, "src");
  if (existsSync(src) && statSync(src).isDirectory()) {
    return [{ abs: src, prefix: "src/" }];
  }
  return [{ abs: cwd, prefix: "" }];
}

function runWorkspaceCoverage(relPath, root = ROOT) {
  const cwd = resolve(root, relPath);
  const files = testFilesForWorkspace(relPath, root);
  const tmp = mkdtempSync(join(tmpdir(), "sub-rosa-cov-"));
  const lcovPath = join(tmp, "coverage.lcov");

  try {
    const args = [
      "--import",
      "tsx",
      "--experimental-test-coverage",
      "--test-coverage-exclude=**/*.test.ts",
      "--test-coverage-exclude=**/*.test.js",
      "--test-coverage-exclude=**/*.smoke.test.ts",
      "--test-coverage-include=**/*.{ts,js,mjs}",
      "--test-reporter=lcov",
      `--test-reporter-destination=${lcovPath}`,
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      "--test",
      ...files,
    ];

    try {
      execFileSync(process.execPath, args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch (error) {
      const err = /** @type {any} */ (error);
      const output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
      if (output) process.stderr.write(`${output}\n`);
      throw new Error(`Tests failed in ${relPath} (exit ${err.status ?? 1})`);
    }

    if (!existsSync(lcovPath)) {
      throw new Error(`LCOV report missing for ${relPath}`);
    }

    const lcov = readFileSync(lcovPath, "utf8");
    const lcovFiles = parseLcov(lcov);
    /** @type {string[]} */
    const sourceFiles = [];
    for (const { abs, prefix } of sourceRootsForWorkspace(cwd)) {
      for (const rel of listSourceFiles(abs)) {
        // Skip package.json-adjacent tooling when scanning package root.
        if (!prefix && (rel.includes("/") || rel === "package.json")) continue;
        if (!prefix && !/\.(ts|js|mjs)$/.test(rel)) continue;
        sourceFiles.push(`${prefix}${rel}`);
      }
    }
    return aggregateWorkspaceLines(lcovFiles, sourceFiles, (rel) =>
      readFileSync(resolve(cwd, rel), "utf8"),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const { lineThresholdPercent, workspaces } = loadConfig();

  diagnostics.info("sub-rosa-typescript-coverage-packages-services", "Sub Rosa TypeScript coverage (packages/* + services/*)\n");
  diagnostics.info("configured-minimum-weighted-line-coverage", `Configured minimum weighted line coverage: ${lineThresholdPercent}%\n`);
  diagnostics.info("node", `Node ${process.version}\n`);

  /** @type {WorkspaceCoverage[]} */
  const rows = [];
  for (const workspace of workspaces) {
    process.stdout.write(`Running coverage: ${workspace} ... `);
    const totals = runWorkspaceCoverage(workspace);
    rows.push({ workspace, ...totals });
    diagnostics.info("progress", `${totals.percent.toFixed(2)}% lines (${totals.covered}/${totals.total})`);
  }

  const aggregate = aggregateCoverage(rows);

  diagnostics.info("coverage-summary", "\nCoverage summary");
  diagnostics.info("progress-2", "----------------");
  for (const row of rows) {
    diagnostics.info("progress-3", `${row.workspace.padEnd(32)} ${row.percent.toFixed(2)}%  (${row.covered}/${row.total})`);
  }
  diagnostics.info("progress-4", "----------------");
  diagnostics.info("progress-5", `${"aggregate (weighted)".padEnd(32)} ${aggregate.percent.toFixed(2)}%  (${aggregate.covered}/${aggregate.total})`);
  diagnostics.info("threshold", `threshold                        ${lineThresholdPercent.toFixed(2)}%`);

  if (aggregate.percent < lineThresholdPercent) {
    diagnostics.error("weighted-line-coverage", `\n❌ Weighted line coverage ${aggregate.percent.toFixed(2)}% is below threshold ${lineThresholdPercent}%.`);
    process.exit(1);
  }

  diagnostics.info("coverage-gate-passed", "\n✅ Coverage gate passed.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
