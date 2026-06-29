import type { PrismaClient, User } from "@prisma/client";
import bcrypt from "bcryptjs";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { verifyLocalToken } from "../src/lib/jwt.js";
import { ACCOUNT_CLIENT_ID, AuthAccountService } from "../src/modules/auth/accounts.js";

const now = new Date("2026-06-29T12:00:00.000Z");

const user = (overrides: Partial<User> = {}) => ({
  id: "account-1",
  wecomUserId: null,
  employeeNo: null,
  username: "admin",
  passwordHash: "$2b$10$hash",
  name: "管理员",
  nameInitials: null,
  avatar: null,
  teamName: null,
  status: "active",
  lastLoginAt: null,
  createdAt: now,
  updatedAt: now,
  ...overrides
});

const account = (overrides: Partial<User> = {}, roles = ["admin"]) => ({
  ...user(overrides),
  userRoles: roles.map((code) => ({ role: { code } }))
});

const errorStatus = async (promise: Promise<unknown>) => {
  try {
    await promise;
    throw new Error("Expected promise to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).statusCode;
  }
};

describe("password account service", () => {
  it("issues a local token and updates last login for valid password accounts", async () => {
    const passwordHash = await bcrypt.hash("admin1", 10);
    const db = {
      user: {
        findUnique: vi.fn().mockResolvedValue(account({ passwordHash })),
        update: vi.fn().mockResolvedValue(account({ passwordHash, lastLoginAt: now }))
      }
    };
    const service = new AuthAccountService(db as unknown as PrismaClient);

    const result = await service.login({
      clientId: ACCOUNT_CLIENT_ID,
      username: "admin",
      password: "admin1"
    });

    expect(verifyLocalToken(result.token, [ACCOUNT_CLIENT_ID])).toMatchObject({
      userId: "account-1",
      clientId: ACCOUNT_CLIENT_ID,
      name: "管理员"
    });
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "account-1" },
        data: { lastLoginAt: expect.any(Date) }
      })
    );
  });

  it("returns the same 401 for invalid username, password, client, and disabled accounts", async () => {
    const passwordHash = await bcrypt.hash("admin1", 10);
    const serviceFor = (foundUser: unknown) =>
      new AuthAccountService({
        user: {
          findUnique: vi.fn().mockResolvedValue(foundUser),
          update: vi.fn()
        }
      } as unknown as PrismaClient);

    await expect(
      serviceFor(account({ passwordHash })).login({
        clientId: "legacy-frontend",
        username: "admin",
        password: "admin1"
      })
    ).rejects.toMatchObject({ statusCode: 401, message: "账号或密码错误" });
    await expect(
      serviceFor(null).login({ clientId: ACCOUNT_CLIENT_ID, username: "missing", password: "admin1" })
    ).rejects.toMatchObject({ statusCode: 401, message: "账号或密码错误" });
    await expect(
      serviceFor(account({ passwordHash })).login({
        clientId: ACCOUNT_CLIENT_ID,
        username: "admin",
        password: "wrong"
      })
    ).rejects.toMatchObject({ statusCode: 401, message: "账号或密码错误" });
    await expect(
      serviceFor(account({ passwordHash, status: "disabled" })).login({
        clientId: ACCOUNT_CLIENT_ID,
        username: "admin",
        password: "admin1"
      })
    ).rejects.toMatchObject({ statusCode: 401, message: "账号或密码错误" });
  });

  it("creates accounts with hashed passwords and never returns passwordHash", async () => {
    const db = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve(
            account({
              username: data.username,
              passwordHash: data.passwordHash,
              name: data.name,
              status: data.status
            }, ["worker"])
          )
        )
      },
      role: {
        upsert: vi.fn().mockResolvedValue({ id: "role-worker", code: "worker", name: "员工" })
      }
    };
    const service = new AuthAccountService(db as unknown as PrismaClient);

    const created = await service.createAccount({
      username: "worker1",
      password: "secret1",
      name: "Worker",
      roles: ["worker"]
    });

    expect(created).toEqual(
      expect.objectContaining({
        username: "worker1",
        name: "Worker",
        roles: ["worker"],
        enabled: true
      })
    );
    expect(created).not.toHaveProperty("passwordHash");
    expect(await bcrypt.compare("secret1", db.user.create.mock.calls[0][0].data.passwordHash)).toBe(true);
  });

  it("rejects empty or invalid roles", async () => {
    const service = new AuthAccountService({ user: { findUnique: vi.fn() } } as unknown as PrismaClient);

    await expect(
      service.createAccount({ username: "u1", password: "secret1", roles: [] })
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.createAccount({ username: "u1", password: "secret1", roles: ["owner"] })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("prevents disabling or removing the last active admin", async () => {
    const service = new AuthAccountService({
      user: {
        findFirst: vi.fn().mockResolvedValue(account()),
        count: vi.fn().mockResolvedValue(1)
      }
    } as unknown as PrismaClient);

    expect(await errorStatus(service.updateAccount("account-1", { enabled: false }))).toBe(400);
    await expect(service.updateAccount("account-1", { roles: ["worker"] })).rejects.toMatchObject({
      message: "不能停用或移除最后一个管理员"
    });
  });

  it("validates reset passwords and stores a fresh hash", async () => {
    const db = {
      user: {
        findFirst: vi.fn().mockResolvedValue(account()),
        update: vi.fn().mockResolvedValue(account())
      }
    };
    const service = new AuthAccountService(db as unknown as PrismaClient);

    await expect(service.resetPassword("account-1", "12345")).rejects.toMatchObject({ statusCode: 400 });
    await service.resetPassword("account-1", "newpass");
    expect(await bcrypt.compare("newpass", db.user.update.mock.calls[0][0].data.passwordHash)).toBe(true);
  });
});
