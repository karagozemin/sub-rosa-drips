// SPDX-License-Identifier: MIT
'use strict';

const REDACTED = '[REDACTED]';
const sensitive = (key) => /secret|token|password|passwd|privatekey|credential|cookie|authorization|apikey|mnemonic|seedphrase/i.test(key.replace(/[^a-z0-9]/gi, ''));

function scrubText(value, secrets) {
  let text = value
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:[^=&\s]*(?:secret|token|password|credential|api[_-]?key)[^=&\s]*)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, '$1 [REDACTED]')
    .replace(/\bS[A-Z2-7]{55}\b/g, REDACTED)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, REDACTED);
  for (const secret of secrets) text = text.split(secret).join(REDACTED);
  return text;
}

function collectSecrets(value, secrets, seen = new WeakSet(), depth = 0) {
  if (!value || typeof value !== 'object' || depth > 32 || seen.has(value)) return;
  seen.add(value);
  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!('value' in descriptor)) continue;
      if (sensitive(key)) {
        const hidden = descriptor.value;
        if (typeof hidden === 'string' && hidden.length >= 4) secrets.add(hidden);
        else collectSecrets(hidden, secrets, seen, depth + 1);
      } else collectSecrets(descriptor.value, secrets, seen, depth + 1);
    }
  } catch { /* Uninspectable proxies are replaced during serialization. */ }
}

function serialize(value, secrets, seen = new WeakSet(), depth = 0) {
  if (typeof value === 'string') return scrubText(value, secrets);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (value === undefined) return null;
  if (typeof value !== 'object') return `[${typeof value}]`;
  if (depth > 32) return '[MaxDepth]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output = Array.isArray(value) ? [] : Object.create(null);
    if (value instanceof Error) {
      output.name = typeof value.name === 'string' ? scrubText(value.name, secrets) : 'Error';
      output.message = serialize(value.message, secrets, seen, depth + 1);
      if (typeof value.stack === 'string') output.stack = scrubText(value.stack, secrets);
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === 'length') continue;
      output[key] = sensitive(key) ? REDACTED : 'value' in descriptor
        ? serialize(descriptor.value, secrets, seen, depth + 1) : '[Accessor]';
    }
    return output;
  } catch {
    return '[Unserializable]';
  } finally {
    seen.delete(value);
  }
}

/** The only diagnostic transport boundary. Browser builds use their console sink. */
function defaultSink(line, level) {
  if (typeof process !== 'undefined' && process.stdout?.write && process.stderr?.write) {
    const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
    stream.write(line + '\n');
  } else {
    const method = level === 'warn' || level === 'error' ? level : 'info';
    globalThis.console?.[method]?.(line);
  }
}

function createLogger(component, options = {}) {
  const sink = options.sink ?? defaultSink;
  // Scripts running in plain Node need no TypeScript loader. Callers can inject their shared clock.
  const clock = options.clock ?? (() => new Date().toISOString());
  const logger = {};
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (event, message, context) => {
      try {
        const secrets = new Set();
        collectSecrets(message, secrets);
        collectSecrets(context, secrets);
        const record = {
          timestamp: clock(), level, component: scrubText(component, secrets), event: scrubText(event, secrets),
        };
        if (message !== undefined) record.message = serialize(message, secrets);
        if (context !== undefined) record.context = serialize(context, secrets);
        sink(JSON.stringify(record), level);
      } catch { /* Logging must not change command success or failure behavior. */ }
    };
  }
  return Object.freeze(logger);
}

/** Machine-readable command results are data, not diagnostic records. */
function writeData(text) {
  process.stdout.write(text + '\n');
}

exports.createLogger = createLogger;
exports.writeData = writeData;
