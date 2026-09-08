// SPDX-License-Identifier: MIT
// SubRosaClient — a thin, ergonomic, spec-accurate wrapper over the generated
// Round contract bindings. Direct Soroban RPC is the default submission path;
// callers can optionally inject a submitter (for example OZ Relayer Channels)
// without changing contract call encoding. Argument encoding is delegated to the
// contract Spec embedded in the generated bindings, so the bytes on the wire are
// exactly what the contract expects.

import { Keypair, rpc } from "@stellar/stellar-sdk";
import type {
  AssembledTransaction,
  Result,
} from "@stellar/stellar-sdk/contract";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import {
  Client as RoundContract,
  type BidState,
  type BiddersPage,
  type ClearingRule,
  type GlobalConfig,
  type Round,
  type Seal,
} from "@sub-rosa/round-bindings";
import { toHex } from "@sub-rosa/tlock";
import type { SealedBid } from "@sub-rosa/tlock";
import type { RoundReceipt } from "./receipt.js";
import { validateEncryptedBlob } from "./encrypted-blob.js";
import { networkFingerprint } from "./receipt.js";
import type { TransactionSubmitter } from "./submitter.js";
import {
  evaluatePreflight,
  classifyPreflightBuildError,
  type PreflightOperation,
  type PreflightResult,
} from "./preflight.js";
import {
  SubRosaClientConfigError,
  SubRosaMissingReturnValueError,
  SubRosaNetworkMismatchError,
  SubRosaSubmitError,
  SubRosaTimeoutError,
  SubRosaTransactionError,
} from "./errors.js";
import { normalizeRoundId, normalizeSorobanContractId } from "./ids.js";
import { validateContractNetwork } from "./network.js";
import {
  resolveTimeContext,
  systemTime,
  type Clock,
  type PartialTimeContext,
  type Scheduler,
} from "@sub-rosa/time";

export interface SubRosaClientConfig {
  /** Soroban RPC endpoint, e.g. https://soroban-testnet.stellar.org */
  rpcUrl: string;
  /** Network passphrase the contract is deployed on. */
  networkPassphrase: string;
  /** Deployed Round contract id (C…). */
  contractId: string;
  /**
   * Secret key (S…) of the account that signs and pays for state-changing
   * calls. Required for create_round/commit/open_reveal/reveal/clear/settle/void.
   * Read-only calls (get_*) work without it.
   */
  secretKey?: string;
  /**
   * Public key (G…) used as the source for read-only simulation when no
   * `secretKey` is given. Ignored when `secretKey` is provided.
   */
  publicKey?: string;
  /** Allow http RPC URLs (e.g. a local quickstart node). Default: false. */
  allowHttp?: boolean;
  /** Optional external submitter. Direct Soroban RPC remains the default. */
  submitter?: TransactionSubmitter;
  /**
   * How long (ms) to poll RPC for transaction finality when using an external
   * submitter. Must be at least 1_000. Default: 60_000.
   */
  confirmTimeout?: number;
  /**
   * How long (ms) to wait between polling RPC for transaction status when
   * using an external submitter. Must be at least 100. Default: 1_500.
   */
  pollInterval?: number;
  /** Injectable wall clock and scheduler. Default: systemTime. */
  time?: PartialTimeContext;
  /**
   * @deprecated Use `time.scheduler.sleep` or inject `time`.
   * @internal Testing hook: override the poll-loop sleep function.
   */
  _sleep?: (ms: number) => Promise<void>;
  /**
   * @internal Testing hook: inject a mock Soroban RPC server for simulation.
   */
  _server?: rpc.Server;
}

export type ClearingRuleTag = ClearingRule["tag"];

export interface CreateRoundParams {
  /** sha256 (or any opaque 32-byte ref) of the off-chain item description. */
  itemRef: Uint8Array;
  /** Drand round R whose signature unseals the bids. */
  revealRound: number | bigint;
  /** Unix seconds; strictly before time(R). */
  commitDeadline: number | bigint;
  /** Unix seconds; after time(R). */
  revealDeadline: number | bigint;
  /** Auditor public key (selective disclosure) bidder identities seal to. */
  auditorPubkey: Uint8Array;
  /** Clearing rule. Default: HighestBid (first-price sealed-bid auction). */
  clearingRule?: ClearingRuleTag;
  /** Operator address. Default: the configured signer's public key. */
  operator?: string;
}

export interface CommitParams {
  roundId: number | bigint;
  /** The off-chain seal produced by @sub-rosa/tlock `sealBid`. */
  sealed: SealedBid;
  /** Public USDC budget locked now; upper bound on the sealed bid. */
  escrow: bigint;
  /** Bidder address. Default: the configured signer's public key. */
  bidder?: string;
}

export interface RevealParams {
  roundId: number | bigint;
  /** The address the bid was committed under. */
  bidder: string;
  /** The plaintext value revealed from the seal. */
  value: bigint;
  /** The 32-byte nonce revealed from the seal. */
  nonce: Uint8Array;
}

const toBigInt = (v: number | bigint): bigint =>
  typeof v === "bigint" ? v : BigInt(v);

const toBuffer = (b: Uint8Array): Buffer => Buffer.from(b);

export class SubRosaClient {
  readonly contract: RoundContract;
  readonly contractId: string;
  readonly networkPassphrase: string;
  readonly #source?: string;
  readonly #rpcUrl: string;
  readonly #allowHttp: boolean;
  readonly #submitter?: TransactionSubmitter;
  readonly #confirmTimeout: number;
  readonly #pollInterval: number;
  readonly #clock: Clock;
  readonly #scheduler: Scheduler;
  readonly #server: rpc.Server;
  #networkValidation?: Promise<void>;

  constructor(config: SubRosaClientConfig) {
    const allowHttp = config.allowHttp ?? false;
    if (/^http:\/\//i.test(config.rpcUrl) && !allowHttp) {
      throw new SubRosaClientConfigError(
        "rpcUrl must use https unless allowHttp is explicitly enabled",
      );
    }

    const confirmTimeout = config.confirmTimeout ?? 60_000;
    if (!Number.isFinite(confirmTimeout) || confirmTimeout < 1_000) {
      throw new SubRosaClientConfigError(
        `confirmTimeout must be a finite number at least 1000ms, got ${confirmTimeout}`,
      );
    }

    const pollInterval = config.pollInterval ?? 1_500;
    if (!Number.isFinite(pollInterval) || pollInterval < 100) {
      throw new SubRosaClientConfigError(
        `pollInterval must be a finite number at least 100ms, got ${pollInterval}`,
      );
    }

    const keypair = config.secretKey
      ? Keypair.fromSecret(config.secretKey)
      : undefined;
    const source = keypair?.publicKey() ?? config.publicKey;
    const signer = keypair
      ? basicNodeSigner(keypair, config.networkPassphrase)
      : undefined;

    this.contractId = normalizeSorobanContractId(config.contractId);
    this.networkPassphrase = config.networkPassphrase;
    this.#source = source;
    this.#rpcUrl = config.rpcUrl;
    this.#allowHttp = allowHttp;
    this.#submitter = config.submitter;
    this.#confirmTimeout = confirmTimeout;
    this.#pollInterval = pollInterval;
    const time = resolveTimeContext(systemTime, config.time);
    this.#clock = time.clock;
    this.#scheduler = time.scheduler;
    this.#server = config._server ?? new rpc.Server(config.rpcUrl, { allowHttp });
    if (config._sleep) this.#sleep = config._sleep;
    else this.#sleep = (ms) => this.#scheduler.sleep(ms);
    this.contract = new RoundContract({
      contractId: this.contractId,
      networkPassphrase: config.networkPassphrase,
      rpcUrl: config.rpcUrl,
      allowHttp,
      ...(source ? { publicKey: source } : {}),
      ...(signer ? { signTransaction: signer.signTransaction } : {}),
      server: this.#server,
    });
  }

  /** The contract Spec embedded in the bindings — the single source of truth
   *  for argument/return encoding. Exposed for offline encoding checks. */
  get spec() {
    return this.contract.spec;
  }

  #requireSource(role: string): string {
    if (!this.#source) {
      throw new SubRosaClientConfigError(
        `a secretKey (or publicKey) is required to use it as the ${role}`,
      );
    }
    return this.#source;
  }

  async #validatedContractCall<T>(build: () => Promise<T>): Promise<T> {
    if (!this.#networkValidation) {
      this.#networkValidation = validateContractNetwork(this.#server, {
        networkPassphrase: this.networkPassphrase,
        contractId: this.contractId,
        rpcUrl: this.#rpcUrl,
      }).catch((error: unknown) => {
        this.#networkValidation = undefined;
        throw error;
      });
    }
    await this.#networkValidation;
    return build();
  }

  async #sendUnwrap<T>(tx: AssembledTransaction<Result<T>>): Promise<T> {
    if (!this.#submitter) {
      try {
        const sent = await tx.signAndSend();
        return sent.result.unwrap();
      } catch (e) {
        throw new SubRosaSubmitError("direct RPC submission failed", { cause: e });
      }
    }

    await tx.sign();
    if (!tx.signed) throw new SubRosaSubmitError("transaction was not signed");
    let submitted;
    try {
      submitted = await this.#submitter.submitSignedTransaction({
        signedTransactionXdr: tx.signed.toXDR(),
        contractId: this.contractId,
        networkPassphrase: this.networkPassphrase,
        rpcUrl: this.#rpcUrl,
      });
    } catch (e) {
      throw new SubRosaSubmitError(
        `${this.#submitter.name} failed to submit transaction`,
        { cause: e },
      );
    }
    const server = new rpc.Server(this.#rpcUrl, { allowHttp: this.#allowHttp });
    const deadline = this.#clock.nowMs() + this.#confirmTimeout;
    let lastStatus = "NOT_FOUND";
    while (this.#clock.nowMs() < deadline) {
      let res;
      try {
        res = await server.getTransaction(submitted.hash);
      } catch (e) {
        throw new SubRosaSubmitError(
          `RPC getTransaction failed for ${submitted.hash}`,
          { cause: e },
        );
      }
      lastStatus = res.status;
      if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        if (!("returnValue" in res) || !res.returnValue) {
          throw new SubRosaMissingReturnValueError(submitted.hash);
        }
        return tx.options.parseResultXdr(res.returnValue).unwrap();
      }
      if (res.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) {
        throw new SubRosaTransactionError(submitted.hash, res.status);
      }
      await this.#sleep(this.#pollInterval);
    }
    throw new SubRosaTimeoutError({
      hash: submitted.hash,
      submitter: this.#submitter.name,
      lastStatus,
      timeoutMs: this.#confirmTimeout,
      pollIntervalMs: this.#pollInterval,
    });
  }

  #sleep: (ms: number) => Promise<void> = (ms) => this.#scheduler.sleep(ms);

  // ── State-changing calls (sign + submit over RPC) ──────────────────────

  async createRound(params: CreateRoundParams): Promise<bigint> {
    const operator = params.operator ?? this.#requireSource("operator");
    const clearing_rule = {
      tag: params.clearingRule ?? "HighestBid",
      values: undefined,
    } as ClearingRule;
    const tx = await this.#validatedContractCall(() =>
      this.contract.create_round({
        operator,
        item_ref: toBuffer(params.itemRef),
        reveal_round: toBigInt(params.revealRound),
        clearing_rule,
        commit_deadline: toBigInt(params.commitDeadline),
        reveal_deadline: toBigInt(params.revealDeadline),
        auditor_pubkey: toBuffer(params.auditorPubkey),
      }),
    );
    return this.#sendUnwrap(tx);
  }

  async commit(params: CommitParams): Promise<void> {
    // Validate encrypted blobs before submitting — catches size/encoding
    // issues early, before paying gas for an on-chain revert (PayloadTooLarge).
    const ciphertextResult = validateEncryptedBlob(
      params.sealed.ciphertext,
      "ciphertext",
    );
    if (!ciphertextResult.valid) {
      throw new SubRosaClientConfigError(
        ciphertextResult.issues.map((i) => i.message).join("; "),
      );
    }
    const auditorBlobResult = validateEncryptedBlob(
      params.sealed.auditorBlob,
      "auditor_blob",
    );
    if (!auditorBlobResult.valid) {
      throw new SubRosaClientConfigError(
        auditorBlobResult.issues.map((i) => i.message).join("; "),
      );
    }

    const bidder = params.bidder ?? this.#requireSource("bidder");
    const tx = await this.#validatedContractCall(() =>
      this.contract.commit({
        round_id: normalizeRoundId(params.roundId),
        bidder,
        commitment: toBuffer(params.sealed.commitment),
        ciphertext: toBuffer(params.sealed.ciphertext),
        escrow: params.escrow,
        auditor_blob: toBuffer(params.sealed.auditorBlob),
      }),
    );
    await this.#sendUnwrap(tx);
  }

  async openReveal(
    roundId: number | bigint,
    drandSignature: Uint8Array,
  ): Promise<void> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.open_reveal({
        round_id: normalizeRoundId(roundId),
        drand_signature: toBuffer(drandSignature),
      }),
    );
    await this.#sendUnwrap(tx);
  }

  async reveal(params: RevealParams): Promise<void> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.reveal({
        round_id: normalizeRoundId(params.roundId),
        bidder: params.bidder,
        value: params.value,
        nonce: toBuffer(params.nonce),
      }),
    );
    await this.#sendUnwrap(tx);
  }

  /** Clear a round. Returns the winning address, or undefined if the round was
   *  voided for having no valid bids. */
  async clear(roundId: number | bigint): Promise<string | undefined> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.clear({ round_id: normalizeRoundId(roundId) }),
    );
    const winner = await this.#sendUnwrap(tx);
    return winner ?? undefined;
  }

  async settle(roundId: number | bigint): Promise<void> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.settle({ round_id: normalizeRoundId(roundId) }),
    );
    await this.#sendUnwrap(tx);
  }

  async void(roundId: number | bigint): Promise<void> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.void({ round_id: normalizeRoundId(roundId) }),
    );
    await this.#sendUnwrap(tx);
  }

  // ── Preflight simulation (no signing/submission) ─────────────────────

  async #preflight<T>(
    operation: PreflightOperation,
    buildTx: () => Promise<AssembledTransaction<Result<T>>>,
  ): Promise<PreflightResult<T>> {
    try {
      const tx = await buildTx();
      return evaluatePreflight(operation, tx);
    } catch (error) {
      if (
        error instanceof SubRosaClientConfigError ||
        error instanceof SubRosaNetworkMismatchError
      ) {
        throw error;
      }
      return {
        ok: false,
        operation,
        error: classifyPreflightBuildError(operation, error),
      };
    }
  }

  /** Simulate `createRound` without signing or submitting. */
  preflightCreateRound(params: CreateRoundParams): Promise<PreflightResult<bigint>> {
    return this.#preflight("create_round", () => {
      const operator = params.operator ?? this.#requireSource("operator");
      const clearing_rule = {
        tag: params.clearingRule ?? "HighestBid",
        values: undefined,
      } as ClearingRule;
      return this.#validatedContractCall(() =>
        this.contract.create_round({
          operator,
          item_ref: toBuffer(params.itemRef),
          reveal_round: toBigInt(params.revealRound),
          clearing_rule,
          commit_deadline: toBigInt(params.commitDeadline),
          reveal_deadline: toBigInt(params.revealDeadline),
          auditor_pubkey: toBuffer(params.auditorPubkey),
        }),
      );
    });
  }

  /** Simulate `commit` without signing or submitting. */
  preflightCommit(params: CommitParams): Promise<PreflightResult<void>> {
    return this.#preflight("commit", () => {
      const bidder = params.bidder ?? this.#requireSource("bidder");
      return this.#validatedContractCall(() =>
        this.contract.commit({
          round_id: toBigInt(params.roundId),
          bidder,
          commitment: toBuffer(params.sealed.commitment),
          ciphertext: toBuffer(params.sealed.ciphertext),
          escrow: params.escrow,
          auditor_blob: toBuffer(params.sealed.auditorBlob),
        }),
      );
    });
  }

  /** Simulate `openReveal` without signing or submitting. */
  preflightOpenReveal(
    roundId: number | bigint,
    drandSignature: Uint8Array,
  ): Promise<PreflightResult<void>> {
    return this.#preflight("open_reveal", () =>
      this.#validatedContractCall(() =>
        this.contract.open_reveal({
          round_id: toBigInt(roundId),
          drand_signature: toBuffer(drandSignature),
        }),
      ),
    );
  }

  /** Simulate `reveal` without signing or submitting. */
  preflightReveal(params: RevealParams): Promise<PreflightResult<void>> {
    return this.#preflight("reveal", () =>
      this.#validatedContractCall(() =>
        this.contract.reveal({
          round_id: toBigInt(params.roundId),
          bidder: params.bidder,
          value: params.value,
          nonce: toBuffer(params.nonce),
        }),
      ),
    );
  }

  /** Simulate `clear` without signing or submitting. */
  async preflightClear(
    roundId: number | bigint,
  ): Promise<PreflightResult<string | undefined>> {
    const result = await this.#preflight<string | null | undefined>("clear", () =>
      this.#validatedContractCall(() =>
        this.contract.clear({ round_id: toBigInt(roundId) }),
      ),
    );
    if (!result.ok) {
      return result;
    }
    return {
      ...result,
      result: result.result ?? undefined,
    };
  }

  /** Simulate `settle` without signing or submitting. */
  preflightSettle(roundId: number | bigint): Promise<PreflightResult<void>> {
    return this.#preflight("settle", () =>
      this.#validatedContractCall(() =>
        this.contract.settle({ round_id: toBigInt(roundId) }),
      ),
    );
  }

  /** Simulate `void` without signing or submitting. */
  preflightVoid(roundId: number | bigint): Promise<PreflightResult<void>> {
    return this.#preflight("void", () =>
      this.#validatedContractCall(() =>
        this.contract.void({ round_id: toBigInt(roundId) }),
      ),
    );
  }

  // ── Read-only views (simulation only; no signing/submission) ───────────

  async getRound(roundId: number | bigint): Promise<Round> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_round({ round_id: normalizeRoundId(roundId) }),
    );
    return tx.result.unwrap();
  }

  async getBidState(
    roundId: number | bigint,
    bidder: string,
  ): Promise<BidState> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_bid_state({
        round_id: normalizeRoundId(roundId),
        bidder,
      }),
    );
    return tx.result.unwrap();
  }

  /** The deterministic, ordered bidder index — the keeper's reveal set. Reading
   *  this is how the keeper knows exactly which seals to open and reveal. */
  async getBidders(roundId: number | bigint): Promise<string[]> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_bidders({ round_id: normalizeRoundId(roundId) }),
    );
    return tx.result.unwrap();
  }

  /** Fetch a single page of bidders. Zero-based cursor; next_cursor = 0 means
   *  no more pages. Limit must be 1-100. */
  async getBiddersPage(
    roundId: number | bigint,
    cursor: number,
    limit: number,
  ): Promise<BiddersPage> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_bidders_page({
        round_id: normalizeRoundId(roundId),
        cursor,
        limit,
      }),
    );
    return tx.result.unwrap();
  }

  /** Async generator that lazily pages through all bidders for a round.
   *  Fetches one page at a time, yielding each bidder individually. */
  async *bidders(roundId: number | bigint): AsyncGenerator<string> {
    let cursor = 0;
    const PAGE_SIZE = 100;
    do {
      const page = await this.getBiddersPage(roundId, cursor, PAGE_SIZE);
      for (const addr of page.data) yield addr;
      cursor = page.next_cursor;
    } while (cursor !== 0);
  }

  /** The sealed payload while it is still in Temporary storage; undefined once
   *  its TTL expires (by design shortly after the reveal window). Persistent
   *  bid state from `getBidState` remains for settlement either way. Seal TTL
   *  is extended on commit, when reveal opens, and on each observer read. */
  async getSeal(
    roundId: number | bigint,
    bidder: string,
  ): Promise<Seal | undefined> {
    const tx = await this.#validatedContractCall(() =>
      this.contract.get_seal({
        round_id: normalizeRoundId(roundId),
        bidder,
      }),
    );
    return tx.result ?? undefined;
  }

  async getConfig(): Promise<GlobalConfig> {
    const tx = await this.#validatedContractCall(() => this.contract.get_config());
    return tx.result.unwrap();
  }

  /** Export a versioned canonical receipt for a round. Collects all on-chain
   *  state — round params, bidders, commitments, reveal validity, seal evidence
   *  (may be null if expired) — into a single portable document. */
  async exportReceipt(roundId: number | bigint): Promise<RoundReceipt> {
    const rid = normalizeRoundId(roundId);
    const [round, config] = await Promise.all([
      this.getRound(rid),
      this.getConfig(),
    ]);

    const bidders: string[] = [];
    for await (const addr of this.bidders(rid)) bidders.push(addr);

    const bids: RoundReceipt["bids"] = {};
    for (const bidder of bidders) {
      const [state, seal] = await Promise.all([
        this.getBidState(rid, bidder),
        this.getSeal(rid, bidder),
      ]);
      const commitment = toHex(state.commitment);
      // The nonce is now persisted on-chain at reveal time (revealed_nonce),
      // enabling offline receipt verifiers to recompute sha256(be16(value)‖nonce).
      const nonce = state.revealed_nonce ? toHex(state.revealed_nonce) : null;
      bids[bidder] = {
        commitment,
        escrow: state.escrow.toString(),
        revealedValue: state.revealed_value?.toString() ?? null,
        nonce,
        hashValid: null,
        valid: state.valid,
        settled: state.settled,
        evidence: {
          ciphertext: seal ? toHex(seal.ciphertext) : null,
          auditorBlob: seal ? toHex(seal.auditor_blob) : null,
        },
      };
    }

    return {
      version: 1,
      network: this.networkPassphrase,
      networkFingerprint: networkFingerprint(this.networkPassphrase),
      contractId: this.contractId,
      exportedAt: this.#clock.toISOString(),
      roundId: rid.toString(),
      itemRef: toHex(round.item_ref),
      revealRound: Number(round.reveal_round),
      clearingRule: round.clearing_rule.tag,
      commitDeadline: round.commit_deadline.toString(),
      revealDeadline: round.reveal_deadline.toString(),
      operator: round.operator,
      auditorPubkey: toHex(round.auditor_pubkey),
      bidders,
      bids,
      winner: round.winner ?? null,
      winningValue: round.winning_bid?.toString() ?? null,
      status: round.status.tag,
    };
  }
}
