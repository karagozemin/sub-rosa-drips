// Copyright (c) 2026 Sub Rosa contributors
import { createLogger, type Logger } from '@sub-rosa/logging';
import { getErrorMessage } from "@sub-rosa/errors";
const diagnostics = createLogger("services.keeper.src.status-server");
import http from "node:http";

import type { DrandClient } from "@sub-rosa/tlock";
import { resolveTimeContext, systemClock, systemScheduler, systemTime } from "@sub-rosa/time";

import type { StatusReader } from "./status.js";
import { buildKeeperStatus, type BuildStatusSource } from "./status.js";

export interface StatusServerConfig {
  logger?: Logger;
  host?: string;
  port?: number;
  contractId: string;
  network: string;
  reader: StatusReader;
  drand: DrandClient;
  storeRounds: () => import("./store.js").WatchedRound[];
  settleIndicator?: (roundId: bigint) => import("./status.js").SettlementIndicator;
  epochMs?: number;
}

interface Route {
  method: string;
  pattern: RegExp;
  handler: (
    url: URL,
    body: unknown,
  ) => Promise<{ status: number; body: unknown }>;
}

const JSON_CONTENT = { "content-type": "application/json" };

function send(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body, bigintReplacer, 2);
  res.writeHead(status, JSON_CONTENT);
  res.end(payload);
}

export function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

// Health endpoints are intentionally lightweight: the deeper /status endpoint
// performs per-round on-chain reads, but /healthz must always be cheap enough
// to serve as a liveness probe without hammering RPC.
function makeRoutes(src: BuildStatusSource): Route[] {
  const baseSource = () => ({
    reader: src.reader,
    drand: src.drand,
    storeRounds: src.storeRounds,
    contractId: src.contractId,
    network: src.network,
    epochMs: src.epochMs,
    settleIndicator: src.settleIndicator,
  });

  return [
    {
      method: "GET",
      pattern: /^\/status\/?$/,
      handler: async () => {
        const body = await buildKeeperStatus(baseSource());
        return { status: 200, body };
      },
    },
    {
      method: "GET",
      pattern: /^\/status\/rounds\/(\d+)\/?$/,
      handler: async (url) => {
        const match = new RegExp(/^\/status\/rounds\/(\d+)\/?$/).exec(url.pathname);
        const roundId = match ? BigInt(match[1]) : null;
        if (roundId == null || roundId < 0n) {
          return {
            status: 400,
            body: { error: "invalid round id" },
          };
        }
        const full = await buildKeeperStatus(baseSource());
        const round = full.rounds.find((r) => r.roundId === roundId.toString());
        if (!round) {
          return {
            status: 404,
            body: {
              error: "round not tracked",
              roundId: roundId.toString(),
              roundIds: full.rounds.map((r) => r.roundId),
            },
          };
        }
        return { status: 200, body: round };
      },
    },
    {
      method: "GET",
      pattern: /^\/status\/health\/?$/,
      handler: async () => {
        const full = await buildKeeperStatus(baseSource());
        return { status: 200, body: { health: full.health, now: full.now } };
      },
    },
    {
      method: "GET",
      pattern: /^\/$/,
      handler: async () => {
        return {
          status: 200,
          body: {
            service: "sub-rosa-keeper-status",
            endpoints: ["GET /status", "GET /status/rounds/:id", "GET /healthz", "GET /status/health"],
          },
        };
      },
    },
  ];
}

function healthzHandler(
  src: BuildStatusSource,
): (url: URL) => Promise<{ status: number; body: unknown }> {
  const { clock } = resolveTimeContext(systemTime, src.time);
  return async () => {
    try {
      const info = await src.drand.chain().info();
      await src.reader.getRound(0n);
      return {
        status: 200,
        body: {
          ok: true,
          drand: {
            genesisTime: info.genesis_time,
            period: info.period,
          },
          contractId: src.contractId,
          network: src.network,
          now: clock.toISOString(),
        },
      };
    } catch (e) {
      const detail = getErrorMessage(e);
      (src.logger ?? diagnostics).error("keeper-healthz-health-check-failed", "[keeper-healthz] health check failed:", { "detail_0": detail });
      return {
        status: 503,
        body: {
          ok: false,
          reason: "health check failed",
          now: clock.toISOString(),
        },
      };
    }
  };
}

export function createStatusServer(config: StatusServerConfig): http.Server {
  const host = config.host ?? process.env.KEEPER_STATUS_HOST ?? "127.0.0.1";
  const port = config.port ?? Number(process.env.KEEPER_STATUS_PORT ?? "8090");

  const source: BuildStatusSource = {
    logger: config.logger,
    reader: config.reader,
    drand: config.drand,
    storeRounds: config.storeRounds,
    contractId: config.contractId,
    network: config.network,
    settleIndicator: config.settleIndicator,
    epochMs: config.epochMs ?? systemClock.nowMs(),
  };

  const dynamic = makeRoutes(source);
  const fastHealth = healthzHandler(source);

  const server = http.createServer((req, res) => {
    try {
      const baseHost = req.headers.host ?? `${host}:${port}`;
      const url = new URL(req.url ?? "/", `http://${baseHost}`);

      if (req.method === "GET" && url.pathname === "/healthz") {
        void fastHealth(url).then((r) => send(res, r.status, r.body));
        return;
      }

      const match = dynamic.find(
        (r) => r.method === req.method && r.pattern.test(url.pathname),
      );
      if (!match) {
        send(res, 404, {
          error: "not found",
          path: url.pathname,
          available: ["GET /status", "GET /status/rounds/:id", "GET /healthz", "GET /status/health"],
        });
        return;
      }

      readJson(req)
        .then((body) => match.handler(url, body))
        .then((r) => send(res, r.status, r.body))
        .catch((e) => {
          send(res, 500, { error: getErrorMessage(e) });
        });
    } catch (e) {
      send(res, 500, { error: getErrorMessage(e) });
    }
  });

  // Stash socket hints so tests / callers can probe the bound address server-side
  server.once("listening", () => {
    const addr = server.address();
    if (addr && typeof addr === "object") {
      process.stdout.write(`[status-api] listening on http://${addr.address}:${addr.port}\n`);
    }
  });

  server.listen(port, host);
  return server;
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (req.method === "GET" || req.method === "HEAD") {
      resolve(undefined);
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      if (raw.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(raw.toString("utf8")));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export interface StatusServerHandle {
  server: http.Server;
  close: () => Promise<void>;
}

export function withGracefulShutdown(server: http.Server, signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"]): StatusServerHandle {
  let stopping = false;
  const onSig = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => process.exit(0));
    systemScheduler.setTimeout(() => process.exit(1), 5000);
  };
  for (const sig of signals) process.on(sig, onSig);

  return {
    server,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
