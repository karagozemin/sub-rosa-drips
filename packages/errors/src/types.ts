/**
 * Structured options passed to normalizeError.
 */
export interface NormalizeOptions {
  code?: string | number;
  retryable?: boolean;
  context?: Record<string, unknown>;
  publicMessage?: string;
  maxDepth?: number;
}

/**
 * Public serializable representation of an error suitable for snapshot-free assertions.
 */
export interface AssertableError {
  name: string;
  message: string;
  code?: string | number;
  retryable: boolean;
  publicMessage: string;
  context?: Record<string, unknown>;
  cause?: AssertableError;
}

/**
 * Operator diagnostic view containing technical context, scrubbed stack, and cause chain.
 */
export interface OperatorDiagnostics {
  name: string;
  message: string;
  code?: string | number;
  retryable: boolean;
  stack?: string;
  context?: Record<string, unknown>;
  causes?: Array<{
    name: string;
    message: string;
    code?: string | number;
    stack?: string;
  }>;
}

/**
 * Core interface describing a normalized error.
 */
export interface INormalizedError {
  readonly name: string;
  readonly message: string;
  readonly code?: string | number;
  readonly cause?: INormalizedError;
  readonly stack?: string;
  readonly retryable: boolean;
  readonly context?: Record<string, unknown>;
  readonly publicMessage: string;
  readonly raw?: unknown;

  toAssertable(): AssertableError;
  toOperatorDiagnostics(): OperatorDiagnostics;
}
