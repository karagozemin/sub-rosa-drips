#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
const { createLogger } = require('../packages/logging/src/index.cjs');
const diagnostics = createLogger("scripts.check-links");
'use strict';

const fs = require('fs');
const path = require('path');
const { runCommand } = require('@sub-rosa/command');

const FILES = [
  'README.md',
  'ARCHITECTURE.md',
  'docs/TECH_DESIGN.md',
  'docs/THREAT_MODEL.md',
  'docs/DEPLOY.md',
  'docs/DEMO_SCRIPT.md',
  'docs/INTEGRATION.md',
  'docs/RECEIPTS.md',
  'docs/SCF_TRANCHE_PLAN.md',
  'docs/CV_LABS_APPLICATION.md',
  'docs/LIMITATIONS.md',
  'docs/ECOSYSTEM.md',
  'docs/TRACK_ANSWERS.md',
  'docs/PILOT_PLAYBOOK.md',
  'packages/round-bindings/README.md',
];

const ALLOWLIST = new Set([]);

/**
 * Normalizes text to a markdown header slug.
 *
 * @param {string} text
 * @returns {string}
 */
function headingSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Extracts all heading slugs from markdown text.
 *
 * @param {string} content
 * @returns {Set<string>}
 */
function extractSlugs(content) {
  const slugs = new Set();
  const re = /^#{1,6}\s+(.+)$/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    slugs.add(headingSlug(m[1]));
  }
  return slugs;
}

const slugCache = new Map();

/**
 * Retrieves cached heading slugs for a given markdown file.
 *
 * @param {string} absPath
 * @returns {Set<string>}
 */
function getSlugs(absPath) {
  if (!slugCache.has(absPath)) {
    const content = fs.readFileSync(absPath, 'utf8');
    slugCache.set(absPath, extractSlugs(content));
  }
  return slugCache.get(absPath);
}

const LINK_RE = /\[([^\]]*)\]\(([^)\s]+)\)/g;

runCommand({
  name: "scripts.check-links",
  description: "Check markdown links across documentation files",
  options: {
    external: {
      type: "boolean",
      short: "e",
      default: false,
      description: "List external links",
    },
  },
  run(ctx) {
    const rootDir = ctx.repoRoot;
    const showExternal = Boolean(ctx.options.external);

    let broken = 0;
    let checked = 0;
    let skipped = 0;
    const external = [];

    for (const relFile of FILES) {
      const absFile = path.join(rootDir, relFile);

      if (!fs.existsSync(absFile)) {
        diagnostics.error("error", `ERROR  ${relFile}:0 — source file not found`);
        broken++;
        continue;
      }

      const content = fs.readFileSync(absFile, 'utf8');
      const lines = content.split('\n');
      const fileDir = path.dirname(absFile);

      lines.forEach((line, idx) => {
        const lineNum = idx + 1;
        LINK_RE.lastIndex = 0;
        let m;
        while ((m = LINK_RE.exec(line)) !== null) {
          const href = m[2];

          if (/^https?:\/\/|^mailto:/.test(href)) {
            external.push({ file: relFile, line: lineNum, href });
            continue;
          }

          const hashIdx = href.indexOf('#');
          const filePart = hashIdx === -1 ? href : href.slice(0, hashIdx);
          const anchor = hashIdx === -1 ? null : href.slice(hashIdx + 1);

          const allowKey = `${relFile}:${href}`;
          if (ALLOWLIST.has(allowKey)) {
            skipped++;
            continue;
          }

          if (!filePart) {
            checked++;
            const ownSlugs = getSlugs(absFile);
            if (!ownSlugs.has(anchor)) {
              diagnostics.error("broken", `BROKEN ${relFile}:${lineNum} — anchor #${anchor} not found in same file`);
              broken++;
            }
            continue;
          }

          const absTarget = path.resolve(fileDir, filePart);

          checked++;

          if (!fs.existsSync(absTarget)) {
            const rel = path.relative(rootDir, absTarget);
            diagnostics.error("broken-2", `BROKEN ${relFile}:${lineNum} — file not found: ${filePart} (→ ${rel})`);
            broken++;
            continue;
          }

          if (anchor && /\.md$/i.test(absTarget)) {
            const targetSlugs = getSlugs(absTarget);
            if (!targetSlugs.has(anchor.toLowerCase())) {
              diagnostics.error("broken-3", `BROKEN ${relFile}:${lineNum} — anchor #${anchor} not found in ${path.relative(rootDir, absTarget)}`);
              broken++;
            }
          }
        }
      });
    }

    if (external.length > 0) {
      if (showExternal) {
        diagnostics.info("external-links", `\nExternal links (${external.length}, not validated):`);
        for (const { file, line, href } of external) {
          diagnostics.info("progress", `  ${file}:${line}: ${href}`);
        }
      } else {
        diagnostics.info("external-links-2", `External links: ${external.length} (pass --external to list)`);
      }
    }

    if (broken === 0) {
      diagnostics.info("ok", `OK  ${checked} local link(s) checked, ${skipped} allowlisted`);
      return 0;
    }

    diagnostics.error("fail", `\nFAIL  ${broken} broken link(s) — fix the paths above or add to ALLOWLIST in scripts/check-links.js`);
    return 1;
  },
});
