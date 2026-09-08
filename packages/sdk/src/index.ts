// SPDX-License-Identifier: MIT
export {
  SubRosaClient,
  type SubRosaClientConfig,
  type CreateRoundParams,
  type CommitParams,
  type RevealParams,
  type ClearingRuleTag,
} from "./client.js";
export { normalizeRoundId, normalizeSorobanContractId } from "./ids.js";
export {
  type PreflightOperation,
  type PreflightResult,
  type PreflightSuccess,
  type PreflightFailureResult,
  type PreflightFeeEstimate,
  type PreflightResourceEstimate,
  evaluatePreflight,
  contractErrorCode,
} from "./preflight.js";
export {
  createOzChannelsSubmitter,
  createOzChannelsSubmitterFromEnv,
  type OzChannelsSubmitterConfig,
  type SubmittedTransaction,
  type SubmitSignedTransactionParams,
  type TransactionSubmitter,
} from "./submitter.js";
export {
  SubRosaClientConfigError,
  SubRosaMissingReturnValueError,
  SubRosaNetworkMismatchError,
  SubRosaPreflightError,
  SubRosaSubmitError,
  SubRosaTimeoutError,
  SubRosaTransactionError,
} from "./errors.js";
export type {
  NetworkMismatchErrorParams,
  PreflightFailureKind,
  SubRosaPreflightErrorParams,
  TimeoutErrorParams,
} from "./errors.js";
export {
  validateContractNetwork,
  type ContractNetworkValidationConfig,
  type NetworkValidationServer,
} from "./network.js";

export {
  validateEncryptedBlob,
  tryDecodeHex,
  tryDecodeBase64,
  MAX_CIPHERTEXT_BYTES,
  MAX_AUDITOR_BLOB_BYTES,
  type BlobContentType,
  type BlobValidationIssue,
  type BlobValidationResult,
} from "./encrypted-blob.js";
export {
  MAINNET_ARTIFACTS,
  MAINNET_CONFIRM_PHRASE,
  MAINNET_DEPLOY_MIN_XLM_STROOPS,
  MAINNET_MICRO_MAX_ESCROW,
  MAINNET_MIN_FEE_RESERVE_STROOPS,
} from "./mainnet-artifacts.js";
export {
  AssetConfigError,
  validateAssetConfig,
  validateAssetConfigs,
  ASSET_FIXTURES,
  type AssetConfig,
  type AssetType,
} from "./asset-config.js";
export {
  assertMainnetConfirmed,
  assertMicroAmounts,
  assertReadinessForExecute,
  createSacBalanceReader,
  defaultMainnetReadinessInput,
  fetchContractWasmHash,
  formatReadinessReport,
  hasBlockingFailures,
  nativeXlmSacId,
  runMainnetReadiness,
  verifySettledRoundProof,
  type MainnetReadinessDeps,
  type MainnetReadinessInput,
  type MainnetReadinessReport,
  type ReadinessCheck,
  type ReadinessStatus,
} from "./mainnet-readiness.js";

export {
  serializeReceipt,
  parseReceipt,
  networkFingerprint,
  type RoundReceipt,
  type BidReceiptEntry,
  RECEIPT_VERSION,
} from "./receipt.js";
export {
  redactReceipt,
  type RedactOptions,
} from "./redact.js";
export {
  verifyReceipt,
  type VerificationIssue,
  type VerificationResult,
  type VerifyOptions,
  type Severity,
} from "./verify.js";

// Round-status predicates and human-readable labels. Mirror
// services/keeper/src/status.ts status vocab.
export {
  ACTIVE_ROUND_STATUSES,
  TERMINAL_ROUND_STATUSES,
  ERROR_ROUND_STATUSES,
  type RoundStatusClass,
  classifyRoundStatus,
  isActiveRoundStatus,
  isTerminalRoundStatus,
  isErrorRoundStatus,
  roundStatusLabel,
  isKeeperRoundActive,
  isKeeperRoundTerminal,
  isKeeperRoundSettlementPending,
} from "./round-status.js";

// Keeper status-API response shapes. Mirror services/keeper/src/status.ts.
export {
  type RoundStatus,
  type SettlementIndicator,
  type KeeperHealthState,
  type KeeperRoundStatusView,
  type KeeperServiceHealth,
  type KeeperStatusResponse,
  type KeeperHealthResponse,
  type ApiError,
} from "./status.js";

// Fetch client for the keeper status API.
export {
  KeeperStatusClient,
  StatusApiError,
  StatusJsonParseError,
  type StatusClientOptions,
  fetchKeeperStatus,
} from "./status-client.js";

// Re-export the generated contract types so consumers get spec-accurate shapes
// from a single import surface.
export {
  Client as RoundContract,
  Errors as RoundErrors,
  type Round,
  type BidState,
  type BiddersPage,
  type Seal,
  type GlobalConfig,
  type ClearingRule,
  type Status,
  type DataKey,
} from "@sub-rosa/round-bindings";
