import {
  collectSecrets,
  redactSensitive,
  scrubText,
} from "./redact.js";
import {
  extractErrorCode,
  getSafePublicMessage,
  isRetryable as checkRetryable,
} from "./classify.js";
import type {
  AssertableError,
  INormalizedError,
  NormalizeOptions,
  OperatorDiagnostics,
} from "./types.js";

const STANDARD_KEYS = new Set([
  "name",
  "message",
  "stack",
  "cause",
  "code",
  "status",
  "statusCode",
  "kind",
  "retryable",
  "isRetryable",
  "publicMessage",
]);

/**
 * Normalized error class extending Error and providing structured diagnostic methods.
 */
export class NormalizedError extends Error implements INormalizedError {
  readonly name: string;
  readonly message: string;
  readonly code?: string | number;
  readonly cause?: NormalizedError;
  readonly stack?: string;
  readonly retryable: boolean;
  readonly context?: Record<string, unknown>;
  readonly publicMessage: string;
  readonly raw?: unknown;

  constructor(init: {
    name: string;
    message: string;
    code?: string | number;
    cause?: NormalizedError;
    stack?: string;
    retryable?: boolean;
    context?: Record<string, unknown>;
    publicMessage?: string;
    raw?: unknown;
  }) {
    super(init.message);
    this.name = init.name;
    this.message = init.message;
    this.code = init.code;
    this.cause = init.cause;
    this.stack = init.stack;
    this.retryable = Boolean(init.retryable);
    this.context = init.context;
    this.publicMessage =
      init.publicMessage ?? getSafePublicMessage(init.name, init.message, init.code);
    this.raw = init.raw;

    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Produces a stable, snapshot-friendly representation without volatile stack traces.
   */
  toAssertable(): AssertableError {
    const out: AssertableError = {
      name: this.name,
      message: this.message,
      retryable: this.retryable,
      publicMessage: this.publicMessage,
    };
    if (this.code !== undefined) {
      out.code = this.code;
    }
    if (this.context !== undefined) {
      out.context = this.context;
    }
    if (this.cause instanceof NormalizedError) {
      out.cause = this.cause.toAssertable();
    }
    return out;
  }

  /**
   * Returns a complete operator diagnostics payload including scrubbed stack and cause chain.
   */
  toOperatorDiagnostics(): OperatorDiagnostics {
    const causes: NonNullable<OperatorDiagnostics["causes"]> = [];
    let cur = this.cause;
    while (cur instanceof NormalizedError) {
      causes.push({
        name: cur.name,
        message: cur.message,
        code: cur.code,
        stack: cur.stack,
      });
      cur = cur.cause;
    }

    const out: OperatorDiagnostics = {
      name: this.name,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.code !== undefined) {
      out.code = this.code;
    }
    if (this.stack) {
      out.stack = this.stack;
    }
    if (this.context) {
      out.context = this.context;
    }
    if (causes.length > 0) {
      out.causes = causes;
    }
    return out;
  }

  override toString(): string {
    const prefix = this.code !== undefined ? `${this.name} [${this.code}]` : this.name;
    return `${prefix}: ${this.message}`;
  }
}

/**
 * Internal recursive normalization engine tracking cycle prevention and depth.
 */
function normalizeInternal(
  err: unknown,
  options: NormalizeOptions = {},
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): NormalizedError {
  if (depth > (options.maxDepth ?? 10)) {
    return new NormalizedError({
      name: "DepthLimitExceededError",
      message: "Error cause nesting limit reached",
      retryable: false,
    });
  }

  const dynamicSecrets = new Set<string>();
  collectSecrets(err, dynamicSecrets);

  if (err instanceof NormalizedError && depth === 0 && !options.code && !options.publicMessage) {
    return err;
  }

  if (err === null || err === undefined) {
    const message = `Unknown error (${String(err)})`;
    return new NormalizedError({
      name: "Error",
      message,
      code: options.code,
      retryable: options.retryable ?? false,
      publicMessage: options.publicMessage ?? "An unknown error occurred.",
      raw: err,
    });
  }

  if (typeof err === "string") {
    const scrubbed = scrubText(err, dynamicSecrets);
    const code = options.code;
    const retryable = options.retryable ?? checkRetryable(null, code, scrubbed);
    return new NormalizedError({
      name: "Error",
      message: scrubbed,
      code,
      retryable,
      publicMessage: options.publicMessage ?? getSafePublicMessage("Error", scrubbed, code),
      raw: err,
    });
  }

  if (typeof err === "number" || typeof err === "bigint" || typeof err === "boolean") {
    const message = String(err);
    return new NormalizedError({
      name: "Error",
      message,
      code: options.code,
      retryable: options.retryable ?? false,
      publicMessage: options.publicMessage ?? "An unexpected error occurred.",
      raw: err,
    });
  }

  if (typeof err === "symbol") {
    const message = err.toString();
    return new NormalizedError({
      name: "Error",
      message,
      code: options.code,
      retryable: options.retryable ?? false,
      publicMessage: options.publicMessage ?? "An unexpected error occurred.",
      raw: err,
    });
  }

  if (typeof err === "function") {
    return new NormalizedError({
      name: "Error",
      message: `[Function ${err.name || "anonymous"}]`,
      code: options.code,
      retryable: options.retryable ?? false,
      publicMessage: options.publicMessage ?? "An unexpected error occurred.",
      raw: err,
    });
  }

  if (typeof err === "object") {
    if (seen.has(err)) {
      return new NormalizedError({
        name: "CircularError",
        message: "[Circular cause]",
        retryable: false,
        raw: err,
      });
    }
    seen.add(err);

    let rawName = "Error";
    let rawMessage = "";
    let rawStack: string | undefined = undefined;
    let causeVal: unknown = undefined;

    try {
      const obj = err as Record<string, unknown>;
      if (typeof obj.name === "string" && obj.name.trim()) {
        rawName = obj.name;
      } else if (err instanceof Error && err.constructor?.name) {
        rawName = err.constructor.name;
      }

      if (typeof obj.message === "string") {
        rawMessage = obj.message;
      } else if (typeof obj.error === "string") {
        rawMessage = obj.error;
      } else if (obj.error && typeof obj.error === "object") {
        const nested = obj.error as Record<string, unknown>;
        if (typeof nested.message === "string") {
          rawMessage = nested.message;
        }
      } else if (typeof obj.statusText === "string") {
        rawMessage = obj.statusText;
      }

      if (typeof obj.stack === "string") {
        rawStack = obj.stack;
      }

      if ("cause" in obj) {
        causeVal = obj.cause;
      }
    } catch {
      rawMessage = "[Unserializable object]";
    }

    const code = options.code ?? extractErrorCode(err);
    const message = scrubText(rawMessage || "Unknown error", dynamicSecrets);
    const stack = rawStack ? scrubText(rawStack, dynamicSecrets) : undefined;
    const retryable = options.retryable ?? checkRetryable(err, code, message);

    let context: Record<string, unknown> | undefined = undefined;
    try {
      const extracted: Record<string, unknown> = {};
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(err))) {
        if (STANDARD_KEYS.has(key)) continue;
        if ("value" in descriptor) {
          extracted[key] = redactSensitive(descriptor.value, dynamicSecrets);
        }
      }
      if (options.context) {
        for (const [k, v] of Object.entries(options.context)) {
          extracted[k] = redactSensitive(v, dynamicSecrets);
        }
      }
      if (Object.keys(extracted).length > 0) {
        context = extracted;
      }
    } catch {
      context = undefined;
    }

    let normalizedCause: NormalizedError | undefined = undefined;
    if (causeVal !== undefined && causeVal !== null) {
      normalizedCause = normalizeInternal(causeVal, {}, seen, depth + 1);
    }

    return new NormalizedError({
      name: rawName,
      message,
      code,
      cause: normalizedCause,
      stack,
      retryable,
      context,
      publicMessage: options.publicMessage ?? getSafePublicMessage(rawName, message, code),
      raw: err,
    });
  }

  return new NormalizedError({
    name: "Error",
    message: String(err),
    code: options.code,
    retryable: options.retryable ?? false,
    publicMessage: options.publicMessage ?? "An unexpected error occurred.",
    raw: err,
  });
}

/**
 * Normalizes any unknown thrown value into a structured NormalizedError instance.
 */
export function normalizeError(err: unknown, options: NormalizeOptions = {}): NormalizedError {
  return normalizeInternal(err, options);
}

/**
 * Extracts a normalized, secret-scrubbed message string from any caught value.
 */
export function getErrorMessage(err: unknown, options: NormalizeOptions = {}): string {
  return normalizeError(err, options).message;
}

/**
 * Extracts a safe public or user-facing message string from any caught value.
 */
export function getPublicErrorMessage(err: unknown, options: NormalizeOptions = {}): string {
  return normalizeError(err, options).publicMessage;
}

/**
 * Evaluates whether a caught value indicates a retryable condition.
 */
export function isRetryableError(err: unknown): boolean {
  return normalizeError(err).retryable;
}

/**
 * Produces a stable, snapshot-safe assertion object for an unknown caught value.
 */
export function toAssertableError(err: unknown, options: NormalizeOptions = {}): AssertableError {
  return normalizeError(err, options).toAssertable();
}

/**
 * Produces an operator diagnostics summary for an unknown caught value.
 */
export function toOperatorDiagnostics(
  err: unknown,
  options: NormalizeOptions = {},
): OperatorDiagnostics {
  return normalizeError(err, options).toOperatorDiagnostics();
}
