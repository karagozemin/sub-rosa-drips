// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.keeper.src.serve");
// Standalone status server for the keeper.
//
// Runs the watch-mode keeper AND a status HTTP API on the same process so
// pilots and dashboards can poll keeper-observed rounds without SSHing into
// the host. The status server reads from the same on-chain source and the
// same persisted store as the watch loop — no extra RPC budget, no extra
// signing capability.
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
//   KEEPER_STATUS_HOST  status API bind host (default 127.0.0.1)
//   KEEPER_STATUS_PORT  status API port (default 8090)
//   KEEPER_STATUS_ENABLE set to "false" to disable the status API (default true)

import { Keypair } from "@stellar/stellar-sdk";
import { SubRosaClient } from "@sub-rosa/sdk";
import { quicknet } from "@sub-rosa/tlock";

import { createSettlementGuard } from "./settlement-guard.js";
import { createStatusServer, withGracefulShutdown } from "./status-server.js";
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
  const reader = new SubRosaClient({
    rpcUrl,
    networkPassphrase,
    contractId,
    publicKey: Keypair.fromSecret(keeperSecret).publicKey(),
  });
  const drand = quicknet();
  const log = (m: string) => diagnostics.info("progress", `· ${m}`);

  const store = new KeeperStore();
  const settlementGuard = createSettlementGuard();

  let stopping = false;
  process.on("SIGINT", () => {
    diagnostics.info("serve-sigint-finishing-current-tick-then-exit", "\nserve: SIGINT — finishing current tick then exit");
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  const statusEnabled = (process.env.KEEPER_STATUS_ENABLE ?? "true").toLowerCase() !== "false";
  const statusHost = process.env.KEEPER_STATUS_HOST ?? "127.0.0.1";
  const statusPort = Number(process.env.KEEPER_STATUS_PORT ?? "8090");

  let statusHandle: ReturnType<typeof withGracefulShutdown> | undefined;
  if (statusEnabled) {
    const server = createStatusServer({
      host: statusHost,
      port: statusPort,
      contractId,
      network: networkPassphrase,
      reader,
      drand,
      storeRounds: () => store.listRounds(),
      settleIndicator: (rid) => {
        const entry = settlementGuard.getEntry(rid);
        if (!entry) return "none";
        if (entry.status === "pending") return "pending";
        if (entry.status === "submitted") return "submitted";
        return "terminal";
      },
    });
    statusHandle = withGracefulShutdown(server);
    diagnostics.info("status-api-http", `· status API: http://${statusHost}:${statusPort} (GET /status, /status/rounds/:id, /healthz, /status/health)`);
  } else {
    diagnostics.info("status-api-disabled-keeper-status-enable-false", "· status API disabled (KEEPER_STATUS_ENABLE=false)");
  }

  diagnostics.info("sub-rosa-keeper-watch-status", "Sub Rosa keeper (watch + status)");
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

  if (statusHandle) await statusHandle.close();
  diagnostics.info("serve-stopped", "serve: stopped");
}

main().catch((err) => {
  diagnostics.error("keeper-serve-failed", "keeper serve failed:", { "err_0": err });
  process.exit(1);
});
