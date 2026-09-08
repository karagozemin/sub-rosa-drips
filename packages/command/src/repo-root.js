import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Ascends the filesystem hierarchy to find the repository root directory.
 *
 * @param {string} [startDir] - Initial directory to start searching from.
 * @returns {string} - Absolute path to the repository root.
 */
export function findRepoRoot(startDir) {
  let current = resolve(startDir || process.cwd());
  while (true) {
    if (
      existsSync(resolve(current, "pnpm-workspace.yaml")) ||
      existsSync(resolve(current, ".git"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(startDir || process.cwd());
    }
    current = parent;
  }
}
