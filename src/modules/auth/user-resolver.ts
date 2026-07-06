import type { Prisma, User } from "@prisma/client";
import { config } from "../../lib/config.js";
import { AppError } from "../../lib/errors.js";
import { verifyLocalToken } from "../../lib/jwt.js";
import { prisma } from "../../lib/prisma.js";
import type { AuthServiceUser, AuthenticatedUser } from "./types.js";
import { authCache, hashCacheKey, pruneExpiredEntries, trimOldestEntries, MAX_AUTH_CACHE_ENTRIES } from "./token.js";

const authMeUrl = () => new URL("/auth/me", config.authApiBaseUrl).toString();

export const fetchUserFromAuthService = async (token: string): Promise<AuthServiceUser> => {
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

export const optionalProfileFields = (authUser: OptionalProfileFieldSource) => ({
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

export const toInputJson = (value: unknown): Prisma.InputJsonValue | undefined => {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
};

export const jsonProfileField = (field: keyof OptionalProfileFieldSource, source: OptionalProfileFieldSource) => {
  if (!(field in source)) return {};
  const value = toInputJson(source[field]);
  return value === undefined ? {} : { [field]: value };
};

export const jsonSame = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

export const upsertAuthenticatedUser = async (authUser: AuthServiceUser): Promise<AuthenticatedUser> => {
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

export const serializeDbUser = (user: User & {
  userRoles: Array<{ role: { code: string } }>;
}): AuthenticatedUser => ({
  id: user.id,
  wecomUserId: user.wecomUserId,
  name: user.name,
  avatar: user.avatar ?? undefined,
  roles: user.userRoles.map((item) => item.role.code)
});

type DbUserWithRoles = Prisma.UserGetPayload<{
  include: { userRoles: { include: { role: true } } };
}>;

export const resolveLocalUser = async (localUser: NonNullable<ReturnType<typeof verifyLocalToken>>) => {
  const existingUser = await prisma.user.findUnique({
    where: { id: localUser.userId },
    include: { userRoles: { include: { role: true } } }
  });

  if (existingUser) {
    if (existingUser.status !== "active") throw new AppError(401, "token 缺失或失效");
    const user: DbUserWithRoles = existingUser;
    const nextName = localUser.name || user.name;
    const nextWecomUserId =
      typeof localUser.wecomUserId === "string" && localUser.wecomUserId.trim()
        ? localUser.wecomUserId
        : user.wecomUserId;
    const nextAvatar =
      "avatar" in localUser
        ? typeof localUser.avatar === "string" && localUser.avatar.trim()
          ? localUser.avatar
          : null
        : user.avatar;
    const nextProfile = {
      gender: "gender" in localUser ? localUser.gender ?? null : user.gender,
      qrCode: "qrCode" in localUser ? localUser.qrCode ?? null : user.qrCode,
      mobile: "mobile" in localUser ? localUser.mobile ?? null : user.mobile,
      email: "email" in localUser ? localUser.email ?? null : user.email,
      bizMail: "bizMail" in localUser ? localUser.bizMail ?? null : user.bizMail,
      address: "address" in localUser ? localUser.address ?? null : user.address,
      department: "department" in localUser ? localUser.department : user.department,
      departmentOrder: "departmentOrder" in localUser ? localUser.departmentOrder : user.departmentOrder,
      position: "position" in localUser ? localUser.position ?? null : user.position,
      isLeaderInDept: "isLeaderInDept" in localUser ? localUser.isLeaderInDept : user.isLeaderInDept,
      directLeader: "directLeader" in localUser ? localUser.directLeader : user.directLeader,
      telephone: "telephone" in localUser ? localUser.telephone ?? null : user.telephone,
      alias: "alias" in localUser ? localUser.alias ?? null : user.alias,
      extattr: "extattr" in localUser ? localUser.extattr : user.extattr,
      wecomStatus: "wecomStatus" in localUser ? localUser.wecomStatus ?? null : user.wecomStatus,
      externalProfile: "externalProfile" in localUser ? localUser.externalProfile : user.externalProfile,
      externalPosition:
        "externalPosition" in localUser ? localUser.externalPosition ?? null : user.externalPosition,
      openUserid: "openUserid" in localUser ? localUser.openUserid ?? null : user.openUserid,
      mainDepartment: "mainDepartment" in localUser ? localUser.mainDepartment ?? null : user.mainDepartment
    };

    if (
      nextName !== user.name ||
      nextWecomUserId !== user.wecomUserId ||
      nextAvatar !== user.avatar ||
      nextProfile.gender !== user.gender ||
      nextProfile.qrCode !== user.qrCode ||
      nextProfile.mobile !== user.mobile ||
      nextProfile.email !== user.email ||
      nextProfile.bizMail !== user.bizMail ||
      nextProfile.address !== user.address ||
      !jsonSame(nextProfile.department, user.department) ||
      !jsonSame(nextProfile.departmentOrder, user.departmentOrder) ||
      nextProfile.position !== user.position ||
      !jsonSame(nextProfile.isLeaderInDept, user.isLeaderInDept) ||
      !jsonSame(nextProfile.directLeader, user.directLeader) ||
      nextProfile.telephone !== user.telephone ||
      nextProfile.alias !== user.alias ||
      !jsonSame(nextProfile.extattr, user.extattr) ||
      nextProfile.wecomStatus !== user.wecomStatus ||
      !jsonSame(nextProfile.externalProfile, user.externalProfile) ||
      nextProfile.externalPosition !== user.externalPosition ||
      nextProfile.openUserid !== user.openUserid ||
      nextProfile.mainDepartment !== user.mainDepartment
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
      ...user,
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
