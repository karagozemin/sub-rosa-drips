'use strict';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_RE = /secret|token|password|passwd|privatekey|credential|cookie|authorization|apikey|mnemonic|seedphrase/i;

function isSensitiveKey(key) {
  return SENSITIVE_KEY_RE.test(key.replace(/[^a-z0-9]/gi, ''));
}

function scrubText(value, dynamicSecrets = new Set()) {
  let text = value
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:[^=&\s]*(?:secret|token|password|credential|api[_-]?key)[^=&\s]*)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, '$1 [REDACTED]')
    .replace(/((?:cookie|set-cookie)\s*[:=]\s*)[^\r\n;]+/gi, '$1[REDACTED]')
    .replace(/\bS[A-Z2-7]{55}\b/g, REDACTED)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, REDACTED);

  for (const secret of dynamicSecrets) {
    if (secret && secret.length >= 4) {
      text = text.split(secret).join(REDACTED);
    }
  }

  return text;
}

function collectSecrets(value, secrets, seen = new WeakSet(), depth = 0) {
  if (!value || typeof value !== 'object' || depth > 32) return;
  if (seen.has(value)) return;
  seen.add(value);

  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!('value' in descriptor)) continue;
      const val = descriptor.value;
      if (isSensitiveKey(key)) {
        if (typeof val === 'string' && val.length >= 4) {
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

function redactSensitive(value, dynamicSecrets = new Set(), seen = new WeakSet(), depth = 0) {
  if (typeof value === 'string') return scrubText(value, dynamicSecrets);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (value === undefined) return null;
  if (typeof value !== 'object') return `[${typeof value}]`;
  if (depth > 32) return '[MaxDepth]';
  if (seen.has(value)) return '[Circular]';

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactSensitive(item, dynamicSecrets, seen, depth + 1));
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output = Object.create(null);

    if (value instanceof Error) {
      output.name = typeof value.name === 'string' ? scrubText(value.name, dynamicSecrets) : 'Error';
      output.message = typeof value.message === 'string' ? scrubText(value.message, dynamicSecrets) : '';
      if (typeof value.stack === 'string') {
        output.stack = scrubText(value.stack, dynamicSecrets);
      }
    }

    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (isSensitiveKey(key)) {
        output[key] = REDACTED;
      } else if ('value' in descriptor) {
        output[key] = redactSensitive(descriptor.value, dynamicSecrets, seen, depth + 1);
      } else {
        output[key] = '[Accessor]';
      }
    }
    return output;
  } catch {
    return '[Unserializable]';
  } finally {
    seen.delete(value);
  }
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 502, 503, 504]);
const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const RETRYABLE_PHRASES = [
  'got 425',
  'too early',
  'not published yet',
  'rate limit',
  'network error',
  'fetch failed',
  'timed out',
  'connection refused',
  'connection reset',
  'drand round',
];
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

function extractErrorCode(value) {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value;
  if (typeof obj.code === 'string' || typeof obj.code === 'number') return obj.code;
  if (typeof obj.status === 'number' || typeof obj.status === 'string') return obj.status;
  if (typeof obj.statusCode === 'number' || typeof obj.statusCode === 'string') return obj.statusCode;
  if (typeof obj.kind === 'string') return obj.kind;
  if (obj.error && typeof obj.error === 'object') {
    if (typeof obj.error.code === 'string' || typeof obj.error.code === 'number') return obj.error.code;
  }
  if (obj.response && typeof obj.response === 'object') {
    if (typeof obj.response.status === 'number') return obj.response.status;
  }
  return undefined;
}

function isRetryable(value, code, message) {
  if (value && typeof value === 'object') {
    if (typeof value.retryable === 'boolean') return value.retryable;
    if (typeof value.isRetryable === 'boolean') return value.isRetryable;
  }
  if (typeof code === 'number') {
    if (RETRYABLE_STATUSES.has(code)) return true;
    if (NON_RETRYABLE_STATUSES.has(code)) return false;
  }
  if (typeof code === 'string') {
    const num = Number(code);
    if (!Number.isNaN(num)) {
      if (RETRYABLE_STATUSES.has(num)) return true;
      if (NON_RETRYABLE_STATUSES.has(num)) return false;
    }
    if (RETRYABLE_CODES.has(code.toUpperCase())) return true;
  }
  if (message) {
    const lower = message.toLowerCase();
    for (const phrase of RETRYABLE_PHRASES) {
      if (lower.includes(phrase)) return true;
    }
  }
  return false;
}

function getSafePublicMessage(name, rawMessage, code) {
  const scrubbed = scrubText(rawMessage);
  if (scrubbed.includes('Contract, #10') || code === 10 || code === '10') {
    return 'Commit window closed. Create a fresh round, then commit before Drand reaches reveal.';
  }
  if (scrubbed.includes('Contract, #15') || code === 15 || code === '15') {
    return 'Reveal window closed for this round. Create a new round and open + reveal soon after Drand R (within ~4 minutes).';
  }
  if (scrubbed.includes('got 425') || scrubbed.includes('Error response fetching') || code === 425 || code === '425') {
    return 'Drand R is not published yet. Wait for the countdown, then open + reveal.';
  }
  if (scrubbed.includes('trustline entry is missing')) {
    return 'Wallet is missing the escrow asset trustline. Fund the testnet wallet or use the XLM demo contract.';
  }
  if (/RoundNotFound/i.test(scrubbed) || code === 'RoundNotFound') {
    return 'Round not found.';
  }

  const numericCode = typeof code === 'number' ? code : Number(code);
  if (!Number.isNaN(numericCode)) {
    if (numericCode === 400) return 'Bad request.';
    if (numericCode === 401) return 'Authentication required.';
    if (numericCode === 403) return 'Access denied.';
    if (numericCode === 404) return 'Resource not found.';
    if (numericCode === 429) return 'Rate limit exceeded. Please try again later.';
    if (numericCode === 500) return 'Internal server error.';
    if (numericCode === 502) return 'Bad gateway. The upstream service is temporarily unavailable.';
    if (numericCode === 503) return 'Service temporarily unavailable. Please try again.';
    if (numericCode === 504) return 'Gateway timeout. The upstream service took too long to respond.';
  }

  if (
    scrubbed.includes('fetch failed') ||
    scrubbed.includes('ECONNREFUSED') ||
    scrubbed.includes('ETIMEDOUT') ||
    scrubbed.includes('UND_ERR_CONNECT_TIMEOUT')
  ) {
    return 'Network request failed. Please check your connection and try again.';
  }

  if (name === 'SyntaxError' || scrubbed.includes('Unexpected token')) {
    return 'Invalid response format.';
  }

  const cleanMessage = scrubbed
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0 && !line.trim().startsWith('at ')) || '';

  const sanitized = cleanMessage
    .replace(/(?:\/[a-zA-Z0-9_.-]+)+/g, '[path]')
    .replace(/(?:[a-zA-Z]:\\[a-zA-Z0-9_.-]+)+/g, '[path]');

  if (!sanitized.trim()) {
    return 'An unexpected error occurred.';
  }
  return sanitized.trim();
}

class NormalizedError extends Error {
  constructor(init) {
    super(init.message);
    this.name = init.name;
    this.message = init.message;
    this.code = init.code;
    this.cause = init.cause;
    this.stack = init.stack;
    this.retryable = Boolean(init.retryable);
    this.context = init.context;
    this.publicMessage = init.publicMessage || getSafePublicMessage(init.name, init.message, init.code);
    this.raw = init.raw;
  }

  toAssertable() {
    const out = {
      name: this.name,
      message: this.message,
      retryable: this.retryable,
      publicMessage: this.publicMessage,
    };
    if (this.code !== undefined) out.code = this.code;
    if (this.context !== undefined) out.context = this.context;
    if (this.cause instanceof NormalizedError) out.cause = this.cause.toAssertable();
    return out;
  }

  toOperatorDiagnostics() {
    const causes = [];
    let cur = this.cause;
    while (cur instanceof NormalizedError) {
      causes.push({
        name: cur.name,
        message: cur.message,
        code: cur.code,
        stack: cur.stack,
      });
      cur = cur.cause;
    }

    const out = {
      name: this.name,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.code !== undefined) out.code = this.code;
    if (this.stack) out.stack = this.stack;
    if (this.context) out.context = this.context;
    if (causes.length > 0) out.causes = causes;
    return out;
  }

  toString() {
    const prefix = this.code !== undefined ? `${this.name} [${this.code}]` : this.name;
    return `${prefix}: ${this.message}`;
  }
}

const STANDARD_KEYS = new Set([
  'name',
  'message',
  'stack',
  'cause',
  'code',
  'status',
  'statusCode',
  'kind',
  'retryable',
  'isRetryable',
  'publicMessage',
]);

function normalizeInternal(err, options = {}, seen = new WeakSet(), depth = 0) {
  if (depth > (options.maxDepth ?? 10)) {
    return new NormalizedError({
      name: 'DepthLimitExceededError',
      message: 'Error cause nesting limit reached',
      retryable: false,
    });
  }

  const dynamicSecrets = new Set();
  collectSecrets(err, dynamicSecrets);

  if (err instanceof NormalizedError && depth === 0 && !options.code && !options.publicMessage) {
    return err;
  }

  if (err === null || err === undefined) {
    const message = `Unknown error (${String(err)})`;
    return new NormalizedError({
      name: 'Error',
      message,
      code: options.code,
      retryable: options.retryable ?? false,
      publicMessage: options.publicMessage ?? 'An unknown error occurred.',
      raw: err,
    });
  }

  if (typeof err === 'string') {
    const scrubbed = scrubText(err, dynamicSecrets);
    const code = options.code;
    const retryable = options.retryable ?? isRetryable(null, code, scrubbed);
    return new NormalizedError({
      name: 'Error',
      message: scrubbed,
      code,
      retryable,
      publicMessage: options.publicMessage ?? getSafePublicMessage('Error', scrubbed, code),
      raw: err,
    });
  }

  if (typeof err === 'number' || typeof err === 'bigint' || typeof err === 'boolean') {
    const message = String(err);
    return new NormalizedError({
      name: 'Error',
      message,
      code: options.code,
      retryable: options.retryable ?? false,
      publicMessage: options.publicMessage ?? 'An unexpected error occurred.',
      raw: err,
    });
  }

  if (typeof err === 'symbol') {
    const message = err.toString();
    return new NormalizedError({
      name: 'Error',
      message,
      code: options.code,
      retryable: options.retryable ?? false,
      publicMessage: options.publicMessage ?? 'An unexpected error occurred.',
      raw: err,
    });
  }

  if (typeof err === 'function') {
    return new NormalizedError({
      name: 'Error',
      message: `[Function ${err.name || 'anonymous'}]`,
      code: options.code,
      retryable: options.retryable ?? false,
      publicMessage: options.publicMessage ?? 'An unexpected error occurred.',
      raw: err,
    });
  }

  if (typeof err === 'object') {
    if (seen.has(err)) {
      return new NormalizedError({
        name: 'CircularError',
        message: '[Circular cause]',
        retryable: false,
        raw: err,
      });
    }
    seen.add(err);

    let rawName = 'Error';
    let rawMessage = '';
    let rawStack = undefined;
    let causeVal = undefined;

    try {
      if (typeof err.name === 'string' && err.name.trim()) {
        rawName = err.name;
      } else if (err instanceof Error && err.constructor?.name) {
        rawName = err.constructor.name;
      }

      if (typeof err.message === 'string') {
        rawMessage = err.message;
      } else if (typeof err.error === 'string') {
        rawMessage = err.error;
      } else if (err.error && typeof err.error === 'object' && typeof err.error.message === 'string') {
        rawMessage = err.error.message;
      } else if (typeof err.statusText === 'string') {
        rawMessage = err.statusText;
      }

      if (typeof err.stack === 'string') rawStack = err.stack;
      if ('cause' in err) causeVal = err.cause;
    } catch {
      rawMessage = '[Unserializable object]';
    }

    const code = options.code ?? extractErrorCode(err);
    const message = scrubText(rawMessage || 'Unknown error', dynamicSecrets);
    const stack = rawStack ? scrubText(rawStack, dynamicSecrets) : undefined;
    const retryable = options.retryable ?? isRetryable(err, code, message);

    let context = undefined;
    try {
      const extracted = {};
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(err))) {
        if (STANDARD_KEYS.has(key)) continue;
        if ('value' in descriptor) {
          extracted[key] = redactSensitive(descriptor.value, dynamicSecrets);
        }
      }
      if (options.context) {
        for (const [k, v] of Object.entries(options.context)) {
          extracted[k] = redactSensitive(v, dynamicSecrets);
        }
      }
      if (Object.keys(extracted).length > 0) {
        context = extracted;
      }
    } catch {
      context = undefined;
    }

    let normalizedCause = undefined;
    if (causeVal !== undefined && causeVal !== null) {
      normalizedCause = normalizeInternal(causeVal, {}, seen, depth + 1);
    }

    return new NormalizedError({
      name: rawName,
      message,
      code,
      cause: normalizedCause,
      stack,
      retryable,
      context,
      publicMessage: options.publicMessage ?? getSafePublicMessage(rawName, message, code),
      raw: err,
    });
  }

  return new NormalizedError({
    name: 'Error',
    message: String(err),
    code: options.code,
    retryable: options.retryable ?? false,
    publicMessage: options.publicMessage ?? 'An unexpected error occurred.',
    raw: err,
  });
}

function normalizeError(err, options = {}) {
  return normalizeInternal(err, options);
}

function getErrorMessage(err, options = {}) {
  return normalizeError(err, options).message;
}

function getPublicErrorMessage(err, options = {}) {
  return normalizeError(err, options).publicMessage;
}

function isRetryableError(err) {
  return normalizeError(err).retryable;
}

function toAssertableError(err, options = {}) {
  return normalizeError(err, options).toAssertable();
}

function toOperatorDiagnostics(err, options = {}) {
  return normalizeError(err, options).toOperatorDiagnostics();
}

module.exports = {
  REDACTED,
  isSensitiveKey,
  scrubText,
  collectSecrets,
  redactSensitive,
  extractErrorCode,
  isRetryable,
  getSafePublicMessage,
  NormalizedError,
  normalizeError,
  getErrorMessage,
  getPublicErrorMessage,
  isRetryableError,
  toAssertableError,
  toOperatorDiagnostics,
};
