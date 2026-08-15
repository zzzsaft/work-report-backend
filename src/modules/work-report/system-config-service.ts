import type { PrismaClient } from "@prisma/client";

const CACHE_TTL_MS = 30_000;

export class SystemConfigService {
  private cache: { data: unknown; expiresAt: number } | null = null;

  constructor(private readonly db: PrismaClient) {}

  get = async () => {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.data as Awaited<ReturnType<SystemConfigService["readFromDb"]>>;
    }
    const data = await this.readFromDb();
    this.cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return data;
  };

  private readFromDb = async () => {
    const existing = await this.db.systemConfig.findUnique({ where: { id: "default" } });
    if (existing) return existing;
    return this.db.systemConfig.create({
      data: { id: "default", teamOperationPermissionEnabled: false }
    });
  };

  update = async (data: { teamOperationPermissionEnabled?: boolean }) => {
    const updated = await this.db.systemConfig.upsert({
      where: { id: "default" },
      create: { id: "default", teamOperationPermissionEnabled: data.teamOperationPermissionEnabled ?? false },
      update: data
    });
    this.cache = { data: updated, expiresAt: Date.now() + CACHE_TTL_MS };
    return updated;
  };

  clearCache = () => {
    this.cache = null;
  };
}
