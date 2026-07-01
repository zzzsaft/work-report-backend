import bcrypt from "bcryptjs";
import type { Prisma, PrismaClient, User } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { generateLocalToken } from "../../lib/jwt.js";
import { prisma } from "../../lib/prisma.js";
import { clearAuthCache } from "../../middleware/auth.js";

export const ACCOUNT_CLIENT_ID = "work-report";
const PASSWORD_LOGIN_ERROR = "账号或密码错误";
const PASSWORD_MIN_LENGTH = 6;
const ROLE_CODES = ["worker", "leader", "admin"] as const;

type RoleCode = (typeof ROLE_CODES)[number];

type AccountUser = User & {
  userRoles: Array<{ role: { code: string } }>;
};

export interface AccountResponse {
  id: string;
  username: string;
  name: string;
  roles: string[];
  enabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const normalizeUsername = (value: unknown) => String(value ?? "").trim();
const normalizeName = (value: unknown, fallback: string) => String(value ?? fallback).trim();

const assertPassword = (password: string) => {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AppError(400, `密码长度不能少于 ${PASSWORD_MIN_LENGTH} 位`);
  }
};

const normalizeRoles = (roles: unknown): RoleCode[] => {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new AppError(400, "至少需要一个角色");
  }

  const uniqueRoles = [...new Set(roles.map((role) => String(role).trim()).filter(Boolean))];
  if (uniqueRoles.length === 0) {
    throw new AppError(400, "至少需要一个角色");
  }
  const invalidRole = uniqueRoles.find((role) => !ROLE_CODES.includes(role as RoleCode));
  if (invalidRole) throw new AppError(400, "角色无效");
  return uniqueRoles as RoleCode[];
};

const serializeAccount = (user: AccountUser): AccountResponse => ({
  id: user.id,
  username: user.username ?? "",
  name: user.name,
  roles: user.userRoles.map((item) => item.role.code),
  enabled: user.status === "active",
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt
});

const accountInclude = {
  userRoles: { include: { role: true } }
} satisfies Prisma.UserInclude;

const ensureRoles = async (db: PrismaClient | Prisma.TransactionClient, roleCodes: RoleCode[]) => {
  const roleNames: Record<RoleCode, string> = {
    worker: "员工",
    leader: "小组长",
    admin: "管理员"
  };

  return Promise.all(
    roleCodes.map((code) =>
      db.role.upsert({
        where: { code },
        create: { code, name: roleNames[code] },
        update: {}
      })
    )
  );
};

export class AuthAccountService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async login(input: { clientId: unknown; username: unknown; password: unknown }) {
    const clientId = String(input.clientId ?? ACCOUNT_CLIENT_ID).trim();
    if (clientId !== ACCOUNT_CLIENT_ID) throw new AppError(401, PASSWORD_LOGIN_ERROR);

    const username = normalizeUsername(input.username);
    const password = String(input.password ?? "");
    const user = username
      ? await this.db.user.findUnique({
          where: { username },
          include: accountInclude
        })
      : null;

    if (!user?.passwordHash || user.status !== "active") {
      throw new AppError(401, PASSWORD_LOGIN_ERROR);
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) throw new AppError(401, PASSWORD_LOGIN_ERROR);

    const updatedUser = await this.db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      include: accountInclude
    });

    return {
      token: generateLocalToken({
        userId: updatedUser.id,
        clientId: ACCOUNT_CLIENT_ID,
        name: updatedUser.name,
        avatar: updatedUser.avatar ?? null
      })
    };
  }

  async listAccounts(keyword?: unknown) {
    const normalizedKeyword = String(keyword ?? "").trim();
    const where: Prisma.UserWhereInput = {
      username: { not: null },
      ...(normalizedKeyword
        ? {
            OR: [
              { username: { contains: normalizedKeyword, mode: "insensitive" } },
              { name: { contains: normalizedKeyword, mode: "insensitive" } }
            ]
          }
        : {})
    };

    const users = await this.db.user.findMany({
      where,
      include: accountInclude,
      orderBy: [{ createdAt: "asc" }]
    });

    return { items: users.map(serializeAccount) };
  }

  async createAccount(input: {
    username: unknown;
    password: unknown;
    name?: unknown;
    roles: unknown;
    enabled?: unknown;
  }) {
    const username = normalizeUsername(input.username);
    if (!username) throw new AppError(400, "用户名不能为空");

    const existingUser = await this.db.user.findUnique({ where: { username } });
    if (existingUser) throw new AppError(409, "用户名已存在");

    const password = String(input.password ?? "");
    assertPassword(password);
    const roles = normalizeRoles(input.roles);
    const roleRecords = await ensureRoles(this.db, roles);
    const passwordHash = await bcrypt.hash(password, 10);
    const enabled = input.enabled === undefined ? true : Boolean(input.enabled);

    const user = await this.db.user.create({
      data: {
        username,
        passwordHash,
        name: normalizeName(input.name, username),
        status: enabled ? "active" : "disabled",
        userRoles: {
          create: roleRecords.map((role) => ({ roleId: role.id }))
        }
      },
      include: accountInclude
    });

    return serializeAccount(user);
  }

  async updateAccount(
    id: string,
    input: {
      name?: unknown;
      roles?: unknown;
      enabled?: unknown;
      password?: unknown;
      passwordHash?: unknown;
    }
  ) {
    if (input.password !== undefined || input.passwordHash !== undefined) {
      throw new AppError(400, "不能在此接口修改密码");
    }

    const existingUser = await this.findAccountOrThrow(id);
    const nextRoles = input.roles === undefined ? null : normalizeRoles(input.roles);
    const nextEnabled = input.enabled === undefined ? existingUser.status === "active" : Boolean(input.enabled);
    await this.assertNotRemovingLastAdmin(existingUser, nextRoles, nextEnabled);

    const updatedAccount = await this.db.$transaction(async (tx) => {
      if (nextRoles) {
        const roleRecords = await ensureRoles(tx, nextRoles);
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({
          data: roleRecords.map((role) => ({ userId: id, roleId: role.id })),
          skipDuplicates: true
        });
      }

      const user = await tx.user.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: normalizeName(input.name, existingUser.name) } : {}),
          ...(input.enabled !== undefined ? { status: nextEnabled ? "active" : "disabled" } : {})
        },
        include: accountInclude
      });
      return serializeAccount(user);
    });

    clearAuthCache();
    return updatedAccount;
  }

  async resetPassword(id: string, password: unknown) {
    const account = await this.findAccountOrThrow(id);
    const nextPassword = String(password ?? "");
    assertPassword(nextPassword);
    const passwordHash = await bcrypt.hash(nextPassword, 10);
    await this.db.user.update({
      where: { id: account.id },
      data: { passwordHash }
    });
  }

  private async findAccountOrThrow(id: string) {
    const user = await this.db.user.findFirst({
      where: { id, username: { not: null } },
      include: accountInclude
    });
    if (!user) throw new AppError(404, "账号不存在");
    return user;
  }

  private async assertNotRemovingLastAdmin(
    existingUser: AccountUser,
    nextRoles: RoleCode[] | null,
    nextEnabled: boolean
  ) {
    const currentlyAdmin = existingUser.userRoles.some((item) => item.role.code === "admin");
    const remainsAdmin = nextEnabled && (nextRoles ? nextRoles.includes("admin") : currentlyAdmin);
    if (!currentlyAdmin || remainsAdmin) return;

    const activeAdminCount = await this.db.user.count({
      where: {
        username: { not: null },
        status: "active",
        userRoles: { some: { role: { code: "admin" } } }
      }
    });
    if (activeAdminCount <= 1) throw new AppError(400, "不能停用或移除最后一个管理员");
  }
}

export const authAccountService = new AuthAccountService();
