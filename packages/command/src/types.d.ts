import type { Logger } from "@sub-rosa/logging";
import type { ExitCode } from "./errors.js";

export interface CommandOption {
  type: "string" | "boolean";
  short?: string;
  description?: string;
  default?: string | boolean | string[];
  multiple?: boolean;
}

export interface PositionalDescription {
  name: string;
  description: string;
  required?: boolean;
}

export interface CommandContext<TValues = Record<string, any>> {
  args: TValues;
  options: TValues;
  positionals: string[];
  rawArgs: string[];
  env: Record<string, string | undefined>;
  signal: AbortSignal;
  registerCleanup: (cleanup: () => Promise<void> | void) => void;
  logger: Logger;
  repoRoot: string;
  resolvePath: (...segments: string[]) => string;
}

export interface CommandDefinition<TValues = Record<string, any>> {
  name: string;
  description: string;
  usage?: string;
  options?: Record<string, CommandOption>;
  positionals?: PositionalDescription[];
  requiredEnv?: string[];
  parseArgs?: (rawArgs: string[]) => { args: TValues; positionals: string[] };
  preflight?: (ctx: CommandContext<TValues>) => Promise<void> | void;
  run: (ctx: CommandContext<TValues>) => Promise<number | void> | number | void;
}

export interface RunOptions {
  argv?: string[];
  env?: Record<string, string | undefined>;
  repoRoot?: string;
  signal?: AbortSignal;
  terminate?: boolean;
  stdout?: { write: (chunk: string) => boolean | void };
  stderr?: { write: (chunk: string) => boolean | void };
}
