import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("packages.sdk.scripts.mainnet-micro");
// Optional mainnet micro commit on an EXISTING deployed Round contract.
//
// Default: checklist + dry-run only — no transactions.
// Execute: requires MAINNET_CONFIRM=SUB_ROSA_MAINNET and explicit --execute.
// Amounts are capped well below testnet demo sizes (never 700 USDC-scale).

import { randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

import { SubRosaClient } from "../src/client.js";
import {
  MAINNET_ARTIFACTS,
  MAINNET_MICRO_MAX_ESCROW,
} from "../src/mainnet-artifacts.js";
import {
  assertMainnetConfirmed,
  assertMicroAmounts,
  assertReadinessForExecute,
  defaultMainnetReadinessInput,
  runMainnetReadiness,
} from "../src/mainnet-readiness.js";
import { getSystemEnv } from "@sub-rosa/config";
import { generateAuditorKeypair, generateNonce, quicknet, sealBid } from "@sub-rosa/tlock";
import { systemClock } from "@sub-rosa/time";

const env = getSystemEnv();
const DRAND_GENESIS = 1_692_803_367;
const DRAND_PERIOD = 3;

const DEFAULT_BID = 500_000n;
const DEFAULT_ESCROW = 1_000_000n;

function reqEnv(name: string): string {
  const v = env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

function parseStroops(name: string, fallback: bigint): bigint {
  const raw = env[name];
  if (!raw) return fallback;
  const v = BigInt(raw);
  if (v <= 0n) throw new Error(`${name} must be positive`);
  if (v > MAINNET_MICRO_MAX_ESCROW) {
    throw new Error(`${name}=${v} exceeds MAINNET_MICRO_MAX_ESCROW (${MAINNET_MICRO_MAX_ESCROW})`);
  }
  return v;
}

function printChecklist(bid: bigint, escrow: bigint, execute: boolean) {
  diagnostics.info("sub-rosa-mainnet-micro-runner", "Sub Rosa — mainnet micro runner\n");
  diagnostics.info("contract-existing", "Contract (existing):", { "value1_0": env.ROUND_CONTRACT_ID ?? MAINNET_ARTIFACTS.contractId });
  diagnostics.info("token-native-xlm-sac", "Token:               native XLM SAC");
  diagnostics.info("bid-stroops", "Bid (stroops):      ", { "value1_0": bid.toString(), "value2_1": `(${(Number(bid) / 1e7).toFixed(7)} XLM)` });
  diagnostics.info("escrow-stroops", "Escrow (stroops):   ", { "value1_0": escrow.toString(), "value2_1": `(${(Number(escrow) / 1e7).toFixed(7)} XLM)` });
  diagnostics.info("progress", "");
  diagnostics.info("checklist", "Checklist:");
  diagnostics.info("round-contract-id-points-at-deployed-mainnet-round", "  [ ] ROUND_CONTRACT_ID points at deployed mainnet Round");
  diagnostics.info("operator-secret-bidder-secret-funded-with-xlm-for-fees", "  [ ] OPERATOR_SECRET + BIDDER_SECRET funded with XLM for fees");
  diagnostics.info("amounts-are-micro-never-testnet-700-459-usdc-demo-sizes", "  [ ] Amounts are micro (never testnet 700/459 USDC demo sizes)");
  diagnostics.info("round-1-settled-proof-already-verified-via-pnpm-mainnet", "  [ ] Round 1 settled proof already verified via pnpm mainnet:verify");
  if (execute) {
    diagnostics.info("mainnet-confirm-sub-rosa-mainnet-is-set", "  [ ] MAINNET_CONFIRM=SUB_ROSA_MAINNET is set");
    diagnostics.info("execute-flag-passed", "  [ ] --execute flag passed");
  } else {
    diagnostics.info("dry-run-only-no-transactions-will-be-sent", "  [ ] Dry-run only — no transactions will be sent");
  }
  diagnostics.info("progress-2", "");
}

async function main() {
  const execute = process.argv.includes("--execute");
  const bid = parseStroops("MICRO_BID_STROOPS", DEFAULT_BID);
  const escrow = parseStroops("MICRO_ESCROW_STROOPS", DEFAULT_ESCROW);
  assertMicroAmounts(bid, escrow);

  printChecklist(bid, escrow, execute);

  if (!execute) {
    diagnostics.info("dry-run-complete-to-send-txs", "DRY-RUN complete. To send txs:");
    diagnostics.info("mainnet-confirm-sub-rosa-mainnet-operator-secret-s-bidd", "  MAINNET_CONFIRM=SUB_ROSA_MAINNET OPERATOR_SECRET=S… BIDDER_SECRET=S… \\");
    diagnostics.info("pnpm-mainnet-micro-execute", "    pnpm mainnet:micro -- --execute");
    return;
  }

  if (env.MAINNET_CONFIRM !== "SUB_ROSA_MAINNET") {
    throw new Error('set MAINNET_CONFIRM=SUB_ROSA_MAINNET to execute on mainnet');
  }
  assertMainnetConfirmed(env);

  const operatorSecret = reqEnv("OPERATOR_SECRET");
  const bidderSecret = reqEnv("BIDDER_SECRET");
  const contractId = env.ROUND_CONTRACT_ID ?? MAINNET_ARTIFACTS.contractId;
  const rpcUrl = env.RPC_URL ?? MAINNET_ARTIFACTS.rpcUrl;
  const network = env.NETWORK_PASSPHRASE ?? MAINNET_ARTIFACTS.networkPassphrase;

  const operatorKp = Keypair.fromSecret(operatorSecret);
  const bidderKp = Keypair.fromSecret(bidderSecret);

  const reader = new SubRosaClient({
    rpcUrl,
    networkPassphrase: network,
    contractId,
    publicKey: operatorKp.publicKey(),
  });

  const readiness = await runMainnetReadiness(
    defaultMainnetReadinessInput({
      rpcUrl,
      networkPassphrase: network,
      contractId,
      withBalances: true,
      operatorAccount: operatorKp.publicKey(),
      bidderAccount: bidderKp.publicKey(),
    }),
    { reader },
  );
  assertReadinessForExecute(readiness.checks);

  // Pick next round id: max existing + 1 (probe up to 32).
  let nextRound = 1n;
  for (let id = 1n; id <= 32n; id++) {
    try {
      await reader.getRound(id);
      nextRound = id + 1n;
    } catch {
      break;
    }
  }

  const now = systemClock.nowSeconds();
  const revealRound = Math.ceil((now + 300 - DRAND_GENESIS) / DRAND_PERIOD);
  const commitDeadline = now + 120;
  const revealDeadline = DRAND_GENESIS + DRAND_PERIOD * revealRound + 180;
  const auditor = generateAuditorKeypair();

  diagnostics.info("createround-id", `→ createRound id≈${nextRound} R=${revealRound}…`);
  const operator = new SubRosaClient({
    rpcUrl,
    networkPassphrase: network,
    contractId,
    secretKey: operatorSecret,
  });
  const roundId = await operator.createRound({
    itemRef: randomBytes(32),
    revealRound,
    commitDeadline,
    revealDeadline,
    auditorPubkey: auditor.publicKey,
    clearingRule: "HighestBid",
  });

  const drand = quicknet();
  const nonce = generateNonce();
  const sealed = await sealBid({
    value: bid,
    nonce,
    round: revealRound,
    client: drand,
    identity: new TextEncoder().encode(`micro:${bidderKp.publicKey()}`),
    auditorPublicKey: auditor.publicKey,
  });

  diagnostics.info("commit-micro-sealed-bid", "→ commit micro sealed bid…");
  const bidder = new SubRosaClient({
    rpcUrl,
    networkPassphrase: network,
    contractId,
    secretKey: bidderSecret,
  });
  await bidder.commit({ roundId, sealed, escrow });

  diagnostics.info("mainnet-micro-commit-sent", "\n✅ MAINNET MICRO COMMIT SENT");
  diagnostics.info("contract", "   contract:", { "contractId_0": contractId });
  diagnostics.info("round", "   round:   ", { "value1_0": roundId.toString() });
  diagnostics.info("r", "   R:       ", { "revealRound_0": revealRound });
  diagnostics.info("bid", "   bid:     ", { "value1_0": (Number(bid) / 1e7).toFixed(7), "value2_1": "XLM" });
  diagnostics.info("escrow", "   escrow:  ", { "value1_0": (Number(escrow) / 1e7).toFixed(7), "value2_1": "XLM" });
  diagnostics.info("next-wait-for-r-then-pnpm-mainnet-settle-with-round-id", "\nNext: wait for R, then pnpm mainnet:settle with ROUND_ID=", { "value1_0": roundId.toString() });
}

main().catch((err) => {
  diagnostics.error("mainnet-micro-failed", "\n❌ MAINNET MICRO FAILED");
  diagnostics.error("progress-3", err);
  process.exit(1);
});
