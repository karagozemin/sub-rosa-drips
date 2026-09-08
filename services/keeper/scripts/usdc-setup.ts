import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.keeper.scripts.usdc-setup");
// USDC asset provisioning (classic operations via Horizon).
//
// Establishes trustlines for the operator + both bidders to a custom-issued
// USDC asset and mints USDC to the bidders. Done in JS because stellar-cli
// `tx new change-trust` is unreliable on this version; the SAC deploy itself is
// still done with the CLI. Real assets, real trustlines — no mock.

import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { getSystemEnv } from "@sub-rosa/config";

const env = getSystemEnv();
const HORIZON_URL =
  env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const NETWORK = env.NETWORK_PASSPHRASE ?? Networks.TESTNET;
const ASSET_CODE = env.ASSET_CODE ?? "USDC";
const MINT_AMOUNT = env.MINT_AMOUNT ?? "1000";

const reqEnv = (n: string): string => {
  const v = env[n];
  if (!v) throw new Error(`missing required env var ${n}`);
  return v;
};

async function main() {
  const issuerKp = Keypair.fromSecret(reqEnv("ISSUER_SECRET"));
  const operatorKp = Keypair.fromSecret(reqEnv("OPERATOR_SECRET"));
  const bidder1Kp = Keypair.fromSecret(reqEnv("BIDDER1_SECRET"));
  const bidder2Kp = Keypair.fromSecret(reqEnv("BIDDER2_SECRET"));

  const server = new Horizon.Server(HORIZON_URL);
  const asset = new Asset(ASSET_CODE, issuerKp.publicKey());

  async function submit(sourceKp: Keypair, op: xdr.Operation) {
    const account = await server.loadAccount(sourceKp.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK,
    })
      .addOperation(op)
      .setTimeout(120)
      .build();
    tx.sign(sourceKp);
    await server.submitTransaction(tx);
  }

  // Trustlines: operator (receives the winning bid) + both bidders.
  for (const kp of [operatorKp, bidder1Kp, bidder2Kp]) {
    await submit(kp, Operation.changeTrust({ asset }));
    diagnostics.info("trustline-ok", `trustline OK: ${kp.publicKey()}`);
  }

  // Mint USDC to the bidders so they can escrow real funds.
  for (const kp of [bidder1Kp, bidder2Kp]) {
    await submit(
      issuerKp,
      Operation.payment({
        destination: kp.publicKey(),
        asset,
        amount: MINT_AMOUNT,
      }),
    );
    diagnostics.info("minted", `minted ${MINT_AMOUNT} ${ASSET_CODE} → ${kp.publicKey()}`);
  }
}

main().catch((err) => {
  diagnostics.error("usdc-setup-failed", "usdc-setup failed:", { "value1_0": err?.response?.data ?? err });
  process.exit(1);
});
