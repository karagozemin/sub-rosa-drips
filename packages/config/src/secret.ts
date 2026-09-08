const SECRET_BRAND = Symbol("sub-rosa.secret");

/**
 * Opaque container for sensitive configuration values preventing accidental logging.
 */
export class SecretValue<T = string> {
  private readonly [SECRET_BRAND]: true = true;
  private readonly raw: T;

  /**
   * Constructs a new SecretValue wrapper.
   *
   * @param value Underlying secret data.
   */
  constructor(value: T) {
    this.raw = value;
    Object.freeze(this);
  }

  /**
   * Retrieves the raw secret value for cryptographic and authentication operations.
   *
   * @returns Unredacted secret content.
   */
  unwrap(): T {
    return this.raw;
  }

  /**
   * Redacted string representation.
   *
   * @returns Constant redacted marker.
   */
  toString(): string {
    return "[REDACTED]";
  }

  /**
   * Redacted JSON representation.
   *
   * @returns Constant redacted marker.
   */
  toJSON(): string {
    return "[REDACTED]";
  }

  /**
   * Custom inspect formatter for Node.js util.inspect and console output.
   *
   * @returns Constant redacted marker.
   */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "[REDACTED]";
  }

  /**
   * Primitive coercion handler returning the redacted marker.
   *
   * @returns Constant redacted marker.
   */
  [Symbol.toPrimitive](): string {
    return "[REDACTED]";
  }
}

/**
 * Wraps a sensitive string or payload in an opaque SecretValue container.
 *
 * @param value Sensitive configuration value.
 * @returns Wrapped SecretValue.
 */
export function secret<T>(value: T): SecretValue<T> {
  return new SecretValue(value);
}

/**
 * Checks whether an arbitrary value is a SecretValue container.
 *
 * @param value Value to check.
 * @returns Type predicate indicating SecretValue.
 */
export function isSecret(value: unknown): value is SecretValue<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[SECRET_BRAND] === true
  );
}
