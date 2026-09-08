#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from '../packages/logging/src/index.cjs';
const diagnostics = createLogger("scripts.check-threat-model-anchors");
/**
 * Check that docs/THREAT_MODEL.md still covers the core sealed-round risk
 * topics used by SCF / Wave diligence.
 *
 * The check is intentionally text/anchor based: it scans the markdown file for
 * either a section header (e.g. `### Topic`) or a representative phrase/keyword
 * that the topic is documented under. Each topic has a small list of accepted
 * patterns (cover the common phrasings used in this repo). If any topic has no
 * match, the script exits non-zero so CI / pre-commit can block the change.
 *
 * Adding or renaming a topic should be done in two places:
 *   1. docs/THREAT_MODEL.md (the actual coverage)
 *   2. REQUIRED_ANCHORS below (so the inventory stays in sync)
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const DEFAULT_DOC = "docs/THREAT_MODEL.md";

/**
 * @typedef {Object} Anchor
 * @property {string} id       Stable id used in failure messages.
 * @property {string} label    Human-readable name of the topic.
 * @property {RegExp[]} patterns Patterns that count as coverage.
 *   Any one match is enough. Keep patterns anchored to the wording actually
 *   used in docs/THREAT_MODEL.md so a deliberate rename triggers a failure.
 */

/** @type {Anchor[]} */
const REQUIRED_ANCHORS = [
  {
    id: "commit-privacy",
    label: "Commit privacy (ciphertext confidentiality pre-R)",
    patterns: [
      /###\s+\S*\s*Early bid disclosure/i,
      /Ciphertext\b[^|\n]*?until\s+R/i,
      /bid commitment H/i,
    ],
  },
  {
    id: "drand-reveal-timing",
    label: "Drand reveal timing",
    patterns: [
      /Drand never delivers/i,
      /Drand round R\b/i,
      /Drand quicknet/i,
      /Drand.*reveal/i,
    ],
  },
  {
    id: "escrow-settlement",
    label: "Escrow settlement",
    patterns: [
      /###\s+\S*\s*Funds/i,
      /Escrow[^|\n]*?settle/i,
      /settle[^|\n]*?from escrow/i,
      /Winner doesn['’]t pay/i,
    ],
  },
  {
    id: "keeper-permissionlessness",
    label: "Keeper permissionlessness",
    patterns: [
      /Permissionless/i,
      /Keeper could censor/i,
      /###\s+\S*\s*(Keeper|keeper)/i,
    ],
  },
  {
    id: "receipt-verification",
    label: "Receipt verification",
    patterns: [
      /###\s+\S*\s*Receipt verification/i,
      /Idempotent settle/i,
      /receipt/i,
    ],
  },
];

function loadDoc(docPath) {
  const absolute = isAbsolute(docPath) ? docPath : resolve(process.cwd(), docPath);
  if (!existsSync(absolute)) {
    return { content: null, path: absolute };
  }
  return { content: readFileSync(absolute, "utf-8"), path: absolute };
}

function checkAnchor(anchor, content) {
  for (const pattern of anchor.patterns) {
    if (pattern.test(content)) {
      return { matched: pattern };
    }
  }
  return { matched: null };
}

function main() {
  const docPath = process.argv[2] || DEFAULT_DOC;
  const { content, path } = loadDoc(docPath);

  if (content === null) {
    diagnostics.error("fail", `[FAIL] ${docPath} not found at ${path}`);
    diagnostics.error("threat-model-anchor-coverage-check-cannot-run-without-t", "Threat model anchor coverage check cannot run without the doc.");
    process.exit(1);
  }

  diagnostics.info("threat-model-anchor-coverage-for", `\nThreat model anchor coverage for ${docPath}`);
  diagnostics.info("progress", "=".repeat(72));

  let allPassed = true;
  const failures = [];

  for (const anchor of REQUIRED_ANCHORS) {
    const result = checkAnchor(anchor, content);
    const ok = result.matched !== null;
    if (!ok) {
      allPassed = false;
      failures.push(anchor);
    }

    const tag = ok ? "PASS" : "FAIL";
    diagnostics.info("progress-2", `  [${tag}] ${anchor.label}`);
    if (result.matched) {
      diagnostics.info("matched", `         matched: ${result.matched}`);
    } else {
      diagnostics.info("candidates-none-matched", "         candidates (none matched):");
      for (const p of anchor.patterns) {
        diagnostics.info("progress-3", `           - ${p}`);
      }
    }
  }

  diagnostics.info("progress-4", "=".repeat(72));

  if (allPassed) {
    diagnostics.info("all", `All ${REQUIRED_ANCHORS.length} required threat model anchors are present.`);
    process.exit(0);
  } else {
    diagnostics.error("progress-5", `Missing ${failures.length} required threat model anchor(s): ` +
        failures.map((a) => a.id).join(", "));
    diagnostics.error("either-add-coverage-under-docs-threat-model-md-or-exten", "Either add coverage under docs/THREAT_MODEL.md or extend REQUIRED_ANCHORS in");
    diagnostics.error("scripts-check-threat-model-anchors-mjs-so-the-inventory", "scripts/check-threat-model-anchors.mjs so the inventory stays in sync.");
    process.exit(1);
  }
}

main();
