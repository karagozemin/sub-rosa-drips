#!/usr/bin/env node
// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from '../packages/logging/src/index.cjs';
const diagnostics = createLogger("scripts.check-snapshots");
// check-snapshots.mjs
//
// CI guard for Issue #120 — contract snapshot inventory check.
//
// Scans contracts/round/test_snapshots/test for .json files and verifies
// that every required snapshot category is still present. The check is
// purely filename-based: no snapshot payloads are parsed.
//
// Usage (from repo root):
//   node scripts/check-snapshots.mjs
//   pnpm snapshot:check          ← added to root package.json
//
// Exit codes:
//   0  all required categories present
//   1  one or more categories missing

import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { runCommand } from "@sub-rosa/command";

// ---------------------------------------------------------------------------
// Required snapshot categories.
//
// Each entry is a prefix that must be matched by at least one .json file in
// the snapshot directory. They are grouped by lifecycle phase for readability.
// ---------------------------------------------------------------------------
const REQUIRED_CATEGORIES = [
  // ── Create ──────────────────────────────────────────────────────────────
  "create_round_happy_path",
  "create_round_rejects_commit_after_reveal",
  "create_round_rejects_deadline_in_past",

  // ── Commit ───────────────────────────────────────────────────────────────
  "commit_locks_escrow",
  "commit_after_deadline_rejected",
  "commit_zero_escrow_rejected",
  "commit_on_settled_round_rejected",
  "commit_overwrite_before_close_refunds_prior_escrow",
  "overwrite_to_larger_escrow_conserves_tokens",
  "repeated_overwrites_escrow_conservation",

  // ── Reveal ───────────────────────────────────────────────────────────────
  "duplicate_reveal_rejected",
  "reveal_hash_mismatch_invalidates_bid",
  "reveal_wrong_nonce_rejected",
  "reveal_on_settled_round_rejected",
  "late_reveal_rejected_after_window_even_with_seal_present",
  "open_reveal_extends_seal_through_reveal_window",
  "open_reveal_on_settled_round_rejected",
  "missing_reveal_bid_is_skipped_during_clear",
  "no_valid_bids_after_reveal_window",

  // ── Settle ───────────────────────────────────────────────────────────────
  "double_settle_rejected",
  "settle_exact_payouts_table",
  "settled_round_persistent_state_survives_seal_expiry",
  "contract_balance_zero_after_settle",
  "clear_and_settle_work_after_seal_expiry",

  // ── Void ─────────────────────────────────────────────────────────────────
  "double_void_rejected",
  "void_before_grace_rejected",
  "void_after_grace_refunds_all",
  "voided_round_refunds_survive_seal_expiry",
  "contract_balance_zero_after_void",

  // ── Pagination ───────────────────────────────────────────────────────────
  "get_bidders_page_empty",
  "get_bidders_page_exact",
  "get_bidders_page_partial",
  "get_bidders_page_final",
  "get_bidders_page_multi",
  "get_bidders_page_cursor_at_total",
  "get_bidders_page_cursor_beyond_total",
  "get_bidders_page_rejects_limit_zero",
  "get_bidders_page_rejects_limit_over_max",
  "get_bidders_page_preserves_order",
  "get_bidders_returns_ordered_index",
  "get_bidders_still_returns_full_list",

  // ── Drand / lifecycle ────────────────────────────────────────────────────
  "full_lifecycle_real_drand_signature",
  "active_round_seal_ttl_covers_reveal_window",
  "observer_reads_round_and_bid_state_after_lifecycle_completion",
  "token_conservation_full_lifecycle",

  // ── Clearing rules ───────────────────────────────────────────────────────
  "highest_bid_table_driven",
  "highest_bid_tie_is_deterministic_first_inserter_wins",
  "lowest_bid_table_driven",
  "lowest_bid_tie_is_deterministic_first_inserter_wins",
  "seeded_case_42_highest_bid_reproducible",
  "seeded_case_7_lowest_bid_reproducible",
];

/**
 * Validates the presence of required contract snapshot categories.
 *
 * @param {string} snapshotDir
 * @returns {number}
 */
export function main(snapshotDir) {
  let files;
  try {
    files = readdirSync(snapshotDir).filter((f) => f.endsWith(".json"));
  } catch (err) {
    diagnostics.error("cannot-read-snapshot-directory", `\n✗ Cannot read snapshot directory: ${snapshotDir}`);
    diagnostics.error("progress", `  ${err.message}`);
    return 1;
  }

  const presentCategories = new Set(
    files.map((f) => f.replace(/\.\d+\.json$/, "")),
  );

  const missing = REQUIRED_CATEGORIES.filter(
    (cat) => !presentCategories.has(cat),
  );

  const total = files.length;
  const required = REQUIRED_CATEGORIES.length;

  diagnostics.info("contract-snapshot-inventory", `\nContract snapshot inventory`);
  diagnostics.info("directory", `  Directory : ${snapshotDir}`);
  diagnostics.info("files-found", `  Files found  : ${total}`);
  diagnostics.info("categories-checked", `  Categories checked : ${required}`);

  if (missing.length === 0) {
    diagnostics.info("all", `\n✓ All ${required} required snapshot categories are present.\n`);
    return 0;
  }

  diagnostics.error("progress-2", `\n✗ ${missing.length} required snapshot category/categories missing:\n`);
  for (const cat of missing) {
    diagnostics.error("progress-3", `    - ${cat}`);
  }
  diagnostics.error("regenerate-snapshots-with-cargo-test-p-sub-rosa-round", `\n  Regenerate snapshots with: cargo test -p sub-rosa-round\n`);
  return 1;
}

runCommand({
  name: "scripts.check-snapshots",
  description: "Verify contract snapshot inventory",
  run(ctx) {
    const snapshotDir = ctx.resolvePath("contracts/round/test_snapshots/test");
    return main(snapshotDir);
  },
});
