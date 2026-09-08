// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.keeper.src.run");
// Keeper CLI entry. Runs one full pass over a round (wait for R → open → reveal
// all) and prints the result. Re-running is safe: completed work is skipped.
//
// Env:
//   ROUND_CONTRACT_ID   deployed Round contract id (C…)
//   ROUND_ID            round to keep (default 1)
//   KEEPER_DRY_RUN      true prints a read-only preflight summary and exits
//   KEEPER_SECRET       funded signer secret (S…); not required for dry-run
//   MAX_WAIT_SECONDS    how long to wait for round R (default 0)
//   RPC_URL             default https://soroban-testnet.stellar.org
//   NETWORK_PASSPHRASE  default testnet

import { SubRosaClient } from "@sub-rosa/sdk";
import { quicknet } from "@sub-rosa/tlock";

import {
  buildKeeperDryRunSummary,
  parseKeeperRunConfig,
} from "./dry-run.js";
import { keepRound } from "./keeper.js";

async function main() {
  const config = parseKeeperRunConfig();

  if (config.dryRun) {
    const reader = new SubRosaClient({
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      contractId: config.contractId,
    });
    const summary = await buildKeeperDryRunSummary(reader, config.roundId);
    diagnostics.info("keeper-dry-run-summary", "keeper dry-run summary:");
    diagnostics.info("progress", JSON.stringify(summary, bigintReplacer, 2));
    return;
  }

  const sdk = new SubRosaClient({
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    contractId: config.contractId,
    secretKey: config.keeperSecret!,
  });

  const result = await keepRound(
    {
      sdk,
      drand: quicknet(),
      log: (m) => diagnostics.info("progress-2", `· ${m}`),
      maxWaitSeconds: config.maxWaitSeconds,
    },
    config.roundId,
  );

  diagnostics.info("keeper-result", "\nkeeper result:", { "value1_0": JSON.stringify(result, bigintReplacer, 2) });
  if (result.finalStatus === "Open") {
    diagnostics.info("round-still-open-r-not-yet-published-re-run-later", "round still Open (R not yet published) — re-run later.");
  }
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

main().catch((err) => {
  diagnostics.error("keeper-failed", "keeper failed:", { "err_0": err });
  process.exit(1);
});
