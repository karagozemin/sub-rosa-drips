import { parseArgs } from "node:util";
import { isAbsolute, resolve } from "node:path";
import { createLogger } from "@sub-rosa/logging";
import {
  CommandError,
  ConfigError,
  ExitCode,
  InterruptedError,
  UsageError,
} from "./errors.js";
import { findRepoRoot } from "./repo-root.js";

/**
 * Formats help text for a command definition.
 *
 * @param {import("./types.js").CommandDefinition<any>} definition
 * @returns {string}
 */
export function formatHelp(definition) {
  const lines = [];
  const usage = definition.usage || "[options]";
  lines.push(`Usage: ${definition.name} ${usage}`);
  lines.push("");
  lines.push(definition.description);
  lines.push("");

  /** @type {Record<string, import("./types.js").CommandOption>} */
  const options = {
    help: { type: "boolean", short: "h", description: "Show help" },
    ...(definition.options || {}),
  };

  lines.push("Options:");
  for (const [key, opt] of Object.entries(options)) {
    const flag = opt.short ? `-${opt.short}, --${key}` : `    --${key}`;
    const desc = opt.description || "";
    const def = opt.default !== undefined ? ` (default: ${JSON.stringify(opt.default)})` : "";
    lines.push(`  ${flag.padEnd(20)} ${desc}${def}`);
  }

  if (definition.positionals && definition.positionals.length > 0) {
    lines.push("");
    lines.push("Positional Arguments:");
    for (const pos of definition.positionals) {
      const req = pos.required ? " (required)" : " (optional)";
      lines.push(`  ${pos.name.padEnd(20)} ${pos.description}${req}`);
    }
  }

  if (definition.requiredEnv && definition.requiredEnv.length > 0) {
    lines.push("");
    lines.push("Required Environment Variables:");
    for (const envVar of definition.requiredEnv) {
      lines.push(`  ${envVar.padEnd(20)} Required`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Executes a command definition with lifecycle management.
 *
 * @template [TValues=Record<string, any>]
 * @param {import("./types.js").CommandDefinition<TValues>} definition
 * @param {import("./types.js").RunOptions} [options={}]
 * @returns {Promise<number>}
 */
export async function runCommand(definition, options = {}) {
  const rawArgs = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const shouldTerminate = options.terminate ?? true;
  const repoRoot = options.repoRoot ?? findRepoRoot(process.cwd());
  const logger = createLogger(definition.name);

  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    stdout.write(formatHelp(definition));
    if (shouldTerminate) {
      process.exit(ExitCode.SUCCESS);
    }
    return ExitCode.SUCCESS;
  }

  /** @type {Array<() => Promise<void> | void>} */
  const cleanups = [];
  let cleanupsExecuted = false;

  const runCleanups = async () => {
    if (cleanupsExecuted) {
      return;
    }
    cleanupsExecuted = true;
    const reversed = cleanups.slice().reverse();
    for (const cleanup of reversed) {
      try {
        await cleanup();
      } catch (cleanupError) {
        const msg = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        stderr.write(`Cleanup error: ${msg}\n`);
      }
    }
  };

  const abortController = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) {
      abortController.abort(options.signal.reason);
    } else {
      options.signal.addEventListener("abort", () => {
        abortController.abort(options.signal?.reason);
      }, { once: true });
    }
  }

  let interruptedBySignal = false;
  /** @type {((sig: string) => void) | null} */
  let sigHandler = null;

  if (shouldTerminate) {
    sigHandler = (sig) => {
      interruptedBySignal = true;
      abortController.abort(new InterruptedError(`Interrupted by ${sig}`));
      runCleanups().finally(() => {
        process.exit(ExitCode.INTERRUPTED);
      });
    };
    process.once("SIGINT", sigHandler);
    process.once("SIGTERM", sigHandler);
  }

  /**
   * @param {...string} segments
   * @returns {string}
   */
  const resolvePath = (...segments) => {
    const combined = segments.length === 1 ? segments[0] : resolve(...segments);
    return isAbsolute(combined) ? combined : resolve(repoRoot, combined);
  };

  let parsedArgs = /** @type {TValues} */ ({});
  let positionals = /** @type {string[]} */ ([]);

  try {
    if (definition.parseArgs) {
      const parsed = definition.parseArgs(rawArgs);
      parsedArgs = parsed.args;
      positionals = parsed.positionals;
    } else {
      /** @type {Record<string, { type: "string" | "boolean"; short?: string; default?: any; multiple?: boolean }>} */
      const schemaOptions = {
        help: { type: "boolean", short: "h" },
      };
      if (definition.options) {
        for (const [key, opt] of Object.entries(definition.options)) {
          /** @type {{ type: "string" | "boolean"; short?: string; default?: any; multiple?: boolean }} */
          const entry = { type: opt.type };
          if (opt.short !== undefined) {
            entry.short = opt.short;
          }
          if (opt.default !== undefined) {
            entry.default = opt.default;
          }
          if (opt.multiple !== undefined) {
            entry.multiple = opt.multiple;
          }
          schemaOptions[key] = entry;
        }
      }

      try {
        const result = parseArgs({
          args: rawArgs,
          options: schemaOptions,
          allowPositionals: true,
          strict: true,
        });
        parsedArgs = /** @type {TValues} */ (result.values);
        positionals = result.positionals;
      } catch (parseError) {
        const msg = parseError instanceof Error ? parseError.message : String(parseError);
        throw new UsageError(msg);
      }
    }

    if (definition.positionals) {
      for (let i = 0; i < definition.positionals.length; i++) {
        const posDef = definition.positionals[i];
        if (posDef.required && !positionals[i]) {
          throw new UsageError(`Missing required argument: <${posDef.name}>`);
        }
      }
    }

    if (definition.requiredEnv) {
      for (const envName of definition.requiredEnv) {
        if (!env[envName]) {
          throw new ConfigError(`Missing required environment variable: ${envName}`);
        }
      }
    }

    /** @type {import("./types.js").CommandContext<TValues>} */
    const ctx = {
      args: parsedArgs,
      options: parsedArgs,
      positionals,
      rawArgs,
      env,
      signal: abortController.signal,
      registerCleanup: (fn) => {
        cleanups.push(fn);
      },
      logger,
      repoRoot,
      resolvePath,
    };

    if (definition.preflight) {
      await definition.preflight(ctx);
    }

    const runResult = await definition.run(ctx);
    const finalExitCode = typeof runResult === "number" ? runResult : ExitCode.SUCCESS;

    await runCleanups();
    if (sigHandler) {
      process.removeListener("SIGINT", sigHandler);
      process.removeListener("SIGTERM", sigHandler);
    }

    if (shouldTerminate) {
      process.exit(finalExitCode);
    }
    return finalExitCode;
  } catch (error) {
    /** @type {number} */
    let exitCode = ExitCode.UNEXPECTED;
    if (interruptedBySignal || abortController.signal.aborted) {
      exitCode = ExitCode.INTERRUPTED;
    } else if (error instanceof CommandError) {
      exitCode = error.exitCode;
    }

    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${definition.name} failed: ${message}\n`);

    await runCleanups();
    if (sigHandler) {
      process.removeListener("SIGINT", sigHandler);
      process.removeListener("SIGTERM", sigHandler);
    }

    if (shouldTerminate) {
      process.exit(exitCode);
    }
    return exitCode;
  }
}
