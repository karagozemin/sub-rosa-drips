import { createLogger } from '@sub-rosa/logging';
import { runCommand } from "@sub-rosa/command";
import { Keypair } from "@stellar/stellar-sdk";
import {
  assertMainnetConfirmed,
  assertReadinessForExecute,
  createSacBalanceReader,
  defaultMainnetReadinessInput,
  nativeXlmSacId,
  runMainnetReadiness,
  SubRosaClient,
} from "@sub-rosa/sdk";
import { quicknet } from "@sub-rosa/tlock";
import { systemTime } from "@sub-rosa/time";

import { closeRound, keepRound } from "../src/keeper.js";

const diagnostics = createLogger("services.keeper.scripts.mainnet-settle");
const { clock, scheduler } = systemTime;

function reqEnv(name: string, env: Record<string, string | undefined> = process.env): string {
  const v = env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

const sleep = (ms: number) => scheduler.sleep(ms);
const bigintReplacer = (_k: string, v: unknown) =>
  typeof v === "bigint" ? v.toString() : v;

runCommand({
  name: "services.keeper.mainnet-settle",
  description: "Mainnet settlement — keepRound (wait R → open → reveal) + closeRound (clear → settle)",
  options: {
    round: {
      type: "string",
      description: "Round ID (defaults to ROUND_ID env or 1)",
    },
  },
  async run(ctx) {
    assertMainnetConfirmed();

    const keeperSecret = reqEnv("KEEPER_SECRET", ctx.env);
    const contractId = reqEnv("ROUND_CONTRACT_ID", ctx.env);
    const roundId = BigInt((ctx.args.round as string | undefined) ?? ctx.env.ROUND_ID ?? "1");
    const rpcUrl = ctx.env.RPC_URL ?? "https://rpc.ankr.com/stellar_soroban";
    const network = ctx.env.NETWORK_PASSPHRASE ?? "Public Global Stellar Network ; September 2015";
    const keeperKp = Keypair.fromSecret(keeperSecret);

    const reader = new SubRosaClient({
      rpcUrl,
      networkPassphrase: network,
      contractId,
      publicKey: keeperKp.publicKey(),
    });

    const readiness = await runMainnetReadiness(
      defaultMainnetReadinessInput({
        rpcUrl,
        networkPassphrase: network,
        contractId,
        withBalances: false,
      }),
      { reader },
    );
    assertReadinessForExecute(readiness.checks);

    const sdk = new SubRosaClient({
      rpcUrl,
      networkPassphrase: network,
      contractId,
      secretKey: keeperSecret,
    });
    const drand = quicknet();
    const log = (m: string) => diagnostics.info("progress", "    ·", { "m_0": m });

    diagnostics.info("contract", "· contract:", { "contractId_0": contractId });
    diagnostics.info("round", "· round:   ", { "value1_0": roundId.toString() });
    diagnostics.info("keeper", "· keeper:  ", { "value1_0": keeperKp.publicKey() });

    let round = await reader.getRound(roundId);
    diagnostics.info("status", "\n[status] ", { "tag_0": round.status.tag, "value2_1": "R=", "value3_2": round.reveal_round.toString() });

    if (round.status.tag === "Open" || round.status.tag === "Revealing") {
      diagnostics.info("1-3-keeper-wait-r-open-reveal-reveal-all", "\n[1/3] keeper: wait R → open_reveal → reveal all…");
      let rev = await keepRound(
        { sdk, drand, log, maxWaitSeconds: 600, pollMs: 5000 },
        roundId,
      );
      for (let i = 0; i < 5 && rev.finalStatus === "Open"; i++) {
        await sleep(5000);
        rev = await keepRound(
          { sdk, drand, log, maxWaitSeconds: 120, pollMs: 5000 },
          roundId,
        );
      }
      diagnostics.info("keep", "    keep:", { "value1_0": JSON.stringify(rev, bigintReplacer) });
      if (rev.finalStatus === "Open") {
        throw new Error("reveal not opened — Drand R not yet available");
      }
      round = await reader.getRound(roundId);
    }

    round = await reader.getRound(roundId);
    const revealDeadline = Number(round.reveal_deadline);
    diagnostics.info("2-3-waiting-for-reveal-deadline", "\n[2/3] waiting for reveal deadline…", { "revealDeadline_0": revealDeadline });
    while (clock.nowSeconds() <= revealDeadline + 3) {
      const remain = revealDeadline + 4 - clock.nowSeconds();
      if (remain > 0) {
        log(`~${remain}s until clear allowed`);
        await sleep(Math.min(10_000, remain * 1000));
      }
    }

    diagnostics.info("3-3-clear-settle", "\n[3/3] clear + settle…");
    let close = await closeRound({ sdk, drand, log }, roundId);
    if (!close.settled && close.finalStatus !== "Settled") {
      await sleep(5000);
      close = await closeRound({ sdk, drand, log }, roundId);
    }
    diagnostics.info("close", "    close:", { "value1_0": JSON.stringify(close, bigintReplacer) });

    round = await reader.getRound(roundId);
    if (round.status.tag !== "Settled") {
      throw new Error(`expected Settled, got ${round.status.tag}`);
    }

    const bidders = await reader.getBidders(roundId);
    for (const b of bidders) {
      const st = await reader.getBidState(roundId, b);
      diagnostics.info("bid", `    bid ${b.slice(0, 8)}… value=${st.revealed_value?.toString()} valid=${st.valid} settled=${st.settled}`);
    }

    const tokenSacId = nativeXlmSacId(network);
    const balanceOf = createSacBalanceReader(
      rpcUrl,
      network,
      tokenSacId,
      keeperKp.publicKey(),
    );
    const contractBalance = await balanceOf(contractId);
    if (contractBalance !== 0n) {
      throw new Error(
        `contract escrow balance guardrail failed: expected 0, got ${contractBalance.toString()} stroops`,
      );
    }

    diagnostics.info("mainnet-settlement-complete", "\n✅ MAINNET SETTLEMENT COMPLETE");
    diagnostics.info("contract-2", "   contract:", { "contractId_0": contractId });
    diagnostics.info("round-2", "   round:", { "value1_0": roundId.toString() });
    diagnostics.info("winner", "   winner:", { "value1_0": close.winner ?? round.winner });
    diagnostics.info("final-status", "   final status:", { "tag_0": round.status.tag });
    return 0;
  },
});
