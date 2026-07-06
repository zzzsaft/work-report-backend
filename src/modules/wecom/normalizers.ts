import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors.js";

export const normalizeOptionalString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const normalizeDisplayName = (value: unknown, userId: string) => {
  const name = normalizeOptionalString(value);
  if (!name) return null;
  return name.toLowerCase() === userId.toLowerCase() ? null : name;
};

export const normalizeOptionalNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

export const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export const ensurePlainObject = (value: unknown, errorCode: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(400, errorCode);
  return value as Record<string, unknown>;
};

export const normalizeStringList = (value: unknown, fieldName: string, maxLength: number) => {
  if (!Array.isArray(value)) throw new AppError(400, `INVALID_${fieldName.toUpperCase()}`);
  const items = value.map((item) => normalizeOptionalString(item)).filter((item): item is string => Boolean(item));
  if (items.length !== value.length || items.length === 0 || items.length > maxLength) {
    throw new AppError(400, `INVALID_${fieldName.toUpperCase()}`);
  }
  return items;
};

export const normalizeNumberList = (value: unknown, fieldName: string, maxLength: number) => {
  if (!Array.isArray(value)) throw new AppError(400, `INVALID_${fieldName.toUpperCase()}`);
  const items = value.map((item) => Number(item)).filter((item) => Number.isInteger(item));
  if (items.length !== value.length || items.length === 0 || items.length > maxLength) {
    throw new AppError(400, `INVALID_${fieldName.toUpperCase()}`);
  }
  return items;
};

export const normalizeInteger = (value: unknown, fieldName: string) => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) throw new AppError(400, `INVALID_${fieldName.toUpperCase()}`);
  return parsed;
};

export const normalizeOptionalInteger = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === "") return undefined;
  return normalizeInteger(value, fieldName);
};

export const normalizeOptionalDepartmentOrder = (value: unknown) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= 2 ** 32) throw new AppError(400, "INVALID_ORDER");
  return parsed;
};

export const normalizeDepartmentLeader = (value: unknown): Prisma.InputJsonArray | null => {
  if (!Array.isArray(value)) return null;
  const leaders = value.map((item) => normalizeOptionalString(item)).filter((item): item is string => Boolean(item));
  return leaders.length === value.length ? leaders : null;
};
