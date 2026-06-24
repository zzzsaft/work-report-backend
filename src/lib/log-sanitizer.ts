import type { Prisma } from "@prisma/client";

const MAX_STRING_LENGTH = 4000;
const MAX_ARRAY_LENGTH = 50;
const MAX_OBJECT_KEYS = 100;
const MAX_DEPTH = 5;
const SENSITIVE_KEY_PATTERN = /authorization|cookie|password|token|secret|signature|api[-_]?key/i;

const truncate = (value: string) =>
  value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` : value;

const parseJsonString = (value: string) => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const sanitizeValue = (value: unknown, depth: number): Prisma.InputJsonValue | null => {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return null;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return truncate(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[buffer:${value.length}]`;
  if (depth >= MAX_DEPTH) return "[max-depth]";

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const output: Record<string, Prisma.InputJsonValue | null | string> = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeValue(item, depth + 1);
    }
    return output;
  }

  return String(value);
};

export const sanitizeLogPayload = (value: unknown): Prisma.InputJsonValue | null => {
  if (typeof value === "string") return sanitizeValue(parseJsonString(value), 0);
  return sanitizeValue(value, 0);
};
