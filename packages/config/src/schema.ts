import { getSystemEnv } from "./system.js";

/**
 * Creates an immutable typed configuration factory from a parser function.
 *
 * @param parser Function mapping an environment record to a typed configuration.
 * @returns Factory function accepting an optional environment override and returning a frozen configuration.
 */
export function defineSchema<T extends object>(
  parser: (env: Record<string, string | undefined>) => T,
): (env?: Record<string, string | undefined>) => Readonly<T> {
  return (env?: Record<string, string | undefined>): Readonly<T> => {
    const resolvedEnv = env ?? getSystemEnv();
    const config = parser(resolvedEnv);
    return Object.freeze(config);
  };
}
