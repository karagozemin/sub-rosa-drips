/**
 * Approved bootstrap adapter reading the Vite browser environment.
 *
 * @param customEnv Optional environment map override for testing.
 * @returns Record of environment variable keys and values.
 */
export function getBrowserEnv(
  customEnv?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (customEnv) {
    return customEnv;
  }
  try {
    return (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  } catch {
    return {};
  }
}
