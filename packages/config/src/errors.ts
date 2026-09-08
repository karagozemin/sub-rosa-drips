/**
 * Configuration error codes categorizing environment read failures.
 */
export type ConfigErrorCode = "MISSING" | "EMPTY" | "MALFORMED";

/**
 * Base error class for all configuration read and validation failures.
 */
export class ConfigError extends Error {
  readonly key: string;
  readonly variable: string;
  readonly code: ConfigErrorCode;

  /**
   * Constructs a new ConfigError.
   *
   * @param key Environment variable key name.
   * @param message Failure description without secrets.
   * @param code Error category code.
   * @param options Standard ErrorOptions containing cause.
   */
  constructor(
    key: string,
    message: string,
    code: ConfigErrorCode = "MALFORMED",
    options?: ErrorOptions,
  ) {
    super(`${key}: ${message}`, options);
    this.name = "ConfigError";
    this.key = key;
    this.variable = key;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when a required environment variable is not defined.
 */
export class MissingEnvironmentVariableError extends ConfigError {
  /**
   * Constructs a new MissingEnvironmentVariableError.
   *
   * @param key Environment variable key name.
   * @param message Optional detail message.
   */
  constructor(key: string, message: string = "required environment variable is missing") {
    super(key, message, "MISSING");
    this.name = "MissingEnvironmentVariableError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when an environment variable is defined but contains only whitespace.
 */
export class EmptyEnvironmentVariableError extends ConfigError {
  /**
   * Constructs a new EmptyEnvironmentVariableError.
   *
   * @param key Environment variable key name.
   * @param message Optional detail message.
   */
  constructor(key: string, message: string = "environment variable cannot be empty") {
    super(key, message, "EMPTY");
    this.name = "EmptyEnvironmentVariableError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when an environment variable fails format or type parsing.
 */
export class MalformedEnvironmentVariableError extends ConfigError {
  /**
   * Constructs a new MalformedEnvironmentVariableError.
   *
   * @param key Environment variable key name.
   * @param message Parsing failure explanation without sensitive data.
   * @param options Standard ErrorOptions containing cause.
   */
  constructor(key: string, message: string, options?: ErrorOptions) {
    super(key, message, "MALFORMED", options);
    this.name = "MalformedEnvironmentVariableError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
