// Copyright (c) 2026 Sub Rosa contributors
import { useState } from "react";
import { getErrorMessage } from "@sub-rosa/errors";
import type { AttackStep } from "../lib/demoTypes";
import { useToast } from "../ui/Toast";

function StepList({ steps, variant }: { steps: AttackStep[]; variant: "bad" | "good" }) {
  return (
    <ul className={`attack-steps ${variant}`}>
      {steps.map((s) => (
        <li key={s.label} className={s.ok ? "ok" : "fail"}>
          <span className="attack-mark">{s.ok ? "✓" : "✗"}</span>
          <div>
            <strong>{s.label}</strong>
            <p>{s.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AttackDemo() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [sealOff, setSealOff] = useState<AttackStep[] | null>(null);
  const [sealOn, setSealOn] = useState<AttackStep[] | null>(null);
  const [round, setRound] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    const workingId = toast.push("working", "Running tlock comparison…");
    setLoading(true);
    setErr(null);
    try {
      const { runSealAttackDemo } = await import("../lib/demoActions");
      const res = await runSealAttackDemo();
      setSealOff(res.sealOff);
      setSealOn(res.sealOn);
      setRound(res.revealRound);
      toast.dismiss(workingId);
      toast.push(
        "success",
        "Attack demo complete",
        `Seal-off leaks early · seal-on waits for R=${res.revealRound.toLocaleString()}`,
      );
    } catch (e) {
      const msg = getErrorMessage(e);
      setErr(msg);
      toast.dismiss(workingId);
      toast.push("error", "Attack demo failed", msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel attack-panel">
      <header className="panel-head attack-head">
        <div>
          <p className="eyebrow">Main stage</p>
          <h2>Seal-off vs seal-on attack</h2>
        </div>
        <p>
          Live tlock against Drand quicknet. The broken baseline reveals early;
          Sub Rosa waits for R and force-opens all bids.
        </p>
      </header>

      <div className="attack-control">
        <button type="button" className="btn primary" onClick={run} disabled={loading}>
          {loading ? "Running live tlock demo..." : "Run live attack comparison"}
        </button>
        {round != null && (
          <p className="muted">Sealed to future Drand round R={round.toLocaleString()}</p>
        )}
        {err && <p className="error">{err}</p>}
      </div>

      <div className="attack-columns">
        <div className="attack-col bad">
          <h3>Seal OFF — broken commit-reveal</h3>
          <p className="attack-sub">
            Bid stored in reversible form. Observer reads early. Losing bidder can abort.
          </p>
          {sealOff ? <StepList steps={sealOff} variant="bad" /> : <p className="placeholder">Run demo</p>}
        </div>
        <div className="attack-col good">
          <h3>Seal ON — Sub Rosa + Drand tlock</h3>
          <p className="attack-sub">
            Undecryptable until R. Permissionless mass reveal. Commitment binding on-chain.
          </p>
          {sealOn ? <StepList steps={sealOn} variant="good" /> : <p className="placeholder">Run demo</p>}
        </div>
      </div>
    </section>
  );
}
