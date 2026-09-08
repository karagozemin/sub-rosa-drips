// SPDX-License-Identifier: MIT
// Canonical round receipt — deterministic, versioned, offline-verifiable.
//
// Every bigint is serialized as a decimal string; every byte sequence as
// lowercase hex. Fields that depend on expired Temporary storage (seal
// ciphertext, auditor blob) are honestly marked null when unavailable.

import { createHash } from "node:crypto";

export const RECEIPT_VERSION = 1;

/** sha256(utf8(networkPassphrase)) — hex. Embedded in the receipt so the
 *  offline verifier can detect a tampered `network` field without any caller-
 *  supplied context. */
export function networkFingerprint(passphrase: string): string {
  return createHash("sha256").update(passphrase, "utf8").digest("hex");
}

export interface BidReceiptEntry {
  /** sha256(be16(value) ‖ nonce) — hex. */
  commitment: string;
  /** Public USDC budget locked at commit — decimal string. */
  escrow: string;
  /** Revealed bid value — decimal string; null if not revealed. */
  revealedValue: string | null;
  /** 32-byte nonce that was combined with the value — hex; null if not revealed. */
  nonce: string | null;
  /** Whether the recomputed sha256 matches the on-chain commitment. null if unrevealed. */
  hashValid: boolean | null;
  /** Whether the bid was marked valid by the contract at clear time. */
  valid: boolean;
  /** Whether this bidder's escrow has been settled/refunded. */
  settled: boolean;
  /** Available ephemeral evidence (may be null if expired). */
  evidence: {
    /** tlock ciphertext — hex; null if expired. */
    ciphertext: string | null;
    /** Encrypted bidder identity — hex; null if expired. */
    auditorBlob: string | null;
  };
}

export interface RoundReceipt {
  /** Schema version. Currently 1. */
  version: typeof RECEIPT_VERSION;
  /** Stellar network passphrase (e.g. "Test SDF Network ; September 2015"). */
  network: string;
  /** sha256(utf8(network)) — hex. Lets the offline verifier detect a tampered
   *  `network` field without any caller-supplied context. */
  networkFingerprint: string;
  /** Contract ID the round belongs to (C…). */
  contractId: string;
  /** ISO-8601 timestamp when this receipt was exported. */
  exportedAt: string;

  // ── Round parameters ───────────────────────────────────────────────
  /** Round ID (u64, decimal string). */
  roundId: string;
  /** Opaque 32-byte item reference — hex. */
  itemRef: string;
  /** Drand round R whose threshold signature unseals the bids. */
  revealRound: number;
  /** Clearing rule tag (e.g. "HighestBid", "LowestBid"). */
  clearingRule: string;
  /** Commit window deadline — Unix seconds (decimal string). */
  commitDeadline: string;
  /** Reveal window deadline — Unix seconds (decimal string). */
  revealDeadline: string;
  /** Operator address (G…). */
  operator: string;
  /** Auditor public key — hex. */
  auditorPubkey: string;

  // ── Participants ───────────────────────────────────────────────────
  /** Ordered bidder addresses, matching the on-chain index order. */
  bidders: string[];
  /** Per-bidder detail keyed by address. */
  bids: Record<string, BidReceiptEntry>;

  // ── Outcome ─────────────────────────────────────────────────────────
  /** Winning bidder address, or null if voided / no valid bids. */
  winner: string | null;
  /** Winning bid value — decimal string, or null. */
  winningValue: string | null;
  /** Final on-chain status tag. */
  status: string;
  /** Optional checksum of the local artifact manifest or binding file. */
  artifactChecksum?: string;
}

function sortKeys(_: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }
  return value;
}

/** Serialise a receipt to canonical JSON (deep-sorted keys, no whitespace).
 *  This is the format the CLI writes and the verifier reads. */
export function serializeReceipt(receipt: RoundReceipt): string {
  return JSON.stringify(receipt, sortKeys) + "\n";
}

/** Parse a receipt from its canonical JSON form. */
export function parseReceipt(json: string): RoundReceipt {
  return JSON.parse(json) as RoundReceipt;
}
