import type { RequestHandler } from "express";
import type { User } from "@prisma/client";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { verifyLocalToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";

interface AuthServiceUser {
  userId: string;
  wecomUserId?: string | null;
  name: string;
  avatar?: string;
  token?: string;
}

export interface AuthenticatedUser {
  id: string;
  wecomUserId?: string | null;
  name: string;
  avatar?: string;
  roles: string[];
}

interface CacheEntry {
  user: AuthenticatedUser;
  expiresAt: number;
}

const authCache = new Map<string, CacheEntry>();
const usedImportNonces = new Map<string, { expiresAt: number }>();
const MAX_AUTH_CACHE_ENTRIES = 5000;
const MAX_IMPORT_NONCE_ENTRIES = 10000;

export const clearAuthCache = () => {
  authCache.clear();
  usedImportNonces.clear();
};

export const extractAuthToken = (authorization: unknown, cookies: Record<string, unknown> = {}) => {
  if (typeof authorization === "string") {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }

  const cookieToken = cookies[config.authCookieName];
  return typeof cookieToken === "string" && cookieToken.trim() ? cookieToken.trim() : "";
};

const authMeUrl = () => new URL("/auth/me", config.authApiBaseUrl).toString();

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const hashCacheKey = (value: string) => createHash("sha256").update(value).digest("hex");

const pruneExpiredEntries = <T extends { expiresAt: number }>(cache: Map<string, T>) => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
};

const trimOldestEntries = <T>(cache: Map<string, T>, maxEntries: number) => {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
};

const verifyImportSignature = (req: Parameters<RequestHandler>[0]) => {
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

const fetchUserFromAuthService = async (token: string): Promise<AuthServiceUser> => {
  const response = await fetch(authMeUrl(), {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new AppError(401, "token 缺失或失效");
  }

  const data = (await response.json()) as Partial<AuthServiceUser>;
  if (!data.userId || !data.name) {
    throw new AppError(401, "token 缺失或失效");
  }

  return {
    userId: data.userId,
    wecomUserId: typeof data.wecomUserId === "string" ? data.wecomUserId : null,
    name: data.name,
    avatar: data.avatar,
    token: data.token
  };
};

const upsertAuthenticatedUser = async (authUser: AuthServiceUser): Promise<AuthenticatedUser> => {
  await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { id: authUser.userId },
      create: {
        id: authUser.userId,
        wecomUserId: authUser.wecomUserId ?? null,
        name: authUser.name,
        avatar: authUser.avatar,
        status: "active"
      },
      update: {
        wecomUserId: authUser.wecomUserId ?? undefined,
        name: authUser.name,
        avatar: authUser.avatar
      }
    });

    const workerRole = await tx.role.upsert({
      where: { code: "worker" },
      create: { code: "worker", name: "员工" },
      update: {}
    });

    const roleCount = await tx.userRole.count({ where: { userId: authUser.userId } });
    if (roleCount === 0) {
      await tx.userRole.create({
        data: {
          userId: authUser.userId,
          roleId: workerRole.id
        }
      });
    }
  });

  const user = await prisma.user.findUnique({
    where: { id: authUser.userId },
    include: { userRoles: { include: { role: true } } }
  });

  if (!user) throw new AppError(401, "token 缺失或失效");

  return {
    id: user.id,
    wecomUserId: user.wecomUserId,
    name: user.name,
    avatar: user.avatar ?? undefined,
    roles: user.userRoles.map((item) => item.role.code)
  };
};

const serializeDbUser = (user: User & {
  userRoles: Array<{ role: { code: string } }>;
}): AuthenticatedUser => ({
  id: user.id,
  wecomUserId: user.wecomUserId,
  name: user.name,
  avatar: user.avatar ?? undefined,
  roles: user.userRoles.map((item) => item.role.code)
});

const resolveLocalUser = async (localUser: NonNullable<ReturnType<typeof verifyLocalToken>>) => {
  const existingUser = await prisma.user.findUnique({
    where: { id: localUser.userId },
    include: { userRoles: { include: { role: true } } }
  });

  if (existingUser) {
    if (existingUser.status !== "active") throw new AppError(401, "token 缺失或失效");
    const nextName = localUser.name || existingUser.name;
    const nextWecomUserId =
      typeof localUser.wecomUserId === "string" && localUser.wecomUserId.trim()
        ? localUser.wecomUserId
        : existingUser.wecomUserId;
    const nextAvatar =
      typeof localUser.avatar === "string" && localUser.avatar.trim()
        ? localUser.avatar
        : existingUser.avatar;

    if (
      nextName !== existingUser.name ||
      nextWecomUserId !== existingUser.wecomUserId ||
      nextAvatar !== existingUser.avatar
    ) {
      await prisma.user.update({
        where: { id: localUser.userId },
        data: {
          wecomUserId: nextWecomUserId,
          name: nextName,
          avatar: nextAvatar
        }
      });
    }

    return serializeDbUser({
      ...existingUser,
      wecomUserId: nextWecomUserId,
      name: nextName,
      avatar: nextAvatar
    });
  }

  return upsertAuthenticatedUser({
    userId: localUser.userId,
    wecomUserId: localUser.wecomUserId ?? undefined,
    name: localUser.name || localUser.userId,
    avatar: localUser.avatar ?? undefined
  });
};

export const resolveUser = async (token: string) => {
  const cacheKey = hashCacheKey(token);
  const cached = authCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  if (config.allowMockToken && token === config.mockAuthToken) {
    const user = await upsertAuthenticatedUser({
      userId: config.mockUserId,
      name: config.mockUserName
    });
    const mockUser = {
      ...user,
      roles: config.mockUserRoles.length > 0 ? config.mockUserRoles : user.roles
    };
    pruneExpiredEntries(authCache);
    authCache.set(cacheKey, {
      user: mockUser,
      expiresAt: Date.now() + config.authCacheTtlSeconds * 1000
    });
    trimOldestEntries(authCache, MAX_AUTH_CACHE_ENTRIES);
    return mockUser;
  }

  const localUser = verifyLocalToken(token);
  if (localUser) {
    const user = await resolveLocalUser(localUser);
    pruneExpiredEntries(authCache);
    authCache.set(cacheKey, {
      user,
      expiresAt: Date.now() + config.authCacheTtlSeconds * 1000
    });
    trimOldestEntries(authCache, MAX_AUTH_CACHE_ENTRIES);
    return user;
  }

  const authUser = await fetchUserFromAuthService(token);
  const user = await upsertAuthenticatedUser(authUser);
  pruneExpiredEntries(authCache);
  authCache.set(cacheKey, {
    user,
    expiresAt: Date.now() + config.authCacheTtlSeconds * 1000
  });
  trimOldestEntries(authCache, MAX_AUTH_CACHE_ENTRIES);
  return user;
};

export const requireAdminUser = async (token: string | undefined) => {
  if (!token) throw new AppError(401, "token 缺失或失效");
  const user = await resolveUser(token);
  if (!user.roles.includes("admin")) throw new AppError(403, "当前用户无权限");
  return user;
};

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const isImportPath = 
      req.path === "/leader/operations/import" || 
      req.path === "/api/operations/import";
    const importUser = isImportPath ? verifyImportSignature(req) : null;
    if (importUser) {
      req.user = importUser;
      next();
      return;
    }

    const token = extractAuthToken(req.headers.authorization, req.cookies);
    if (!token) throw new AppError(401, "token 缺失或失效");

    req.authToken = token;
    req.user = await resolveUser(token);
    next();
  } catch (error) {
    next(error);
  }
};

export const requireCapability = (capability: keyof ReturnType<typeof getCapabilitiesForRoles>): RequestHandler => {
  return (req, _res, next) => {
    if (!req.user) {
      next(new AppError(401, "token 缺失或失效"));
      return;
    }

    const capabilities = getCapabilitiesForRoles(req.user.roles);
    if (!capabilities[capability]) {
      next(new AppError(403, "当前用户无权限"));
      return;
    }
    next();
  };
};

export const requirePermissionManagement: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(new AppError(401, "token 缺失或失效"));
    return;
  }

  const capabilities = getCapabilitiesForRoles(req.user.roles);
  if (
    !capabilities.canAssignWorkers ||
    !capabilities.canForceRemoveAssignments ||
    !capabilities.canViewAllTeams
  ) {
    next(new AppError(403, "当前用户无权限"));
    return;
  }

  next();
};

export const getCapabilitiesForRoles = (roles: string[]) => {
  const isAdmin = roles.includes("admin");
  const isLeader = roles.includes("leader");

  return {
    roles: roles.length > 0 ? roles : ["worker"],
    canViewAdmin: isAdmin || isLeader,
    canAssignWorkers: isAdmin,
    canReviewExceptions: isAdmin || isLeader,
    canImportOperations: isAdmin || isLeader,
    canViewTeamOperations: isAdmin || isLeader,
    canForceRemoveAssignments: isAdmin,
    canViewAllTeams: isAdmin
  };
};
