import type { CommandDefinition, RunOptions } from "./types.js";

/**
 * Formats help text for a command definition.
 *
 * @param definition - Command definition to generate help text for.
 * @returns Formatted help string.
 */
export declare function formatHelp(definition: CommandDefinition<any>): string;

/**
 * Executes a command definition with lifecycle management.
 *
 * @param definition - Command specification including arguments, environment, and run handler.
 * @param options - Execution options controlling arguments, environment, streams, and termination.
 * @returns Promise resolving to the numeric exit code.
 */
export declare function runCommand<TValues = Record<string, any>>(
  definition: CommandDefinition<TValues>,
  options?: RunOptions
): Promise<number>;
