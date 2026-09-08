// SPDX-License-Identifier: MIT
import type { RoundReceipt, BidReceiptEntry } from "./receipt.js";

export type { BidReceiptEntry } from "./receipt.js";
export interface RedactOptions {
  /** Dot-paths to preserve (e.g. "bids.GABC...123.commitment"). */
  keep?: string[];
}

const REDACTED = "<redacted>";

const SENSITIVE_KEYS = new Set([
  "bidder", "bidders", "operator", "contractid", "contract_id",
  "winner", "appraiser", "memo", "txhash", "tx_hash",
  "ciphertext", "auditorblob", "auditor_blob", "accountid",
  "account_id", "roundid", "round_id", "itemref", "item_ref",
  "revealround", "reveal_round",
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

function redactBidEntry(
  entry: BidReceiptEntry,
  path: string,
  keep: Set<string>,
): BidReceiptEntry {
  if (keep.has(path)) {
    return JSON.parse(JSON.stringify(entry));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    const childPath = `${path}.${key}`;
    if (keep.has(childPath)) {
      result[key] = value;
    } else if ((key === "ciphertext" || key === "auditorBlob") && value !== null) {
      result[key] = REDACTED;
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = redactObject(value as Record<string, unknown>, childPath, keep);
    } else {
      result[key] = value;
    }
  }
  return result as unknown as BidReceiptEntry;
}

function redactObject(
  obj: Record<string, unknown>,
  path: string,
  keep: Set<string>,
): Record<string, unknown> {
  if (keep.has(path)) {
    return JSON.parse(JSON.stringify(obj));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const childPath = path ? `${path}.${key}` : key;
    if (keep.has(childPath)) {
      out[key] = val;
    } else if (isSensitiveKey(key) && val !== null) {
      out[key] = REDACTED;
    } else if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      out[key] = redactObject(val as Record<string, unknown>, childPath, keep);
    } else if (Array.isArray(val)) {
      out[key] = redactArray(val, childPath, keep);
    } else {
      out[key] = val;
    }
  }
  return out;
}

function redactArray(arr: unknown[], path: string, keep: Set<string>): unknown[] {
  return arr.map((item, i) => {
    const itemPath = `${path}[${i}]`;
    if (keep.has(itemPath)) return item;
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      return redactObject(item as Record<string, unknown>, itemPath, keep);
    } else if (Array.isArray(item)) {
      return redactArray(item, itemPath, keep);
    }
    return item;
  });
}

export function redactReceipt<T extends RoundReceipt>(receipt: T, options?: RedactOptions): T {
  const keep = new Set(options?.keep ?? []);
  const cloned = JSON.parse(JSON.stringify(receipt)) as T;

  const root: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(cloned as Record<string, unknown>)) {
    if (key === "bids") {
      const redactedBids: Record<string, BidReceiptEntry> = {};
      const entries = Object.entries(val as Record<string, BidReceiptEntry>);
      if (keep.has("bids")) {
        root[key] = JSON.parse(JSON.stringify(val));
      } else {
        for (let i = 0; i < entries.length; i++) {
          const [bidKey, entry] = entries[i];
          const isKept =
            keep.has(`bids.${bidKey}`) ||
            Array.from(keep).some((p) => p.startsWith(`bids.${bidKey}.`));
          const newKey = isKept ? bidKey : `<redacted:${i}>`;
          redactedBids[newKey] = redactBidEntry(entry, `bids.${bidKey}`, keep);
        }
        root[key] = redactedBids;
      }
    } else if (key === "bidders" && Array.isArray(val)) {
      root[key] = keep.has("bidders") ? val : val.map((_, i) => `<redacted:${i}>`);
    } else if (keep.has(key)) {
      root[key] = val;
    } else if (isSensitiveKey(key)) {
      root[key] = REDACTED;
    } else if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      root[key] = redactObject(val as Record<string, unknown>, key, keep);
    } else if (Array.isArray(val)) {
      root[key] = redactArray(val, key, keep);
    } else {
      root[key] = val;
    }
  }

  return root as T;
}
