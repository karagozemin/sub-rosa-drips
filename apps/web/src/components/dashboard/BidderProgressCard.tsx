// Copyright (c) 2026 Sub Rosa contributors
import { shortAddr, usdc } from "../../lib/format";
import type { DashboardData } from "../../dashboard/types";

function BidderStatusIndicator({
  committed,
  revealed,
  valid,
  settled,
}: {
  committed: boolean;
  revealed: boolean;
  valid: boolean | null;
  settled: boolean;
}) {
  if (settled && valid) return <span className="dashboard-bidder-status success">Winner</span>;
  if (settled && valid === false) return <span className="dashboard-bidder-status neutral">Refunded</span>;
  if (settled) return <span className="dashboard-bidder-status success">Settled</span>;
  if (valid === false) return <span className="dashboard-bidder-status error">Invalid</span>;
  if (revealed) return <span className="dashboard-bidder-status info">Revealed</span>;
  if (committed) return <span className="dashboard-bidder-status warning">Committed</span>;
  return <span className="dashboard-bidder-status neutral">Pending</span>;
}

export function BidderProgressCard({ data }: { data: DashboardData }) {
  const { bidders } = data;
  const committed = bidders.filter((b) => b.committed).length;
  const revealed = bidders.filter((b) => b.revealed).length;
  const valid = bidders.filter((b) => b.valid === true).length;

  return (
    <section className="dashboard-card bidder-progress-card">
      <header className="dashboard-card-header">
        <h2>Bidder Progress</h2>
        <span className="dashboard-bidder-count">{bidders.length} bidder{bidders.length !== 1 ? "s" : ""}</span>
      </header>

      <div className="dashboard-card-body">
        <div className="dashboard-progress-stats">
          <div className="dashboard-stat">
            <span className="dashboard-stat-value">{committed}</span>
            <span className="dashboard-stat-label">Committed</span>
          </div>
          <div className="dashboard-stat">
            <span className="dashboard-stat-value">{revealed}</span>
            <span className="dashboard-stat-label">Revealed</span>
          </div>
          <div className="dashboard-stat">
            <span className="dashboard-stat-value">{valid}</span>
            <span className="dashboard-stat-label">Valid</span>
          </div>
        </div>

        {bidders.length > 0 && (
          <div className="dashboard-bidder-table-wrapper">
            <table className="dashboard-bidder-table" aria-label="Bidder progress">
              <thead>
                <tr>
                  <th scope="col">Bidder</th>
                  <th scope="col">Escrow</th>
                  <th scope="col">Bid</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {bidders.map((bidder) => (
                  <tr
                    key={bidder.address}
                    className={data.round.winner === bidder.address ? "winner-row" : ""}
                  >
                    <td>
                      <div className="dashboard-bidder-cell">
                        {bidder.label && (
                          <span className="dashboard-bidder-label">{bidder.label}</span>
                        )}
                        <code className="dashboard-bidder-address">
                          {shortAddr(bidder.address, 6)}
                        </code>
                      </div>
                    </td>
                    <td className="dashboard-numeric-cell">
                      {usdc(bidder.escrowUsdc)} USDC
                    </td>
                    <td className="dashboard-numeric-cell">
                      {bidder.bidUsdc !== null ? `${usdc(bidder.bidUsdc)} USDC` : "—"}
                    </td>
                    <td>
                      <BidderStatusIndicator
                        committed={bidder.committed}
                        revealed={bidder.revealed}
                        valid={bidder.valid}
                        settled={bidder.settled}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {bidders.length === 0 && (
          <p className="dashboard-empty-message">No bidders yet</p>
        )}
      </div>
    </section>
  );
}
