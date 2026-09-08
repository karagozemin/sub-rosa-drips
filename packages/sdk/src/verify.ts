// SPDX-License-Identifier: MIT
// Offline round-receipt verifier.
//
// Every check is stateless — no RPC, no secrets. The verifier recomputes
// commitment bindings, winner selection, and internal consistency from the
// receipt data alone.

import { toHex, fromHex, commitment } from "@sub-rosa/tlock";
import type { RoundReceipt } from "./receipt.js";
import { networkFingerprint } from "./receipt.js";

// ── Verification result types ────────────────────────────────────────────

export type Severity = "error" | "warning";

export interface VerificationIssue {
  severity: Severity;
  code: string;
  message: string;
  /** Optional path to the offending field, e.g. "bids.GABC…123.commitment". */
  path?: string;
}

export interface VerificationResult {
  /** true when no errors (warnings are tolerated). */
  valid: boolean;
  issues: VerificationIssue[];
  /** Recomputed winner from the receipt data (may differ from declared). */
  computedWinner: { address: string | null; value: bigint | null };
}

export interface VerifyOptions {
  // Reserved for future extension.
}

// ── Helpers ──────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set([
  "Open", "Revealing", "Cleared", "Settled", "Voided",
]);

/** Parse a decimal bigint string. Returns null on malformed input. */
function parseBigInt(s: string): bigint | null {
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

// ── Verifier ─────────────────────────────────────────────────────────────

export function verifyReceipt(receipt: RoundReceipt, options?: VerifyOptions): VerificationResult {
  const issues: VerificationIssue[] = [];
  const add = (
    severity: Severity,
    code: string,
    message: string,
    path?: string,
  ) => issues.push({ severity, code, message, path });

  // ══ Schema ══════════════════════════════════════════════════════════════
  if (receipt.version !== 1) {
    add("error", "unsupported_version", `version ${receipt.version} is not supported`);
    return { valid: false, issues, computedWinner: { address: null, value: null } };
  }

  if (typeof receipt.network !== "string" || !receipt.network) {
    add("error", "missing_network", "network is missing or empty", "network");
  } else {
    // Always verify the embedded fingerprint — detects a tampered network
    // passphrase without any caller-supplied context.
    const expected = networkFingerprint(receipt.network);
    if (
      typeof receipt.networkFingerprint !== "string" ||
      receipt.networkFingerprint !== expected
    ) {
      add(
        "error",
        "network_mismatch",
        `networkFingerprint does not match sha256 of network passphrase`,
        "networkFingerprint",
      );
    }
  }
  if (typeof receipt.contractId !== "string" || !receipt.contractId.startsWith("C")) {
    add("error", "invalid_contract_id", "contractId must start with C", "contractId");
  }
  if (typeof receipt.roundId !== "string" || parseBigInt(receipt.roundId) === null) {
    add("error", "invalid_round_id", "roundId must be a decimal bigint string", "roundId");
  }
  if (typeof receipt.clearingRule !== "string" || !["HighestBid", "LowestBid"].includes(receipt.clearingRule)) {
    add("error", "invalid_clearing_rule", `clearingRule must be HighestBid or LowestBid, got ${receipt.clearingRule}`, "clearingRule");
  }
  if (!VALID_STATUSES.has(receipt.status)) {
    add("warning", "unknown_status", `unrecognised status: ${receipt.status}`, "status");
  }

  // ══ Bidders consistency ════════════════════════════════════════════════
  if (!Array.isArray(receipt.bidders)) {
    add("error", "missing_bidders", "bidders must be an array", "bidders");
    return { valid: false, issues, computedWinner: { address: null, value: null } };
  }

  const seen = new Set<string>();
  for (const bidder of receipt.bidders) {
    if (!bidder.startsWith("G")) {
      add("error", "invalid_bidder", `bidder address must start with G: ${bidder}`, "bidders");
    }
    if (seen.has(bidder)) {
      add("error", "duplicate_bidder", `duplicate bidder: ${bidder}`, "bidders");
    }
    seen.add(bidder);
  }

  const receiptBidderSet = new Set(receipt.bidders);
  const bidKeys = Object.keys(receipt.bids);
  for (const key of bidKeys) {
    if (!receiptBidderSet.has(key)) {
      add("error", "orphan_bid_entry", `bid entry for ${key} not in bidders array`, `bids.${key}`);
    }
  }
  for (const bidder of receipt.bidders) {
    if (!(bidder in receipt.bids)) {
      add("error", "missing_bid_entry", `no bid entry for ${bidder}`, `bidders.${bidder}`);
    }
  }

  // ══ Per-bidder checks ══════════════════════════════════════════════════
  let computedWinnerAddr: string | null = null;
  let computedWinnerVal: bigint | null = null;

  for (const bidder of receipt.bidders) {
    const entry = receipt.bids[bidder];
    if (!entry) continue;
    const prefix = `bids.${bidder}`;

    // Commitment must be a 64-char hex string (32 bytes).
    if (typeof entry.commitment !== "string" || !/^[0-9a-f]{64}$/i.test(entry.commitment)) {
      add("error", "invalid_commitment", `commitment must be 64 hex chars`, `${prefix}.commitment`);
    }

    // Escrow must be a valid decimal bigint.
    const escrow = parseBigInt(entry.escrow);
    if (escrow === null || escrow < 0n) {
      add("error", "invalid_escrow", `escrow must be a non-negative decimal bigint string`, `${prefix}.escrow`);
    }

    if (entry.revealedValue !== null && entry.nonce !== null) {
      // Full offline binding check — both value and nonce are present.
      const rv = parseBigInt(entry.revealedValue);
      if (rv === null) {
        add("error", "invalid_revealed_value", `revealedValue must be a decimal bigint string`, `${prefix}.revealedValue`);
      } else {
        let nonce: Uint8Array;
        try {
          nonce = fromHex(entry.nonce);
        } catch {
          add("error", "invalid_nonce", `nonce must be valid hex`, `${prefix}.nonce`);
          continue;
        }
        if (nonce.length !== 32) {
          add("error", "invalid_nonce_length", `nonce must be 32 bytes, got ${nonce.length}`, `${prefix}.nonce`);
          continue;
        }

        const recomputed = toHex(commitment(rv, nonce));
        if (recomputed !== entry.commitment.toLowerCase()) {
          add(
            "error",
            "commitment_mismatch",
            `sha256(be16(${rv}) || nonce) = ${recomputed}, expected ${entry.commitment}`,
            `${prefix}.commitment`,
          );
        }

        // Track winner candidate.
        if (entry.valid) {
          const rule = receipt.clearingRule;
          const isHigher = computedWinnerVal === null || rv > computedWinnerVal;
          const isLower = computedWinnerVal === null || rv < computedWinnerVal;
          if (rule === "HighestBid" ? isHigher : isLower) {
            computedWinnerAddr = bidder;
            computedWinnerVal = rv;
          }
        }
      }
    } else if (entry.revealedValue !== null && entry.nonce === null) {
      // Contract verified the hash on-chain; nonce not persisted. Offline
      // commitment re-binding is not possible. Winner is still computable.
      const rv = parseBigInt(entry.revealedValue);
      if (rv === null) {
        add("error", "invalid_revealed_value", `revealedValue must be a decimal bigint string`, `${prefix}.revealedValue`);
      } else if (entry.valid) {
        const rule = receipt.clearingRule;
        const isHigher = computedWinnerVal === null || rv > computedWinnerVal;
        const isLower = computedWinnerVal === null || rv < computedWinnerVal;
        if (rule === "HighestBid" ? isHigher : isLower) {
          computedWinnerAddr = bidder;
          computedWinnerVal = rv;
        }
      }
    } else if (entry.nonce !== null) {
      // nonce present without revealedValue — malformed.
      add(
        "error",
        "partial_reveal",
        "nonce is set but revealedValue is null",
        `${prefix}`,
      );
    }
  }

  // ══ Winner validation ══════════════════════════════════════════════════
  if (computedWinnerAddr !== null && receipt.winner !== null) {
    if (computedWinnerAddr !== receipt.winner) {
      add(
        "error",
        "winner_mismatch",
        `computed winner is ${computedWinnerAddr} (${computedWinnerVal}), declared winner is ${receipt.winner}`,
        "winner",
      );
    }
  } else if (receipt.winner === null && computedWinnerAddr !== null) {
    add(
      "warning",
      "winner_not_declared",
      `receipt declares no winner but computed winner is ${computedWinnerAddr} (${computedWinnerVal})`,
      "winner",
    );
  } else if (receipt.winner !== null && computedWinnerAddr === null) {
    add(
      "warning",
      "winner_not_computed",
      `receipt declares winner ${receipt.winner} but no valid revealed bids found`,
      "winner",
    );
  }

  // ══ Evidence checks ════════════════════════════════════════════════════
  for (const bidder of receipt.bidders) {
    const entry = receipt.bids[bidder];
    if (!entry) continue;
    const evidence = entry.evidence;
    if (evidence) {
      if (evidence.ciphertext !== null && !/^[0-9a-f]+$/i.test(evidence.ciphertext)) {
        add("error", "invalid_evidence_hex", `ciphertext is not valid hex`, `bids.${bidder}.evidence.ciphertext`);
      }
      if (evidence.auditorBlob !== null && !/^[0-9a-f]+$/i.test(evidence.auditorBlob)) {
        add("error", "invalid_evidence_hex", `auditorBlob is not valid hex`, `bids.${bidder}.evidence.auditorBlob`);
      }
    }
  }

  const errors = issues.filter((i) => i.severity === "error");
  return {
    valid: errors.length === 0,
    issues,
    computedWinner: { address: computedWinnerAddr, value: computedWinnerVal },
  };
}
