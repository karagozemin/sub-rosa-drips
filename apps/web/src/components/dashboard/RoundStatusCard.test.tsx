// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeTime } from "@sub-rosa/time";

import { DASHBOARD_FIXTURE } from "../../dashboard/fixture";
import type { DashboardData } from "../../dashboard/types";
import { TimeProvider } from "../../lib/time";
import { RoundStatusCard } from "./RoundStatusCard";

const QUICKNET_GENESIS = 1_692_803_367;
const QUICKNET_PERIOD = 3;

function drandPublishedNowMs(revealRound: number): number {
  return (QUICKNET_GENESIS + QUICKNET_PERIOD * revealRound + 1) * 1000;
}

function renderCard(data: DashboardData, nowMs?: number): string {
  const fake = createFakeTime(nowMs ?? drandPublishedNowMs(data.round.revealRound));
  return renderToStaticMarkup(
    <TimeProvider value={fake}>
      <RoundStatusCard data={data} />
    </TimeProvider>,
  );
}

test("round status card renders settled phase and past Drand countdown", () => {
  const html = renderCard(DASHBOARD_FIXTURE);

  assert.match(html, /Settled/);
  assert.match(html, /Reveal countdown/);
  assert.match(html, /has already published/);
});

test("round status card renders open phase and live countdown copy", () => {
  const nowSeconds = 1_700_000_000;
  const data: DashboardData = {
    ...DASHBOARD_FIXTURE,
    round: {
      ...DASHBOARD_FIXTURE.round,
      status: "Open",
      commitDeadline: nowSeconds + 60,
      revealDeadline: nowSeconds + 360,
      revealRound: 99_999_999,
      winner: null,
      winningBid: null,
    },
  };

  const html = renderCard(data, nowSeconds * 1000);

  assert.match(html, /Open/);
  assert.match(html, /until R 99,999,999/);
});

test("round status card renders reveal phase when an open round passed R", () => {
  const data: DashboardData = {
    ...DASHBOARD_FIXTURE,
    round: {
      ...DASHBOARD_FIXTURE.round,
      status: "Open",
      winner: null,
      winningBid: null,
    },
  };

  const html = renderCard(data);

  assert.match(html, /Reveal/);
  assert.match(html, /has already published/);
});
