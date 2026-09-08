import { createLogger } from '@sub-rosa/logging';
import { runCommand } from "@sub-rosa/command";
import { Keypair } from "@stellar/stellar-sdk";

import { SubRosaClient } from "../src/client.js";
import { MAINNET_ARTIFACTS, MAINNET_CONFIRM_PHRASE } from "../src/mainnet-artifacts.js";
import {
  defaultMainnetReadinessInput,
  formatReadinessReport,
  hasBlockingFailures,
  runMainnetReadiness,
} from "../src/mainnet-readiness.js";

const diagnostics = createLogger("packages.sdk.scripts.mainnet-ready");

const DEFAULT_READER_PUBKEY =
  "GCDARJFKKSTJYAZC647H4ZSSSPXPPSKOWOHGMUNCT22VG74KXZ5BHVNR";

runCommand({
  name: "sdk.mainnet-ready",
  description: "Consolidated mainnet launch readiness check",
  options: {
    "dry-run": { type: "boolean" },
    "with-balances": { type: "boolean" },
    strict: { type: "boolean" },
  },
  async run(ctx) {
    const dryRun = Boolean(ctx.options["dry-run"]) || ctx.env.MAINNET_DRY_RUN === "1";
    const withBalances = Boolean(ctx.options["with-balances"]);
    const strict = Boolean(ctx.options.strict);

    const rpcUrl = ctx.env.RPC_URL ?? MAINNET_ARTIFACTS.rpcUrl;
    const networkPassphrase =
      ctx.env.NETWORK_PASSPHRASE ?? MAINNET_ARTIFACTS.networkPassphrase;
    const contractId =
      ctx.env.ROUND_CONTRACT_ID ?? MAINNET_ARTIFACTS.contractId;

    const operatorAccount = ctx.env.OPERATOR_SECRET
      ? Keypair.fromSecret(ctx.env.OPERATOR_SECRET).publicKey()
      : undefined;
    const keeperAccount = ctx.env.KEEPER_SECRET
      ? Keypair.fromSecret(ctx.env.KEEPER_SECRET).publicKey()
      : undefined;
    const bidderAccount = ctx.env.BIDDER_SECRET
      ? Keypair.fromSecret(ctx.env.BIDDER_SECRET).publicKey()
      : undefined;

    const input = defaultMainnetReadinessInput({
      rpcUrl,
      networkPassphrase,
      contractId,
      live: !dryRun,
      withBalances,
      operatorAccount,
      keeperAccount,
      bidderAccount,
    });

    const reader = dryRun
      ? undefined
      : new SubRosaClient({
          rpcUrl,
          networkPassphrase,
          contractId,
          publicKey:
            ctx.env.MAINNET_READER_PUBKEY ?? DEFAULT_READER_PUBKEY,
        });

    const report = await runMainnetReadiness(input, { reader });
    diagnostics.info("progress", formatReadinessReport(report));

    if (strict && hasBlockingFailures(report.checks)) {
      throw new Error("readiness checks failed in strict mode");
    }

    if (report.blockCount > 0) {
      diagnostics.info("blocking-issues-must-be-resolved-before-mainnet-executi", "\nBlocking issues must be resolved before mainnet execution.");
      diagnostics.info("value-moving-commands-require", "Value-moving commands require:");
      diagnostics.info("mainnet-confirm", `  MAINNET_CONFIRM=${MAINNET_CONFIRM_PHRASE}`);
      return 1;
    }

    diagnostics.info("mainnet-readiness-ok", "\n✅ MAINNET READINESS OK");
    diagnostics.info("recommended-launch-checklist", "Recommended launch checklist:");
    diagnostics.info("1-pnpm-mainnet-ready-strict", "  1. pnpm mainnet:ready -- --strict");
    diagnostics.info("2-pnpm-mainnet-verify", "  2. pnpm mainnet:verify");
    diagnostics.info("3-pnpm-mainnet-micro-dry-run", "  3. pnpm mainnet:micro            # dry-run");
    diagnostics.info("4-mainnet-confirm-sub-rosa-mainnet-pnpm-mainnet-micro-e", "  4. MAINNET_CONFIRM=SUB_ROSA_MAINNET … pnpm mainnet:micro -- --execute");
    diagnostics.info("5-mainnet-confirm-sub-rosa-mainnet-pnpm-mainnet-settle", "  5. MAINNET_CONFIRM=SUB_ROSA_MAINNET … pnpm mainnet:settle");
    return 0;
  },
});
