/**
 * Approved bootstrap adapter reading the Node.js process environment.
 *
 * @returns Record of environment variable keys and values.
 */
export function getSystemEnv(): Record<string, string | undefined> {
  if (typeof process !== "undefined" && process.env) {
    return process.env;
  }
  return {};
}
