import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.agent.scripts.usdc-setup");
// USDC setup for multi-agent e2e: trustlines + mint for both principals and the
// appraisal resource server.

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
  const p1 = Keypair.fromSecret(reqEnv("PRINCIPAL1_SECRET"));
  const p2 = Keypair.fromSecret(reqEnv("PRINCIPAL2_SECRET"));
  const appraisalServer = Keypair.fromSecret(reqEnv("APPRAISAL_SERVER_SECRET"));

  const server = new Horizon.Server(HORIZON_URL);
  const asset = new Asset(ASSET_CODE, issuerKp.publicKey());

  async function submit(source: Keypair, op: xdr.Operation) {
    const account = await server.loadAccount(source.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
      .addOperation(op)
      .setTimeout(120)
      .build();
    tx.sign(source);
    await server.submitTransaction(tx);
  }

  for (const kp of [p1, p2, appraisalServer]) {
    await submit(kp, Operation.changeTrust({ asset }));
    diagnostics.info("trustline-ok", `trustline OK: ${kp.publicKey()}`);
  }
  const operatorSecret = env.OPERATOR_SECRET;
  if (operatorSecret) {
    const operator = Keypair.fromSecret(operatorSecret);
    await submit(operator, Operation.changeTrust({ asset }));
    diagnostics.info("trustline-ok-2", `trustline OK: ${operator.publicKey()}`);
  }
  for (const kp of [p1, p2]) {
    await submit(
      issuerKp,
      Operation.payment({ destination: kp.publicKey(), asset, amount: MINT_AMOUNT }),
    );
    diagnostics.info("minted", `minted ${MINT_AMOUNT} ${ASSET_CODE} → ${kp.publicKey()}`);
  }
}

main().catch((err) => {
  diagnostics.error("usdc-setup-failed", "usdc-setup failed:", { "value1_0": err?.response?.data ?? err });
  process.exit(1);
});
