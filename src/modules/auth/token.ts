import { createHash } from "node:crypto";
import { config } from "../../lib/config.js";
import type { AuthenticatedUser } from "./types.js";

interface CacheEntry {
  user: AuthenticatedUser;
  expiresAt: number;
}

export const authCache = new Map<string, CacheEntry>();
export const MAX_AUTH_CACHE_ENTRIES = 5000;

export const extractAuthToken = (authorization: unknown, cookies: Record<string, unknown> = {}) => {
  if (typeof authorization === "string") {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }

  const cookieToken = cookies[config.authCookieName];
  return typeof cookieToken === "string" && cookieToken.trim() ? cookieToken.trim() : "";
};

export const hashCacheKey = (value: string) => createHash("sha256").update(value).digest("hex");

export const pruneExpiredEntries = <T extends { expiresAt: number }>(cache: Map<string, T>) => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
};

export const trimOldestEntries = <T>(cache: Map<string, T>, maxEntries: number) => {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
};

export const clearAuthCacheEntries = () => {
  authCache.clear();
};
