// SPDX-License-Identifier: MIT
import {
  Account,
  Address,
  Asset,
  Contract,
  rpc,
  scValToNative,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import { getSystemEnv } from "@sub-rosa/config";
import type { SubRosaClient } from "./client.js";
import {
  MAINNET_ARTIFACTS,
  MAINNET_CONFIRM_PHRASE,
  MAINNET_DEPLOY_MIN_XLM_STROOPS,
  MAINNET_MICRO_MAX_ESCROW,
  MAINNET_MIN_FEE_RESERVE_STROOPS,
} from "./mainnet-artifacts.js";

export type ReadinessStatus = "pass" | "warn" | "block";

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessStatus;
  message: string;
}

export interface MainnetReadinessInput {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  expectedWasmHash: string;
  settledRoundId: bigint;
  expectedBidStroops: bigint;
  expectedEscrowStroops: bigint;
  expectedRevealRound: number;
  /** When false, emit dry-run placeholders instead of live RPC checks. */
  live?: boolean;
  /** When true, include optional balance checks when account ids are provided. */
  withBalances?: boolean;
  tokenSacId?: string;
  operatorAccount?: string;
  keeperAccount?: string;
  bidderAccount?: string;
}

export interface MainnetReadinessDeps {
  reader?: Pick<SubRosaClient, "getRound" | "getBidState" | "getBidders">;
  rpc?: Pick<
    rpc.Server,
    | "getHealth"
    | "getLatestLedger"
    | "getLedgerEntries"
    | "getAccountEntry"
    | "simulateTransaction"
  >;
  sacBalance?: (address: string) => Promise<bigint>;
  fetchWasmHash?: (contractId: string) => Promise<string>;
}

export interface MainnetReadinessReport {
  mode: "dry-run" | "live";
  checks: ReadinessCheck[];
  passCount: number;
  warnCount: number;
  blockCount: number;
}

const check = (
  id: string,
  label: string,
  status: ReadinessStatus,
  message: string,
): ReadinessCheck => ({ id, label, status, message });

export function nativeXlmSacId(networkPassphrase: string): string {
  return Asset.native().contractId(networkPassphrase);
}

export function assertMainnetConfirmed(
  env: Record<string, string | undefined> = getSystemEnv(),
): void {
  if (env.MAINNET_CONFIRM?.trim() !== MAINNET_CONFIRM_PHRASE) {
    throw new Error(
      `set MAINNET_CONFIRM=${MAINNET_CONFIRM_PHRASE} to execute value-moving mainnet commands`,
    );
  }
}

export function assertMicroAmounts(
  bid: bigint,
  escrow: bigint,
  maxEscrow: bigint = MAINNET_MICRO_MAX_ESCROW,
): void {
  if (bid <= 0n || escrow <= 0n) {
    throw new Error("bid and escrow must be positive stroop amounts");
  }
  if (bid > escrow) {
    throw new Error("bid cannot exceed escrow");
  }
  if (escrow > maxEscrow) {
    throw new Error(
      `escrow ${escrow} exceeds MAINNET_MICRO_MAX_ESCROW (${maxEscrow})`,
    );
  }
}

export function hasBlockingFailures(checks: ReadinessCheck[]): boolean {
  return checks.some((c) => c.status === "block");
}

export function assertReadinessForExecute(checks: ReadinessCheck[]): void {
  const blocked = checks.filter((c) => c.status === "block");
  if (blocked.length === 0) return;
  const summary = blocked.map((c) => `${c.id}: ${c.message}`).join("; ");
  throw new Error(`mainnet readiness blocked: ${summary}`);
}

export function formatReadinessReport(report: MainnetReadinessReport): string {
  const lines = [
    "Sub Rosa — mainnet launch readiness (read-only)",
    `Mode: ${report.mode}`,
    "",
  ];
  for (const c of report.checks) {
    const tag =
      c.status === "pass" ? "PASS" : c.status === "warn" ? "WARN" : "BLOCK";
    lines.push(`[${tag}] ${c.label}: ${c.message}`);
  }
  lines.push("");
  lines.push(
    `Summary: ${report.passCount} pass, ${report.warnCount} warn, ${report.blockCount} block`,
  );
  return lines.join("\n");
}

export async function fetchContractWasmHash(
  server: Pick<rpc.Server, "getLedgerEntries">,
  contractId: string,
): Promise<string> {
  const contractLedgerKey = new Contract(contractId).getFootprint();
  const response = await server.getLedgerEntries(contractLedgerKey);
  const entry = response.entries[0]?.val;
  if (!entry) {
    throw new Error("contract not found on network");
  }
  const wasmHash = entry
    .contractData()
    .val()
    .instance()
    .executable()
    .wasmHash();
  return Buffer.from(wasmHash).toString("hex");
}

export function createSacBalanceReader(
  rpcUrl: string,
  networkPassphrase: string,
  tokenSacId: string,
  sourcePublicKey: string,
): (address: string) => Promise<bigint> {
  const server = new rpc.Server(rpcUrl);
  const sac = new Contract(tokenSacId);
  return async (address: string): Promise<bigint> => {
    const source = new Account(sourcePublicKey, "0");
    const tx = new TransactionBuilder(source, {
      fee: "100",
      networkPassphrase,
    })
      .addOperation(sac.call("balance", new Address(address).toScVal()))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(`balance simulation failed: ${sim.error}`);
    }
    if (!sim.result) return 0n;
    return scValToNative(sim.result.retval) as bigint;
  };
}

export async function verifySettledRoundProof(
  reader: Pick<SubRosaClient, "getRound" | "getBidState" | "getBidders">,
  roundId: bigint,
  expected: {
    bidStroops: bigint;
    escrowStroops: bigint;
    revealRound: number;
  },
): Promise<void> {
  const round = await reader.getRound(roundId);
  const bidders = await reader.getBidders(roundId);
  if (bidders.length !== 1) {
    throw new Error(`expected 1 bidder, got ${bidders.length}`);
  }
  const bidState = await reader.getBidState(roundId, bidders[0]!);
  if (round.status.tag !== "Settled") {
    throw new Error(`status ${round.status.tag} != Settled`);
  }
  if (Number(round.reveal_round) !== expected.revealRound) {
    throw new Error(
      `R ${round.reveal_round} != expected ${expected.revealRound}`,
    );
  }
  if (bidState.revealed_value !== expected.bidStroops) {
    throw new Error(
      `revealed ${bidState.revealed_value} != ${expected.bidStroops}`,
    );
  }
  if (bidState.escrow !== expected.escrowStroops) {
    throw new Error(`escrow ${bidState.escrow} != ${expected.escrowStroops}`);
  }
  if (!bidState.valid || !bidState.settled) {
    throw new Error("bid not valid/settled");
  }
}

function summarize(checks: ReadinessCheck[]): Omit<
  MainnetReadinessReport,
  "mode" | "checks"
> {
  return {
    passCount: checks.filter((c) => c.status === "pass").length,
    warnCount: checks.filter((c) => c.status === "warn").length,
    blockCount: checks.filter((c) => c.status === "block").length,
  };
}

export async function runMainnetReadiness(
  input: MainnetReadinessInput,
  deps: MainnetReadinessDeps = {},
): Promise<MainnetReadinessReport> {
  const checks: ReadinessCheck[] = [];
  const live = input.live ?? true;

  if (input.networkPassphrase === MAINNET_ARTIFACTS.networkPassphrase) {
    checks.push(
      check(
        "network-passphrase",
        "Network passphrase",
        "pass",
        "matches Stellar mainnet",
      ),
    );
  } else {
    checks.push(
      check(
        "network-passphrase",
        "Network passphrase",
        "block",
        `expected mainnet passphrase, got ${JSON.stringify(input.networkPassphrase)}`,
      ),
    );
  }

  if (/^https:\/\//i.test(input.rpcUrl)) {
    checks.push(
      check("rpc-url", "RPC URL", "pass", `uses HTTPS (${input.rpcUrl})`),
    );
  } else if (/^http:\/\//i.test(input.rpcUrl)) {
    checks.push(
      check(
        "rpc-url",
        "RPC URL",
        "warn",
        "uses HTTP — prefer HTTPS for mainnet",
      ),
    );
  } else {
    checks.push(
      check(
        "rpc-url",
        "RPC URL",
        "block",
        `invalid RPC URL ${JSON.stringify(input.rpcUrl)}`,
      ),
    );
  }

  if (input.contractId === MAINNET_ARTIFACTS.contractId) {
    checks.push(
      check(
        "contract-id",
        "Contract id",
        "pass",
        "matches frozen artifact",
      ),
    );
  } else {
    checks.push(
      check(
        "contract-id",
        "Contract id",
        "warn",
        `differs from frozen artifact (${MAINNET_ARTIFACTS.contractId})`,
      ),
    );
  }

  if (!live) {
    checks.push(
      check(
        "rpc-reachable",
        "RPC reachable",
        "warn",
        "dry-run — would ping RPC health",
      ),
      check(
        "wasm-hash",
        "Artifact wasm hash",
        "warn",
        `dry-run — would verify ${input.expectedWasmHash}`,
      ),
      check(
        "settled-round",
        "Settled round proof",
        "warn",
        `dry-run — would verify round ${input.settledRoundId.toString()}`,
      ),
    );
    if (input.withBalances) {
      checks.push(
        check(
          "contract-balance",
          "Contract escrow balance",
          "warn",
          "dry-run — would assert contract SAC balance is 0",
        ),
      );
    }
    return {
      mode: "dry-run",
      checks,
      ...summarize(checks),
    };
  }

  const rpcServer = deps.rpc ?? new rpc.Server(input.rpcUrl);

  try {
    await rpcServer.getHealth();
    const latest = await rpcServer.getLatestLedger();
    checks.push(
      check(
        "rpc-reachable",
        "RPC reachable",
        "pass",
        `healthy (ledger ${latest.sequence})`,
      ),
    );
  } catch (err) {
    checks.push(
      check(
        "rpc-reachable",
        "RPC reachable",
        "block",
        err instanceof Error ? err.message : String(err),
      ),
    );
  }

  const fetchWasmHash =
    deps.fetchWasmHash ??
    ((contractId: string) => fetchContractWasmHash(rpcServer, contractId));

  try {
    const onChainHash = await fetchWasmHash(input.contractId);
    if (onChainHash.toLowerCase() === input.expectedWasmHash.toLowerCase()) {
      checks.push(
        check(
          "wasm-hash",
          "Artifact wasm hash",
          "pass",
          "on-chain hash matches frozen artifact",
        ),
      );
    } else {
      checks.push(
        check(
          "wasm-hash",
          "Artifact wasm hash",
          "block",
          `on-chain ${onChainHash} != artifact ${input.expectedWasmHash}`,
        ),
      );
    }
  } catch (err) {
    checks.push(
      check(
        "wasm-hash",
        "Artifact wasm hash",
        "block",
        err instanceof Error ? err.message : String(err),
      ),
    );
  }

  if (!deps.reader) {
    checks.push(
      check(
        "settled-round",
        "Settled round proof",
        "block",
        "reader dependency missing",
      ),
    );
  } else {
    try {
      await verifySettledRoundProof(deps.reader, input.settledRoundId, {
        bidStroops: input.expectedBidStroops,
        escrowStroops: input.expectedEscrowStroops,
        revealRound: input.expectedRevealRound,
      });
      checks.push(
        check(
          "settled-round",
          "Settled round proof",
          "pass",
          `round ${input.settledRoundId.toString()} settled with expected amounts`,
        ),
      );
    } catch (err) {
      checks.push(
        check(
          "settled-round",
          "Settled round proof",
          "block",
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  }

  if (input.withBalances) {
    const tokenSacId =
      input.tokenSacId ?? nativeXlmSacId(input.networkPassphrase);
    const sacBalance =
      deps.sacBalance ??
      createSacBalanceReader(
        input.rpcUrl,
        input.networkPassphrase,
        tokenSacId,
        input.operatorAccount ??
          input.keeperAccount ??
          "GCDARJFKKSTJYAZC647H4ZSSSPXPPSKOWOHGMUNCT22VG74KXZ5BHVNR",
      );

    try {
      const contractBalance = await sacBalance(input.contractId);
      if (contractBalance === 0n) {
        checks.push(
          check(
            "contract-balance",
            "Contract escrow balance",
            "pass",
            "native XLM SAC balance is 0",
          ),
        );
      } else {
        checks.push(
          check(
            "contract-balance",
            "Contract escrow balance",
            "block",
            `expected 0 stroops, got ${contractBalance.toString()}`,
          ),
        );
      }
    } catch (err) {
      checks.push(
        check(
          "contract-balance",
          "Contract escrow balance",
          "block",
          err instanceof Error ? err.message : String(err),
        ),
      );
    }

    const accountChecks: Array<{
      id: string;
      label: string;
      account?: string;
      min: bigint;
    }> = [
      {
        id: "operator-balance",
        label: "Operator XLM balance",
        account: input.operatorAccount,
        min: MAINNET_DEPLOY_MIN_XLM_STROOPS,
      },
      {
        id: "keeper-balance",
        label: "Keeper XLM balance",
        account: input.keeperAccount,
        min: MAINNET_MIN_FEE_RESERVE_STROOPS,
      },
      {
        id: "bidder-balance",
        label: "Bidder XLM balance",
        account: input.bidderAccount,
        min: MAINNET_MIN_FEE_RESERVE_STROOPS,
      },
    ];

    for (const { id, label, account, min } of accountChecks) {
      if (!account) {
        checks.push(
          check(id, label, "warn", "skipped — account not provided"),
        );
        continue;
      }
      try {
        const entry = await rpcServer.getAccountEntry(account);
        const balance = BigInt(entry.balance().toString());
        if (balance >= min) {
          checks.push(
            check(
              id,
              label,
              "pass",
              `${balance.toString()} stroops (min ${min.toString()})`,
            ),
          );
        } else {
          checks.push(
            check(
              id,
              label,
              "warn",
              `${balance.toString()} stroops below recommended ${min.toString()}`,
            ),
          );
        }
      } catch (err) {
        checks.push(
          check(
            id,
            label,
            "block",
            err instanceof Error ? err.message : String(err),
          ),
        );
      }
    }
  }

  return {
    mode: "live",
    checks,
    ...summarize(checks),
  };
}

export function defaultMainnetReadinessInput(
  overrides: Partial<MainnetReadinessInput> = {},
): MainnetReadinessInput {
  return {
    rpcUrl: MAINNET_ARTIFACTS.rpcUrl,
    networkPassphrase: MAINNET_ARTIFACTS.networkPassphrase,
    contractId: MAINNET_ARTIFACTS.contractId,
    expectedWasmHash: MAINNET_ARTIFACTS.wasmHash,
    settledRoundId: BigInt(MAINNET_ARTIFACTS.settledRoundId),
    expectedBidStroops: MAINNET_ARTIFACTS.bidStroops,
    expectedEscrowStroops: MAINNET_ARTIFACTS.escrowStroops,
    expectedRevealRound: MAINNET_ARTIFACTS.revealRound,
    live: true,
    withBalances: false,
    ...overrides,
  };
}
