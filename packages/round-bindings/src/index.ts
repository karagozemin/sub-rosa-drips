import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





/**
 * Per-bid ephemeral sealed payload (Temporary). Auto-expires after the reveal
 * window; the auto-expiry is the design, not a workaround (PRD §8).
 */
export interface Seal {
  /**
 * enc(bidder_identity, auditor_pubkey) — readable only by the auditor.
 */
auditor_blob: Buffer;
  /**
 * C = tlock_encrypt(be16(value) ‖ nonce, drand_pubkey, R).
 */
ciphertext: Buffer;
}

/**
 * Contract error codes. Every failure state from the PRD has a defined code —
 * there is no undefined behavior and no silent fallback.
 */
export const Errors = {
  1: {message:"NotInitialized"},
  2: {message:"AlreadyInitialized"},
  3: {message:"RoundNotFound"},
  4: {message:"BidNotFound"},
  10: {message:"CommitClosed"},
  11: {message:"CommitNotClosed"},
  12: {message:"CommitDeadlineAfterReveal"},
  13: {message:"RevealNotOpen"},
  14: {message:"RevealAlreadyOpen"},
  15: {message:"RevealWindowClosed"},
  16: {message:"RevealStillOpen"},
  17: {message:"NotCleared"},
  18: {message:"AlreadyCleared"},
  19: {message:"AlreadySettled"},
  20: {message:"RoundVoided"},
  21: {message:"NotVoidable"},
  22: {message:"WrongStatus"},
  30: {message:"InvalidDrandSignature"},
  31: {message:"HashMismatch"},
  32: {message:"AlreadyRevealed"},
  33: {message:"PayloadTooLarge"},
  34: {message:"InvalidAmount"},
  35: {message:"BidExceedsEscrow"},
  36: {message:"DeadlineInPast"},
  37: {message:"NoValidBids"},
  38: {message:"RoundFull"},
  39: {message:"InvalidLimit"}
}


/**
 * Per-round record (Persistent). Survives until the round is explicitly closed.
 */
export interface Round {
  /**
 * Public key bidder-identity blobs are encrypted to (selective disclosure).
 */
auditor_pubkey: Buffer;
  bidders: Array<string>;
  clearing_rule: ClearingRule;
  /**
 * Unix seconds. Must be strictly before time(R).
 */
commit_deadline: u64;
  /**
 * Opaque reference to the item / allocation being decided (hash of an
 * off-chain description). The contract is agnostic to its meaning.
 */
item_ref: Buffer;
  operator: string;
  /**
 * Unix seconds. Reveal window closes here; must be after time(R).
 */
reveal_deadline: u64;
  /**
 * Drand round number R whose threshold signature unseals the bids.
 */
reveal_round: u64;
  status: Status;
  winner: Option<string>;
  winning_bid: i128;
}

/**
 * Round lifecycle. Mirrors the state machine in PRD §6.
 */
export type Status = {tag: "Open", values: void} | {tag: "Revealing", values: void} | {tag: "Cleared", values: void} | {tag: "Settled", values: void} | {tag: "Voided", values: void};

export type DataKey = {tag: "Config", values: void} | {tag: "RoundCounter", values: void} | {tag: "Round", values: readonly [u64]} | {tag: "State", values: readonly [u64, string]} | {tag: "Seal", values: readonly [u64, string]};


/**
 * Per-bid durable state (Persistent). Holds everything required to clear and
 * settle / refund safely, even if the ephemeral ciphertext has expired.
 */
export interface BidState {
  /**
 * H = sha256(be16(value) ‖ nonce) — binds the sealed bid.
 */
commitment: Buffer;
  /**
 * Public USDC budget locked at commit; upper bound on the sealed bid.
 */
escrow: i128;
  /**
 * The 32-byte nonce used in the commitment. Persisted at reveal time so
 * that offline receipt verifiers can recompute sha256(be16(value)‖nonce)
 * without trusting the exporter.
 */
revealed_nonce: Option<Buffer>;
  revealed_value: Option<i128>;
  settled: boolean;
  valid: boolean;
}


/**
 * A page of bidders for a round, with continuation metadata.
 */
export interface BiddersPage {
  /**
 * Page of bidder addresses.
 */
data: Array<string>;
  /**
 * Cursor for the next page (0 if no more pages).
 */
next_cursor: u32;
  /**
 * Total number of bidders in the round.
 */
total: u32;
}

/**
 * Deterministic clearing rule. Default is a first-price sealed-bid auction
 * (highest valid revealed bid wins).
 */
export type ClearingRule = {tag: "HighestBid", values: void} | {tag: "LowestBid", values: void};


/**
 * Contract-global configuration, set once at deploy in Instance storage.
 * 
 * All Drand parameters are supplied at deploy time (validated against a live
 * quicknet round before deploy) so the source carries no guessed constants.
 * `drand_pubkey` and `g2_neg_generator` are uncompressed BLS12-381 G2 points
 * (192 bytes each) in Soroban host serialization. `dst` is the RFC 9380
 * domain separation tag for the configured Drand scheme.
 */
export interface GlobalConfig {
  drand_genesis: u64;
  drand_period: u64;
  drand_pubkey: Buffer;
  dst: Buffer;
  g2_neg_generator: Buffer;
  usdc: string;
}

export interface Client {
  /**
   * Construct and simulate a void transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Liveness safety valve: if Drand round R is never produced (network stall)
   * and the grace window after the reveal deadline has passed without the
   * round opening, anyone can void it and all escrow is refunded.
   */
  void: ({round_id}: {round_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a clear transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deterministically compute the winner after the reveal deadline. If no
   * valid bid was revealed, the round is voided and all escrow becomes
   * refundable.
   */
  clear: ({round_id}: {round_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Option<string>>>>

  /**
   * Construct and simulate a commit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Submit (or overwrite, before the deadline) a sealed bid and lock escrow.
   * 
   * - `commitment` H binds the bid; checked at reveal.
   * - `ciphertext` C is the timelock seal; guarantees forced reveal.
   * - `escrow` is a public USDC budget and an upper bound on the sealed bid;
   * locked now so the winner can always pay.
   * - `auditor_blob` is the bidder identity encrypted to the auditor key.
   */
  commit: ({round_id, bidder, commitment, ciphertext, escrow, auditor_blob}: {round_id: u64, bidder: string, commitment: Buffer, ciphertext: Buffer, escrow: i128, auditor_blob: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a reveal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reveal a bid. Permissionless: once R's signature is public, anyone can
   * decrypt any ciphertext and submit the reveal — so no bidder can abort.
   * The contract checks `sha256(be16(value) ‖ nonce) == H`.
   */
  reveal: ({round_id, bidder, value, nonce}: {round_id: u64, bidder: string, value: i128, nonce: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a settle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Settle a cleared round. The winner pays their bid from escrow to the
   * operator; the winner's surplus and every loser's escrow are refunded.
   * Cannot fail for lack of funds — everything was escrowed at commit.
   */
  settle: ({round_id}: {round_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_seal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Observer view: the sealed ciphertext + auditor blob while still in
   * Temporary storage. Returns `None` once the seal TTL has expired (by design
   * after the reveal window). Persistent bid state remains for settlement.
   */
  get_seal: ({round_id, bidder}: {round_id: u64, bidder: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Seal>>>

  /**
   * Construct and simulate a get_round transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_round: ({round_id}: {round_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Round>>>

  /**
   * Construct and simulate a get_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<GlobalConfig>>>

  /**
   * Construct and simulate a get_bidders transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Keeper view: the deterministic, ordered bidder index for a round. The
   * keeper reads this to learn exactly which seals must be opened and
   * revealed — the reveal set is on-chain state, so no event scraping or
   * indexer is required and nothing can be missed.
   */
  get_bidders: ({round_id}: {round_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Array<string>>>>

  /**
   * Construct and simulate a open_reveal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Open the reveal window by proving Drand round R has been produced.
   * 
   * The supplied signature is verified on-chain via BLS12-381. This is the
   * only way to move a round into `Revealing`; there is no operator override.
   */
  open_reveal: ({round_id, drand_signature}: {round_id: u64, drand_signature: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_round transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Open a new sealed round. Permissionless: anyone can be an operator, and
   * the operator gets no special read power — that is the point.
   */
  create_round: ({operator, item_ref, reveal_round, clearing_rule, commit_deadline, reveal_deadline, auditor_pubkey}: {operator: string, item_ref: Buffer, reveal_round: u64, clearing_rule: ClearingRule, commit_deadline: u64, reveal_deadline: u64, auditor_pubkey: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a get_bid_state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_bid_state: ({round_id, bidder}: {round_id: u64, bidder: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<BidState>>>

  /**
   * Construct and simulate a get_bidders_page transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Paginated bidder index for a round. Returns a page of bidders starting
   * at `cursor` (zero-based), with continuation metadata.
   * 
   * `limit` must be 1–100. `next_cursor` in the response is 0 when there
   * are no more pages.
   */
  get_bidders_page: ({round_id, cursor, limit}: {round_id: u64, cursor: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<BiddersPage>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {drand_pubkey, g2_neg_generator, dst, drand_genesis, drand_period, usdc}: {drand_pubkey: Buffer, g2_neg_generator: Buffer, dst: Buffer, drand_genesis: u64, drand_period: u64, usdc: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({drand_pubkey, g2_neg_generator, dst, drand_genesis, drand_period, usdc}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAM1MaXZlbmVzcyBzYWZldHkgdmFsdmU6IGlmIERyYW5kIHJvdW5kIFIgaXMgbmV2ZXIgcHJvZHVjZWQgKG5ldHdvcmsgc3RhbGwpCmFuZCB0aGUgZ3JhY2Ugd2luZG93IGFmdGVyIHRoZSByZXZlYWwgZGVhZGxpbmUgaGFzIHBhc3NlZCB3aXRob3V0IHRoZQpyb3VuZCBvcGVuaW5nLCBhbnlvbmUgY2FuIHZvaWQgaXQgYW5kIGFsbCBlc2Nyb3cgaXMgcmVmdW5kZWQuAAAAAAAABHZvaWQAAAABAAAAAAAAAAhyb3VuZF9pZAAAAAYAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAJREZXRlcm1pbmlzdGljYWxseSBjb21wdXRlIHRoZSB3aW5uZXIgYWZ0ZXIgdGhlIHJldmVhbCBkZWFkbGluZS4gSWYgbm8KdmFsaWQgYmlkIHdhcyByZXZlYWxlZCwgdGhlIHJvdW5kIGlzIHZvaWRlZCBhbmQgYWxsIGVzY3JvdyBiZWNvbWVzCnJlZnVuZGFibGUuAAAABWNsZWFyAAAAAAAAAQAAAAAAAAAIcm91bmRfaWQAAAAGAAAAAQAAA+kAAAPoAAAAEwAAAAM=",
        "AAAAAAAAAXVTdWJtaXQgKG9yIG92ZXJ3cml0ZSwgYmVmb3JlIHRoZSBkZWFkbGluZSkgYSBzZWFsZWQgYmlkIGFuZCBsb2NrIGVzY3Jvdy4KCi0gYGNvbW1pdG1lbnRgIEggYmluZHMgdGhlIGJpZDsgY2hlY2tlZCBhdCByZXZlYWwuCi0gYGNpcGhlcnRleHRgIEMgaXMgdGhlIHRpbWVsb2NrIHNlYWw7IGd1YXJhbnRlZXMgZm9yY2VkIHJldmVhbC4KLSBgZXNjcm93YCBpcyBhIHB1YmxpYyBVU0RDIGJ1ZGdldCBhbmQgYW4gdXBwZXIgYm91bmQgb24gdGhlIHNlYWxlZCBiaWQ7CmxvY2tlZCBub3cgc28gdGhlIHdpbm5lciBjYW4gYWx3YXlzIHBheS4KLSBgYXVkaXRvcl9ibG9iYCBpcyB0aGUgYmlkZGVyIGlkZW50aXR5IGVuY3J5cHRlZCB0byB0aGUgYXVkaXRvciBrZXkuAAAAAAAABmNvbW1pdAAAAAAABgAAAAAAAAAIcm91bmRfaWQAAAAGAAAAAAAAAAZiaWRkZXIAAAAAABMAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAAAAAApjaXBoZXJ0ZXh0AAAAAAAOAAAAAAAAAAZlc2Nyb3cAAAAAAAsAAAAAAAAADGF1ZGl0b3JfYmxvYgAAAA4AAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAMlSZXZlYWwgYSBiaWQuIFBlcm1pc3Npb25sZXNzOiBvbmNlIFIncyBzaWduYXR1cmUgaXMgcHVibGljLCBhbnlvbmUgY2FuCmRlY3J5cHQgYW55IGNpcGhlcnRleHQgYW5kIHN1Ym1pdCB0aGUgcmV2ZWFsIOKAlCBzbyBubyBiaWRkZXIgY2FuIGFib3J0LgpUaGUgY29udHJhY3QgY2hlY2tzIGBzaGEyNTYoYmUxNih2YWx1ZSkg4oCWIG5vbmNlKSA9PSBIYC4AAAAAAAAGcmV2ZWFsAAAAAAAEAAAAAAAAAAhyb3VuZF9pZAAAAAYAAAAAAAAABmJpZGRlcgAAAAAAEwAAAAAAAAAFdmFsdWUAAAAAAAALAAAAAAAAAAVub25jZQAAAAAAA+4AAAAgAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAM9TZXR0bGUgYSBjbGVhcmVkIHJvdW5kLiBUaGUgd2lubmVyIHBheXMgdGhlaXIgYmlkIGZyb20gZXNjcm93IHRvIHRoZQpvcGVyYXRvcjsgdGhlIHdpbm5lcidzIHN1cnBsdXMgYW5kIGV2ZXJ5IGxvc2VyJ3MgZXNjcm93IGFyZSByZWZ1bmRlZC4KQ2Fubm90IGZhaWwgZm9yIGxhY2sgb2YgZnVuZHMg4oCUIGV2ZXJ5dGhpbmcgd2FzIGVzY3Jvd2VkIGF0IGNvbW1pdC4AAAAABnNldHRsZQAAAAAAAQAAAAAAAAAIcm91bmRfaWQAAAAGAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAANRPYnNlcnZlciB2aWV3OiB0aGUgc2VhbGVkIGNpcGhlcnRleHQgKyBhdWRpdG9yIGJsb2Igd2hpbGUgc3RpbGwgaW4KVGVtcG9yYXJ5IHN0b3JhZ2UuIFJldHVybnMgYE5vbmVgIG9uY2UgdGhlIHNlYWwgVFRMIGhhcyBleHBpcmVkIChieSBkZXNpZ24KYWZ0ZXIgdGhlIHJldmVhbCB3aW5kb3cpLiBQZXJzaXN0ZW50IGJpZCBzdGF0ZSByZW1haW5zIGZvciBzZXR0bGVtZW50LgAAAAhnZXRfc2VhbAAAAAIAAAAAAAAACHJvdW5kX2lkAAAABgAAAAAAAAAGYmlkZGVyAAAAAAATAAAAAQAAA+gAAAfQAAAABFNlYWw=",
        "AAAAAAAAAAAAAAAJZ2V0X3JvdW5kAAAAAAAAAQAAAAAAAAAIcm91bmRfaWQAAAAGAAAAAQAAA+kAAAfQAAAABVJvdW5kAAAAAAAAAw==",
        "AAAAAAAAAAAAAAAKZ2V0X2NvbmZpZwAAAAAAAAAAAAEAAAPpAAAH0AAAAAxHbG9iYWxDb25maWcAAAAD",
        "AAAAAAAAAP1LZWVwZXIgdmlldzogdGhlIGRldGVybWluaXN0aWMsIG9yZGVyZWQgYmlkZGVyIGluZGV4IGZvciBhIHJvdW5kLiBUaGUKa2VlcGVyIHJlYWRzIHRoaXMgdG8gbGVhcm4gZXhhY3RseSB3aGljaCBzZWFscyBtdXN0IGJlIG9wZW5lZCBhbmQKcmV2ZWFsZWQg4oCUIHRoZSByZXZlYWwgc2V0IGlzIG9uLWNoYWluIHN0YXRlLCBzbyBubyBldmVudCBzY3JhcGluZyBvcgppbmRleGVyIGlzIHJlcXVpcmVkIGFuZCBub3RoaW5nIGNhbiBiZSBtaXNzZWQuAAAAAAAAC2dldF9iaWRkZXJzAAAAAAEAAAAAAAAACHJvdW5kX2lkAAAABgAAAAEAAAPpAAAD6gAAABMAAAAD",
        "AAAAAAAAANRPcGVuIHRoZSByZXZlYWwgd2luZG93IGJ5IHByb3ZpbmcgRHJhbmQgcm91bmQgUiBoYXMgYmVlbiBwcm9kdWNlZC4KClRoZSBzdXBwbGllZCBzaWduYXR1cmUgaXMgdmVyaWZpZWQgb24tY2hhaW4gdmlhIEJMUzEyLTM4MS4gVGhpcyBpcyB0aGUKb25seSB3YXkgdG8gbW92ZSBhIHJvdW5kIGludG8gYFJldmVhbGluZ2A7IHRoZXJlIGlzIG5vIG9wZXJhdG9yIG92ZXJyaWRlLgAAAAtvcGVuX3JldmVhbAAAAAACAAAAAAAAAAhyb3VuZF9pZAAAAAYAAAAAAAAAD2RyYW5kX3NpZ25hdHVyZQAAAAPuAAAAYAAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAIZPcGVuIGEgbmV3IHNlYWxlZCByb3VuZC4gUGVybWlzc2lvbmxlc3M6IGFueW9uZSBjYW4gYmUgYW4gb3BlcmF0b3IsIGFuZAp0aGUgb3BlcmF0b3IgZ2V0cyBubyBzcGVjaWFsIHJlYWQgcG93ZXIg4oCUIHRoYXQgaXMgdGhlIHBvaW50LgAAAAAADGNyZWF0ZV9yb3VuZAAAAAcAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAAAAAAIaXRlbV9yZWYAAAPuAAAAIAAAAAAAAAAMcmV2ZWFsX3JvdW5kAAAABgAAAAAAAAANY2xlYXJpbmdfcnVsZQAAAAAAB9AAAAAMQ2xlYXJpbmdSdWxlAAAAAAAAAA9jb21taXRfZGVhZGxpbmUAAAAABgAAAAAAAAAPcmV2ZWFsX2RlYWRsaW5lAAAAAAYAAAAAAAAADmF1ZGl0b3JfcHVia2V5AAAAAAAOAAAAAQAAA+kAAAAGAAAAAw==",
        "AAAAAAAAAAAAAAANZ2V0X2JpZF9zdGF0ZQAAAAAAAAIAAAAAAAAACHJvdW5kX2lkAAAABgAAAAAAAAAGYmlkZGVyAAAAAAATAAAAAQAAA+kAAAfQAAAACEJpZFN0YXRlAAAAAw==",
        "AAAAAAAAAIVPbmUtdGltZSBkZXBsb3kgY29uZmlndXJhdGlvbi4gQWxsIERyYW5kIHBhcmFtZXRlcnMgYXJlIHN1cHBsaWVkIGJ5IHRoZQpkZXBsb3llciBmcm9tIHZhbHVlcyB2YWxpZGF0ZWQgYWdhaW5zdCBhIGxpdmUgcXVpY2tuZXQgcm91bmQuAAAAAAAADV9fY29uc3RydWN0b3IAAAAAAAAGAAAAAAAAAAxkcmFuZF9wdWJrZXkAAAPuAAAAwAAAAAAAAAAQZzJfbmVnX2dlbmVyYXRvcgAAA+4AAADAAAAAAAAAAANkc3QAAAAADgAAAAAAAAANZHJhbmRfZ2VuZXNpcwAAAAAAAAYAAAAAAAAADGRyYW5kX3BlcmlvZAAAAAYAAAAAAAAABHVzZGMAAAATAAAAAA==",
        "AAAAAAAAANdQYWdpbmF0ZWQgYmlkZGVyIGluZGV4IGZvciBhIHJvdW5kLiBSZXR1cm5zIGEgcGFnZSBvZiBiaWRkZXJzIHN0YXJ0aW5nCmF0IGBjdXJzb3JgICh6ZXJvLWJhc2VkKSwgd2l0aCBjb250aW51YXRpb24gbWV0YWRhdGEuCgpgbGltaXRgIG11c3QgYmUgMeKAkzEwMC4gYG5leHRfY3Vyc29yYCBpbiB0aGUgcmVzcG9uc2UgaXMgMCB3aGVuIHRoZXJlCmFyZSBubyBtb3JlIHBhZ2VzLgAAAAAQZ2V0X2JpZGRlcnNfcGFnZQAAAAMAAAAAAAAACHJvdW5kX2lkAAAABgAAAAAAAAAGY3Vyc29yAAAAAAAEAAAAAAAAAAVsaW1pdAAAAAAAAAQAAAABAAAD6QAAB9AAAAALQmlkZGVyc1BhZ2UAAAAAAw==",
        "AAAAAQAAAI5QZXItYmlkIGVwaGVtZXJhbCBzZWFsZWQgcGF5bG9hZCAoVGVtcG9yYXJ5KS4gQXV0by1leHBpcmVzIGFmdGVyIHRoZSByZXZlYWwKd2luZG93OyB0aGUgYXV0by1leHBpcnkgaXMgdGhlIGRlc2lnbiwgbm90IGEgd29ya2Fyb3VuZCAoUFJEIMKnOCkuAAAAAAAAAAAABFNlYWwAAAACAAAARmVuYyhiaWRkZXJfaWRlbnRpdHksIGF1ZGl0b3JfcHVia2V5KSDigJQgcmVhZGFibGUgb25seSBieSB0aGUgYXVkaXRvci4AAAAAAAxhdWRpdG9yX2Jsb2IAAAAOAAAAOkMgPSB0bG9ja19lbmNyeXB0KGJlMTYodmFsdWUpIOKAliBub25jZSwgZHJhbmRfcHVia2V5LCBSKS4AAAAAAApjaXBoZXJ0ZXh0AAAAAAAO",
        "AAAABAAAAIRDb250cmFjdCBlcnJvciBjb2Rlcy4gRXZlcnkgZmFpbHVyZSBzdGF0ZSBmcm9tIHRoZSBQUkQgaGFzIGEgZGVmaW5lZCBjb2RlIOKAlAp0aGVyZSBpcyBubyB1bmRlZmluZWQgYmVoYXZpb3IgYW5kIG5vIHNpbGVudCBmYWxsYmFjay4AAAAAAAAABUVycm9yAAAAAAAAGwAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAgAAAAAAAAANUm91bmROb3RGb3VuZAAAAAAAAAMAAAAAAAAAC0JpZE5vdEZvdW5kAAAAAAQAAAAAAAAADENvbW1pdENsb3NlZAAAAAoAAAAAAAAAD0NvbW1pdE5vdENsb3NlZAAAAAALAAAAAAAAABlDb21taXREZWFkbGluZUFmdGVyUmV2ZWFsAAAAAAAADAAAAAAAAAANUmV2ZWFsTm90T3BlbgAAAAAAAA0AAAAAAAAAEVJldmVhbEFscmVhZHlPcGVuAAAAAAAADgAAAAAAAAASUmV2ZWFsV2luZG93Q2xvc2VkAAAAAAAPAAAAAAAAAA9SZXZlYWxTdGlsbE9wZW4AAAAAEAAAAAAAAAAKTm90Q2xlYXJlZAAAAAAAEQAAAAAAAAAOQWxyZWFkeUNsZWFyZWQAAAAAABIAAAAAAAAADkFscmVhZHlTZXR0bGVkAAAAAAATAAAAAAAAAAtSb3VuZFZvaWRlZAAAAAAUAAAAAAAAAAtOb3RWb2lkYWJsZQAAAAAVAAAAAAAAAAtXcm9uZ1N0YXR1cwAAAAAWAAAAAAAAABVJbnZhbGlkRHJhbmRTaWduYXR1cmUAAAAAAAAeAAAAAAAAAAxIYXNoTWlzbWF0Y2gAAAAfAAAAAAAAAA9BbHJlYWR5UmV2ZWFsZWQAAAAAIAAAAAAAAAAPUGF5bG9hZFRvb0xhcmdlAAAAACEAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAAiAAAAAAAAABBCaWRFeGNlZWRzRXNjcm93AAAAIwAAAAAAAAAORGVhZGxpbmVJblBhc3QAAAAAACQAAAAAAAAAC05vVmFsaWRCaWRzAAAAACUAAAAAAAAACVJvdW5kRnVsbAAAAAAAACYAAAAAAAAADEludmFsaWRMaW1pdAAAACc=",
        "AAAAAQAAAE1QZXItcm91bmQgcmVjb3JkIChQZXJzaXN0ZW50KS4gU3Vydml2ZXMgdW50aWwgdGhlIHJvdW5kIGlzIGV4cGxpY2l0bHkgY2xvc2VkLgAAAAAAAAAAAAAFUm91bmQAAAAAAAALAAAASVB1YmxpYyBrZXkgYmlkZGVyLWlkZW50aXR5IGJsb2JzIGFyZSBlbmNyeXB0ZWQgdG8gKHNlbGVjdGl2ZSBkaXNjbG9zdXJlKS4AAAAAAAAOYXVkaXRvcl9wdWJrZXkAAAAAAA4AAAAAAAAAB2JpZGRlcnMAAAAD6gAAABMAAAAAAAAADWNsZWFyaW5nX3J1bGUAAAAAAAfQAAAADENsZWFyaW5nUnVsZQAAAC5Vbml4IHNlY29uZHMuIE11c3QgYmUgc3RyaWN0bHkgYmVmb3JlIHRpbWUoUikuAAAAAAAPY29tbWl0X2RlYWRsaW5lAAAAAAYAAACET3BhcXVlIHJlZmVyZW5jZSB0byB0aGUgaXRlbSAvIGFsbG9jYXRpb24gYmVpbmcgZGVjaWRlZCAoaGFzaCBvZiBhbgpvZmYtY2hhaW4gZGVzY3JpcHRpb24pLiBUaGUgY29udHJhY3QgaXMgYWdub3N0aWMgdG8gaXRzIG1lYW5pbmcuAAAACGl0ZW1fcmVmAAAD7gAAACAAAAAAAAAACG9wZXJhdG9yAAAAEwAAAD9Vbml4IHNlY29uZHMuIFJldmVhbCB3aW5kb3cgY2xvc2VzIGhlcmU7IG11c3QgYmUgYWZ0ZXIgdGltZShSKS4AAAAAD3JldmVhbF9kZWFkbGluZQAAAAAGAAAAQERyYW5kIHJvdW5kIG51bWJlciBSIHdob3NlIHRocmVzaG9sZCBzaWduYXR1cmUgdW5zZWFscyB0aGUgYmlkcy4AAAAMcmV2ZWFsX3JvdW5kAAAABgAAAAAAAAAGc3RhdHVzAAAAAAfQAAAABlN0YXR1cwAAAAAAAAAAAAZ3aW5uZXIAAAAAA+gAAAATAAAAAAAAAAt3aW5uaW5nX2JpZAAAAAAL",
        "AAAAAgAAADZSb3VuZCBsaWZlY3ljbGUuIE1pcnJvcnMgdGhlIHN0YXRlIG1hY2hpbmUgaW4gUFJEIMKnNi4AAAAAAAAAAAAGU3RhdHVzAAAAAAAFAAAAAAAAAAAAAAAET3BlbgAAAAAAAAAAAAAACVJldmVhbGluZwAAAAAAAAAAAAAAAAAAB0NsZWFyZWQAAAAAAAAAAAAAAAAHU2V0dGxlZAAAAAAAAAAAAAAAAAZWb2lkZWQAAA==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABQAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAAAAAAAAAAAMUm91bmRDb3VudGVyAAAAAQAAAAAAAAAFUm91bmQAAAAAAAABAAAABgAAAAEAAAAAAAAABVN0YXRlAAAAAAAAAgAAAAYAAAATAAAAAQAAAAAAAAAEU2VhbAAAAAIAAAAGAAAAEw==",
        "AAAAAQAAAJBQZXItYmlkIGR1cmFibGUgc3RhdGUgKFBlcnNpc3RlbnQpLiBIb2xkcyBldmVyeXRoaW5nIHJlcXVpcmVkIHRvIGNsZWFyIGFuZApzZXR0bGUgLyByZWZ1bmQgc2FmZWx5LCBldmVuIGlmIHRoZSBlcGhlbWVyYWwgY2lwaGVydGV4dCBoYXMgZXhwaXJlZC4AAAAAAAAACEJpZFN0YXRlAAAABgAAADtIID0gc2hhMjU2KGJlMTYodmFsdWUpIOKAliBub25jZSkg4oCUIGJpbmRzIHRoZSBzZWFsZWQgYmlkLgAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAABDUHVibGljIFVTREMgYnVkZ2V0IGxvY2tlZCBhdCBjb21taXQ7IHVwcGVyIGJvdW5kIG9uIHRoZSBzZWFsZWQgYmlkLgAAAAAGZXNjcm93AAAAAAALAAAArVRoZSAzMi1ieXRlIG5vbmNlIHVzZWQgaW4gdGhlIGNvbW1pdG1lbnQuIFBlcnNpc3RlZCBhdCByZXZlYWwgdGltZSBzbwp0aGF0IG9mZmxpbmUgcmVjZWlwdCB2ZXJpZmllcnMgY2FuIHJlY29tcHV0ZSBzaGEyNTYoYmUxNih2YWx1ZSnigJZub25jZSkKd2l0aG91dCB0cnVzdGluZyB0aGUgZXhwb3J0ZXIuAAAAAAAADnJldmVhbGVkX25vbmNlAAAAAAPoAAAD7gAAACAAAAAAAAAADnJldmVhbGVkX3ZhbHVlAAAAAAPoAAAACwAAAAAAAAAHc2V0dGxlZAAAAAABAAAAAAAAAAV2YWxpZAAAAAAAAAE=",
        "AAAAAQAAADpBIHBhZ2Ugb2YgYmlkZGVycyBmb3IgYSByb3VuZCwgd2l0aCBjb250aW51YXRpb24gbWV0YWRhdGEuAAAAAAAAAAAAC0JpZGRlcnNQYWdlAAAAAAMAAAAZUGFnZSBvZiBiaWRkZXIgYWRkcmVzc2VzLgAAAAAAAARkYXRhAAAD6gAAABMAAAAuQ3Vyc29yIGZvciB0aGUgbmV4dCBwYWdlICgwIGlmIG5vIG1vcmUgcGFnZXMpLgAAAAAAC25leHRfY3Vyc29yAAAAAAQAAAAlVG90YWwgbnVtYmVyIG9mIGJpZGRlcnMgaW4gdGhlIHJvdW5kLgAAAAAAAAV0b3RhbAAAAAAAAAQ=",
        "AAAAAgAAAGtEZXRlcm1pbmlzdGljIGNsZWFyaW5nIHJ1bGUuIERlZmF1bHQgaXMgYSBmaXJzdC1wcmljZSBzZWFsZWQtYmlkIGF1Y3Rpb24KKGhpZ2hlc3QgdmFsaWQgcmV2ZWFsZWQgYmlkIHdpbnMpLgAAAAAAAAAADENsZWFyaW5nUnVsZQAAAAIAAAAAAAAAAAAAAApIaWdoZXN0QmlkAAAAAAAAAAAAAAAAAAlMb3dlc3RCaWQAAAA=",
        "AAAAAQAAAaRDb250cmFjdC1nbG9iYWwgY29uZmlndXJhdGlvbiwgc2V0IG9uY2UgYXQgZGVwbG95IGluIEluc3RhbmNlIHN0b3JhZ2UuCgpBbGwgRHJhbmQgcGFyYW1ldGVycyBhcmUgc3VwcGxpZWQgYXQgZGVwbG95IHRpbWUgKHZhbGlkYXRlZCBhZ2FpbnN0IGEgbGl2ZQpxdWlja25ldCByb3VuZCBiZWZvcmUgZGVwbG95KSBzbyB0aGUgc291cmNlIGNhcnJpZXMgbm8gZ3Vlc3NlZCBjb25zdGFudHMuCmBkcmFuZF9wdWJrZXlgIGFuZCBgZzJfbmVnX2dlbmVyYXRvcmAgYXJlIHVuY29tcHJlc3NlZCBCTFMxMi0zODEgRzIgcG9pbnRzCigxOTIgYnl0ZXMgZWFjaCkgaW4gU29yb2JhbiBob3N0IHNlcmlhbGl6YXRpb24uIGBkc3RgIGlzIHRoZSBSRkMgOTM4MApkb21haW4gc2VwYXJhdGlvbiB0YWcgZm9yIHRoZSBjb25maWd1cmVkIERyYW5kIHNjaGVtZS4AAAAAAAAADEdsb2JhbENvbmZpZwAAAAYAAAAAAAAADWRyYW5kX2dlbmVzaXMAAAAAAAAGAAAAAAAAAAxkcmFuZF9wZXJpb2QAAAAGAAAAAAAAAAxkcmFuZF9wdWJrZXkAAAPuAAAAwAAAAAAAAAADZHN0AAAAAA4AAAAAAAAAEGcyX25lZ19nZW5lcmF0b3IAAAPuAAAAwAAAAAAAAAAEdXNkYwAAABM=" ]),
      options
    )
  }
  public readonly fromJSON = {
    void: this.txFromJSON<Result<void>>,
        clear: this.txFromJSON<Result<Option<string>>>,
        commit: this.txFromJSON<Result<void>>,
        reveal: this.txFromJSON<Result<void>>,
        settle: this.txFromJSON<Result<void>>,
        get_seal: this.txFromJSON<Option<Seal>>,
        get_round: this.txFromJSON<Result<Round>>,
        get_config: this.txFromJSON<Result<GlobalConfig>>,
        get_bidders: this.txFromJSON<Result<Array<string>>>,
        open_reveal: this.txFromJSON<Result<void>>,
        create_round: this.txFromJSON<Result<u64>>,
        get_bid_state: this.txFromJSON<Result<BidState>>,
        get_bidders_page: this.txFromJSON<Result<BiddersPage>>
  }
}