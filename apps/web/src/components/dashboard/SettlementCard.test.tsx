// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DASHBOARD_FIXTURE } from "../../dashboard/fixture";
import type { DashboardData, RoundStatus } from "../../dashboard/types";
import { SettlementCard } from "./SettlementCard";

function render(round: Partial<DashboardData["round"]>, settlement = DASHBOARD_FIXTURE.settlement) {
  return renderToStaticMarkup(<SettlementCard data={{
    ...DASHBOARD_FIXTURE, round: { ...DASHBOARD_FIXTURE.round, ...round }, settlement,
  }} />);
}

for (const status of ["Open", "Revealing", "Cleared"] satisfies RoundStatus[]) {
  test(`${status} hides settlement output`, () => assert.equal(render({ status }), ""));
}

test("voided rounds explain refunds without winner details", () => {
  const html = render({ status: "Voided" });
  assert.match(html, />Voided</);
  assert.match(html, /All escrow has been refunded to bidders/);
  assert.doesNotMatch(html, /dashboard-winner-section|Winning Bid/);
});

test("settled rounds show the winner and formatted winning bid", () => {
  const html = render({ status: "Settled", winner: "GTESTWINNER", winningBid: 1234.5 });
  assert.match(html, /GTESTWINNER/);
  assert.match(html, /Winning Bid/);
  assert.match(html, /1,234.50 USDC/);
});

test("a null winner omits winner and bid details", () => {
  assert.doesNotMatch(render({ winner: null, winningBid: null }), /dashboard-winner-section|Winning Bid/);
});

test("a null bid preserves the winner without a bid label", () => {
  const html = render({ winner: "GTESTWINNER", winningBid: null });
  assert.match(html, /GTESTWINNER/);
  assert.doesNotMatch(html, /Winning Bid/);
});

test("a zero winning bid is displayed", () => {
  assert.match(render({ winner: "GTESTWINNER", winningBid: 0 }), /0.00 USDC/);
});

test("missing settlement statistics are omitted", () => {
  assert.doesNotMatch(render({}, null), /dashboard-settlement-stats|dashboard-settlement-note/);
});
