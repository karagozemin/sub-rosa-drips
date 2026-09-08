/**
 * Stable exit-code categories for command execution.
 */
export const ExitCode = Object.freeze({
  SUCCESS: 0,
  UNEXPECTED: 1,
  USAGE: 2,
  CONFIG: 3,
  DEPENDENCY: 4,
  INTERRUPTED: 130,
});

/**
 * Base error class for operational command failures with exit codes.
 */
export class CommandError extends Error {
  /**
   * @param {string} message
   * @param {number} [exitCode=ExitCode.UNEXPECTED]
   */
  constructor(message, exitCode = ExitCode.UNEXPECTED) {
    super(message);
    this.name = "CommandError";
    this.exitCode = exitCode;
  }
}

/**
 * Error indicating invalid CLI arguments, options, or command usage.
 */
export class UsageError extends CommandError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message, ExitCode.USAGE);
    this.name = "UsageError";
  }
}

/**
 * Error indicating missing or invalid environment variables or configuration.
 */
export class ConfigError extends CommandError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message, ExitCode.CONFIG);
    this.name = "ConfigError";
  }
}

/**
 * Error indicating external service, binary, RPC, or network failure.
 */
export class DependencyError extends CommandError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message, ExitCode.DEPENDENCY);
    this.name = "DependencyError";
  }
}

/**
 * Error indicating process cancellation via abort signal or interrupt.
 */
export class InterruptedError extends CommandError {
  /**
   * @param {string} [message="Command interrupted"]
   */
  constructor(message = "Command interrupted") {
    super(message, ExitCode.INTERRUPTED);
    this.name = "InterruptedError";
  }
}
