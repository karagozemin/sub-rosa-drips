// Copyright (c) 2026 Sub Rosa contributors
import { Buffer } from "buffer";
import { useEffect, useState } from "react";
import {
  getNetworkDetails,
  isConnected,
  requestAccess,
} from "@stellar/freighter-api";
import type { BidState, Round } from "@sub-rosa/sdk";
import {
  fetchRoundSignature,
  generateAuditorKeypair,
  generateNonce,
  openBid,
  quicknet,
  roundInSeconds,
  sealBid,
} from "@sub-rosa/tlock";
import type { UseCase } from "../config/useCases";
import type { UseCaseId } from "../config/useCases";
import {
  CONTRACT_ID,
  LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS,
  LIVE_COMMIT_WINDOW_SECONDS,
  LIVE_REVEAL_IN_SECONDS,
  LIVE_REVEAL_WINDOW_AFTER_REVEAL_SECONDS,
  NETWORK,
  displayError,
  formatDemoAmount,
  freighterError,
  resolveFreighterAddress,
  sha256Bytes,
  toDemoEscrowAmount,
  useWalletContract,
} from "../lib/chain";
import { DEMO_TRACE } from "../demo/trace";
import { formatCountdown, useDrandCountdown } from "./useDrandCountdown";
import { useToast } from "../ui/Toast";
import { useTime } from "../lib/time";
import { shortAddr } from "../lib/format";

export type ActionStatus = "idle" | "working" | "ok" | "error";

export interface LiveRound {
  round: Round;
  bidders: string[];
  bidStates: Record<string, BidState>;
}

export interface CaseSession {
  roundId: bigint | null;
  auditorPublicKey: Uint8Array | null;
  commitValue: bigint | null;
  /** Off-chain copy of the tlock ciphertext; fallback if Temporary seal storage expired. */
  sealedCiphertext: Uint8Array | null;
  /** Timestamp (ms) when the round was created locally; powers cohort animations. */
  roundCreatedAt: number | null;
  live: LiveRound | null;
  log: string[];
}

function emptySession(roundId: bigint | null = null): CaseSession {
  return {
    roundId,
    auditorPublicKey: null,
    commitValue: null,
    sealedCiphertext: null,
    roundCreatedAt: null,
    live: null,
    log: [],
  };
}

function initialSessions(): Record<UseCaseId, CaseSession> {
  return {
    auction: emptySession(),
  };
}

export function useRoundSession(active: UseCase) {
  const toast = useToast();
  const { clock } = useTime();
  const [address, setAddress] = useState<string | null>(null);
  const [walletStatus, setWalletStatus] = useState("Connect a funded Stellar testnet wallet.");
  const [entryValue, setEntryValue] = useState(active.defaultValue);
  const [sessions, setSessions] = useState<Record<UseCaseId, CaseSession>>(() =>
    initialSessions(),
  );
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [revealProgress, setRevealProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const contract = useWalletContract(address);
  const session = sessions[active.id];
  const { auditorPublicKey, commitValue, sealedCiphertext, live, log, roundId, roundCreatedAt } =
    session;
  const canUseContract = Boolean(CONTRACT_ID && contract);
  const targetRound = live ? Number(live.round.reveal_round) : DEMO_TRACE.meta.revealRound;
  const drandGate = useDrandCountdown(targetRound);
  const commitSecondsRemaining = live
    ? Math.max(0, Number(live.round.commit_deadline) - clock.nowSeconds())
    : null;
  const commitClosed = commitSecondsRemaining != null && commitSecondsRemaining <= 0;
  const committedOnChain = Boolean(address && live?.bidStates[address]);
  const committed = committedOnChain || (commitValue != null && live == null);
  const revealedCount = live
    ? Object.values(live.bidStates).filter((state) => state.revealed_value != null).length
    : 0;

  useEffect(() => {
    setEntryValue(active.defaultValue);
  }, [active.id, active.defaultValue]);

  function updateSession(id: UseCaseId, patch: Partial<CaseSession>) {
    setSessions((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }));
  }

  function push(message: string, id = active.id) {
    setSessions((prev) => ({
      ...prev,
      [id]: { ...prev[id], log: [message, ...prev[id].log].slice(0, 8) },
    }));
  }

  async function refresh(targetRoundId = roundId, id = active.id) {
    if (!contract || targetRoundId == null) return;
    const round = await contract.get_round({ round_id: targetRoundId });
    const bidders = await contract.get_bidders({ round_id: targetRoundId });
    const bidStates: Record<string, BidState> = {};
    for (const bidder of bidders.result.unwrap()) {
      const state = await contract.get_bid_state({ round_id: targetRoundId, bidder });
      bidStates[bidder] = state.result.unwrap();
    }
    updateSession(id, {
      live: { round: round.result.unwrap(), bidders: bidders.result.unwrap(), bidStates },
    });
  }

  async function connect() {
    const workingId = toast.push("working", "Connecting Freighter…");
    setStatus("working");
    try {
      const connected = await isConnected();
      if (!connected.isConnected) {
        throw new Error("Freighter extension is not installed or not reachable");
      }
      const access = await requestAccess();
      const error = freighterError(access);
      if (error) throw new Error(error);
      const addr = await resolveFreighterAddress(access);
      setAddress(addr);
      const net = await getNetworkDetails();
      const netMsg =
        net.networkPassphrase === NETWORK
          ? `Connected on ${net.network}.`
          : `Connected — switch Freighter to Testnet (current: ${net.network}).`;
      setWalletStatus(netMsg);
      push("Freighter connected.");
      setStatus("ok");
      toast.dismiss(workingId);
      toast.push("success", "Wallet connected", netMsg);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setWalletStatus(msg);
      setStatus("error");
      toast.dismiss(workingId);
      toast.push("error", "Wallet connection failed", msg);
    }
  }

  async function createRound(commitWindowSeconds: number = LIVE_COMMIT_WINDOW_SECONDS) {
    if (!CONTRACT_ID) {
      toast.push("error", "Contract not configured", "Set VITE_CONTRACT_ID in apps/web/.env.local");
      return;
    }
    if (!contract || !address) return;
    const id = active.id;
    const workingId = toast.push(
      "working",
      "Creating sealed round…",
      `Commit window: ${commitWindowSeconds}s · signing with Freighter`,
    );
    setStatus("working");
    try {
      const drand = quicknet();
      const revealInSeconds = commitWindowSeconds + LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS;
      const revealRound = await roundInSeconds(drand, revealInSeconds);
      const info = await drand.chain().info();
      const tReveal = Number(info.genesis_time) + Number(info.period) * revealRound;
      const commitDeadline = tReveal - LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS;
      const revealDeadline = tReveal + LIVE_REVEAL_WINDOW_AFTER_REVEAL_SECONDS;
      const auditor = generateAuditorKeypair();
      const itemRef = await sha256Bytes(`${active.id}:${address}:${clock.nowMs()}`);
      const tx = await contract.create_round({
        operator: address,
        item_ref: Buffer.from(itemRef),
        reveal_round: BigInt(revealRound),
        clearing_rule: { tag: "HighestBid", values: undefined },
        commit_deadline: BigInt(commitDeadline),
        reveal_deadline: BigInt(revealDeadline),
        auditor_pubkey: Buffer.from(auditor.publicKey),
      });
      const sent = await tx.signAndSend();
      const nextRoundId = sent.result.unwrap() as bigint;
      updateSession(id, {
        roundId: nextRoundId,
        auditorPublicKey: auditor.publicKey,
        roundCreatedAt: clock.nowMs(),
        commitValue: null,
        sealedCiphertext: null,
        live: null,
      });
      setStatus("ok");
      const msg = `Round #${nextRoundId} · commit window ~${commitWindowSeconds}s · R=${revealRound}`;
      push(msg, id);
      toast.dismiss(workingId);
      toast.push("success", "Round created on Stellar", msg);
      await refresh(nextRoundId, id);
    } catch (error) {
      const msg = displayError(error);
      setStatus("error");
      push(msg, id);
      toast.dismiss(workingId);
      toast.push("error", "Round creation failed", msg);
    }
  }

  async function joinRound(idStr: string) {
    if (!contract || !address) {
      toast.push("error", "Wallet not ready", "Connect Freighter first");
      return;
    }
    const id = active.id;
    const trimmed = idStr.trim();
    if (!trimmed) {
      toast.push("error", "Round id required", "Paste an existing round number");
      return;
    }
    let parsedId: bigint;
    try {
      parsedId = BigInt(trimmed);
    } catch {
      toast.push("error", "Invalid round id", "Round ids are numeric (e.g. 42)");
      return;
    }
    const workingId = toast.push("working", "Joining round…", `Round #${parsedId}`);
    setStatus("working");
    try {
      const roundTx = await contract.get_round({ round_id: parsedId });
      const round = roundTx.result.unwrap();
      if (round.status.tag !== "Open") {
        throw new Error(`Round #${parsedId} is ${round.status.tag} — commit window has closed.`);
      }
      const commitDeadline = Number(round.commit_deadline);
      const now = clock.nowSeconds();
      if (commitDeadline <= now) {
        throw new Error(`Round #${parsedId} commit window has already closed.`);
      }
      updateSession(id, {
        roundId: parsedId,
        auditorPublicKey: new Uint8Array(round.auditor_pubkey),
        roundCreatedAt: clock.nowMs(),
        commitValue: null,
        sealedCiphertext: null,
        live: null,
      });
      setStatus("ok");
      const remaining = commitDeadline - now;
      const msg = `Round #${parsedId} · ${remaining}s left to commit`;
      push(`Joined existing round #${parsedId}.`, id);
      toast.dismiss(workingId);
      toast.push("success", "Joined round", msg);
      await refresh(parsedId, id);
    } catch (error) {
      const msg = displayError(error);
      setStatus("error");
      push(msg, id);
      toast.dismiss(workingId);
      toast.push("error", "Could not join round", msg);
    }
  }

  async function commitEntry() {
    if (!contract || !address || roundId == null) return;
    const id = active.id;
    const displayed = active.formatValue(entryValue);
    const workingId = toast.push("working", "Sealing your entry…", `${active.inputLabel}: ${displayed}`);
    setStatus("working");
    try {
      const roundTx = await contract.get_round({ round_id: roundId });
      const round = roundTx.result.unwrap();
      const roundAuditorPublicKey = new Uint8Array(round.auditor_pubkey);
      const value = toDemoEscrowAmount(entryValue);
      const drand = quicknet();
      const sealed = await sealBid({
        value,
        nonce: generateNonce(),
        round: Number(round.reveal_round),
        client: drand,
        identity: new TextEncoder().encode(`${active.nav}:${address}`),
        auditorPublicKey: auditorPublicKey ?? roundAuditorPublicKey,
      });
      const tx = await contract.commit({
        round_id: roundId,
        bidder: address,
        commitment: Buffer.from(sealed.commitment),
        ciphertext: Buffer.from(sealed.ciphertext),
        escrow: value,
        auditor_blob: Buffer.from(sealed.auditorBlob),
      });
      await tx.signAndSend();
      updateSession(id, {
        commitValue: value,
        sealedCiphertext: sealed.ciphertext,
        auditorPublicKey: auditorPublicKey ?? roundAuditorPublicKey,
      });
      setStatus("ok");
      const msg = `${formatDemoAmount(value)} escrow locked · ciphertext on-chain`;
      push(`Sealed ${active.inputLabel}: ${displayed}.`, id);
      toast.dismiss(workingId);
      toast.push("success", "Entry sealed on-chain", msg);
      await refresh(roundId, id);
    } catch (error) {
      const msg = displayError(error);
      setStatus("error");
      push(msg, id);
      toast.dismiss(workingId);
      toast.push("error", "Commit failed", msg);
    }
  }

  async function openAndReveal() {
    if (!contract || roundId == null) return;
    const id = active.id;
    if (live && !drandGate.published) {
      toast.push(
        "info",
        "Waiting for Drand R",
        `Reveal opens in ${formatCountdown(drandGate.secondsRemaining)}`,
      );
      return;
    }
    const workingId = toast.push("working", "Opening reveal gate…", "BLS verify + decrypt bids");
    setStatus("working");
    setRevealProgress(null);
    try {
      const drand = quicknet();
      const roundTx = await contract.get_round({ round_id: roundId });
      let round = roundTx.result.unwrap();
      if (round.status.tag === "Open") {
        const signature = await fetchRoundSignature(drand, Number(round.reveal_round));
        const openTx = await contract.open_reveal({
          round_id: roundId,
          drand_signature: Buffer.from(signature),
        });
        await openTx.signAndSend();
        push(`Opened reveal with Drand R=${Number(round.reveal_round).toLocaleString()}.`, id);
        toast.push("success", "Drand gate opened", "BLS signature verified on-chain");
        round = (await contract.get_round({ round_id: roundId })).result.unwrap();
      }
      if (round.status.tag !== "Revealing") {
        throw new Error(`Round is ${round.status.tag}, not Revealing.`);
      }
      const bidders = (await contract.get_bidders({ round_id: roundId })).result.unwrap();
      const pending = [];
      for (const bidder of bidders) {
        const state = (await contract.get_bid_state({ round_id: roundId, bidder })).result.unwrap();
        if (state.revealed_value == null) pending.push(bidder);
      }
      if (pending.length === 0 && bidders.length === 0) {
        throw new Error(
          "No sealed entries on-chain for this round. Commit your bid before Drand R, then open + reveal.",
        );
      }
      let revealed = 0;
      const skipped: string[] = [];
      for (let i = 0; i < pending.length; i += 1) {
        const bidder = pending[i];
        setRevealProgress({ current: i + 1, total: pending.length });
        toast.dismiss(workingId);
        const stepId = toast.push(
          "working",
          `Revealing bid ${i + 1} of ${pending.length}`,
          shortAddr(bidder),
        );
        const seal = (await contract.get_seal({ round_id: roundId, bidder })).result;
        let ciphertext: Uint8Array | null = seal ? new Uint8Array(seal.ciphertext) : null;
        if (!ciphertext && address === bidder && sealedCiphertext) {
          ciphertext = sealedCiphertext;
        }
        if (!ciphertext) {
          skipped.push(`${shortAddr(bidder)}: seal expired or missing`);
          toast.dismiss(stepId);
          continue;
        }
        const opened = await openBid(ciphertext, drand);
        const revealTx = await contract.reveal({
          round_id: roundId,
          bidder,
          value: opened.value,
          nonce: Buffer.from(opened.nonce),
        });
        await revealTx.signAndSend();
        revealed += 1;
        toast.dismiss(stepId);
      }
      setRevealProgress(null);
      if (revealed === 0) {
        const detail =
          skipped.length > 0
            ? skipped.join("; ")
            : `${pending.length} pending bid(s) could not be opened.`;
        throw new Error(
          pending.length > 0
            ? `Reveal gate is open but no ciphertext could be decrypted. ${detail}`
            : "All bids are already revealed.",
        );
      }
      setStatus("ok");
      const msg = `${revealed} entr${revealed === 1 ? "y" : "ies"} opened permissionlessly`;
      push(msg, id);
      toast.dismiss(workingId);
      toast.push("success", "Reveal complete", msg);
      if (skipped.length > 0) {
        toast.push(
          "info",
          "Some bids skipped",
          skipped.join("; "),
        );
      }
      await refresh(roundId, id);
    } catch (error) {
      setRevealProgress(null);
      const msg = displayError(error);
      setStatus("error");
      push(msg, id);
      toast.dismiss(workingId);
      toast.push("error", "Reveal failed", msg);
    }
  }

  return {
    address,
    walletStatus,
    entryValue,
    setEntryValue,
    session,
    status,
    canUseContract,
    targetRound,
    drandGate,
    commitSecondsRemaining,
    commitClosed,
    revealedCount,
    committed,
    commitValue,
    roundId,
    roundCreatedAt,
    live,
    log,
    revealProgress,
    connect,
    createRound,
    joinRound,
    commitEntry,
    openAndReveal,
    refresh,
  };
}
