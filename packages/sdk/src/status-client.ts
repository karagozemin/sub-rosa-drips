// SPDX-License-Identifier: MIT
// Fetch helpers for the keeper status API. These are intentionally tiny
// wrappers over `fetch` so they work unchanged in Node 22+, the browser, or a
// Lambda — no `axios`, no generated client. Status endpoints are read-only
// and return stable typed JSON (see ../status.ts).

import type {
  KeeperHealthResponse,
  KeeperStatusResponse,
  KeeperRoundStatusView,
  ApiError,
} from "./status.js";

export interface StatusClientOptions {
  baseURL: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
}

export class StatusApiError extends Error {
  status: number;
  data: ApiError;
  constructor(status: number, data: ApiError) {
    super(data.error ?? `status api returned ${status}`);
    this.name = "StatusApiError";
    this.status = status;
    this.data = data;
  }
}

/** Raised when a successful HTTP response body is empty or not valid JSON. */
export class StatusJsonParseError extends Error {
  readonly name = "StatusJsonParseError";
  readonly status: number;

  constructor(status: number, options?: ErrorOptions) {
    super(`status api returned ${status} with invalid JSON body`, options);
    this.status = status;
  }
}

function fullURL(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, "");
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${trimmed}${clean}`;
}

async function parseErrorBody(res: Response): Promise<ApiError> {
  const text = await res.text();
  if (!text.trim()) return { error: `status api returned ${res.status}` };
  try {
    return JSON.parse(text) as ApiError;
  } catch {
    return { error: "invalid JSON body" };
  }
}

async function parseSuccessBody<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new StatusJsonParseError(res.status);
  }
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new StatusJsonParseError(res.status, { cause });
  }
}

export class KeeperStatusClient {
  readonly baseURL: string;
  readonly fetchImpl: typeof fetch;
  readonly headers: Record<string, string>;

  constructor(opts: StatusClientOptions) {
    this.baseURL = opts.baseURL;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.headers = opts.headers ?? {};
    if (!this.fetchImpl) {
      throw new Error(
        "No global fetch found. Pass `fetchImpl` in StatusClientOptions.",
      );
    }
  }

  async getStatus(): Promise<KeeperStatusResponse> {
    return this.getJSON<KeeperStatusResponse>("/status");
  }

  async getRound(roundId: number | bigint | string): Promise<KeeperRoundStatusView> {
    return this.getJSON<KeeperRoundStatusView>(`/status/rounds/${roundId}`);
  }

  async getHealth(): Promise<KeeperHealthResponse> {
    return this.getJSON<KeeperHealthResponse>("/status/health");
  }

  async healthz(): Promise<{ ok: boolean; [k: string]: unknown }> {
    return this.getJSON<{ ok: boolean; [k: string]: unknown }>("/healthz");
  }

  async getJSON<T>(path: string): Promise<T> {
    const url = fullURL(this.baseURL, path);
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", ...this.headers },
    });
    if (!res.ok) {
      const body = await parseErrorBody(res);
      throw new StatusApiError(res.status, body);
    }
    return parseSuccessBody<T>(res);
  }
}

// Convenience — one-shot status fetch without constructing a client.
export async function fetchKeeperStatus(baseURL: string): Promise<KeeperStatusResponse> {
  return new KeeperStatusClient({ baseURL }).getStatus();
}
