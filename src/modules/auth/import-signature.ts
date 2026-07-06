import type { RequestHandler } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../../lib/config.js";
import { AppError } from "../../lib/errors.js";
import { hashCacheKey, pruneExpiredEntries, trimOldestEntries } from "./token.js";

const usedImportNonces = new Map<string, { expiresAt: number }>();
const MAX_IMPORT_NONCE_ENTRIES = 10000;

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const verifyImportSignature = (req: Parameters<RequestHandler>[0]) => {
  const apiKey = req.header("x-import-key") || "";
  const timestamp = req.header("x-import-timestamp") || "";
  const nonce = req.header("x-import-nonce") || "";
  const signature = req.header("x-import-signature") || "";

  if (!apiKey && !timestamp && !nonce && !signature) return null;
  if (!config.importApiKey || !config.importApiSecret) {
    throw new AppError(401, "导入接口签名未配置");
  }
  if (!safeEqual(apiKey, config.importApiKey)) {
    throw new AppError(401, "导入接口签名无效");
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new AppError(401, "导入接口时间戳无效");
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(nonce)) {
    throw new AppError(401, "导入接口 nonce 无效");
  }

  const allowedSkewMs = config.importSignatureTtlSeconds * 1000;
  if (Math.abs(Date.now() - timestampMs) > allowedSkewMs) {
    throw new AppError(401, "导入接口签名已过期");
  }

  const payload = `${timestamp}.${nonce}.${req.rawBody ?? ""}`;
  const expected = createHmac("sha256", config.importApiSecret).update(payload).digest("hex");
  if (!safeEqual(signature.toLowerCase(), expected)) {
    throw new AppError(401, "导入接口签名无效");
  }

  pruneExpiredEntries(usedImportNonces);
  const nonceKey = hashCacheKey(`${apiKey}:${nonce}`);
  if (usedImportNonces.has(nonceKey)) {
    throw new AppError(401, "导入接口签名已使用");
  }
  usedImportNonces.set(nonceKey, { expiresAt: Date.now() + allowedSkewMs });
  trimOldestEntries(usedImportNonces, MAX_IMPORT_NONCE_ENTRIES);

  return {
    id: "system-import",
    name: "工序导入接口",
    roles: ["leader"]
  };
};

export const clearImportSignatureCache = () => {
  usedImportNonces.clear();
};
