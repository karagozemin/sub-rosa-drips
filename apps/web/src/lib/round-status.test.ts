// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { test } from "node:test";

import { getRoundStatusInfo } from "./round-status";
import type { RoundStatusInfo } from "./round-status";

function found(info: RoundStatusInfo) {
  return info.state === "found";
}

function loading(info: RoundStatusInfo) {
  return info.state === "loading";
}

function empty(info: RoundStatusInfo) {
  return info.state === "empty";
}

function err(info: RoundStatusInfo) {
  return info.state === "error";
}

function stale(info: RoundStatusInfo) {
  return info.state === "stale";
}

test("returns found when live data exists and no error", () => {
  const info = getRoundStatusInfo({
    live: { round: { status: { tag: "Open" } } },
    error: null,
    configured: true,
    stale: false,
  });
  assert.ok(found(info));
  assert.equal(info.tag, "Open");
});

test("returns loading when configured but no live data yet", () => {
  const info = getRoundStatusInfo({
    live: null,
    error: null,
    configured: true,
    stale: false,
  });
  assert.ok(loading(info));
  assert.equal(info.tag, null);
});

test("returns empty when not configured and no live data", () => {
  const info = getRoundStatusInfo({
    live: null,
    error: null,
    configured: false,
    stale: false,
  });
  assert.ok(empty(info));
  assert.equal(info.tag, null);
});

test("returns error when error is present", () => {
  const info = getRoundStatusInfo({
    live: null,
    error: "Network error",
    configured: true,
    stale: false,
  });
  assert.ok(err(info));
  assert.equal(info.tag, null);
  assert.match(info.message, /Network error/);
});

test("error takes precedence over live data", () => {
  const info = getRoundStatusInfo({
    live: { round: { status: { tag: "Open" } } },
    error: "Poll failed",
    configured: true,
    stale: false,
  });
  assert.ok(err(info));
  assert.equal(info.tag, null);
});

test("returns stale when stale flag is true and live data exists", () => {
  const info = getRoundStatusInfo({
    live: { round: { status: { tag: "Settled" } } },
    error: null,
    configured: true,
    stale: true,
  });
  assert.ok(stale(info));
  assert.equal(info.tag, "Settled");
});

test("returns found with null tag when live data has no status", () => {
  const info = getRoundStatusInfo({
    live: {},
    error: null,
    configured: true,
    stale: false,
  });
  assert.ok(found(info));
  assert.equal(info.tag, null);
});

test("returns found with null tag when live data round has no status tag", () => {
  const info = getRoundStatusInfo({
    live: { round: { status: {} } },
    error: null,
    configured: true,
    stale: false,
  });
  assert.ok(found(info));
  assert.equal(info.tag, null);
});

test("message is the error string when in error state", () => {
  const info = getRoundStatusInfo({
    live: null,
    error: "something went wrong",
    configured: true,
    stale: false,
  });
  assert.equal(info.message, "something went wrong");
});

test("message is human-readable when in loading state", () => {
  const info = getRoundStatusInfo({
    live: null,
    error: null,
    configured: true,
    stale: false,
  });
  assert.ok(info.message.length > 0);
});

test("message is human-readable when in empty state", () => {
  const info = getRoundStatusInfo({
    live: null,
    error: null,
    configured: false,
    stale: false,
  });
  assert.ok(info.message.length > 0);
});
