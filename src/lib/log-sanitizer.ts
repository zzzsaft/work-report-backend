import type { Prisma } from "@prisma/client";

interface SanitizeLogOptions {
  maxStringLength?: number;
  maxArrayLength?: number;
  maxObjectKeys?: number;
  maxDepth?: number;
  maxPayloadLength?: number;
}

const DEFAULT_OPTIONS = {
  maxStringLength: 4000,
  maxArrayLength: 50,
  maxObjectKeys: 100,
  maxDepth: 5,
  maxPayloadLength: 64 * 1024
} satisfies Required<SanitizeLogOptions>;

export const EXPRESS_LOG_OPTIONS = {
  maxStringLength: 1000,
  maxArrayLength: 25,
  maxObjectKeys: 50,
  maxDepth: 4,
  maxPayloadLength: 16 * 1024
} satisfies Required<SanitizeLogOptions>;

const SENSITIVE_KEY_PATTERN = /authorization|cookie|password|token|secret|signature|api[-_]?key/i;
const BINARY_KEY_PATTERN = /avatar|base64|file|image|photo|picture|upload/i;
const DATA_URL_PATTERN = /^data:[^;]+;base64,/i;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

const truncate = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...[truncated:${value.length}]` : value;

const looksLikeLargeBinaryString = (value: string, key?: string) => {
  if (DATA_URL_PATTERN.test(value)) return true;
  if (!key || !BINARY_KEY_PATTERN.test(key) || value.length < 512) return false;
  return BASE64_PATTERN.test(value) && value.length % 4 === 0;
};

const parseJsonString = (value: string) => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const truncatePayload = (
  value: Prisma.InputJsonValue | null,
  maxPayloadLength: number
): Prisma.InputJsonValue | null => {
  if (value === null) return null;

  const serialized = JSON.stringify(value);
  if (serialized.length <= maxPayloadLength) return value;

  return {
    truncated: true,
    originalLength: serialized.length,
    preview: truncate(serialized, maxPayloadLength)
  };
};

const sanitizeValue = (
  value: unknown,
  depth: number,
  options: Required<SanitizeLogOptions>,
  key?: string
): Prisma.InputJsonValue | null => {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return null;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    if (looksLikeLargeBinaryString(value, key)) return `[binary-string:${value.length}]`;
    return truncate(value, options.maxStringLength);
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[buffer:${value.length}]`;
  if (depth >= options.maxDepth) return "[max-depth]";

  if (Array.isArray(value)) {
    const output = value
      .slice(0, options.maxArrayLength)
      .map((item) => sanitizeValue(item, depth + 1, options));

    if (value.length > options.maxArrayLength) {
      output.push(`[truncated-items:${value.length - options.maxArrayLength}]`);
    }

    return output;
  }

  if (typeof value === "object") {
    const output: Record<string, Prisma.InputJsonValue | null | string> = {};
    const entries = Object.entries(value);
    for (const [entryKey, item] of entries.slice(0, options.maxObjectKeys)) {
      output[entryKey] = SENSITIVE_KEY_PATTERN.test(entryKey)
        ? "[redacted]"
        : sanitizeValue(item, depth + 1, options, entryKey);
    }

    if (entries.length > options.maxObjectKeys) {
      output.__truncatedKeys = entries.length - options.maxObjectKeys;
    }
    return output;
  }

  return String(value);
};

export const sanitizeLogPayload = (
  value: unknown,
  options: SanitizeLogOptions = {}
): Prisma.InputJsonValue | null => {
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  const parsedValue = typeof value === "string" ? parseJsonString(value) : value;
  return truncatePayload(sanitizeValue(parsedValue, 0, resolvedOptions), resolvedOptions.maxPayloadLength);
};
