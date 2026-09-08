// SPDX-License-Identifier: MIT
import { rpc } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  type Result,
} from "@stellar/stellar-sdk/contract";
import { Errors as RoundContractErrors } from "@sub-rosa/round-bindings";
import { SubRosaPreflightError } from "./errors.js";

export type PreflightOperation =
  | "create_round"
  | "commit"
  | "open_reveal"
  | "reveal"
  | "clear"
  | "settle"
  | "void";

export interface PreflightFeeEstimate {
  /** Base transaction fee in stroops from the assembled transaction. */
  transactionFee?: number;
  /** Minimum Soroban resource fee reported by the simulation, when available. */
  minResourceFee?: bigint;
}

export interface PreflightResourceEstimate {
  instructions?: number;
  /** Number of ledger entries in the simulation read footprint. */
  readOnlyEntries?: number;
  /** Number of ledger entries in the simulation read-write footprint. */
  readWriteEntries?: number;
}

export interface PreflightSuccess<T> {
  ok: true;
  operation: PreflightOperation;
  result: T;
  fee: PreflightFeeEstimate;
  resources?: PreflightResourceEstimate;
}

export interface PreflightFailureResult {
  ok: false;
  operation: PreflightOperation;
  error: SubRosaPreflightError;
  fee?: PreflightFeeEstimate;
  resources?: PreflightResourceEstimate;
}

export type PreflightResult<T> = PreflightSuccess<T> | PreflightFailureResult;

export function contractErrorCode(message: string): number | undefined {
  for (const [code, info] of Object.entries(RoundContractErrors)) {
    if (info.message === message) {
      return Number(code);
    }
  }
  return undefined;
}

function extractFee(
  tx: AssembledTransaction<unknown>,
  simulation?: rpc.Api.SimulateTransactionResponse,
): PreflightFeeEstimate {
  const fee: PreflightFeeEstimate = {};
  if (tx.built?.fee) {
    fee.transactionFee = Number(tx.built.fee);
  }
  if (
    simulation &&
    rpc.Api.isSimulationSuccess(simulation) &&
    simulation.minResourceFee
  ) {
    fee.minResourceFee = BigInt(simulation.minResourceFee);
  }
  return fee;
}

function extractResources(
  tx: AssembledTransaction<unknown>,
): PreflightResourceEstimate | undefined {
  try {
    const resources = tx.simulationData.transactionData.resources();
    const footprint = resources.footprint();
    return {
      instructions: Number(resources.instructions()),
      readOnlyEntries: footprint.readOnly().length,
      readWriteEntries: footprint.readWrite().length,
    };
  } catch {
    return undefined;
  }
}

function failure<T>(
  operation: PreflightOperation,
  error: SubRosaPreflightError,
  fee?: PreflightFeeEstimate,
  resources?: PreflightResourceEstimate,
): PreflightResult<T> {
  return {
    ok: false,
    operation,
    error,
    ...(fee ? { fee } : {}),
    ...(resources ? { resources } : {}),
  };
}

export function classifyPreflightBuildError(
  operation: PreflightOperation,
  error: unknown,
): SubRosaPreflightError {
  if (error instanceof AssembledTransaction.Errors.SimulationFailed) {
    return new SubRosaPreflightError({
      kind: "simulation_error",
      operation,
      message: error.message,
      simulationError: error.message,
      cause: error,
    });
  }
  if (error instanceof AssembledTransaction.Errors.ExpiredState) {
    return new SubRosaPreflightError({
      kind: "expired_state",
      operation,
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof SubRosaPreflightError) {
    return error;
  }

  const message =
    error instanceof Error ? error.message : "RPC simulation request failed";
  return new SubRosaPreflightError({
    kind: "rpc_error",
    operation,
    message,
    cause: error,
  });
}

export function evaluatePreflight<T>(
  operation: PreflightOperation,
  tx: AssembledTransaction<Result<T>>,
): PreflightResult<T> {
  const simulation = tx.simulation;
  const fee = extractFee(tx, simulation);

  if (!simulation) {
    return failure(
      operation,
      new SubRosaPreflightError({
        kind: "malformed_response",
        operation,
        message:
          "Simulation response missing after transaction assembly; expected RPC simulateTransaction output",
      }),
      fee,
    );
  }

  if (rpc.Api.isSimulationError(simulation)) {
    return failure(
      operation,
      new SubRosaPreflightError({
        kind: "simulation_error",
        operation,
        message: simulation.error,
        simulationError: simulation.error,
      }),
      fee,
    );
  }

  if (rpc.Api.isSimulationRestore(simulation)) {
    return failure(
      operation,
      new SubRosaPreflightError({
        kind: "expired_state",
        operation,
        message:
          "Contract state must be restored before this call can succeed",
        restoreMinResourceFee: BigInt(
          simulation.restorePreamble.minResourceFee,
        ),
      }),
      fee,
      extractResources(tx),
    );
  }

  let parsed: Result<T>;
  try {
    parsed = tx.result;
  } catch (error) {
    return failure(
      operation,
      classifyPreflightBuildError(operation, error),
      fee,
    );
  }

  if (parsed.isErr()) {
    const contractErr = parsed.unwrapErr();
    return failure(
      operation,
      new SubRosaPreflightError({
        kind: "contract_error",
        operation,
        message: `Contract rejected call: ${contractErr.message}`,
        contractErrorCode: contractErrorCode(contractErr.message),
        contractErrorMessage: contractErr.message,
      }),
      fee,
      extractResources(tx),
    );
  }

  return {
    ok: true,
    operation,
    result: parsed.unwrap(),
    fee,
    resources: extractResources(tx),
  };
}
