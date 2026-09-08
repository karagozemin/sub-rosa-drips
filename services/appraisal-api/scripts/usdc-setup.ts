import { createLogger } from '@sub-rosa/logging';
import { getSystemEnv } from '@sub-rosa/config';
const diagnostics = createLogger("services.appraisal-api.scripts.usdc-setup");

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

const env = getSystemEnv();
const HORIZON_URL = env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
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
  const clientKp = Keypair.fromSecret(reqEnv("CLIENT_SECRET"));
  const serverKp = Keypair.fromSecret(reqEnv("SERVER_SECRET"));

  const server = new Horizon.Server(HORIZON_URL);
  const asset = new Asset(ASSET_CODE, issuerKp.publicKey());

  async function submit(sourceKp: Keypair, op: xdr.Operation) {
    const account = await server.loadAccount(sourceKp.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
      .addOperation(op)
      .setTimeout(120)
      .build();
    tx.sign(sourceKp);
    await server.submitTransaction(tx);
  }

  for (const kp of [clientKp, serverKp]) {
    await submit(kp, Operation.changeTrust({ asset }));
    diagnostics.info("trustline-ok", `trustline OK: ${kp.publicKey()}`);
  }
  await submit(
    issuerKp,
    Operation.payment({ destination: clientKp.publicKey(), asset, amount: MINT_AMOUNT }),
  );
  diagnostics.info("minted", `minted ${MINT_AMOUNT} ${ASSET_CODE} → ${clientKp.publicKey()}`);
}

main().catch((err) => {
  diagnostics.error("usdc-setup-failed", "usdc-setup failed:", { "value1_0": err?.response?.data ?? err });
  process.exit(1);
});
