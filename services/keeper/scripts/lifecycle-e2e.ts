import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.keeper.scripts.lifecycle-e2e");
// Full live testnet lifecycle proof.
//
//   commit×2 → wait R → openReveal → reveal all → clear → settle/refund → 0
//
// Two bidders commit sealed bids in a real testnet round denominated in a
// (custom-issued) USDC Stellar Asset Contract. A permissionless 3rd-party keeper
// waits for Drand round R, opens the reveal with R's real signature (on-chain
// BLS verified), reveals both bids, clears the winner deterministically after
// the reveal deadline, and settles — paying the winner's bid to the operator and
// refunding the loser and the winner's surplus via real SAC transfers. We assert
// every balance and that the contract holds exactly zero at the end, then prove
// a second pass is idempotent (already cleared / already settled are skipped).

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  Account,
  Address,
  Contract,
  Keypair,
  TransactionBuilder,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { RoundContract, SubRosaClient } from "@sub-rosa/sdk";
import {
  generateAuditorKeypair,
  generateNonce,
  quicknet,
  sealBid,
} from "@sub-rosa/tlock";
import { systemTime } from "@sub-rosa/time";

import { closeRound, keepRound } from "../src/keeper.js";

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

const hex = (s: string) => Buffer.from(s, "hex");
const sha256 = (s: string) => createHash("sha256").update(s).digest();
const sleep = (ms: number) => scheduler.sleep(ms);
const reqEnv = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`missing required env var ${n}`);
  return v;
};
const fail = (m: string): never => {
  throw new Error(`lifecycle assertion failed: ${m}`);
};
const usdc = (stroops: bigint) => (Number(stroops) / 1e7).toFixed(2);
const bytesHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const repoPath = (path: string) =>
  path.startsWith("/") ? path : resolve(process.cwd(), "../..", path);

async function writeAuditorTrace(path: string, trace: unknown) {
  const out = repoPath(path);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(trace, null, 2)}\n`);
  diagnostics.info("auditor-trace", "    ✔ auditor trace:", { "out_0": out });
}

async function main() {
  const operatorSecret = reqEnv("OPERATOR_SECRET");
  const bidder1Secret = reqEnv("BIDDER1_SECRET");
  const bidder2Secret = reqEnv("BIDDER2_SECRET");
  const keeperSecret = reqEnv("KEEPER_SECRET");
  const wasmHash = reqEnv("WASM_HASH");
  const usdcSac = reqEnv("USDC_SAC");

  const operatorKp = Keypair.fromSecret(operatorSecret);
  const bidder1Kp = Keypair.fromSecret(bidder1Secret);
  const bidder2Kp = Keypair.fromSecret(bidder2Secret);
  const op = operatorKp.publicKey();
  const b1 = bidder1Kp.publicKey();
  const b2 = bidder2Kp.publicKey();
  diagnostics.info("operator", "· operator:", { "op_0": op });
  diagnostics.info("bidder1", "· bidder1: ", { "b1_0": b1 });
  diagnostics.info("bidder2", "· bidder2: ", { "b2_0": b2 });
  diagnostics.info("token", "· token:   ", { "usdcSac_0": usdcSac, "value2_1": "(USDC SAC)" });

  // USDC balance reader — a read-only simulation of the SAC's `balance(id)`.
  const server = new rpc.Server(RPC_URL);
  const sac = new Contract(usdcSac);
  const balanceOf = async (addr: string): Promise<bigint> => {
    const source = new Account(op, "0");
    const tx = new TransactionBuilder(source, { fee: "100", networkPassphrase: NETWORK })
      .addOperation(sac.call("balance", new Address(addr).toScVal()))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`balance sim failed: ${sim.error}`);
    if (!sim.result) return 0n;
    return scValToNative(sim.result.retval) as bigint;
  };

  // ── 1. Deploy a fresh Round denominated in USDC ────────────────────────
  diagnostics.info("1-8-deploying-round-usdc-denominated", "\n[1/8] deploying Round (USDC-denominated)…");
  const signer = basicNodeSigner(operatorKp, NETWORK);
  const deployTx = await RoundContract.deploy(
    {
      drand_pubkey: hex(DRAND_PUBKEY_C1C0),
      g2_neg_generator: hex(DRAND_NEGGEN_C1C0),
      dst: Buffer.from(DST, "utf8"),
      drand_genesis: BigInt(DRAND_GENESIS),
      drand_period: BigInt(DRAND_PERIOD),
      usdc: usdcSac,
    },
    {
      wasmHash,
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK,
      publicKey: op,
      signTransaction: signer.signTransaction,
    },
  );
  const contractId = (await deployTx.signAndSend()).result.options.contractId;
  diagnostics.info("progress", "    ✔", { "contractId_0": contractId });

  // ── 2. createRound (HighestBid) with a short, near-future R ────────────
  const operator = new SubRosaClient({ rpcUrl: RPC_URL, networkPassphrase: NETWORK, contractId, secretKey: operatorSecret });
  const now = clock.nowSeconds();
  const commitDeadline = now + 75;
  const revealRound = Math.ceil((now + 135 - DRAND_GENESIS) / DRAND_PERIOD);
  const tReveal = DRAND_GENESIS + DRAND_PERIOD * revealRound;
  const revealDeadline = tReveal + 75;
  const auditor = generateAuditorKeypair();

  diagnostics.info("2-8-createround-r", `\n[2/8] createRound (R=${revealRound}, time(R)≈${tReveal - now}s, reveal window 75s)…`);
  const roundId = await operator.createRound({
    itemRef: sha256("sub-rosa://lifecycle/sealed-asset-auction"),
    revealRound,
    commitDeadline,
    revealDeadline,
    auditorPubkey: auditor.publicKey,
    clearingRule: "HighestBid",
  });
  diagnostics.info("round", "    ✔ round", { "value1_0": roundId.toString() });

  // ── 3. Two bidders seal + commit ───────────────────────────────────────
  const V1 = 300_000_000n; // 30 USDC bid
  const E1 = 500_000_000n; // 50 USDC escrow
  const V2 = 700_000_000n; // 70 USDC bid  → winner (HighestBid)
  const E2 = 800_000_000n; // 80 USDC escrow
  const drand = quicknet();

  const before = {
    op: await balanceOf(op),
    b1: await balanceOf(b1),
    b2: await balanceOf(b2),
    contract: await balanceOf(contractId),
  };
  diagnostics.info("3-8-initial-usdc", "\n[3/8] initial USDC:", { "value1_0": {
    operator: usdc(before.op), bidder1: usdc(before.b1), bidder2: usdc(before.b2), contract: usdc(before.contract),
  } });

  async function commitBid(secret: string, value: bigint, escrow: bigint, who: string) {
    const nonce = generateNonce();
    const sealed = await sealBid({
      value, nonce, round: revealRound, client: drand,
      identity: new TextEncoder().encode(`bidder:${who}`),
      auditorPublicKey: auditor.publicKey,
    });
    const client = new SubRosaClient({ rpcUrl: RPC_URL, networkPassphrase: NETWORK, contractId, secretKey: secret });
    await client.commit({ roundId, sealed, escrow });
    diagnostics.info("progress-2", `    ✔ ${who} committed bid ${usdc(value)} / escrow ${usdc(escrow)} USDC`);
    return { label: who, blobHex: bytesHex(sealed.auditorBlob) };
  }
  diagnostics.info("3-8-sealing-committing-two-bids", "\n[3/8] sealing + committing two bids…");
  const auditorRows = [
    await commitBid(bidder1Secret, V1, E1, "bidder1"),
    await commitBid(bidder2Secret, V2, E2, "bidder2"),
  ];
  await writeAuditorTrace("artifacts/lifecycle-auditor-trace.json", {
    source: "lifecycle:e2e",
    generatedAt: clock.toISOString(),
    network: "Stellar Testnet",
    contractId,
    roundId: Number(roundId),
    revealRound,
    secretHex: bytesHex(auditor.secretKey),
    publicHex: bytesHex(auditor.publicKey),
    blobs: Object.fromEntries(auditorRows.map((row) => [row.label, row.blobHex])),
  });

  const lockedContract = await balanceOf(contractId);
  if (lockedContract - before.contract !== E1 + E2) {
    fail(`escrow locked ${lockedContract - before.contract} != ${E1 + E2}`);
  }
  diagnostics.info("contract-locked", `    ✔ contract locked ${usdc(E1 + E2)} USDC in escrow`);

  // ── 4. Keeper: wait R, open reveal, reveal all ─────────────────────────
  diagnostics.info("4-8-keeper-waits-for-r-opens-reveal-reveals-all", "\n[4/8] keeper waits for R, opens reveal, reveals all…");
  const keeperSdk = new SubRosaClient({ rpcUrl: RPC_URL, networkPassphrase: NETWORK, contractId, secretKey: keeperSecret });
  const log = (m: string) => diagnostics.info("progress-3", "    ·", { "m_0": m });
  let rev = await keepRound({ sdk: keeperSdk, drand, log, maxWaitSeconds: 240, pollMs: 5000 }, roundId);
  for (let i = 0; i < 3 && rev.finalStatus === "Open"; i++) {
    await sleep(5000);
    rev = await keepRound({ sdk: keeperSdk, drand, log, maxWaitSeconds: 60, pollMs: 5000 }, roundId);
  }
  if (![b1, b2].every((b) => rev.revealed.includes(b))) {
    fail(`not all bids revealed: ${JSON.stringify(rev)}`);
  }
  diagnostics.info("both-bids-revealed", "    ✔ both bids revealed");

  // ── 5. Wait out the reveal deadline ────────────────────────────────────
  diagnostics.info("5-8-waiting-for-the-reveal-deadline-to-pass", "\n[5/8] waiting for the reveal deadline to pass…");
  while (clock.nowSeconds() <= revealDeadline + 3) {
    const remain = revealDeadline + 4 - clock.nowSeconds();
    if (remain > 0) { log(`~${remain}s until reveal deadline`); await sleep(Math.min(5000, remain * 1000)); }
  }

  // ── 6. Keeper: clear + settle ──────────────────────────────────────────
  diagnostics.info("6-8-keeper-clears-settles", "\n[6/8] keeper clears + settles…");
  const close = await closeRound({ sdk: keeperSdk, drand, log }, roundId);
  diagnostics.info("close", "    close:", { "value1_0": JSON.stringify(close, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) });
  if (!close.cleared) fail("round was not cleared");
  if (!close.settled) fail("round was not settled");
  if (close.winner !== b2) fail(`winner ${close.winner} != bidder2 ${b2}`);
  diagnostics.info("deterministic-winner-bidder2-highest-bid-70-usdc", "    ✔ deterministic winner = bidder2 (highest bid 70 USDC)");

  // ── 7. Balance checks — real SAC transfers, contract drains to zero ────
  diagnostics.info("7-8-verifying-balances", "\n[7/8] verifying balances…");
  const after = {
    op: await balanceOf(op),
    b1: await balanceOf(b1),
    b2: await balanceOf(b2),
    contract: await balanceOf(contractId),
  };
  diagnostics.info("final-usdc", "    final USDC:", { "value1_0": {
    operator: usdc(after.op), bidder1: usdc(after.b1), bidder2: usdc(after.b2), contract: usdc(after.contract),
  } });
  if (after.op - before.op !== V2) fail(`operator delta ${after.op - before.op} != winning bid ${V2}`);
  if (after.b1 !== before.b1) fail(`bidder1 not made whole: ${before.b1} → ${after.b1}`);
  if (before.b2 - after.b2 !== V2) fail(`bidder2 net ${before.b2 - after.b2} != bid ${V2} (surplus not refunded)`);
  if (after.contract !== 0n) fail(`contract balance ${after.contract} != 0`);
  diagnostics.info("operator-70-bidder1-whole-bidder2-net-70-surplus-refund", "    ✔ operator +70, bidder1 whole, bidder2 net -70 (surplus refunded), contract = 0");

  // ── 8. Idempotency — second close must skip, not error ─────────────────
  diagnostics.info("8-8-second-close-pass-idempotency", "\n[8/8] second close pass (idempotency)…");
  const close2 = await closeRound({ sdk: keeperSdk, drand, log }, roundId);
  diagnostics.info("close-2", "    close#2:", { "value1_0": JSON.stringify(close2, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) });
  if (close2.cleared || close2.settled) fail("second pass re-cleared/re-settled");
  if (close2.finalStatus !== "Settled") fail(`unexpected final status ${close2.finalStatus}`);
  diagnostics.info("idempotent-already-settled-round-skipped-cleanly", "    ✔ idempotent: already-settled round skipped cleanly");

  diagnostics.info("full-lifecycle-passed-commit-2-r-open-reveal-clear-sett", "\n✅ FULL LIFECYCLE PASSED — commit×2 → R → open → reveal → clear → settle → 0.");
  diagnostics.info("contract", "   contract:", { "contractId_0": contractId, "value2_1": "round:", "value3_2": roundId.toString(), "value4_3": "winner:", "winner_4": close.winner });
}

main().catch((err) => {
  diagnostics.error("full-lifecycle-failed", "\n❌ FULL LIFECYCLE FAILED");
  diagnostics.error("progress-4", err);
  process.exit(1);
});
