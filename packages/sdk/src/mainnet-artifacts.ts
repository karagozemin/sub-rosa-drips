// SPDX-License-Identifier: MIT
/** Frozen mainnet deployment artifacts — read-only proof references. */
export const MAINNET_ARTIFACTS = {
  network: "Stellar Mainnet",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
  rpcUrl: "https://rpc.ankr.com/stellar_soroban",
  contractId: "CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX",
  wasmHash: "353915ad440965ea5f8d92fdb8d93cb2e309fb365e68e6762bca7fd6762b30c7",
  settledRoundId: 1,
  revealRound: 29_174_905,
  /** Native XLM SAC — escrow token for the mainnet smoke round. */
  escrowToken: "native XLM (SAC)",
  /** Stroops — 1 XLM bid, 5 XLM escrow (not testnet USDC demo amounts). */
  bidStroops: 10_000_000n,
  escrowStroops: 50_000_000n,
  bidXlm: "1",
  escrowXlm: "5",
  status: "Settled" as const,
  proofCommand: "pnpm mainnet:verify",
  deployCommand: "pnpm mainnet:deploy",
  settleCommand: "pnpm mainnet:settle",
  explorerContract:
    "https://stellar.expert/explorer/public/contract/CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX",
} as const;

/** Hard ceiling for optional mainnet micro runner (1 XLM escrow). */
export const MAINNET_MICRO_MAX_ESCROW = 10_000_000n;

/** Required env value before value-moving mainnet commands execute. */
export const MAINNET_CONFIRM_PHRASE = "SUB_ROSA_MAINNET";

/** Recommended minimum operator XLM for wasm upload (~30 XLM). */
export const MAINNET_DEPLOY_MIN_XLM_STROOPS = 300_000_000n;

/** Minimum XLM reserve for keeper/bidder fee coverage. */
export const MAINNET_MIN_FEE_RESERVE_STROOPS = 5_000_000n;
