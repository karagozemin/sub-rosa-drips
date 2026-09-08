// Copyright (c) 2026 Sub Rosa contributors
import { createLogger, type Logger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.keeper.src.store");
import * as fs from "fs";
import * as path from "path";
import { systemClock } from "@sub-rosa/time";

export interface WatchedRound {
  roundId: string;
  contractId?: string;
  network?: string;
  revealRound?: string;
  lastStatus: string;
  retryCount: number;
  lastError?: string;
  lastAction?: string;
}

export interface StoreData {
  rounds: Record<string, WatchedRound>;
}

export type RoundIdInput = bigint | number | string;

/**
 * Numeric round-id comparator. Orders two round ids by their numeric value
 * regardless of the input type (bigint, number, or string). Returns a negative
 * number if `a < b`, zero if equal, and a positive number if `a > b`.
 */
export function compareRoundIds(a: RoundIdInput, b: RoundIdInput): number {
  const aBig = BigInt(normalizeRoundId(a));
  const bBig = BigInt(normalizeRoundId(b));
  return aBig < bBig ? -1 : aBig > bBig ? 1 : 0;
}

export function normalizeRoundId(roundId: RoundIdInput): string {
  let value: bigint;

  if (typeof roundId === "bigint") {
    value = roundId;
  } else if (typeof roundId === "number") {
    if (!Number.isSafeInteger(roundId)) {
      throw new Error(`roundId must be a positive integer, got ${roundId}`);
    }
    value = BigInt(roundId);
  } else {
    const trimmed = roundId.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`roundId must be a positive integer, got ${JSON.stringify(roundId)}`);
    }
    value = BigInt(trimmed);
  }

  if (value <= 0n) {
    throw new Error(`roundId must be a positive integer, got ${value}`);
  }

  return value.toString();
}

export class KeeperStore {
  private readonly storePath: string;
  private data: StoreData;

  constructor(storePath?: string, private readonly logger: Logger = diagnostics) {
    this.storePath =
      storePath || process.env.KEEPER_STORE_PATH || ".keeper-store.json";
    this.data = this.loadStore();
  }

  private loadStore(): StoreData {
    if (!fs.existsSync(this.storePath)) {
      return { rounds: {} };
    }

    try {
      const content = fs.readFileSync(this.storePath, "utf-8");
      if (!content.trim()) return { rounds: {} };
      const parsed = JSON.parse(content) as Partial<StoreData>;
      if (!parsed.rounds || typeof parsed.rounds !== "object") {
        return { rounds: {} };
      }
      const rounds: Record<string, WatchedRound> = {};
      for (const [key, value] of Object.entries(parsed.rounds)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          this.logger.warn("store-dropping-malformed-stored-round-entry", `[Store] Dropping malformed stored round entry ${key}: expected an object`);
          continue;
        }
        const stored = value as Partial<WatchedRound>;
        let id: string;
        try {
          id = normalizeRoundId(stored.roundId ?? key);
        } catch {
          this.logger.warn("store-dropping-malformed-stored-round-entry-2", `[Store] Dropping malformed stored round entry ${key}: non-numeric or invalid round id ${JSON.stringify(stored.roundId ?? key)}`);
          continue;
        }
        rounds[id] = { ...stored, roundId: id } as WatchedRound;
      }
      return { rounds };
    } catch (e) {
      this.logger.warn("store-failed-to-parse", `[Store] Failed to parse ${this.storePath}. Backing up corrupted file and starting fresh.`);
      try {
        fs.renameSync(this.storePath, `${this.storePath}.corrupted.${systemClock.nowMs()}`);
      } catch (backupErr) {
        this.logger.error("store-could-not-backup-corrupted-file", `[Store] Could not backup corrupted file:`, { "backupErr_0": backupErr });
      }
      return { rounds: {} };
    }
  }

  private saveStore(): void {
    try {
      // Ensure directory exists if path has one
      const dir = path.dirname(this.storePath);
      if (dir !== ".") {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (e) {
      this.logger.error("store-failed-to-save-store-to", `[Store] Failed to save store to ${this.storePath}:`, { "e_0": e });
    }
  }

  public addRound(roundId: RoundIdInput, extra: Partial<WatchedRound> = {}): void {
    const idStr = normalizeRoundId(roundId);
    if (!this.data.rounds[idStr]) {
      this.data.rounds[idStr] = {
        lastStatus: "Unknown",
        retryCount: 0,
        ...extra,
        roundId: idStr,
      };
    } else {
      // If it exists, we can optionally update its fields
      this.data.rounds[idStr] = {
        ...this.data.rounds[idStr],
        ...extra,
        roundId: idStr,
      };
    }
    this.saveStore();
  }

  public removeRound(roundId: RoundIdInput): void {
    const idStr = normalizeRoundId(roundId);
    if (this.data.rounds[idStr]) {
      delete this.data.rounds[idStr];
      this.saveStore();
    }
  }

  public updateRound(roundId: RoundIdInput, update: Partial<WatchedRound>): void {
    const idStr = normalizeRoundId(roundId);
    if (this.data.rounds[idStr]) {
      this.data.rounds[idStr] = { ...this.data.rounds[idStr], ...update, roundId: idStr };
      this.saveStore();
    }
  }

  public getRound(roundId: RoundIdInput): WatchedRound | undefined {
    return this.data.rounds[normalizeRoundId(roundId)];
  }

  public listRounds(): WatchedRound[] {
    // Return sorted by roundId numerically, regardless of id type
    return Object.values(this.data.rounds).sort((a, b) => compareRoundIds(a.roundId, b.roundId));
  }

  public getRawData(): StoreData {
    return this.data;
  }
}
