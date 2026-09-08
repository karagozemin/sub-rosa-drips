#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from '../packages/logging/src/index.cjs';
const diagnostics = createLogger("scripts.check-deploy-docs");
// scripts/check-deploy-docs.mjs
//
// Lightweight text-based smoke test that keeps docs/DEPLOY.md copy-pasteable.
//
// Verifies:
//
//   (1) Every env var mentioned in docs/DEPLOY.md (in code blocks or tables)
//       is documented in the appropriate .env.example file:
//           - VITE_*                  -> apps/web/.env.example
//           - everything else         -> root .env.example
//       An env var counts as documented if it appears either as an active
//       line or as a commented-out line (`# NAME=...`).
//
//   (2) Every `pnpm <cmd>` core command referenced in docs/DEPLOY.md
//       is defined in the appropriate package.json `scripts`:
//           - pnpm X:Y                -> root package.json
//           - pnpm --filter <pkg> X   -> <pkg>'s scripts in the workspace
//           - pnpm install            -> builtin pnpm; skipped
//
// Text-based only: no Stellar, Vercel or RPC calls. Exits 0 on PASS, 1 on FAIL.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSystemEnv } from "../packages/config/src/system.ts";

// `DEPLOY_DOCS_ROOT` lets tests redirect reads to a fixture project tree.
// In normal use, `pnpm docs:check` runs from the repo root, so process.cwd()
// is the project root.
const env = getSystemEnv();
const ROOT = env.DEPLOY_DOCS_ROOT
  ? env.DEPLOY_DOCS_ROOT
  : process.cwd();

const PATHS = {
  deployDoc: resolve(ROOT, "docs/DEPLOY.md"),
  rootEnv: resolve(ROOT, ".env.example"),
  webEnv: resolve(ROOT, "apps/web/.env.example"),
  rootPkg: resolve(ROOT, "package.json"),
};

const SKIP_PNPM = new Set(["install"]);

// Tokens that look like env var names but are placeholder / brand acronyms.
const KNOWN_NON_ENVS = new Set([
  "SDF", "RPC", "URL", "JS", "JSON", "HTTP", "XLM", "SAC",
  "USDC", "WASM", "TSX", "ESM", "CPI", "TTL", "FAQ", "CPU",
  // `VAR` is used in `inline 'VAR=... command'` prose as a placeholder
  // for any environment variable name. It is not a real environment variable.
  "VAR",
]);

// `VAR=` style assignments in code blocks and inline. Captures the name on the
// left side of `=`. Single token per match -- works across newlines because
// `String.prototype.matchAll` is global.
const ENV_ASSIGN_RE = /\b([A-Z][A-Z0-9_]{2,})\s*=/g;

// Markdown table cell with an env-var-like name:
//   | `KEEPER_SECRET` | description |
//   | OPERATOR_SECRET | description |
const ENV_TABLE_RE = /\|\s*`?([A-Z][A-Z0-9_]{2,})`?\s*\|/g;

// `pnpm --filter @scope/pkg <cmd>` (matches if and only if `--filter` is present)
const PNPM_FILTER_RE = /\bpnpm\s+--filter\s+(\S+)\s+([a-z][a-z0-9_.:-]*)/g;

// `pnpm <cmd>` where <cmd> is a top-level script key (e.g. `pnpm web:build`).
// Does not match `pnpm --filter ...`.
const PNPM_PLAIN_RE = /\bpnpm\s+(?!--filter\b)([a-z][a-z0-9_.:-]*)/g;

// Walk a handful of well-known workspace package.json paths to build a
// `name -> Set<script-keys>` map. Kept deliberately lightweight and explicit
// (no glob walking, no yaml parsing) so the script stays trivially auditable
// and runnable without extra deps. Keep this list in sync with
// pnpm-workspace.yaml when workspace layout changes.
const WORKSPACE_PKG_DIRS = [
  "packages/sdk",
  "packages/round-bindings",
  "packages/tlock",
  "services/keeper",
  "services/appraisal-api",
  "services/receipt-cli",
  "services/agent",
  "services/drand-tools",
  "services/auction-template",
  "apps/web",
];

function loadEnvKeys(filePath) {
  const text = readFileSync(filePath, "utf8");
  // Match either an active `NAME=…` line or a commented `# NAME=…` line.
  const re = /^[ \t]*(?:#[ \t]*)?([A-Z][A-Z0-9_]{2,})\s*=/gm;
  return new Set(Array.from(text.matchAll(re), (m) => m[1]));
}

function loadRootScripts() {
  const pkg = JSON.parse(readFileSync(PATHS.rootPkg, "utf8"));
  return new Set(Object.keys(pkg.scripts ?? {}));
}

function loadWorkspaceScripts() {
  const map = new Map();
  for (const dir of WORKSPACE_PKG_DIRS) {
    const pkgPath = resolve(ROOT, dir, "package.json");
    let raw;
    try {
      raw = readFileSync(pkgPath, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") continue; // package not present -- fine
      throw err;
    }
    const pkg = JSON.parse(raw);
    if (pkg.name && pkg.scripts) {
      map.set(pkg.name, new Set(Object.keys(pkg.scripts)));
    }
  }
  return map;
}

function isLikelyEnvVar(name) {
  if (KNOWN_NON_ENVS.has(name)) return false;
  // Skip pure-digit or 1-letter placeholders like `S…`, `C…`, `G…` which
  // intentionally do not start with a letter; this is a defensive belt.
  return /^[A-Z][A-Z0-9_]{2,}$/.test(name);
}

function findDocEnvVars(docText) {
  const set = new Set();
  for (const m of docText.matchAll(ENV_ASSIGN_RE)) set.add(m[1]);
  for (const m of docText.matchAll(ENV_TABLE_RE)) set.add(m[1]);
  return [...set].filter(isLikelyEnvVar).sort();
}

function findDocPnpmCommands(docText) {
  const out = [];
  for (const m of docText.matchAll(PNPM_FILTER_RE)) {
    const cmd = m[2];
    if (SKIP_PNPM.has(cmd)) continue;
    out.push({ kind: "filter", pkg: m[1], cmd, spec: `pnpm --filter ${m[1]} ${cmd}` });
  }
  for (const m of docText.matchAll(PNPM_PLAIN_RE)) {
    const cmd = m[1];
    if (SKIP_PNPM.has(cmd)) continue;
    out.push({ kind: "plain", pkg: null, cmd, spec: `pnpm ${cmd}` });
  }
  // De-duplicate by `spec`.
  const seen = new Set();
  return out.filter((c) => (seen.has(c.spec) ? false : (seen.add(c.spec), true)));
}

function main() {
  const docText = readFileSync(PATHS.deployDoc, "utf8");

  const rootAllowed = loadEnvKeys(PATHS.rootEnv);
  const webAllowed = loadEnvKeys(PATHS.webEnv);
  const rootScripts = loadRootScripts();
  const wsScripts = loadWorkspaceScripts();

  const envVars = findDocEnvVars(docText);
  const commands = findDocPnpmCommands(docText);

  const failures = [];

  diagnostics.info("docs-deploy-md-env-references", "docs/DEPLOY.md -> env references");
  diagnostics.info("progress", "-".repeat(60));
  for (const v of envVars) {
    const isVite = v.startsWith("VITE_");
    const where = isVite ? "apps/web/.env.example" : "root .env.example";
    const ok = isVite ? webAllowed.has(v) : rootAllowed.has(v);
    const tag = ok ? "PASS" : "FAIL";
    diagnostics.info("progress-2", `  [${tag}]  ${v}` + (ok ? "" : `  (missing in ${where})`));
    if (!ok) failures.push({ kind: "env", name: v, where });
  }

  diagnostics.info("docs-deploy-md-pnpm-commands", "\ndocs/DEPLOY.md -> pnpm commands");
  diagnostics.info("progress-3", "-".repeat(60));
  for (const c of commands) {
    let ok = false;
    let where = "";
    if (c.kind === "plain") {
      ok = rootScripts.has(c.cmd);
      where = "root package.json `scripts`";
    } else {
      const wsSet = wsScripts.get(c.pkg);
      ok = !!wsSet && wsSet.has(c.cmd);
      where = `${c.pkg} \`scripts\``;
    }
    const tag = ok ? "PASS" : "FAIL";
    diagnostics.info("progress-4", `  [${tag}]  ${c.spec}` + (ok ? "" : `  (missing in ${where})`));
    if (!ok) failures.push({ kind: "cmd", spec: c.spec, where });
  }

  diagnostics.info("progress-5", "");
  if (failures.length === 0) {
    diagnostics.info("pass-docs-deploy-md-references-are-consistent-with-env", "PASS: docs/DEPLOY.md references are consistent with .env.example files and package.json scripts.");
    return 0;
  }
  diagnostics.info("fail", `FAIL: ${failures.length} inconsistent reference(s) in docs/DEPLOY.md.`);
  diagnostics.info("add-the-missing-env-var-to-the-appropriate-env-example", "  - add the missing env var to the appropriate .env.example file, or");
  diagnostics.info("add-the-missing-script-to-root-package-json-the-workspa", "  - add the missing script to root package.json / the workspace package.json.");
  return 1;
}

process.exit(main());
