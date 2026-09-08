// Copyright (c) 2026 Sub Rosa contributors
import { useMemo, useState } from "react";
import { getErrorMessage } from "@sub-rosa/errors";
import type { DemoTrace } from "../demo/trace";
import { shortAddr } from "../lib/format";
import { hexToBytes } from "../lib/hex";

interface DecryptedRow {
  label: string;
  address: string;
  identity: string | null;
  error: string | null;
}

export function AuditorView({ trace }: { trace: DemoTrace }) {
  const auditor = trace.auditor;
  const [secretHex, setSecretHex] = useState<string>(auditor.secretHex);
  const [rows, setRows] = useState<DecryptedRow[] | null>(null);
  const [bidDemo, setBidDemo] = useState<{ value: string; round: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const blobRows = useMemo(
    () =>
      trace.bidders.map((b) => ({
        label: b.label,
        address: b.address,
        blobHex: (auditor.blobs as Record<string, string>)[b.label] ?? "",
      })),
    [trace.bidders, auditor.blobs],
  );

  async function decryptIdentities() {
    setBusy(true);
    setErr(null);
    setRows(null);
    try {
      const { openIdentity } = await import("@sub-rosa/tlock");
      const secret = hexToBytes(secretHex);
      const decoded: DecryptedRow[] = blobRows.map(({ label, address, blobHex }) => {
        if (!blobHex) {
          return { label, address, identity: null, error: "no auditor blob in trace" };
        }
        try {
          const plain = openIdentity(hexToBytes(blobHex), secret);
          return {
            label,
            address,
            identity: new TextDecoder().decode(plain),
            error: null,
          };
        } catch (e) {
          return {
            label,
            address,
            identity: null,
            error: getErrorMessage(e),
          };
        }
      });
      setRows(decoded);
    } catch (e) {
      setErr(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function runBidDecryptDemo() {
    setBusy(true);
    setErr(null);
    setBidDemo(null);
    try {
      const { quicknet, sealBid, openBid, generateNonce } = await import("@sub-rosa/tlock");
      const client = quicknet();
      const round = trace.meta.revealRound;
      const nonce = generateNonce();
      const value = 42_000_000n;
      const sealed = await sealBid({ value, nonce, round, client });
      const opened = await openBid(new Uint8Array(sealed.ciphertext), client);
      if (opened.value !== value) throw new Error("opened value mismatch");
      setBidDemo({ value: (Number(value) / 1e7).toFixed(2), round });
    } catch (e) {
      setErr(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel auditor-panel">
      <header className="panel-head">
        <h2>Auditor view</h2>
        <p>
          Bid <em>values</em> unseal publicly at Drand R. Bidder <em>identities</em> stay
          encrypted in the on-chain auditor blob until the designated auditor opens them with
          their X25519 secret key.
        </p>
      </header>

      <div className="auditor-grid">
        <article className="card">
          <h3>Selective disclosure</h3>
          <p className="muted">
            E2E auditor pubkey: <code className="tiny">{auditor.publicHex.slice(0, 16)}…</code>
          </p>
          <p className="muted">
            Source: <code className="tiny">{auditor.source}</code> / round{" "}
            <code className="tiny">{trace.meta.roundId}</code>
          </p>
          <label className="field">
            <span>Auditor secret key (hex, 32 bytes)</span>
            <input
              type="text"
              value={secretHex}
              onChange={(e) => setSecretHex(e.target.value.trim())}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <div className="btn-row">
            <button type="button" className="btn" disabled={busy} onClick={() => void decryptIdentities()}>
              Decrypt identity blobs
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => setSecretHex(auditor.secretHex)}
            >
              Reset e2e key
            </button>
          </div>
        </article>

        <article className="card">
          <h3>Bid tlock decrypt (live)</h3>
          <p>
            Uses quicknet against recorded R={trace.meta.revealRound.toLocaleString()} (already
            published). Seals a sample bid to R, then immediately opens it — same path the keeper
            uses after <code>open_reveal</code>.
          </p>
          <button type="button" className="btn" disabled={busy} onClick={() => void runBidDecryptDemo()}>
            Run live bid decrypt
          </button>
          {bidDemo && (
            <p className="accent">
              Opened bid value: <strong>{bidDemo.value}</strong> (round R={bidDemo.round.toLocaleString()})
            </p>
          )}
        </article>
      </div>

      {err && <p className="error">{err}</p>}

      <table className="table">
        <thead>
          <tr>
            <th>Bidder</th>
            <th>Public address (session key)</th>
            <th>Auditor blob</th>
            <th>Decrypted identity</th>
          </tr>
        </thead>
        <tbody>
          {blobRows.map((b) => {
            const dec = rows?.find((r) => r.label === b.label);
            return (
              <tr key={b.label}>
                <td>{b.label}</td>
                <td>
                  <code className="tiny">{shortAddr(b.address, 12)}</code>
                </td>
                <td className="muted tiny">{b.blobHex.slice(0, 24)}…</td>
                <td>
                  {dec?.identity ? (
                    <code>{dec.identity}</code>
                  ) : dec?.error ? (
                    <span className="error">{dec.error}</span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
