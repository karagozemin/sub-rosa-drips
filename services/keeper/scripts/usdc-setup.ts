import { createLogger } from '@sub-rosa/logging';
import { runCommand } from "@sub-rosa/command";
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

const diagnostics = createLogger("services.keeper.scripts.usdc-setup");

const reqEnv = (n: string, env: Record<string, string | undefined> = process.env): string => {
  const v = env[n];
  if (!v) throw new Error(`missing required env var ${n}`);
  return v;
};

runCommand({
  name: "services.keeper.usdc-setup",
  description: "USDC asset provisioning (classic operations via Horizon)",
  options: {
    asset: {
      type: "string",
      description: "Asset code (defaults to ASSET_CODE env or USDC)",
    },
    amount: {
      type: "string",
      description: "Mint amount (defaults to MINT_AMOUNT env or 1000)",
    },
  },
  async run(ctx) {
    const horizonUrl = ctx.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
    const network = ctx.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;
    const assetCode = (ctx.args.asset as string | undefined) ?? ctx.env.ASSET_CODE ?? "USDC";
    const mintAmount = (ctx.args.amount as string | undefined) ?? ctx.env.MINT_AMOUNT ?? "1000";

    const issuerKp = Keypair.fromSecret(reqEnv("ISSUER_SECRET", ctx.env));
    const operatorKp = Keypair.fromSecret(reqEnv("OPERATOR_SECRET", ctx.env));
    const bidder1Kp = Keypair.fromSecret(reqEnv("BIDDER1_SECRET", ctx.env));
    const bidder2Kp = Keypair.fromSecret(reqEnv("BIDDER2_SECRET", ctx.env));

    const server = new Horizon.Server(horizonUrl);
    const asset = new Asset(assetCode, issuerKp.publicKey());

    async function submit(sourceKp: Keypair, op: xdr.Operation) {
      const account = await server.loadAccount(sourceKp.publicKey());
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: network,
      })
        .addOperation(op)
        .setTimeout(120)
        .build();
      tx.sign(sourceKp);
      await server.submitTransaction(tx);
    }

    for (const kp of [operatorKp, bidder1Kp, bidder2Kp]) {
      await submit(kp, Operation.changeTrust({ asset }));
      diagnostics.info("trustline-ok", `trustline OK: ${kp.publicKey()}`);
    }

    for (const kp of [bidder1Kp, bidder2Kp]) {
      await submit(
        issuerKp,
        Operation.payment({
          destination: kp.publicKey(),
          asset,
          amount: mintAmount,
        }),
      );
      diagnostics.info("minted", `minted ${mintAmount} ${assetCode} → ${kp.publicKey()}`);
    }

    return 0;
  },
});
