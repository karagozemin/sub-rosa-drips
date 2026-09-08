// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RoundStatusBadge, type RoundStatusBadgeProps } from "./RoundStatusBadge";

const labels = { loading: "Loading", empty: "Empty", error: "Error", stale: "Stale", found: "Live" } as const;
for (const state of Object.keys(labels) as Array<keyof typeof labels>) {
  test(`${state} renders its label and the appropriate optional control`, () => {
    const withRetry = renderToStaticMarkup(<RoundStatusBadge state={state} onRetry={() => {}} />);
    assert.ok(withRetry.includes(`>${labels[state]}</span>`));
    const action = state === "error" ? "Retry" : state === "stale" ? "Refresh" : null;
    if (action) assert.match(withRetry, new RegExp(`>${action}</button>`));
    else assert.doesNotMatch(withRetry, /<button/);
    const withoutRetry = renderToStaticMarkup(<RoundStatusBadge state={state} />);
    assert.doesNotMatch(withoutRetry, /<button/);
  });
}

test("optional tags render only when supplied", () => {
  assert.match(renderToStaticMarkup(<RoundStatusBadge state="found" tag="Open" />), /round-status-tag">Open/);
  assert.doesNotMatch(renderToStaticMarkup(<RoundStatusBadge state="found" />), /round-status-tag/);
});

for (const [props, title] of [
  [{ error: "RPC offline", message: "Try again" }, "RPC offline"],
  [{ message: "Waiting for a round" }, "Waiting for a round"],
  [{}, null],
] as Array<[Partial<RoundStatusBadgeProps>, string | null]>) {
  test(`badge title resolves to ${title}`, () => {
    const html = renderToStaticMarkup(<RoundStatusBadge state="error" {...props} />);
    if (title) assert.ok(html.includes(`title="${title}"`));
    else assert.doesNotMatch(html, / title=/);
  });
}
