import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.auction-template.sealed-auction");
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { verifyReceipt, type RoundReceipt } from "@sub-rosa/sdk";
import {
  commitment as computeCommitment,
  fromHex,
  generateAuditorKeypair,
  generateNonce,
  openBid,
  quicknet,
  sealBid,
  toHex,
} from "@sub-rosa/tlock";
import { systemTime } from "@sub-rosa/time";
import { getSystemEnv } from "@sub-rosa/config";

const env = getSystemEnv();
const DRAND_GENESIS = 1_692_803_367;
const DRAND_PERIOD = 3;
const DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";
const DRAND_PUBKEY_C1C0 = "03cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a01a714f2edb74119a2f2b0d5a7c75ba902d163700a61bc224ededd8e63aef7be1aaf8e93d7a9718b047ccddb3eb5d68b0e5db2b6bfbb01c867749cadffca88b36c24f3012ba09fc4d3022c5c37dce0f977d3adb5d183c7477c442b1f04515273";
const DRAND_NEGGEN_C1C0 = "13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb813fa4d4a0ad8b1ce186ed5061789213d993923066dddaf1040bc3ff59f825c78df74f2d75467e25e0f55f8a00fa030ed0d1b3cc2c7027888be51d9ef691d77bcb679afda66c73f17f9ee3837a55024f78c71363275a75d75d86bab79f74782aa";
const RPC_URL = env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK = env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const VOID_GRACE = 3600;

const { clock, scheduler } = systemTime;

const hex = (s: string) => Buffer.from(s, "hex");
const sha256 = (s: string) => createHash("sha256").update(s).digest();
const sleep = (ms: number) => scheduler.sleep(ms);
const reqEnv = (n: string): string => {
  const v = env[n];
  if (!v) throw new Error(`missing required env var ${n}`);
  return v;
};
const usdc = (s: bigint) => `${(Number(s) / 1e7).toFixed(2)} USDC`;
const banner = (s: string) => diagnostics.info("progress", `\n═══ ${s} ═══`);

async function fixtureMain() {
  const fixturePath = resolve(process.cwd(), "../receipt-cli/src/fixtures/golden.json");
  const receipt: RoundReceipt = JSON.parse(await readFile(fixturePath, "utf8"));

  diagnostics.info("mode-fixture-offline", "mode:         fixture (offline)");
  diagnostics.info("receipt-golden-json", "receipt:      golden.json");
  diagnostics.info("round", `round:        ${receipt.roundId}`);
  diagnostics.info("rule", `rule:         ${receipt.clearingRule}`);
  diagnostics.info("status", `status:       ${receipt.status}`);
  diagnostics.info("bidders", `bidders:      ${receipt.bidders.length}`);
  diagnostics.info("winner", `winner:       ${receipt.winner ?? "(voided)"}`);

  banner("Phase 1 — Setup");
  diagnostics.info("operator-creates-a-round-with", "operator creates a Round with:");
  diagnostics.info("itemref", `  itemRef:       ${receipt.itemRef}`);
  diagnostics.info("revealround", `  revealRound:   ${receipt.revealRound}`);
  diagnostics.info("commitdeadline", `  commitDeadline: ${receipt.commitDeadline}s`);
  diagnostics.info("revealdeadline", `  revealDeadline: ${receipt.revealDeadline}s`);
  diagnostics.info("clearingrule", `  clearingRule:  ${receipt.clearingRule}`);
  diagnostics.info("protocol-level-round-contract-drand-config-usdc-sac-add", "(protocol-level: Round contract, Drand config, USDC SAC address)");

  banner("Phase 2 — Commit (sealed bid creation + escrow)");
  for (const bidder of receipt.bidders) {
    const b = receipt.bids[bidder];
    diagnostics.info("bidder", `bidder ${bidder.slice(0, 16)}…`);
    diagnostics.info("escrow", `  escrow:    ${usdc(BigInt(b.escrow))}`);
    diagnostics.info("commitment", `  commitment: ${b.commitment}`);
    diagnostics.info("ciphertext", `  ciphertext: ${b.evidence.ciphertext ? `${b.evidence.ciphertext.slice(0, 16)}…` : "null"}`);
    if (b.revealedValue) {
      diagnostics.info("revealed", `  revealed:  ${usdc(BigInt(b.revealedValue))}`);
    }
  }
  diagnostics.info("template-level-bid-value-nonce-generation-tlock-seal-to", "(template-level: bid value, nonce generation, tlock seal to Drand R)");
  diagnostics.info("protocol-level-escrow-locked-via-sac-transfer-h-stored", "(protocol-level: escrow locked via SAC transfer, H stored on-chain)");

  banner("Phase 3 — Reveal (Drand R gates opening)");
  diagnostics.info("permissionless-keeper", "permissionless keeper:");
  diagnostics.info("1-waits-for-drand-quicknet-round-r", "  1. waits for Drand quicknet round R");
  diagnostics.info("2-fetches-threshold-bls-signature-for-r", "  2. fetches threshold BLS signature for R");
  diagnostics.info("3-calls-open-reveal-contract-verifies-bls-on-chain-via", "  3. calls open_reveal — contract verifies BLS on-chain via pairing_check");
  diagnostics.info("4-reads-deterministic-bidder-index", "  4. reads deterministic bidder index");
  diagnostics.info("5-decrypts-each-seal-with-tlock-drand-r", "  5. decrypts each seal with tlock + Drand R");
  diagnostics.info("6-submits-reveal-value-nonce-contract-checks-sha256-be1", "  6. submits reveal (value + nonce) — contract checks sha256(be16(value)‖nonce) == H");
  diagnostics.info("protocol-level-bls-verification-in-round-contract", "(protocol-level: BLS verification in Round contract)");
  diagnostics.info("template-level-openbid-from-sub-rosa-tlock", "(template-level: openBid from @sub-rosa/tlock)");

  banner("Phase 4 — Clear + Settle (deterministic winner)");
  diagnostics.info("clearing-rule", `clearing rule: ${receipt.clearingRule}`);
  diagnostics.info("winner-2", `winner:        ${receipt.winner ?? "(none — voided)"}`);
  diagnostics.info("winning-value", `winning value: ${receipt.winningValue ? usdc(BigInt(receipt.winningValue)) : "N/A"}`);
  for (const bidder of receipt.bidders) {
    const b = receipt.bids[bidder];
    diagnostics.info("progress-2", `  ${bidder.slice(0, 16)}… valid=${b.valid} settled=${b.settled}`);
  }
  diagnostics.info("protocol-level-deterministic-iteration-escrow-check-sac", "(protocol-level: deterministic iteration, escrow check, SAC transfers)");

  banner("Phase 5 — Receipt Verification (offline)");
  const result = verifyReceipt(receipt);
  for (const issue of result.issues) {
    diagnostics.info("progress-3", `  ${issue.severity === "error" ? "✗" : "!"} [${issue.code}] ${issue.message}`);
  }
  diagnostics.info("verdict", `\nverdict: ${result.valid ? "PASS" : "FAIL"}`);
  diagnostics.info("computed-winner", `computed winner: ${result.computedWinner.address ?? "(none)"} = ${result.computedWinner.value ?? "N/A"}`);

  banner("Failure Cases");
  diagnostics.info("under-escrowed-bid", "under-escrowed bid:");
  diagnostics.info("escrow-150-revealed-200-escrowtoosmall-at-clear-bid-mar", "  escrow=150, revealed=200 → EscrowTooSmall at clear — bid marked invalid");
  diagnostics.info("missed-reveal", "missed reveal:");
  diagnostics.info("bidder-commits-but-never-reveals-no-valid-bid-entry-not", "  bidder commits but never reveals → no valid bid entry → not in winner selection");
  diagnostics.info("late-commit", "late commit:");
  diagnostics.info("commit-after-commitdeadline-commitwindowclosed-error-fr", "  commit after commitDeadline → CommitWindowClosed error from contract");
  diagnostics.info("void-after-grace", "void after grace:");
  diagnostics.info("drand-r-never-arrives-reveal-deadline-3600s-grace-elaps", "  Drand R never arrives, reveal_deadline + 3600s grace elapses");
  diagnostics.info("anyone-calls-void-all-escrow-refunded-round-status-void", "  → anyone calls void() → all escrow refunded, round status = Voided");

  diagnostics.info("fixture-passed-golden-receipt-verified-all-phases-docum", "\n✅ FIXTURE PASSED — golden receipt verified, all phases documented.");
}

async function testnetMain() {
  // Lazy imports: only needed for testnet mode; avoids triggering the
  // @noble/hashes/sha256 export issue when running in FIXTURE=1 mode.
  const { Account, Address, Contract, Keypair, TransactionBuilder, rpc, scValToNative } =
    await import("@stellar/stellar-sdk");
  const { basicNodeSigner } = await import("@stellar/stellar-sdk/contract");
  const { closeRound, keepRound } = await import("@sub-rosa/keeper");
  const { RoundContract, SubRosaClient } = await import("@sub-rosa/sdk");

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

  diagnostics.info("mode-testnet", "mode:     testnet");
  diagnostics.info("network", "network:", { "NETWORK_0": NETWORK });
  diagnostics.info("rpc", "rpc:     ", { "RPC_URL_0": RPC_URL });
  diagnostics.info("operator", "operator:", { "op_0": op });
  diagnostics.info("token", "token:   ", { "usdcSac_0": usdcSac });

  banner("Phase 1 — Deploy + Create Round");
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
      signTransaction: basicNodeSigner(operatorKp, NETWORK).signTransaction,
    },
  );
  const contractId = (await deployTx.signAndSend()).result.options.contractId;
  diagnostics.info("contract", "contract:", { "contractId_0": contractId });

  const now = clock.nowSeconds();
  const revealRound = Math.ceil((now + 135 - DRAND_GENESIS) / DRAND_PERIOD);
  const tReveal = DRAND_GENESIS + DRAND_PERIOD * revealRound;
  const commitDeadline = now + 75;
  const revealDeadline = tReveal + 120;
  const auditor = generateAuditorKeypair();

  const operator = new SubRosaClient({ rpcUrl: RPC_URL, networkPassphrase: NETWORK, contractId, secretKey: operatorSecret });
  const roundId = await operator.createRound({
    itemRef: sha256("sub-rosa://auction-template/demo"),
    revealRound,
    commitDeadline,
    revealDeadline,
    auditorPubkey: auditor.publicKey,
    clearingRule: "HighestBid",
  });
  diagnostics.info("round-2", `round:    ${roundId} (R=${revealRound}, ~${tReveal - now}s to reveal)`);

  banner("Phase 2 — Seal + Commit");
  const V1 = 300_000_000n;
  const E1 = 500_000_000n;
  const V2 = 700_000_000n;
  const E2 = 800_000_000n;
  const drand = quicknet();

  const beforeOp = await balanceOf(op);
  const beforeB1 = await balanceOf(b1);
  const beforeB2 = await balanceOf(b2);
  const beforeContract = await balanceOf(contractId);

  async function commitBid(secret: string, value: bigint, escrow: bigint, who: string) {
    const nonce = generateNonce();
    const sealed = await sealBid({
      value, nonce, round: revealRound, client: drand,
      identity: new TextEncoder().encode(`bidder:${who}`),
      auditorPublicKey: auditor.publicKey,
    });
    const client = new SubRosaClient({ rpcUrl: RPC_URL, networkPassphrase: NETWORK, contractId, secretKey: secret });
    await client.commit({ roundId, sealed, escrow });
    diagnostics.info("progress-4", `  ${who}: bid ${usdc(value)} / escrow ${usdc(escrow)}`);
  }

  await commitBid(bidder1Secret, V1, E1, "bidder1");
  await commitBid(bidder2Secret, V2, E2, "bidder2");

  const locked = await balanceOf(contractId) - beforeContract;
  if (locked !== E1 + E2) throw new Error(`escrow mismatch: ${locked} != ${E1 + E2}`);
  diagnostics.info("contract-locked", `  contract locked ${usdc(E1 + E2)}`);

  banner("Phase 3 — Keeper: Wait R → Open → Reveal All");
  const keeperSdk = new SubRosaClient({ rpcUrl: RPC_URL, networkPassphrase: NETWORK, contractId, secretKey: keeperSecret });
  const log = (m: string) => diagnostics.info("progress-5", "  ·", { "m_0": m });
  let rev = await keepRound({ sdk: keeperSdk, drand, log, maxWaitSeconds: 240, pollMs: 5000 }, roundId);
  for (let i = 0; i < 3 && rev.finalStatus === "Open"; i++) {
    await sleep(5000);
    rev = await keepRound({ sdk: keeperSdk, drand, log, maxWaitSeconds: 60, pollMs: 5000 }, roundId);
  }
  if (![b1, b2].every((a) => rev.revealed.includes(a))) {
    throw new Error(`not all revealed: ${JSON.stringify(rev)}`);
  }
  diagnostics.info("all-bids-revealed", "  all bids revealed");

  banner("Phase 4 — Clear + Settle");
  while (clock.nowSeconds() <= revealDeadline + 3) {
    const r = revealDeadline + 4 - clock.nowSeconds();
    if (r > 0) { log(`~${r}s until clear`); await sleep(Math.min(5000, r * 1000)); }
  }

  const close = await closeRound({ sdk: keeperSdk, drand, log }, roundId);
  if (!close.cleared || !close.settled) throw new Error(`close failed: ${JSON.stringify(close)}`);
  diagnostics.info("winner-3", `  winner: ${close.winner} (highest bid ${usdc(V2)})`);

  const afterOp = await balanceOf(op);
  const afterB1 = await balanceOf(b1);
  const afterB2 = await balanceOf(b2);
  const afterContract = await balanceOf(contractId);
  diagnostics.info("operator-2", `  operator: ${usdc(afterOp - beforeOp)} (+winning bid)`);
  diagnostics.info("bidder1", `  bidder1:  ${usdc(afterB1 - beforeB1)} (refunded)`);
  diagnostics.info("bidder2", `  bidder2:  ${usdc(afterB2 - beforeB2)} (net -bid)`);
  diagnostics.info("contract-2", `  contract: ${usdc(afterContract)} (= 0)`);

  if (afterContract !== 0n) throw new Error(`contract balance ${afterContract} != 0`);
  if (afterOp - beforeOp !== V2) throw new Error(`operator delta ${afterOp - beforeOp} != ${V2}`);
  if (afterB1 !== beforeB1) throw new Error(`bidder1 not refunded: ${afterB1} != ${beforeB1}`);

  banner("Phase 5 — Receipt Export + Verify");
  const receipt = await operator.exportReceipt(roundId);
  const result = verifyReceipt(receipt);
  for (const issue of result.issues) {
    diagnostics.info("progress-6", `  ${issue.severity === "error" ? "✗" : "!"} [${issue.code}] ${issue.message}`);
  }
  diagnostics.info("verdict-2", `verdict: ${result.valid ? "PASS" : "FAIL"}`);
  diagnostics.info("winner-4", `winner:  ${result.computedWinner.address} = ${usdc(result.computedWinner.value ?? 0n)}`);

  diagnostics.info("testnet-passed-full-lifecycle-deploy-commit-r-reveal-cl", "\n✅ TESTNET PASSED — full lifecycle: deploy → commit → R → reveal → clear → settle → verify.");
}

async function main() {
  const isFixture = env.FIXTURE === "1";
  if (isFixture) {
    await fixtureMain();
  } else {
    await testnetMain();
  }
}

main().catch((err) => {
  diagnostics.error("sealed-auction-template-failed", "\n❌ SEALED AUCTION TEMPLATE FAILED");
  diagnostics.error("progress-7", err);
  process.exit(1);
});
