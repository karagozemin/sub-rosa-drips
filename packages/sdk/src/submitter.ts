import { getSystemEnv } from "@sub-rosa/config";
import { SubRosaSubmitError } from "./errors.js";

export interface SubmittedTransaction {
  hash: string;
  relayerTransactionId?: string | null;
  status?: string | null;
}

export interface SubmitSignedTransactionParams {
  signedTransactionXdr: string;
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
}

export interface TransactionSubmitter {
  readonly name: string;
  submitSignedTransaction(params: SubmitSignedTransactionParams): Promise<SubmittedTransaction>;
}

export interface OzChannelsSubmitterConfig {
  baseUrl: string;
  apiKey: string;
  pluginId?: string;
  fundRelayerId?: string;
  timeoutMs?: number;
}

export function createOzChannelsSubmitter(config: OzChannelsSubmitterConfig): TransactionSubmitter {
  return {
    name: "oz-relayer-channels",
    async submitSignedTransaction({ signedTransactionXdr }) {
      const { ChannelsClient } = await import("@openzeppelin/relayer-plugin-channels");
      const client = new ChannelsClient({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        ...(config.pluginId ? { pluginId: config.pluginId } : {}),
        ...(config.timeoutMs ? { timeout: config.timeoutMs } : {}),
      });
      const result = await client.submitTransaction({
        xdr: signedTransactionXdr,
        ...(config.fundRelayerId ? { fundRelayerId: config.fundRelayerId } : {}),
      });
      if (!result.hash) {
        throw new SubRosaSubmitError(
          `OZ Channels accepted the transaction but returned no hash (status=${result.status ?? "unknown"})`,
        );
      }
      return {
        hash: result.hash,
        relayerTransactionId: result.transactionId,
        status: result.status,
      };
    },
  };
}

export function createOzChannelsSubmitterFromEnv(
  env: Record<string, string | undefined> = getSystemEnv(),
): TransactionSubmitter | undefined {
  const baseUrl = env.OZ_CHANNELS_BASE_URL ?? env.OZ_RELAYER_CHANNELS_URL;
  const apiKey = env.OZ_CHANNELS_API_KEY ?? env.OZ_RELAYER_API_KEY;
  if (!baseUrl || !apiKey) return undefined;
  return createOzChannelsSubmitter({
    baseUrl,
    apiKey,
    pluginId: env.OZ_CHANNELS_PLUGIN_ID,
    fundRelayerId: env.OZ_CHANNELS_FUND_RELAYER_ID,
    timeoutMs: env.OZ_CHANNELS_TIMEOUT_MS ? Number(env.OZ_CHANNELS_TIMEOUT_MS) : undefined,
  });
}
