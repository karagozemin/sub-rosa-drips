// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.keeper.src.watch");
// Watch-mode keeper — standalone entry. For a combined status-API + watch
// process, use `serve.ts` instead.
//
// Env:
//   ROUND_CONTRACT_ID   deployed Round contract id (C…)
//   KEEPER_SECRET       funded signer secret (S…)
//   RPC_URL             Soroban RPC (default testnet)
//   NETWORK_PASSPHRASE
//   WATCH_POLL_MS       poll interval (default 15000)
//   WATCH_ROUND_IDS     optional explicit list: "1,2,5" or "1-10"
//   WATCH_FROM          first round id when auto-discovering (default 1)
//   WATCH_MAX_ROUNDS    max rounds to probe (default 64)

import { Keypair } from "@stellar/stellar-sdk";
import { SubRosaClient } from "@sub-rosa/sdk";
import { quicknet } from "@sub-rosa/tlock";

import { createSettlementGuard } from "./settlement-guard.js";
import { KeeperStore } from "./store.js";
import { runWatchLoop } from "./watch-loop.js";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

async function main() {
  const pollMs = Number(process.env.WATCH_POLL_MS ?? "15000");
  const contractId = reqEnv("ROUND_CONTRACT_ID");
  const rpcUrl = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
  const networkPassphrase =
    process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
  const keeperSecret = reqEnv("KEEPER_SECRET");

  const sdk = new SubRosaClient({
    rpcUrl,
    networkPassphrase,
    contractId,
    secretKey: keeperSecret,
  });
  const drand = quicknet();
  const log = (m: string) => diagnostics.info("progress", `· ${m}`);

  let stopping = false;
  process.on("SIGINT", () => {
    diagnostics.info("watch-sigint-finishing-current-tick-then-exit", "\nwatch: SIGINT — finishing current tick then exit");
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  const store = new KeeperStore();
  const settlementGuard = createSettlementGuard();

  diagnostics.info("sub-rosa-watch-mode-keeper", "Sub Rosa watch-mode keeper");
  diagnostics.info("contract", "· contract:", { "contractId_0": contractId });
  diagnostics.info("poll", "· poll:    ", { "pollMs_0": pollMs, "value2_1": "ms" });
  diagnostics.info("ctrl-c-to-stop", "· Ctrl+C to stop\n");

  await runWatchLoop({
    sdk,
    drand,
    log,
    pollMs,
    contractId,
    network: networkPassphrase,
    store,
    settlementGuard,
    isStopping: () => stopping,
  });

  diagnostics.info("watch-stopped", "watch: stopped");
}

main().catch((err) => {
  diagnostics.error("watch-keeper-failed", "watch keeper failed:", { "err_0": err });
  process.exit(1);
});
