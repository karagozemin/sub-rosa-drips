import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.agent.scripts.agents-e2e");
// Live canonical jury demo on testnet:
//   agents (x402 + mandate + sealed commits) → keeper reveal → clear → settle → 0
//
// Writes the full web demo trace to apps/web/src/demo/demo-trace.generated.ts.

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AddressInfo } from "node:net";

import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { closeRound, keepRound } from "@sub-rosa/keeper";
import { RoundContract, SubRosaClient } from "@sub-rosa/sdk";
import { generateAuditorKeypair, quicknet } from "@sub-rosa/tlock";
import { systemTime } from "@sub-rosa/time";
import { buildAppraisalServer } from "@sub-rosa/appraisal-api";

import {
  createSessionMandate,
  runBidderAgent,
  stroopsToUsdc,
  usdcToStroops,
  type SessionMandate,
} from "../src/index.js";
import { writeDemoTrace } from "../src/write-demo-trace.js";

const DRAND_GENESIS = 1_692_803_367;
const DRAND_PERIOD = 3;
const DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";
const DRAND_PUBKEY_C1C0 =
  "03cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a01a714f2edb74119a2f2b0d5a7c75ba902d163700a61bc224ededd8e63aef7be1aaf8e93d7a9718b047ccddb3eb5d68b0e5db2b6bfbb01c867749cadffca88b36c24f3012ba09fc4d3022c5c37dce0f977d3adb5d183c7477c442b1f04515273";
const DRAND_NEGGEN_C1C0 =
  "13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb813fa4d4a0ad8b1ce186ed5061789213d993923066dddaf1040bc3ff59f825c78df74f2d75467e25e0f55f8a00fa030ed0d1b3cc2c7027888be51d9ef691d77bcb679afda66c73f17f9ee3837a55024f78c71363275a75d75d86bab79f74782aa";

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const HORIZON_URL = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const NETWORK = process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;
const X402_NETWORK = process.env.X402_NETWORK ?? "stellar:testnet";

const { clock, scheduler } = systemTime;

const hex = (s: string) => Buffer.from(s, "hex");
const sha256 = (s: string) => createHash("sha256").update(s).digest();
const sleep = (ms: number) => scheduler.sleep(ms);
const reqEnv = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`missing required env var ${n}`);
  return v;
};
const fail = (m: string): never => {
  throw new Error(`agents e2e assertion failed: ${m}`);
};
const bytesHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const usdc = (stroops: bigint) => Number(stroops) / 1e7;
const repoPath = (path: string) =>
  path.startsWith("/") ? path : resolve(process.cwd(), "../..", path);

async function writeJson(path: string, value: unknown) {
  const out = repoPath(path);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(value, null, 2)}\n`);
  diagnostics.info("trace", "    ✔ trace:", { "out_0": out });
}

async function friendbotFund(address: string) {
  const r = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`);
  if (!r.ok) throw new Error(`friendbot failed for ${address}: ${await r.text()}`);
}

async function setupSessionWallet(
  server: Horizon.Server,
  principalSecret: string,
  sessionSecret: string,
  asset: Asset,
  usdcAmount: string,
) {
  const principal = Keypair.fromSecret(principalSecret);
  const session = Keypair.fromSecret(sessionSecret);

  async function submit(source: Keypair, op: xdr.Operation) {
    const account = await server.loadAccount(source.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
      .addOperation(op)
      .setTimeout(120)
      .build();
    tx.sign(source);
    await server.submitTransaction(tx);
  }

  await friendbotFund(session.publicKey());
  await submit(session, Operation.changeTrust({ asset }));
  await submit(
    principal,
    Operation.payment({ destination: session.publicKey(), asset, amount: usdcAmount }),
  );
}

function lifecycleDone(): DemoTracePayload["lifecycle"] {
  return [
    {
      phase: "create_round",
      label: "Create round",
      detail: "Operator opens round with Drand reveal round R, commit/reveal deadlines, auditor key.",
      status: "done",
    },
    {
      phase: "commit",
      label: "Agents commit",
      detail: "Two session-mandated agents pay x402 appraisal, seal bids to R, lock USDC escrow.",
      status: "done",
    },
    {
      phase: "wait_r",
      label: "Wait for Drand R",
      detail: "Bids are undecryptable until quicknet publishes round R (~3s cadence).",
      status: "done",
    },
    {
      phase: "open_reveal",
      label: "Open reveal",
      detail: "Permissionless keeper submits R's BLS signature — verified on-chain via Soroban host.",
      status: "done",
    },
    {
      phase: "reveal_all",
      label: "Reveal all",
      detail: "Keeper decrypts every seal and reveals — selective abort is impossible.",
      status: "done",
    },
    {
      phase: "clear",
      label: "Clear",
      detail: "After reveal deadline: deterministic winner (highest valid bid).",
      status: "done",
    },
    {
      phase: "settle",
      label: "Settle",
      detail: "Winner pays operator; losers + surplus refunded. Contract balance → 0.",
      status: "done",
    },
  ];
}

type DemoTracePayload = Parameters<typeof writeDemoTrace>[1];

async function main() {
  const operatorSecret = reqEnv("OPERATOR_SECRET");
  const principal1Secret = reqEnv("PRINCIPAL1_SECRET");
  const principal2Secret = reqEnv("PRINCIPAL2_SECRET");
  const keeperSecret = reqEnv("KEEPER_SECRET");
  const appraisalServerSecret = reqEnv("APPRAISAL_SERVER_SECRET");
  const facilitatorSecret = reqEnv("FACILITATOR_SECRET");
  const issuerSecret = reqEnv("ISSUER_SECRET");
  const wasmHash = reqEnv("WASM_HASH");
  const usdcSac = reqEnv("USDC_SAC");
  const appraisalPrice = Number(process.env.PRICE ?? "0.10");

  const issuerKp = Keypair.fromSecret(issuerSecret);
  const asset = new Asset("USDC", issuerKp.publicKey());
  const horizon = new Horizon.Server(HORIZON_URL);
  const opKp = Keypair.fromSecret(operatorSecret);
  const operatorPub = opKp.publicKey();

  const rpcServer = new rpc.Server(RPC_URL);
  const sac = new Contract(usdcSac);
  const balanceOf = async (addr: string): Promise<bigint> => {
    const source = new Account(operatorPub, "0");
    const tx = new TransactionBuilder(source, { fee: "100", networkPassphrase: NETWORK })
      .addOperation(sac.call("balance", new Address(addr).toScVal()))
      .setTimeout(30)
      .build();
    const sim = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`balance sim failed: ${sim.error}`);
    if (!sim.result) return 0n;
    return scValToNative(sim.result.retval) as bigint;
  };

  diagnostics.info("operator", "· operator:", { "operatorPub_0": operatorPub });
  diagnostics.info("keeper", "· keeper:  ", { "value1_0": Keypair.fromSecret(keeperSecret).publicKey() });
  diagnostics.info("usdc-sac", "· USDC SAC:", { "usdcSac_0": usdcSac });

  const priceStroops = usdcToStroops(appraisalPrice);

  diagnostics.info("1-7-deploying-round-createround", "\n[1/7] deploying Round + createRound…");
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
      publicKey: operatorPub,
      signTransaction: basicNodeSigner(opKp, NETWORK).signTransaction,
    },
  );
  const contractId = (await deployTx.signAndSend()).result.options.contractId;
  diagnostics.info("contract", "    ✔ contract", { "contractId_0": contractId });

  const itemRefStr = "sub-rosa://agents/spectrum-block-9";
  const now = clock.nowSeconds();
  const revealRound = Math.ceil((now + 180 - DRAND_GENESIS) / DRAND_PERIOD);
  const tReveal = DRAND_GENESIS + DRAND_PERIOD * revealRound;
  const commitDeadline = now + 90;
  const revealDeadline = tReveal + 180;
  const auditor = generateAuditorKeypair();

  const operator = new SubRosaClient({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    contractId,
    secretKey: operatorSecret,
  });
  const roundId = await operator.createRound({
    itemRef: sha256(itemRefStr),
    revealRound,
    commitDeadline,
    revealDeadline,
    auditorPubkey: auditor.publicKey,
    clearingRule: "HighestBid",
  });
  diagnostics.info("round", "    ✔ round", { "value1_0": roundId.toString(), "value2_1": "R=", "revealRound_2": revealRound });

  diagnostics.info("2-7-starting-x402-appraisal-api", "\n[2/7] starting x402 appraisal API…");
  const appraisalServerPub = Keypair.fromSecret(appraisalServerSecret).publicKey();
  const api = await buildAppraisalServer({
    facilitatorSecret,
    payTo: appraisalServerPub,
    asset: usdcSac,
    price: appraisalPrice,
    network: X402_NETWORK as `${string}:${string}`,
    rpcUrl: RPC_URL,
    port: 0,
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", () => resolve()));
  const appraisalUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}/appraise`;
  diagnostics.info("progress", "    ✔", { "appraisalUrl_0": appraisalUrl });

  try {
    const mandateCommon = {
      contractId,
      roundId,
      itemRef: itemRefStr,
      basePriceUsdc: 500,
      category: "spectrum" as const,
      maxBidStroops: usdcToStroops(700),
      maxEscrowStroops: usdcToStroops(700),
      maxAppraisalSpendStroops: usdcToStroops(1),
      appraisalPriceStroops: priceStroops,
      commitDeadline,
    };

    const agentPlans = [
      {
        name: "agent-alpha",
        principalSecret: principal1Secret,
        attributes: { quality: 88, demand: 82, scarcity: 92, risk: 12 },
      },
      {
        name: "agent-beta",
        principalSecret: principal2Secret,
        attributes: { quality: 52, demand: 48, scarcity: 40, risk: 45 },
      },
    ] as const;

    diagnostics.info("3-7-two-autonomous-agents-mandate-x402-commit", "\n[3/7] two autonomous agents: mandate → x402 → commit…");
    const results: Array<{
      plan: (typeof agentPlans)[number];
      mandate: SessionMandate;
      result: Awaited<ReturnType<typeof runBidderAgent>>;
    }> = [];

    for (const plan of agentPlans) {
      const { mandate, sessionSecret } = createSessionMandate({
        ...mandateCommon,
        principalSecret: plan.principalSecret,
      });
      await setupSessionWallet(horizon, plan.principalSecret, sessionSecret, asset, "800");
      const log = (m: string) => diagnostics.info("progress-2", `    · [${plan.name}]`, { "m_0": m });
      const result = await runBidderAgent({
        mandate,
        sessionSecret,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK,
        appraisalUrl,
        auditorPubkey: auditor.publicKey,
        revealRound,
        attributes: plan.attributes,
        x402Network: X402_NETWORK as `${string}:${string}`,
        log,
      });
      results.push({ plan, mandate, result });
    }

    const reader = new SubRosaClient({
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK,
      contractId,
      publicKey: operatorPub,
    });
    const bidders = await reader.getBidders(roundId);
    if (bidders.length !== 2) fail(`expected 2 bidders, got ${bidders.length}`);

    for (const { plan, result } of results) {
      if (!bidders.includes(result.bidder)) fail(`${plan.name} not in bidder index`);
      if (!result.appraisalSettlement?.success) fail(`${plan.name} x402 not settled`);
      diagnostics.info("progress-3", `    ✔ ${plan.name}: bid ${stroopsToUsdc(result.bidValue)} USDC, escrow ${stroopsToUsdc(result.escrow)}`);
    }

    const alpha = results[0]!;
    const beta = results[1]!;
    if (alpha.result.bidValue <= beta.result.bidValue) {
      fail("agent-alpha must outbid agent-beta");
    }

    const beforeOp = await balanceOf(operatorPub);
    const beforeContract = await balanceOf(contractId);

    diagnostics.info("4-7-keeper-wait-r-open-reveal-reveal-all", "\n[4/7] keeper: wait R → open_reveal → reveal all…");
    const drand = quicknet();
    const keeperSdk = new SubRosaClient({
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK,
      contractId,
      secretKey: keeperSecret,
    });
    const log = (m: string) => diagnostics.info("progress-4", "    ·", { "m_0": m });
    let rev = await keepRound(
      { sdk: keeperSdk, drand, log, maxWaitSeconds: 300, pollMs: 5000 },
      roundId,
    );
    for (let i = 0; i < 5 && rev.finalStatus === "Open"; i++) {
      await sleep(5000);
      rev = await keepRound(
        { sdk: keeperSdk, drand, log, maxWaitSeconds: 120, pollMs: 5000 },
        roundId,
      );
    }
    if (!results.every(({ result }) => rev.revealed.includes(result.bidder))) {
      fail(`keeper did not reveal all bids: ${JSON.stringify(rev)}`);
    }
    diagnostics.info("all-bids-revealed", "    ✔ all bids revealed");

    diagnostics.info("5-7-waiting-for-reveal-deadline", "\n[5/7] waiting for reveal deadline…");
    while (clock.nowSeconds() <= revealDeadline + 3) {
      const remain = revealDeadline + 4 - clock.nowSeconds();
      if (remain > 0) {
        log(`~${remain}s until clear allowed`);
        await sleep(Math.min(10_000, remain * 1000));
      }
    }

    diagnostics.info("6-7-clear-settle", "\n[6/7] clear + settle…");
    const close = await closeRound({ sdk: keeperSdk, drand, log }, roundId);
    if (!close.cleared || !close.settled) fail(`close failed: ${JSON.stringify(close)}`);
    if (close.finalStatus !== "Settled") fail(`expected Settled, got ${close.finalStatus}`);

    const afterOp = await balanceOf(operatorPub);
    const afterContract = await balanceOf(contractId);
    if (afterContract !== 0n) fail(`contract balance ${afterContract} != 0`);

    const winnerBid = alpha.result.bidValue;
    const loserEscrow = beta.result.escrow;
    const opDelta = afterOp - beforeOp;
    if (opDelta !== winnerBid) fail(`operator delta ${opDelta} != winning bid ${winnerBid}`);

    diagnostics.info("7-7-writing-canonical-web-demo-trace", "\n[7/7] writing canonical web demo trace…");
    const generatedAt = clock.toISOString();
    const revealLines = results.map(({ plan, result }) => {
      const bid = stroopsToUsdc(result.bidValue);
      return `${plan.name} → ${bid} USDC`;
    });

    const demoTrace: DemoTracePayload = {
      meta: {
        title: "Sealed Asset Auction — Round 1",
        network: "Stellar Testnet",
        contractId,
        roundId: Number(roundId),
        revealRound,
        clearingRule: "HighestBid",
        recordedAt: generatedAt,
        roundStatus: "Settled",
        liveE2e: ["pnpm agents:e2e", "pnpm mainnet:verify"],
        proofScope:
          "Single canonical testnet run: 2 mandated agents, x402 appraisal, sealed commits, permissionless keeper reveal, clear, settle → contract 0 USDC.",
      },
      lifecycle: lifecycleDone(),
      bidders: results.map(({ plan, mandate, result }) => ({
        label: plan.name,
        address: result.bidder,
        role: "agent" as const,
        escrowUsdc: usdc(result.escrow),
        bidUsdc: usdc(result.bidValue),
        revealed: true,
        valid: true,
        winner: close.winner === result.bidder,
      })),
      agents: results.map(({ plan, mandate, result }) => ({
        name: plan.name,
        principal: mandate.principal,
        sessionKey: mandate.sessionKey,
        mandate: {
          maxBidUsdc: usdc(mandateCommon.maxBidStroops),
          maxEscrowUsdc: usdc(mandateCommon.maxEscrowStroops),
          maxAppraisalSpendUsdc: usdc(mandateCommon.maxAppraisalSpendStroops),
          cappedAtMaxBid: result.bidValue === mandateCommon.maxBidStroops,
        },
        appraisal: {
          fairValue: result.appraisal.fairValue,
          suggestedMaxBid: result.appraisal.suggestedMaxBid,
          inputsHash: result.inputsHash,
        },
        x402: { priceUsdc: appraisalPrice, settled: true },
        commitTx: "on-chain via session key",
      })),
      keeper: {
        drandRound: revealRound,
        blsVerifiedOnChain: rev.openedReveal || rev.finalStatus !== "Open",
        reveals: revealLines,
        clearWinner: close.winner ?? undefined,
        contractBalanceFinal: 0,
      },
      settlement: {
        operatorReceivedUsdc: usdc(winnerBid),
        refundsUsdc: usdc(loserEscrow),
        note: "Winner pays bid from escrow; loser refunded in full. Contract holds 0 USDC after settle.",
      },
      auditor: {
        source: "agents:e2e",
        generatedAt,
        secretHex: bytesHex(auditor.secretKey),
        publicHex: bytesHex(auditor.publicKey),
        blobs: Object.fromEntries(
          results.map(({ plan, result }) => [plan.name, bytesHex(result.auditorBlob)]),
        ),
      },
    };

    await writeJson("artifacts/canonical-demo-trace.json", demoTrace);
    if (process.env.SUB_ROSA_WRITE_WEB_TRACE !== "0") {
      await writeDemoTrace(
        process.env.SUB_ROSA_WEB_DEMO_TRACE_OUT ?? "apps/web/src/demo/demo-trace.generated.ts",
        demoTrace,
      );
    }

    diagnostics.info("canonical-agents-e2e-passed-commit-r-reveal-clear-settl", "\n✅ CANONICAL AGENTS E2E PASSED — commit → R → reveal → clear → settle → 0.");
    diagnostics.info("contract-2", "   contract:", { "contractId_0": contractId, "value2_1": "round:", "value3_2": roundId.toString(), "value4_3": "winner:", "winner_4": close.winner });
  } finally {
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
}

main().catch((err) => {
  diagnostics.error("canonical-agents-e2e-failed", "\n❌ CANONICAL AGENTS E2E FAILED");
  diagnostics.error("progress-5", err);
  process.exit(1);
});
