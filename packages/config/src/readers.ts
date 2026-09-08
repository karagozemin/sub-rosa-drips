import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  ConfigError,
  EmptyEnvironmentVariableError,
  MalformedEnvironmentVariableError,
  MissingEnvironmentVariableError,
} from "./errors.js";
import { secret, SecretValue } from "./secret.js";

/**
 * Options configuring string reading behavior.
 */
export interface StringReaderOptions {
  readonly required?: boolean;
  readonly default?: string;
  readonly trim?: boolean;
  readonly allowEmpty?: boolean;
}

/**
 * Options configuring boolean reading behavior.
 */
export interface BooleanReaderOptions {
  readonly required?: boolean;
  readonly default?: boolean;
}

/**
 * Options configuring integer reading behavior.
 */
export interface IntegerReaderOptions {
  readonly required?: boolean;
  readonly default?: number;
  readonly min?: number;
  readonly max?: number;
}

/**
 * Options configuring floating-point number reading behavior.
 */
export interface NumberReaderOptions {
  readonly required?: boolean;
  readonly default?: number;
  readonly min?: number;
  readonly max?: number;
  readonly positive?: boolean;
}

/**
 * Options configuring URL reading behavior.
 */
export interface UrlReaderOptions {
  readonly required?: boolean;
  readonly default?: string;
  readonly normalizeTrailingSlash?: boolean;
  readonly requireNoCredentials?: boolean;
  readonly allowedProtocols?: readonly string[];
}

/**
 * Options configuring enum reading behavior.
 */
export interface EnumReaderOptions<T extends string> {
  readonly required?: boolean;
  readonly default?: T;
}

/**
 * Options configuring Stellar identifier reading behavior.
 */
export interface StellarIdentifierReaderOptions {
  readonly required?: boolean;
  readonly default?: string;
}

/**
 * Options configuring secret reading behavior.
 */
export interface SecretReaderOptions {
  readonly required?: boolean;
  readonly default?: string;
}

/**
 * Reads a string value from an environment map with trimming and presence checks.
 *
 * @param env Environment map.
 * @param key Variable name.
 * @param options Configuration options.
 * @returns Parsed string or undefined.
 */
export function readString(
  env: Record<string, string | undefined>,
  key: string,
  options: StringReaderOptions & { required: true },
): string;
export function readString(
  env: Record<string, string | undefined>,
  key: string,
  options: StringReaderOptions & { default: string },
): string;
export function readString(
  env: Record<string, string | undefined>,
  key: string,
  options?: StringReaderOptions,
): string | undefined;
export function readString(
  env: Record<string, string | undefined>,
  key: string,
  options: StringReaderOptions = {},
): string | undefined {
  const raw = env[key];
  if (raw === undefined) {
    if (options.required) {
      throw new MissingEnvironmentVariableError(key);
    }
    return options.default;
  }

  const shouldTrim = options.trim ?? true;
  const processed = shouldTrim ? raw.trim() : raw;

  if (processed === "") {
    if (options.allowEmpty) {
      return processed;
    }
    if (options.required) {
      throw new EmptyEnvironmentVariableError(key);
    }
    return options.default;
  }

  return processed;
}

/**
 * Reads and parses a boolean value from an environment map.
 *
 * @param env Environment map.
 * @param key Variable name.
 * @param options Configuration options.
 * @returns Parsed boolean or undefined.
 */
export function readBoolean(
  env: Record<string, string | undefined>,
  key: string,
  options: BooleanReaderOptions & { required: true },
): boolean;
export function readBoolean(
  env: Record<string, string | undefined>,
  key: string,
  options: BooleanReaderOptions & { default: boolean },
): boolean;
export function readBoolean(
  env: Record<string, string | undefined>,
  key: string,
  options?: BooleanReaderOptions,
): boolean | undefined;
export function readBoolean(
  env: Record<string, string | undefined>,
  key: string,
  options: BooleanReaderOptions = {},
): boolean | undefined {
  const str = readString(env, key, {
    required: options.required,
    default: options.default !== undefined ? String(options.default) : undefined,
  });

  if (str === undefined) {
    return options.default;
  }

  const normalized = str.toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }

  throw new MalformedEnvironmentVariableError(
    key,
    "must be a boolean ('true', 'false', '1', '0')",
  );
}

/**
 * Reads and parses a base-10 integer from an environment map.
 *
 * @param env Environment map.
 * @param key Variable name.
 * @param options Configuration options.
 * @returns Parsed integer or undefined.
 */
export function readInteger(
  env: Record<string, string | undefined>,
  key: string,
  options: IntegerReaderOptions & { required: true },
): number;
export function readInteger(
  env: Record<string, string | undefined>,
  key: string,
  options: IntegerReaderOptions & { default: number },
): number;
export function readInteger(
  env: Record<string, string | undefined>,
  key: string,
  options?: IntegerReaderOptions,
): number | undefined;
export function readInteger(
  env: Record<string, string | undefined>,
  key: string,
  options: IntegerReaderOptions = {},
): number | undefined {
  const str = readString(env, key, {
    required: options.required,
    default: options.default !== undefined ? String(options.default) : undefined,
  });

  if (str === undefined) {
    return options.default;
  }

  if (!/^-?\d+$/.test(str)) {
    throw new MalformedEnvironmentVariableError(
      key,
      "must be a valid base-10 integer",
    );
  }

  const parsed = Number.parseInt(str, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new MalformedEnvironmentVariableError(
      key,
      "must be a safe base-10 integer",
    );
  }

  if (options.min !== undefined && parsed < options.min) {
    throw new MalformedEnvironmentVariableError(
      key,
      `must be at least ${options.min}`,
    );
  }
  if (options.max !== undefined && parsed > options.max) {
    throw new MalformedEnvironmentVariableError(
      key,
      `must be at most ${options.max}`,
    );
  }

  return parsed;
}

/**
 * Reads and parses a floating-point number from an environment map.
 *
 * @param env Environment map.
 * @param key Variable name.
 * @param options Configuration options.
 * @returns Parsed number or undefined.
 */
export function readNumber(
  env: Record<string, string | undefined>,
  key: string,
  options: NumberReaderOptions & { required: true },
): number;
export function readNumber(
  env: Record<string, string | undefined>,
  key: string,
  options: NumberReaderOptions & { default: number },
): number;
export function readNumber(
  env: Record<string, string | undefined>,
  key: string,
  options?: NumberReaderOptions,
): number | undefined;
export function readNumber(
  env: Record<string, string | undefined>,
  key: string,
  options: NumberReaderOptions = {},
): number | undefined {
  const str = readString(env, key, {
    required: options.required,
    default: options.default !== undefined ? String(options.default) : undefined,
  });

  if (str === undefined) {
    return options.default;
  }

  const parsed = Number(str);
  if (!Number.isFinite(parsed)) {
    throw new MalformedEnvironmentVariableError(
      key,
      "must be a valid finite number",
    );
  }

  if (options.positive && parsed <= 0) {
    throw new MalformedEnvironmentVariableError(
      key,
      "must be a positive number",
    );
  }
  if (options.min !== undefined && parsed < options.min) {
    throw new MalformedEnvironmentVariableError(
      key,
      `must be at least ${options.min}`,
    );
  }
  if (options.max !== undefined && parsed > options.max) {
    throw new MalformedEnvironmentVariableError(
      key,
      `must be at most ${options.max}`,
    );
  }

  return parsed;
}

/**
 * Reads and validates an HTTP or HTTPS URL from an environment map.
 *
 * @param env Environment map.
 * @param key Variable name.
 * @param options Configuration options.
 * @returns Validated URL string or undefined.
 */
export function readUrl(
  env: Record<string, string | undefined>,
  key: string,
  options: UrlReaderOptions & { required: true },
): string;
export function readUrl(
  env: Record<string, string | undefined>,
  key: string,
  options: UrlReaderOptions & { default: string },
): string;
export function readUrl(
  env: Record<string, string | undefined>,
  key: string,
  options?: UrlReaderOptions,
): string | undefined;
export function readUrl(
  env: Record<string, string | undefined>,
  key: string,
  options: UrlReaderOptions = {},
): string | undefined {
  const str = readString(env, key, {
    required: options.required,
    default: options.default,
  });

  if (str === undefined) {
    return options.default;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(str);
  } catch (cause) {
    throw new MalformedEnvironmentVariableError(
      key,
      "must be a valid absolute URL",
      { cause },
    );
  }

  const allowed = options.allowedProtocols ?? ["http:", "https:"];
  if (!allowed.includes(parsedUrl.protocol)) {
    throw new MalformedEnvironmentVariableError(
      key,
      `protocol must be one of: ${allowed.join(", ")}`,
    );
  }

  if (options.requireNoCredentials && (parsedUrl.username || parsedUrl.password)) {
    throw new MalformedEnvironmentVariableError(
      key,
      "must not contain credentials",
    );
  }

  const normalizeTrailing = options.normalizeTrailingSlash ?? true;
  const serialized = parsedUrl.toString();
  return normalizeTrailing ? serialized.replace(/\/+$/, "") : serialized;
}

/**
 * Reads and validates an enum string from an environment map.
 *
 * @param env Environment map.
 * @param key Variable name.
 * @param allowedValues Array of permitted string variants.
 * @param options Configuration options.
 * @returns Validated enum variant or undefined.
 */
export function readEnum<T extends string>(
  env: Record<string, string | undefined>,
  key: string,
  allowedValues: readonly T[],
  options: EnumReaderOptions<T> & { required: true },
): T;
export function readEnum<T extends string>(
  env: Record<string, string | undefined>,
  key: string,
  allowedValues: readonly T[],
  options: EnumReaderOptions<T> & { default: T },
): T;
export function readEnum<T extends string>(
  env: Record<string, string | undefined>,
  key: string,
  allowedValues: readonly T[],
  options?: EnumReaderOptions<T>,
): T | undefined;
export function readEnum<T extends string>(
  env: Record<string, string | undefined>,
  key: string,
  allowedValues: readonly T[],
  options: EnumReaderOptions<T> = {},
): T | undefined {
  const str = readString(env, key, {
    required: options.required,
    default: options.default,
  });

  if (str === undefined) {
    return options.default;
  }

  if (!(allowedValues as readonly string[]).includes(str)) {
    throw new MalformedEnvironmentVariableError(
      key,
      `must be one of: ${allowedValues.join(", ")}`,
    );
  }

  return str as T;
}

/**
 * Reads and validates a Stellar Ed25519 public account address (G...).
 *
 * @param env Environment map.
 * @param key Variable name.
 * @param options Configuration options.
 * @returns Validated Stellar public key or undefined.
 */
export function readStellarPublicKey(
  env: Record<string, string | undefined>,
  key: string,
  options: StellarIdentifierReaderOptions & { required: true },
): string;
export function readStellarPublicKey(
  env: Record<string, string | undefined>,
  key: string,
  options: StellarIdentifierReaderOptions & { default: string },
): string;
export function readStellarPublicKey(
  env: Record<string, string | undefined>,
  key: string,
  options?: StellarIdentifierReaderOptions,
): string | undefined;
export function readStellarPublicKey(
  env: Record<string, string | undefined>,
  key: string,
  options: StellarIdentifierReaderOptions = {},
): string | undefined {
  const str = readString(env, key, {
    required: options.required,
    default: options.default,
  });

  if (str === undefined) {
    return options.default;
  }

  if (!StrKey.isValidEd25519PublicKey(str)) {
    throw new MalformedEnvironmentVariableError(
      key,
      "must be a valid Stellar G... account address",
    );
  }

  return str;
}

/**
 * Reads and validates a Stellar contract address (C...).
 *
 * @param env Environment map.
 * @param key Variable name.
 * @param options Configuration options.
 * @returns Validated Stellar contract address or undefined.
 */
export function readStellarContractId(
  env: Record<string, string | undefined>,
  key: string,
  options: StellarIdentifierReaderOptions & { required: true },
): string;
export function readStellarContractId(
  env: Record<string, string | undefined>,
  key: string,
  options: StellarIdentifierReaderOptions & { default: string },
): string;
export function readStellarContractId(
  env: Record<string, string | undefined>,
  key: string,
  options?: StellarIdentifierReaderOptions,
): string | undefined;
export function readStellarContractId(
  env: Record<string, string | undefined>,
  key: string,
  options: StellarIdentifierReaderOptions = {},
): string | undefined {
  const str = readString(env, key, {
    required: options.required,
    default: options.default,
  });

  if (str === undefined) {
    return options.default;
  }

  if (!StrKey.isValidContract(str)) {
    throw new MalformedEnvironmentVariableError(
      key,
      "must be a valid Stellar C... contract address",
    );
  }

  return str;
}

/**
 * Reads and validates a Stellar secret seed (S...), returning a SecretValue container.
 *
 * @param env Environment map.
 * @param key Variable name.
 * @param options Configuration options.
 * @returns SecretValue container or undefined.
 */
export function readStellarSecretKey(
  env: Record<string, string | undefined>,
  key: string,
  options: StellarIdentifierReaderOptions & { required: true },
): SecretValue<string>;
export function readStellarSecretKey(
  env: Record<string, string | undefined>,
  key: string,
  options: StellarIdentifierReaderOptions & { default: string },
): SecretValue<string>;
export function readStellarSecretKey(
  env: Record<string, string | undefined>,
  key: string,
  options?: StellarIdentifierReaderOptions,
): SecretValue<string> | undefined;
export function readStellarSecretKey(
  env: Record<string, string | undefined>,
  key: string,
  options: StellarIdentifierReaderOptions = {},
): SecretValue<string> | undefined {
  const str = readString(env, key, {
    required: options.required,
    default: options.default,
  });

  if (str === undefined) {
    return options.default !== undefined ? secret(options.default) : undefined;
  }

  try {
    Keypair.fromSecret(str);
  } catch (cause) {
    throw new MalformedEnvironmentVariableError(
      key,
      "must be a valid Stellar secret key",
      { cause },
    );
  }

  return secret(str);
}

/**
 * Reads a sensitive string into an opaque SecretValue container.
 *
 * @param env Environment map.
 * @param key Variable name.
 * @param options Configuration options.
 * @returns SecretValue container or undefined.
 */
export function readSecret(
  env: Record<string, string | undefined>,
  key: string,
  options: SecretReaderOptions & { required: true },
): SecretValue<string>;
export function readSecret(
  env: Record<string, string | undefined>,
  key: string,
  options: SecretReaderOptions & { default: string },
): SecretValue<string>;
export function readSecret(
  env: Record<string, string | undefined>,
  key: string,
  options?: SecretReaderOptions,
): SecretValue<string> | undefined;
export function readSecret(
  env: Record<string, string | undefined>,
  key: string,
  options: SecretReaderOptions = {},
): SecretValue<string> | undefined {
  const str = readString(env, key, {
    required: options.required,
    default: options.default,
  });

  if (str === undefined) {
    return options.default !== undefined ? secret(options.default) : undefined;
  }

  return secret(str);
}

/**
 * Reads a browser-exposed configuration variable, enforcing the VITE_ prefix.
 *
 * @param env Environment map.
 * @param key Variable name.
 * @param options Configuration options.
 * @returns Parsed string or undefined.
 */
export function readBrowserPublic(
  env: Record<string, string | undefined>,
  key: string,
  options: StringReaderOptions & { required: true },
): string;
export function readBrowserPublic(
  env: Record<string, string | undefined>,
  key: string,
  options: StringReaderOptions & { default: string },
): string;
export function readBrowserPublic(
  env: Record<string, string | undefined>,
  key: string,
  options?: StringReaderOptions,
): string | undefined;
export function readBrowserPublic(
  env: Record<string, string | undefined>,
  key: string,
  options: StringReaderOptions = {},
): string | undefined {
  if (!key.startsWith("VITE_")) {
    throw new ConfigError(
      key,
      "browser-exposed environment variables must start with VITE_ prefix",
      "MALFORMED",
    );
  }

  return readString(env, key, options);
}
