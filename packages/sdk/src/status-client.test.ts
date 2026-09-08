import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  KeeperStatusClient,
  StatusApiError,
  StatusJsonParseError,
} from "./status-client.js";
import type { KeeperStatusResponse } from "./status.js";

const SAMPLE_STATUS: KeeperStatusResponse = {
  contractId: "C123",
  network: "testnet",
  uptimeSeconds: 42,
  rounds: [],
  health: {
    rpc: "ok",
    drand: "ok",
    checkedAt: "2026-01-01T00:00:00.000Z",
  },
  now: "2026-01-01T00:00:00.000Z",
};

function mockFetch(body: string, status = 200): typeof fetch {
  return async () =>
    new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
}

describe("KeeperStatusClient successful JSON parsing", () => {
  it("aborts a request after the configured timeout", async () => {
    const client = new KeeperStatusClient({ baseURL: "http://keeper.test", timeoutMs: 1, fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))) });
    await assert.rejects(() => client.getStatus(), /timed out/i);
  });
  it("returns valid successful JSON unchanged", async () => {
    const client = new KeeperStatusClient({
      baseURL: "http://keeper.test",
      fetchImpl: mockFetch(JSON.stringify(SAMPLE_STATUS)),
    });
    const status = await client.getStatus();
    assert.deepEqual(status, SAMPLE_STATUS);
  });

  it("rejects empty successful JSON bodies", async () => {
    const client = new KeeperStatusClient({
      baseURL: "http://keeper.test",
      fetchImpl: mockFetch("   "),
    });
    await assert.rejects(
      () => client.getStatus(),
      (error: unknown) => {
        assert.ok(error instanceof StatusJsonParseError);
        assert.equal(error.status, 200);
        return true;
      },
    );
  });

  it("rejects malformed successful JSON bodies", async () => {
    const client = new KeeperStatusClient({
      baseURL: "http://keeper.test",
      fetchImpl: mockFetch("{not-json"),
    });
    await assert.rejects(
      () => client.getStatus(),
      (error: unknown) => {
        assert.ok(error instanceof StatusJsonParseError);
        assert.match(error.message, /invalid JSON/i);
        return true;
      },
    );
  });
});

describe("KeeperStatusClient non-success responses", () => {
  it("preserves typed StatusApiError for non-2xx JSON errors", async () => {
    const client = new KeeperStatusClient({
      baseURL: "http://keeper.test",
      fetchImpl: mockFetch(JSON.stringify({ error: "round not found" }), 404),
    });
    await assert.rejects(
      () => client.getRound(7),
      (error: unknown) => {
        assert.ok(error instanceof StatusApiError);
        assert.equal(error.status, 404);
        assert.equal(error.data.error, "round not found");
        return true;
      },
    );
  });

  it("preserves StatusApiError when non-2xx bodies are malformed JSON", async () => {
    const client = new KeeperStatusClient({
      baseURL: "http://keeper.test",
      fetchImpl: mockFetch("not-json", 503),
    });
    await assert.rejects(
      () => client.getHealth(),
      (error: unknown) => {
        assert.ok(error instanceof StatusApiError);
        assert.equal(error.status, 503);
        assert.equal(error.data.error, "invalid JSON body");
        return true;
      },
    );
  });
});
