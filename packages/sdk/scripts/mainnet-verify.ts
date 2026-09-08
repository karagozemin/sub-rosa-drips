import { createLogger } from '@sub-rosa/logging';
import { runCommand } from "@sub-rosa/command";
import { SubRosaClient } from "../src/client.js";
import { MAINNET_ARTIFACTS } from "../src/mainnet-artifacts.js";
import { verifySettledRoundProof } from "../src/mainnet-readiness.js";

const diagnostics = createLogger("packages.sdk.scripts.mainnet-verify");

runCommand({
  name: "sdk.mainnet-verify",
  description: "Read-only mainnet proof checker",
  options: {
    "dry-run": { type: "boolean" },
  },
  async run(ctx) {
    const dryRun = Boolean(ctx.options["dry-run"]) || ctx.env.MAINNET_DRY_RUN === "1";

    diagnostics.info("sub-rosa-mainnet-settlement-proof-read-only", "Sub Rosa — mainnet settlement proof (read-only)\n");
    diagnostics.info("checklist", "Checklist:");
    diagnostics.info("contract-id-matches-frozen-artifact", "  [ ] Contract id matches frozen artifact");
    diagnostics.info("round-1-status-is-settled", "  [ ] Round 1 status is Settled");
    diagnostics.info("drand-reveal-round-r-matches-artifact", "  [ ] Drand reveal round R matches artifact");
    diagnostics.info("bid-escrow-stroops-match-micro-smoke-amounts-1-5-xlm", "  [ ] Bid/escrow stroops match micro smoke amounts (1 / 5 XLM)");
    diagnostics.info("bidder-marked-valid-settled", "  [ ] Bidder marked valid + settled\n");

    if (dryRun) {
      diagnostics.info("dry-run-would-read-rpc-only-re-run-without-dry-run-to-f", "DRY-RUN — would read RPC only. Re-run without --dry-run to fetch live state.\n");
      diagnostics.info("expected", "Expected:");
      diagnostics.info("progress", JSON.stringify(
        {
          contractId: MAINNET_ARTIFACTS.contractId,
          roundId: MAINNET_ARTIFACTS.settledRoundId,
          status: MAINNET_ARTIFACTS.status,
          revealRound: MAINNET_ARTIFACTS.revealRound,
          bidStroops: MAINNET_ARTIFACTS.bidStroops.toString(),
          escrowStroops: MAINNET_ARTIFACTS.escrowStroops.toString(),
        },
        null,
        2,
      ));
      return 0;
    }

    const reader = new SubRosaClient({
      rpcUrl: ctx.env.RPC_URL ?? MAINNET_ARTIFACTS.rpcUrl,
      networkPassphrase: ctx.env.NETWORK_PASSPHRASE ?? MAINNET_ARTIFACTS.networkPassphrase,
      contractId: ctx.env.ROUND_CONTRACT_ID ?? MAINNET_ARTIFACTS.contractId,
      publicKey: ctx.env.MAINNET_READER_PUBKEY ?? "GCDARJFKKSTJYAZC647H4ZSSSPXPPSKOWOHGMUNCT22VG74KXZ5BHVNR",
    });

    const roundId = BigInt(ctx.env.ROUND_ID ?? String(MAINNET_ARTIFACTS.settledRoundId));
    await verifySettledRoundProof(reader, roundId, {
      bidStroops: MAINNET_ARTIFACTS.bidStroops,
      escrowStroops: MAINNET_ARTIFACTS.escrowStroops,
      revealRound: MAINNET_ARTIFACTS.revealRound,
    });

    diagnostics.info("mainnet-verify-passed", "✅ MAINNET VERIFY PASSED");
    diagnostics.info("contract", "   contract:", { "value1_0": ctx.env.ROUND_CONTRACT_ID ?? MAINNET_ARTIFACTS.contractId });
    diagnostics.info("round", "   round:   ", { "value1_0": roundId.toString(), "value2_1": "status:", "status_2": MAINNET_ARTIFACTS.status });
    diagnostics.info("r", "   R:       ", { "value1_0": MAINNET_ARTIFACTS.revealRound.toString() });
    diagnostics.info("bid", "   bid:     ", { "bidXlm_0": MAINNET_ARTIFACTS.bidXlm, "value2_1": "XLM" });
    diagnostics.info("escrow", "   escrow:  ", { "escrowXlm_0": MAINNET_ARTIFACTS.escrowXlm, "value2_1": "XLM" });
    return 0;
  },
});
