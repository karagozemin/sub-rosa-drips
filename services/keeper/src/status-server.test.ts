// Copyright (c) 2026 Sub Rosa contributors
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeTime } from "@sub-rosa/time";

import http from "node:http";

import { createStatusServer } from "./status-server.js";
import type { BuildStatusSource } from "./status.js";
import type { WatchedRound } from "./store.js";

async function get(
  server: http.Server,
  path: string,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "object" === false) {
      reject(new Error("server not listening"));
      return;
    }
    const port = addr.port;
    http
      .get(`http://127.0.0.1:${port}${path}`, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          let parsed: unknown = {};
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            /* leave as empty */
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      })
      .on("error", reject);
  });
}

function makeSource(overrides: Partial<BuildStatusSource> = {}): BuildStatusSource {
  const now = createFakeTime(1_700_000_000_000).clock.nowSeconds();
  const fullRound = (extra: Partial<import("@sub-rosa/sdk").Round> = {}): import("@sub-rosa/sdk").Round =>
    ({
      status: { tag: "Open" as const },
      reveal_round: BigInt(1_000_000),
      commit_deadline: BigInt(now + 3600),
      reveal_deadline: BigInt(now + 7200),
      bidders: ["GAAA", "GBBB"],
      winner: null,
      winning_bid: 0n,
      clearing_rule: { tag: "HighestBid" as const },
      auditor_pubkey: Buffer.from("aa"),
      item_ref: Buffer.from("bb".repeat(32), "hex"),
      operator: "GOPERATOR",
      ...extra,
    } as import("@sub-rosa/sdk").Round);
  const fullState = (): import("@sub-rosa/sdk").BidState =>
    ({
      commitment: Buffer.from("00"),
      escrow: 0n,
      revealed_nonce: undefined,
      revealed_value: undefined,
      settled: false,
      valid: false,
    } as import("@sub-rosa/sdk").BidState);
  return {
    reader: {
      getRound: async () => fullRound(),
      getBidState: async () => fullState(),
    },
    drand: {
      chain: () => ({
        info: async () => ({ genesis_time: 1000, period: 3 }),
      }),
    } as never,
    storeRounds: () => [
      { roundId: "1", lastStatus: "Open", retryCount: 0 } as WatchedRound,
    ],
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBBBB",
    network: "Test SDF Network ; September 2015",
    ...overrides,
  };
}

async function withServer(
  source: BuildStatusSource,
  fn: (server: http.Server) => Promise<void>,
) {
  const server = createStatusServer({
    host: "127.0.0.1",
    port: 0,
    ...source,
  });

  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    await fn(server);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("GET / returns service info", async () => {
  await withServer(makeSource(), async (server) => {
    const res = await get(server, "/");
    assert.equal(res.status, 200);
    const body = res.body as Record<string, unknown>;
    assert.equal(body.service, "sub-rosa-keeper-status");
    assert.ok(Array.isArray(body.endpoints));
  });
});

test("GET /status returns a full status response", async () => {
  await withServer(makeSource(), async (server) => {
    const res = await get(server, "/status");
    assert.equal(res.status, 200);
    const body = res.body as Record<string, unknown>;
    assert.equal(body.contractId, "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBBBB");
    assert.ok(Array.isArray(body.rounds));
    assert.ok(body.health);
    const rounds = body.rounds as Array<Record<string, unknown>>;
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].roundId, "1");
    assert.equal(rounds[0].status, "Open");
  });
});

test("GET /status/rounds/:id returns a single round", async () => {
  await withServer(makeSource(), async (server) => {
    const res = await get(server, "/status/rounds/1");
    assert.equal(res.status, 200);
    const body = res.body as Record<string, unknown>;
    assert.equal(body.roundId, "1");
    assert.equal(body.status, "Open");
  });
});

test("GET /status/rounds/:id returns 404 for an untracked round", async () => {
  await withServer(makeSource(), async (server) => {
    const res = await get(server, "/status/rounds/999");
    assert.equal(res.status, 404);
    const body = res.body as Record<string, unknown>;
    assert.equal(body.error, "round not tracked");
    assert.ok(Array.isArray(body.roundIds));
  });
});

test("GET /status/rounds/:id returns 404 for a non-numeric id (route does not match)", async () => {
  await withServer(makeSource(), async (server) => {
    const res = await get(server, "/status/rounds/not-a-number");
    assert.equal(res.status, 404);
  });
});

test("GET /healthz returns healthy when upstream answers", async () => {
  await withServer(makeSource(), async (server) => {
    const res = await get(server, "/healthz");
    assert.equal(res.status, 200);
    const body = res.body as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.contractId, "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBBBB");
    assert.ok(body.drand);
  });
});

test("GET /healthz returns 503 when drand is down", async () => {
  await withServer(
    makeSource({
      drand: {
        chain: () => ({
          info: async () => {
            throw new Error("drand down");
          },
        }),
      } as never,
    }),
    async (server) => {
      const res = await get(server, "/healthz");
      assert.equal(res.status, 503);
      const body = res.body as Record<string, unknown>;
      assert.equal(body.ok, false);
      assert.equal(body.reason, "health check failed");
      assert.doesNotMatch(JSON.stringify(body), /drand down/);
    },
  );
});

test("GET /healthz redacts secret-bearing upstream errors from the response body", async () => {
  const secretRpc = "https://rpc.example.internal/secret-token-abc123";
  await withServer(
    makeSource({
      reader: {
        getRound: async () => {
          throw new Error(`connection refused to ${secretRpc}`);
        },
        getBidState: async () => ({ revealed_value: null }) as never,
      },
      drand: {
        chain: () => ({
          info: async () => {
            throw new Error(`connection refused to ${secretRpc}`);
          },
        }),
      } as never,
    }),
    async (server) => {
      const res = await get(server, "/healthz");
      assert.equal(res.status, 503);
      const body = res.body as Record<string, unknown>;
      assert.equal(body.reason, "health check failed");
      const serialized = JSON.stringify(body);
      assert.doesNotMatch(serialized, /secret-token-abc123/);
      assert.doesNotMatch(serialized, /rpc\.example\.internal/);
    },
  );
});

test("GET /status returns 500-style payload shapes are JSON without crashing", async () => {
  await withServer(
    makeSource({
      reader: {
        getRound: async () => {
          throw new Error("unexpected upstream error");
        },
        getBidState: async () => ({ revealed_value: null }) as never,
      },
      storeRounds: () => [
        { roundId: "1", lastStatus: "Unknown", retryCount: 0 } as WatchedRound,
      ],
    }),
    async (server) => {
      // Server should still respond 200 for /status, because individual round
      // failures are surfaced as statuses, not HTTP errors.
      const res = await get(server, "/status");
      assert.equal(res.status, 200);
      const body = res.body as Record<string, unknown>;
      const rounds = body.rounds as Array<Record<string, unknown>>;
      assert.equal(rounds[0].status, "Unknown");
    },
  );
});

test("GET /status/health returns health shape", async () => {
  await withServer(makeSource(), async (server) => {
    const res = await get(server, "/status/health");
    assert.equal(res.status, 200);
    const body = res.body as Record<string, unknown>;
    assert.ok(body.health);
    assert.ok(body.now);
    const health = body.health as Record<string, unknown>;
    assert.ok(["ok", "degraded", "down"].includes(health.rpc as string));
    assert.ok(["ok", "degraded", "down"].includes(health.drand as string));
  });
});
