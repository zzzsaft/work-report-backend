import type { User } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn()
    }
  }
}));

const now = new Date("2026-06-29T12:00:00.000Z");

const accountUser = (status: string): User & { userRoles: Array<{ role: { code: string } }> } => ({
  id: "account-1",
  wecomUserId: null,
  employeeNo: null,
  username: "admin",
  passwordHash: "$2b$10$hash",
  name: "管理员",
  nameInitials: null,
  avatar: null,
  teamName: null,
  status,
  lastLoginAt: null,
  createdAt: now,
  updatedAt: now,
  userRoles: [{ role: { code: "admin" } }]
});

describe("resolveUser local token checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a previously issued local token after the account is disabled", async () => {
    const { generateLocalToken } = await import("../src/lib/jwt.js");
    const { prisma } = await import("../src/lib/prisma.js");
    const { resolveUser } = await import("../src/middleware/auth.js");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(accountUser("disabled"));

    const token = generateLocalToken({
      userId: "account-1",
      clientId: "new-frontend",
      name: "管理员"
    });

    await expect(resolveUser(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("caches active local token users until auth cache is cleared", async () => {
    const { generateLocalToken } = await import("../src/lib/jwt.js");
    const { prisma } = await import("../src/lib/prisma.js");
    const { clearAuthCache, resolveUser } = await import("../src/middleware/auth.js");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(accountUser("active"));
    clearAuthCache();

    const token = generateLocalToken({
      userId: "account-1",
      clientId: "new-frontend",
      name: "管理员"
    });

    await expect(resolveUser(token)).resolves.toEqual({
      id: "account-1",
      wecomUserId: null,
      name: "管理员",
      avatar: undefined,
      roles: ["admin"]
    });
    await resolveUser(token);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);

    clearAuthCache();
    await resolveUser(token);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it("refreshes an existing local token user with the avatar from authentication", async () => {
    const { generateLocalToken } = await import("../src/lib/jwt.js");
    const { prisma } = await import("../src/lib/prisma.js");
    const { clearAuthCache, resolveUser } = await import("../src/middleware/auth.js");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(accountUser("active"));
    vi.mocked(prisma.user.update).mockResolvedValue(accountUser("active"));
    clearAuthCache();

    const token = generateLocalToken({
      userId: "account-1",
      clientId: "new-frontend",
      name: "管理员",
      avatar: "https://wecom.example/avatar/zz.png"
    });

    await expect(resolveUser(token)).resolves.toEqual({
      id: "account-1",
      wecomUserId: null,
      name: "管理员",
      avatar: "https://wecom.example/avatar/zz.png",
      roles: ["admin"]
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "account-1" },
      data: {
        wecomUserId: null,
        name: "管理员",
        avatar: "https://wecom.example/avatar/zz.png"
      }
    });
  });

  it("stores wecomUserId from local WeCom authentication tokens", async () => {
    const { generateLocalToken } = await import("../src/lib/jwt.js");
    const { prisma } = await import("../src/lib/prisma.js");
    const { clearAuthCache, resolveUser } = await import("../src/middleware/auth.js");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(accountUser("active"));
    vi.mocked(prisma.user.update).mockResolvedValue(accountUser("active"));
    clearAuthCache();

    const token = generateLocalToken({
      userId: "account-1",
      wecomUserId: "zz",
      corpId: "ww-test",
      clientId: "new-frontend",
      name: "管理员"
    });

    await expect(resolveUser(token)).resolves.toMatchObject({
      id: "account-1",
      wecomUserId: "zz"
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "account-1" },
      data: {
        wecomUserId: "zz",
        name: "管理员",
        avatar: null
      }
    });
  });
});
