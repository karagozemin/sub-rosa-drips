import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.keeper.scripts.keeper-e2e");
// Live keeper end-to-end proof.
//
// Deploys a fresh Round with reveal round R a couple of minutes out, commits a
// real sealed bid, then runs the permissionless keeper from a THIRD account
// (not operator, not bidder) to prove:
//   • it waits for R, opens the reveal with R's real Drand signature (on-chain
//     BLS verified), decrypts the seal and reveals the bid, and
//   • a second pass is idempotent — it skips the already-revealed bid.
//
// Real network, real Drand beacon, real on-chain verification. No mock.

import { createHash } from "node:crypto";

import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { RoundContract, SubRosaClient } from "@sub-rosa/sdk";
import {
  generateAuditorKeypair,
  generateNonce,
  quicknet,
  sealBid,
} from "@sub-rosa/tlock";
import { systemTime } from "@sub-rosa/time";

import { keepRound } from "../src/keeper.js";

const { clock, scheduler } = systemTime;

const DRAND_GENESIS = 1_692_803_367;
const DRAND_PERIOD = 3;
const DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";
const DRAND_PUBKEY_C1C0 =
  "03cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a01a714f2edb74119a2f2b0d5a7c75ba902d163700a61bc224ededd8e63aef7be1aaf8e93d7a9718b047ccddb3eb5d68b0e5db2b6bfbb01c867749cadffca88b36c24f3012ba09fc4d3022c5c37dce0f977d3adb5d183c7477c442b1f04515273";
const DRAND_NEGGEN_C1C0 =
  "13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb813fa4d4a0ad8b1ce186ed5061789213d993923066dddaf1040bc3ff59f825c78df74f2d75467e25e0f55f8a00fa030ed0d1b3cc2c7027888be51d9ef691d77bcb679afda66c73f17f9ee3837a55024f78c71363275a75d75d86bab79f74782aa";

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK =
  process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}
const hex = (s: string) => Buffer.from(s, "hex");
const sha256 = (s: string) => createHash("sha256").update(s).digest();
const fail = (m: string): never => {
  throw new Error(`keeper e2e assertion failed: ${m}`);
};

async function main() {
  const operatorSecret = reqEnv("OPERATOR_SECRET");
  const bidderSecret = reqEnv("BIDDER_SECRET");
  const keeperSecret = reqEnv("KEEPER_SECRET");
  const wasmHash = reqEnv("WASM_HASH");
  const usdc = reqEnv("USDC_SAC");

  const operatorKp = Keypair.fromSecret(operatorSecret);
  const bidderKp = Keypair.fromSecret(bidderSecret);
  const keeperKp = Keypair.fromSecret(keeperSecret);
  diagnostics.info("operator", "· operator:", { "value1_0": operatorKp.publicKey() });
  diagnostics.info("bidder", "· bidder:  ", { "value1_0": bidderKp.publicKey() });
  diagnostics.info("keeper", "· keeper:  ", { "value1_0": keeperKp.publicKey(), "value2_1": "(permissionless 3rd party)" });

  // 1. Deploy a fresh Round.
  diagnostics.info("1-6-deploying-round", "\n[1/6] deploying Round…");
  const signer = basicNodeSigner(operatorKp, NETWORK);
  const deployTx = await RoundContract.deploy(
    {
      drand_pubkey: hex(DRAND_PUBKEY_C1C0),
      g2_neg_generator: hex(DRAND_NEGGEN_C1C0),
      dst: Buffer.from(DST, "utf8"),
      drand_genesis: BigInt(DRAND_GENESIS),
      drand_period: BigInt(DRAND_PERIOD),
      usdc,
    },
    {
      wasmHash,
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK,
      publicKey: operatorKp.publicKey(),
      signTransaction: signer.signTransaction,
    },
  );
  const contractId = (await deployTx.signAndSend()).result.options.contractId;
  diagnostics.info("progress", "    ✔", { "contractId_0": contractId });

  // 2. createRound with R ~150s out.
  const operator = new SubRosaClient({ rpcUrl: RPC_URL, networkPassphrase: NETWORK, contractId, secretKey: operatorSecret });
  const now = clock.nowSeconds();
  const commitDeadline = now + 90;
  const revealRound = Math.ceil((now + 150 - DRAND_GENESIS) / DRAND_PERIOD);
  const tReveal = DRAND_GENESIS + DRAND_PERIOD * revealRound;
  const revealDeadline = tReveal + 600;
  const auditor = generateAuditorKeypair();

  diagnostics.info("2-6-createround-r", `\n[2/6] createRound (R=${revealRound}, time(R)≈${tReveal - now}s out)…`);
  const roundId = await operator.createRound({
    itemRef: sha256("sub-rosa://keeper-e2e/item"),
    revealRound,
    commitDeadline,
    revealDeadline,
    auditorPubkey: auditor.publicKey,
    clearingRule: "HighestBid",
  });
  diagnostics.info("round", "    ✔ round", { "value1_0": roundId.toString() });

  // 3. Seal a bid to R and commit.
  diagnostics.info("3-6-sealing-committing-a-bid", "\n[3/6] sealing + committing a bid…");
  const drand = quicknet();
  const value = 10_000_000n;
  const escrow = 50_000_000n;
  const nonce = generateNonce();
  const sealed = await sealBid({
    value,
    nonce,
    round: revealRound,
    client: drand,
    identity: new TextEncoder().encode("bidder:keeper-e2e"),
    auditorPublicKey: auditor.publicKey,
  });
  const bidder = new SubRosaClient({ rpcUrl: RPC_URL, networkPassphrase: NETWORK, contractId, secretKey: bidderSecret });
  await bidder.commit({ roundId, sealed, escrow });
  diagnostics.info("committed-escrow", "    ✔ committed (escrow", { "value1_0": escrow.toString(), "value2_1": "stroops)" });

  // 4. Run the keeper (3rd-party account). It waits for R, opens, reveals.
  diagnostics.info("4-6-running-keeper-waits-for-r-opens-with-real-signatur", "\n[4/6] running keeper (waits for R, opens with real signature, reveals)…");
  const keeperSdk = new SubRosaClient({ rpcUrl: RPC_URL, networkPassphrase: NETWORK, contractId, secretKey: keeperSecret });
  const log = (m: string) => diagnostics.info("progress-2", "    ·", { "m_0": m });

  let res = await keepRound({ sdk: keeperSdk, drand, log, maxWaitSeconds: 240, pollMs: 5000 }, roundId);
  // Tolerate API replica lag at the R boundary with a couple of re-passes.
  for (let i = 0; i < 3 && res.finalStatus === "Open"; i++) {
    await scheduler.sleep(5000);
    res = await keepRound({ sdk: keeperSdk, drand, log, maxWaitSeconds: 60, pollMs: 5000 }, roundId);
  }
  diagnostics.info("keeper-pass-1", "    keeper pass #1:", { "value1_0": JSON.stringify(res, bigintReplacer) });

  if (!res.openedReveal && res.finalStatus !== "Revealing") fail(`reveal not opened (status ${res.finalStatus})`);
  if (!res.revealed.includes(bidderKp.publicKey())) fail("bidder was not revealed");

  // 5. Verify on-chain that the bid is revealed and valid.
  diagnostics.info("5-6-verifying-on-chain-reveal", "\n[5/6] verifying on-chain reveal…");
  const reader = new SubRosaClient({ rpcUrl: RPC_URL, networkPassphrase: NETWORK, contractId, publicKey: keeperKp.publicKey() });
  const st = await reader.getBidState(roundId, bidderKp.publicKey());
  if (st.revealed_value !== value) fail(`revealed_value ${st.revealed_value} != ${value}`);
  if (st.valid !== true) fail("revealed bid not marked valid");
  diagnostics.info("revealed-value", "    ✔ revealed_value =", { "value1_0": st.revealed_value?.toString(), "value2_1": "valid =", "valid_2": st.valid });

  // 6. Idempotency: a second keeper pass must skip, not fail or double-act.
  diagnostics.info("6-6-second-keeper-pass-idempotency", "\n[6/6] second keeper pass (idempotency)…");
  const res2 = await keepRound({ sdk: keeperSdk, drand, log, maxWaitSeconds: 0 }, roundId);
  diagnostics.info("keeper-pass-2", "    keeper pass #2:", { "value1_0": JSON.stringify(res2, bigintReplacer) });
  if (res2.openedReveal) fail("second pass re-opened reveal");
  if (res2.revealed.length !== 0) fail("second pass re-revealed");
  if (!res2.skipped.some((s) => s.bidder === bidderKp.publicKey() && s.reason.includes("already revealed"))) {
    fail("second pass did not skip the already-revealed bid");
  }
  diagnostics.info("idempotent-nothing-re-done-bid-skipped-as-already-revea", "    ✔ idempotent: nothing re-done, bid skipped as already revealed");

  diagnostics.info("keeper-e2e-passed-waited-for-r-opened-with-real-drand-s", "\n✅ KEEPER E2E PASSED — waited for R, opened with real Drand sig, revealed, idempotent.");
  diagnostics.info("contract", "   contract:", { "contractId_0": contractId, "value2_1": "round:", "value3_2": roundId.toString() });
}

function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

main().catch((err) => {
  diagnostics.error("keeper-e2e-failed", "\n❌ KEEPER E2E FAILED");
  diagnostics.error("progress-3", err);
  process.exit(1);
});
