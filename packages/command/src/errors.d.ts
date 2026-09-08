export declare const ExitCode: {
  readonly SUCCESS: 0;
  readonly UNEXPECTED: 1;
  readonly USAGE: 2;
  readonly CONFIG: 3;
  readonly DEPENDENCY: 4;
  readonly INTERRUPTED: 130;
};

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export declare class CommandError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode?: number);
}

export declare class UsageError extends CommandError {
  constructor(message: string);
}

export declare class ConfigError extends CommandError {
  constructor(message: string);
}

export declare class DependencyError extends CommandError {
  constructor(message: string);
}

export declare class InterruptedError extends CommandError {
  constructor(message?: string);
}
