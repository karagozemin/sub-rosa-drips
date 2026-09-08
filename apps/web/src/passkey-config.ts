import { getBrowserEnv } from "@sub-rosa/config/browser";

const env = getBrowserEnv();

/** Public testnet smart-wallet WASM (passkey-kit demo). Not a secret. */
export const PASSKEY_TESTNET_WALLET_WASM_HASH =
  "ecd990f0b45ca6817149b6175f79b32efb442f35731985a084131e8265c4cd90";

export const PASSKEY_RPC_URL =
  env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";

export const PASSKEY_NETWORK_PASSPHRASE =
  env.VITE_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

export function resolvePasskeyWalletWasmHash(): string | undefined {
  const fromEnv = env.VITE_PASSKEY_WALLET_WASM_HASH?.trim();
  if (fromEnv) return fromEnv;
  return PASSKEY_TESTNET_WALLET_WASM_HASH;
}
