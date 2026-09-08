export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_RE = /secret|token|password|passwd|privatekey|credential|cookie|authorization|apikey|mnemonic|seedphrase/i;

/**
 * Evaluates whether an object property key contains sensitive terminology.
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key.replace(/[^a-z0-9]/gi, ""));
}

/**
 * Scrubs known secret patterns from a string.
 */
export function scrubText(value: string, dynamicSecrets: ReadonlySet<string> = new Set()): string {
  let text = value
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, "$1[REDACTED]@")
    .replace(/([?&](?:[^=&\s]*(?:secret|token|password|credential|api[_-]?key)[^=&\s]*)=)[^&#\s]*/gi, "$1[REDACTED]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, "$1 [REDACTED]")
    .replace(/((?:cookie|set-cookie)\s*[:=]\s*)[^\r\n;]+/gi, "$1[REDACTED]")
    .replace(/\bS[A-Z2-7]{55}\b/g, REDACTED)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, REDACTED);

  for (const secret of dynamicSecrets) {
    if (secret && secret.length >= 4) {
      text = text.split(secret).join(REDACTED);
    }
  }

  return text;
}

/**
 * Recursively collects sensitive string values from an object graph.
 */
export function collectSecrets(
  value: unknown,
  secrets: Set<string>,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): void {
  if (!value || typeof value !== "object" || depth > 32) return;
  if (seen.has(value)) return;
  seen.add(value);

  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!("value" in descriptor)) continue;
      const val = descriptor.value;
      if (isSensitiveKey(key)) {
        if (typeof val === "string" && val.length >= 4) {
          secrets.add(val);
        } else {
          collectSecrets(val, secrets, seen, depth + 1);
        }
      } else {
        collectSecrets(val, secrets, seen, depth + 1);
      }
    }
  } catch {
    return;
  }
}

/**
 * Recursively redacts secrets and sensitive keys from any arbitrary value.
 */
export function redactSensitive<T>(
  value: T,
  dynamicSecrets: ReadonlySet<string> = new Set(),
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (typeof value === "string") {
    return scrubText(value, dynamicSecrets);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "object") {
    return `[${typeof value}]`;
  }
  if (depth > 32) {
    return "[MaxDepth]";
  }
  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactSensitive(item, dynamicSecrets, seen, depth + 1));
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output: Record<string, unknown> = Object.create(null);

    if (value instanceof Error) {
      output.name = typeof value.name === "string" ? scrubText(value.name, dynamicSecrets) : "Error";
      output.message = typeof value.message === "string" ? scrubText(value.message, dynamicSecrets) : "";
      if (typeof value.stack === "string") {
        output.stack = scrubText(value.stack, dynamicSecrets);
      }
    }

    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (isSensitiveKey(key)) {
        output[key] = REDACTED;
      } else if ("value" in descriptor) {
        output[key] = redactSensitive(descriptor.value, dynamicSecrets, seen, depth + 1);
      } else {
        output[key] = "[Accessor]";
      }
    }
    return output;
  } catch {
    return "[Unserializable]";
  } finally {
    seen.delete(value);
  }
}
