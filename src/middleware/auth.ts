import type { RequestHandler } from "express";
import type { Prisma, User } from "@prisma/client";
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
  gender?: string | null;
  qrCode?: string | null;
  mobile?: string | null;
  email?: string | null;
  bizMail?: string | null;
  address?: string | null;
  department?: unknown;
  departmentOrder?: unknown;
  position?: string | null;
  isLeaderInDept?: unknown;
  directLeader?: unknown;
  telephone?: string | null;
  alias?: string | null;
  extattr?: unknown;
  wecomStatus?: number | null;
  externalProfile?: unknown;
  externalPosition?: string | null;
  openUserid?: string | null;
  mainDepartment?: number | null;
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
    gender: typeof data.gender === "string" ? data.gender : null,
    qrCode: typeof data.qrCode === "string" ? data.qrCode : null,
    mobile: typeof data.mobile === "string" ? data.mobile : null,
    email: typeof data.email === "string" ? data.email : null,
    bizMail: typeof data.bizMail === "string" ? data.bizMail : null,
    address: typeof data.address === "string" ? data.address : null,
    position: typeof data.position === "string" ? data.position : null,
    telephone: typeof data.telephone === "string" ? data.telephone : null,
    alias: typeof data.alias === "string" ? data.alias : null,
    wecomStatus: typeof data.wecomStatus === "number" ? data.wecomStatus : null,
    externalPosition: typeof data.externalPosition === "string" ? data.externalPosition : null,
    openUserid: typeof data.openUserid === "string" ? data.openUserid : null,
    mainDepartment: typeof data.mainDepartment === "number" ? data.mainDepartment : null,
    ...("department" in data ? { department: data.department } : {}),
    ...("departmentOrder" in data ? { departmentOrder: data.departmentOrder } : {}),
    ...("isLeaderInDept" in data ? { isLeaderInDept: data.isLeaderInDept } : {}),
    ...("directLeader" in data ? { directLeader: data.directLeader } : {}),
    ...("extattr" in data ? { extattr: data.extattr } : {}),
    ...("externalProfile" in data ? { externalProfile: data.externalProfile } : {}),
    token: data.token
  };
};

type OptionalProfileFieldSource = {
  gender?: string | null;
  qrCode?: string | null;
  mobile?: string | null;
  email?: string | null;
  bizMail?: string | null;
  address?: string | null;
  department?: unknown;
  departmentOrder?: unknown;
  position?: string | null;
  isLeaderInDept?: unknown;
  directLeader?: unknown;
  telephone?: string | null;
  alias?: string | null;
  extattr?: unknown;
  wecomStatus?: number | null;
  externalProfile?: unknown;
  externalPosition?: string | null;
  openUserid?: string | null;
  mainDepartment?: number | null;
};

const optionalProfileFields = (authUser: OptionalProfileFieldSource) => ({
  ...("gender" in authUser ? { gender: authUser.gender } : {}),
  ...("qrCode" in authUser ? { qrCode: authUser.qrCode } : {}),
  ...("mobile" in authUser ? { mobile: authUser.mobile } : {}),
  ...("email" in authUser ? { email: authUser.email } : {}),
  ...("bizMail" in authUser ? { bizMail: authUser.bizMail } : {}),
  ...("address" in authUser ? { address: authUser.address } : {}),
  ...jsonProfileField("department", authUser),
  ...jsonProfileField("departmentOrder", authUser),
  ...("position" in authUser ? { position: authUser.position } : {}),
  ...jsonProfileField("isLeaderInDept", authUser),
  ...jsonProfileField("directLeader", authUser),
  ...("telephone" in authUser ? { telephone: authUser.telephone } : {}),
  ...("alias" in authUser ? { alias: authUser.alias } : {}),
  ...jsonProfileField("extattr", authUser),
  ...("wecomStatus" in authUser ? { wecomStatus: authUser.wecomStatus } : {}),
  ...jsonProfileField("externalProfile", authUser),
  ...("externalPosition" in authUser ? { externalPosition: authUser.externalPosition } : {}),
  ...("openUserid" in authUser ? { openUserid: authUser.openUserid } : {}),
  ...("mainDepartment" in authUser ? { mainDepartment: authUser.mainDepartment } : {})
});

const toInputJson = (value: unknown): Prisma.InputJsonValue | undefined => {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
};

const jsonProfileField = (field: keyof OptionalProfileFieldSource, source: OptionalProfileFieldSource) => {
  if (!(field in source)) return {};
  const value = toInputJson(source[field]);
  return value === undefined ? {} : { [field]: value };
};

const jsonSame = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const upsertAuthenticatedUser = async (authUser: AuthServiceUser): Promise<AuthenticatedUser> => {
  await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { id: authUser.userId },
      create: {
        id: authUser.userId,
        wecomUserId: authUser.wecomUserId ?? null,
        name: authUser.name,
        avatar: authUser.avatar,
        ...optionalProfileFields(authUser),
        status: "active"
      },
      update: {
        wecomUserId: authUser.wecomUserId ?? undefined,
        name: authUser.name,
        avatar: authUser.avatar,
        ...optionalProfileFields(authUser)
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
      "avatar" in localUser
        ? typeof localUser.avatar === "string" && localUser.avatar.trim()
          ? localUser.avatar
          : null
        : existingUser.avatar;
    const nextProfile = {
      gender: "gender" in localUser ? localUser.gender ?? null : existingUser.gender,
      qrCode: "qrCode" in localUser ? localUser.qrCode ?? null : existingUser.qrCode,
      mobile: "mobile" in localUser ? localUser.mobile ?? null : existingUser.mobile,
      email: "email" in localUser ? localUser.email ?? null : existingUser.email,
      bizMail: "bizMail" in localUser ? localUser.bizMail ?? null : existingUser.bizMail,
      address: "address" in localUser ? localUser.address ?? null : existingUser.address,
      department: "department" in localUser ? localUser.department : existingUser.department,
      departmentOrder: "departmentOrder" in localUser ? localUser.departmentOrder : existingUser.departmentOrder,
      position: "position" in localUser ? localUser.position ?? null : existingUser.position,
      isLeaderInDept: "isLeaderInDept" in localUser ? localUser.isLeaderInDept : existingUser.isLeaderInDept,
      directLeader: "directLeader" in localUser ? localUser.directLeader : existingUser.directLeader,
      telephone: "telephone" in localUser ? localUser.telephone ?? null : existingUser.telephone,
      alias: "alias" in localUser ? localUser.alias ?? null : existingUser.alias,
      extattr: "extattr" in localUser ? localUser.extattr : existingUser.extattr,
      wecomStatus: "wecomStatus" in localUser ? localUser.wecomStatus ?? null : existingUser.wecomStatus,
      externalProfile: "externalProfile" in localUser ? localUser.externalProfile : existingUser.externalProfile,
      externalPosition:
        "externalPosition" in localUser ? localUser.externalPosition ?? null : existingUser.externalPosition,
      openUserid: "openUserid" in localUser ? localUser.openUserid ?? null : existingUser.openUserid,
      mainDepartment: "mainDepartment" in localUser ? localUser.mainDepartment ?? null : existingUser.mainDepartment
    };

    if (
      nextName !== existingUser.name ||
      nextWecomUserId !== existingUser.wecomUserId ||
      nextAvatar !== existingUser.avatar ||
      nextProfile.gender !== existingUser.gender ||
      nextProfile.qrCode !== existingUser.qrCode ||
      nextProfile.mobile !== existingUser.mobile ||
      nextProfile.email !== existingUser.email ||
      nextProfile.bizMail !== existingUser.bizMail ||
      nextProfile.address !== existingUser.address ||
      !jsonSame(nextProfile.department, existingUser.department) ||
      !jsonSame(nextProfile.departmentOrder, existingUser.departmentOrder) ||
      nextProfile.position !== existingUser.position ||
      !jsonSame(nextProfile.isLeaderInDept, existingUser.isLeaderInDept) ||
      !jsonSame(nextProfile.directLeader, existingUser.directLeader) ||
      nextProfile.telephone !== existingUser.telephone ||
      nextProfile.alias !== existingUser.alias ||
      !jsonSame(nextProfile.extattr, existingUser.extattr) ||
      nextProfile.wecomStatus !== existingUser.wecomStatus ||
      !jsonSame(nextProfile.externalProfile, existingUser.externalProfile) ||
      nextProfile.externalPosition !== existingUser.externalPosition ||
      nextProfile.openUserid !== existingUser.openUserid ||
      nextProfile.mainDepartment !== existingUser.mainDepartment
    ) {
      await prisma.user.update({
        where: { id: localUser.userId },
        data: {
          wecomUserId: nextWecomUserId,
          name: nextName,
          avatar: nextAvatar,
          ...optionalProfileFields(nextProfile)
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
    avatar: localUser.avatar ?? undefined,
    ...optionalProfileFields(localUser)
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
