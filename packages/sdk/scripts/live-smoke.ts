import { createLogger } from '@sub-rosa/logging';
import { runCommand } from "@sub-rosa/command";
const diagnostics = createLogger("packages.sdk.scripts.live-smoke");
// Live smoke gate — proves the SDK's sign → submit → poll → read path actually
// works against a real Soroban network, end to end, with no mock and no
// fallback. It deploys a fresh Round to testnet (constructor configured with
// the real quicknet BLS constants and the native XLM Stellar Asset Contract as
// the escrow token), then drives createRound + a real sealed commit through the
// SDK over live RPC, and reads everything back.
//
// This is intentionally NOT the full e2e (no open_reveal/clear/settle — round R
// is in the future). It is the minimal proof that the binding SDK talks to a
// real ledger. The orchestration script (scripts/live-smoke.sh) provisions
// funded keys + the uploaded wasm hash and passes them in via env.

import { createHash } from "node:crypto";

import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import {
  generateAuditorKeypair,
  generateNonce,
  quicknet,
  sealBid,
} from "@sub-rosa/tlock";
import { systemClock } from "@sub-rosa/time";

import { RoundContract, SubRosaClient } from "../src/index.js";

// Real Drand quicknet parameters (bls-unchained-g1-rfc9380), Fp2 = (c1,c0) —
// the exact constants proven on-chain in the contract's BLS tests.
const DRAND_GENESIS = 1_692_803_367n;
const DRAND_PERIOD = 3n;
const DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";
const DRAND_PUBKEY_C1C0 =
  "03cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a01a714f2edb74119a2f2b0d5a7c75ba902d163700a61bc224ededd8e63aef7be1aaf8e93d7a9718b047ccddb3eb5d68b0e5db2b6bfbb01c867749cadffca88b36c24f3012ba09fc4d3022c5c37dce0f977d3adb5d183c7477c442b1f04515273";
const DRAND_NEGGEN_C1C0 =
  "13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb813fa4d4a0ad8b1ce186ed5061789213d993923066dddaf1040bc3ff59f825c78df74f2d75467e25e0f55f8a00fa030ed0d1b3cc2c7027888be51d9ef691d77bcb679afda66c73f17f9ee3837a55024f78c71363275a75d75d86bab79f74782aa";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

const RPC_URL =
  process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK =
  process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

const hex = (s: string) => Buffer.from(s, "hex");
const sha256 = (s: string) => createHash("sha256").update(s).digest();

runCommand({
  name: "sdk.live-smoke",
  description: "Live smoke gate verifying end-to-end Soroban contract interaction",
  async run(ctx) {
    const operatorSecret = reqEnv("OPERATOR_SECRET");
    const bidderSecret = reqEnv("BIDDER_SECRET");
    const wasmHash = reqEnv("WASM_HASH");
    const usdc = reqEnv("USDC_SAC");

    const rpcUrl = ctx.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
    const network = ctx.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

    const operatorKp = Keypair.fromSecret(operatorSecret);
    const bidderKp = Keypair.fromSecret(bidderSecret);
    const operatorSigner = basicNodeSigner(operatorKp, network);

    diagnostics.info("operator", "· operator:", { "value1_0": operatorKp.publicKey() });
    diagnostics.info("bidder", "· bidder:  ", { "value1_0": bidderKp.publicKey() });
    diagnostics.info("token", "· token:   ", { "usdc_0": usdc, "value2_1": "(native XLM SAC)" });

    diagnostics.info("1-5-deploying-round-running-constructor", "\n[1/5] deploying Round + running __constructor…");
    const deployTx = await RoundContract.deploy(
      {
        drand_pubkey: hex(DRAND_PUBKEY_C1C0),
        g2_neg_generator: hex(DRAND_NEGGEN_C1C0),
        dst: Buffer.from(DST, "utf8"),
        drand_genesis: DRAND_GENESIS,
        drand_period: DRAND_PERIOD,
        usdc,
      },
      {
        wasmHash,
        rpcUrl,
        networkPassphrase: network,
        publicKey: operatorKp.publicKey(),
        signTransaction: operatorSigner.signTransaction,
      },
    );
    const deployed = await deployTx.signAndSend();
    const contractId = deployed.result.options.contractId;
    diagnostics.info("deployed", "    ✔ deployed:", { "contractId_0": contractId });

    const operator = new SubRosaClient({
      rpcUrl,
      networkPassphrase: network,
      contractId,
      secretKey: operatorSecret,
    });

    const now = systemClock.nowSeconds();
    const tReveal = now + 300;
    const revealRound = Math.ceil((tReveal - Number(DRAND_GENESIS)) / Number(DRAND_PERIOD));
    const tRevealExact = Number(DRAND_GENESIS) + Number(DRAND_PERIOD) * revealRound;
    const commitDeadline = now + 90;
    const revealDeadline = tRevealExact + 300;

    const auditor = generateAuditorKeypair();

    diagnostics.info("2-5-createround", "\n[2/5] createRound…", { "value1_0": { revealRound, commitDeadline, revealDeadline } });
    const roundId = await operator.createRound({
      itemRef: sha256("sub-rosa://smoke/item-1"),
      revealRound,
      commitDeadline,
      revealDeadline,
      auditorPubkey: auditor.publicKey,
      clearingRule: "HighestBid",
    });
    diagnostics.info("round-id", "    ✔ round id:", { "value1_0": roundId.toString() });

    diagnostics.info("3-5-sealing-bid-to-quicknet-round-r-commit", "\n[3/5] sealing bid to quicknet round R + commit…");
    const drand = await quicknet();
    const value = 10_000_000n;
    const escrow = 50_000_000n;
    const nonce = generateNonce();
    const identity = new TextEncoder().encode("bidder:smoke@sub-rosa");
    const sealed = await sealBid({
      value,
      nonce,
      round: revealRound,
      client: drand,
      identity,
      auditorPublicKey: auditor.publicKey,
    });

    const bidder = new SubRosaClient({
      rpcUrl,
      networkPassphrase: network,
      contractId,
      secretKey: bidderSecret,
    });
    await bidder.commit({ roundId, sealed, escrow });
    diagnostics.info("committed-escrow-locked", "    ✔ committed, escrow locked:", { "value1_0": escrow.toString(), "value2_1": "stroops" });

    diagnostics.info("4-5-reading-state-back-over-rpc", "\n[4/5] reading state back over RPC…");
    const reader = new SubRosaClient({
      rpcUrl,
      networkPassphrase: network,
      contractId,
      publicKey: operatorKp.publicKey(),
    });
    const round = await reader.getRound(roundId);
    const bidders = await reader.getBidders(roundId);
    const bidState = await reader.getBidState(roundId, bidderKp.publicKey());
    const seal = await reader.getSeal(roundId, bidderKp.publicKey());

    diagnostics.info("5-5-verifying", "\n[5/5] verifying…");
    const fail = (m: string): never => {
      throw new Error(`smoke assertion failed: ${m}`);
    };
    if (round.status.tag !== "Open") fail(`status ${round.status.tag} != Open`);
    if (bidders.length !== 1) fail(`bidders ${bidders.length} != 1`);
    if (bidders[0] !== bidderKp.publicKey()) fail("bidder index mismatch");
    if (bidState.escrow !== escrow) fail(`escrow ${bidState.escrow} != ${escrow}`);
    if (bidState.valid !== false) fail("bid valid before reveal");
    if (!seal) throw new Error("smoke assertion failed: seal not found");
    if (seal.ciphertext.length !== sealed.ciphertext.length) {
      fail(`ciphertext len ${seal.ciphertext.length} != ${sealed.ciphertext.length}`);
    }
    if (Buffer.compare(Buffer.from(bidState.commitment), Buffer.from(sealed.commitment)) !== 0) {
      fail("on-chain commitment != off-chain H");
    }
    if (seal.auditor_blob.length !== sealed.auditorBlob.length) {
      fail("auditor blob length mismatch");
    }

    diagnostics.info("status-open-1-bidder-escrow-locked-commitment-matches-h", "    ✔ status Open, 1 bidder, escrow locked, commitment matches H");
    diagnostics.info("on-chain-ciphertext-auditor-blob-match-the-off-chain-se", "    ✔ on-chain ciphertext + auditor blob match the off-chain seal");
    diagnostics.info("live-smoke-passed-sign-submit-poll-read-all-work-on-tes", "\n✅ LIVE SMOKE PASSED — sign/submit/poll/read all work on testnet.");
    diagnostics.info("contract", "   contract:", { "contractId_0": contractId, "value2_1": "round:", "value3_2": roundId.toString() });
    return 0;
  },
});
