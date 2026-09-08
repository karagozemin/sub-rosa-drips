// Copyright (c) 2026 Sub Rosa contributors
// Live Drand quicknet access. No hardcoded beacons — everything is fetched from
// the public API so the harness validates against the real network.

import { getSystemEnv } from "@sub-rosa/config";

export const QUICKNET_HASH =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";

const env = getSystemEnv();
const API = env.DRAND_API_URL ?? "https://api.drand.sh";

export interface ChainInfo {
  public_key: string; // compressed G2, hex (96 bytes)
  period: number; // seconds
  genesis_time: number; // unix seconds
  hash: string;
  schemeID: string;
}

export interface Beacon {
  round: number;
  randomness: string;
  signature: string; // compressed G1, hex (48 bytes)
}

export async function getChainInfo(): Promise<ChainInfo> {
  const res = await fetch(`${API}/${QUICKNET_HASH}/info`);
  if (!res.ok) throw new Error(`info HTTP ${res.status}`);
  return (await res.json()) as ChainInfo;
}

export async function getBeacon(round: number | "latest"): Promise<Beacon> {
  const res = await fetch(`${API}/${QUICKNET_HASH}/public/${round}`);
  if (!res.ok) throw new Error(`beacon ${round} HTTP ${res.status}`);
  return (await res.json()) as Beacon;
}

export function roundAt(info: ChainInfo, unixSeconds: number): number {
  if (unixSeconds < info.genesis_time) return 1;
  return Math.floor((unixSeconds - info.genesis_time) / info.period) + 1;
}

export function timeOfRound(info: ChainInfo, round: number): number {
  return info.genesis_time + info.period * round;
}
