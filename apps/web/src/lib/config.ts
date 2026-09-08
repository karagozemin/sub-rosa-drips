import { getBrowserEnv } from "@sub-rosa/config/browser";

export interface ConfigIssue {
  key: string;
  message: string;
}

const CRITICAL_KEYS = [
  "VITE_RPC_URL",
  "VITE_NETWORK_PASSPHRASE",
  "VITE_CONTRACT_ID",
] as const;

const OPTIONAL_KEYS = [
  "VITE_ESCROW_TOKEN_LABEL",
  "VITE_ROUND_ID",
] as const;

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

const PLACEHOLDER_VALUES: Record<string, string[]> = {
  VITE_RPC_URL: ["https://soroban-testnet.stellar.org"],
  VITE_NETWORK_PASSPHRASE: ["Test SDF Network ; September 2015"],
  VITE_CONTRACT_ID: [
    "CC2QMOXZERI6UOR67YKSORT7QTUHQ5QUGMHQBYVP23YM3NMUNNOEOGZY",
    "CAPTODBCDEVIK23ALBJBS2TXRTIK47ZA5MBTHYF4XLHG2BK7JPYUCU2Y",
  ],
};

export function validatePublicConfig(
  env: Record<string, string | undefined> = getBrowserEnv(),
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  for (const key of CRITICAL_KEYS) {
    const value = env[key];
    if (!value || value.trim() === "") {
      issues.push({
        key,
        message: `${key} is missing — the demo will not function correctly. Set it in .env.local or deployment environment variables.`,
      });
    }
  }

  for (const key of OPTIONAL_KEYS) {
    const value = env[key];
    if (!value || value.trim() === "") {
      issues.push({
        key,
        message: `${key} is missing (optional — some features may degrade).`,
      });
    }
  }

  for (const key of CRITICAL_KEYS) {
    const value = env[key];
    if (value && value.trim() !== "") {
      const trimmed = key === "VITE_RPC_URL" ? normalizeUrl(value) : value.trim();
      const placeholders = PLACEHOLDER_VALUES[key];
      if (placeholders?.includes(trimmed)) {
        issues.push({
          key,
          message: `${key} appears to be a default/example value (${value}). Update it to your own contract and network config.`,
        });
      }
    }
  }

  const rpcUrl = env.VITE_RPC_URL;
  if (rpcUrl && rpcUrl.trim() !== "") {
    const normalized = normalizeUrl(rpcUrl);
    if (!/^https?:\/\//.test(normalized)) {
      issues.push({
        key: "VITE_RPC_URL",
        message: `VITE_RPC_URL is not a valid URL (${rpcUrl}). It must start with http:// or https://.`,
      });
    }
  }

  return issues;
}

export function hasConfigIssues(
  env: Record<string, string | undefined> = getBrowserEnv(),
): boolean {
  return validatePublicConfig(env).length > 0;
}
