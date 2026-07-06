import type { PrismaClient } from "@prisma/client";
import { config } from "../../lib/config.js";
import { AppError } from "../../lib/errors.js";
import { currentSalaryPeriod, getSalaryPeriodRange } from "./period.js";
import { publicConfig } from "./payload.js";
import type { PersistedXftConfig, XftConfigInput } from "./types.js";

const DEFAULT_CONFIG_ID = "default";

export class XftConfigService {
  constructor(private readonly db: PrismaClient) {}

private envFallbackConfig = (): PersistedXftConfig => ({
    host: config.xftHost,
    appid: config.xftAppid,
    appSecret: config.xftAuthoritySecret,
    enterpriseId: config.xftEnterpriseId,
    defaultUserId: "U0000",
    defaultPlatformUserId: "AUTO0001",
    dataCollectionName: "",
    importType: "ADD",
    salaryPeriod: currentSalaryPeriod(),
    workHoursFieldKey: "",
    isCheckEmpty: false,
    enabled: true,
    hasAppSecret: !!config.xftAuthoritySecret
  });

private getPersistedConfig = async (): Promise<PersistedXftConfig> => {
    const row = await this.db.xftIntegrationConfig.findUnique({ where: { id: DEFAULT_CONFIG_ID } });
    if (!row) return this.envFallbackConfig();

    return {
      host: row.host,
      appid: row.appid,
      appSecret: row.appSecret,
      enterpriseId: row.enterpriseId,
      defaultUserId: row.defaultUserId,
      defaultPlatformUserId: row.defaultPlatformUserId,
      dataCollectionName: row.dataCollectionName,
      importType: row.importType,
      salaryPeriod: row.salaryPeriod,
      workHoursFieldKey: row.workHoursFieldKey,
      isCheckEmpty: row.isCheckEmpty,
      enabled: row.enabled,
      hasAppSecret: !!row.appSecret
    };
  };

requireReadyConfig = async (salaryPeriod?: string) => {
    const configRow = await this.getPersistedConfig();
    const effective = {
      ...configRow,
      salaryPeriod: salaryPeriod || configRow.salaryPeriod
    };

    const missing = [
      ["host", effective.host],
      ["appid", effective.appid],
      ["appSecret", effective.appSecret],
      ["enterpriseId", effective.enterpriseId],
      ["dataCollectionName", effective.dataCollectionName],
      ["importType", effective.importType],
      ["salaryPeriod", effective.salaryPeriod],
      ["workHoursFieldKey", effective.workHoursFieldKey],
      ["defaultUserId", effective.defaultUserId],
      ["defaultPlatformUserId", effective.defaultPlatformUserId]
    ].filter(([, value]) => !String(value || "").trim());

    if (missing.length > 0) {
      throw new AppError(400, `薪福通配置不完整：${missing.map(([key]) => key).join(", ")}`);
    }
    if (!effective.enabled) throw new AppError(409, "薪福通集成未启用");
    getSalaryPeriodRange(effective.salaryPeriod);
    return effective;
  };

getConfig = async () => publicConfig(await this.getPersistedConfig());

saveConfig = async (input: XftConfigInput) => {
    getSalaryPeriodRange(input.salaryPeriod);
    const existing = await this.db.xftIntegrationConfig.findUnique({ where: { id: DEFAULT_CONFIG_ID } });
    const appSecret = input.appSecret?.trim() || existing?.appSecret || config.xftAuthoritySecret;
    if (!appSecret) throw new AppError(400, "appSecret 必填");

    const row = await this.db.xftIntegrationConfig.upsert({
      where: { id: DEFAULT_CONFIG_ID },
      create: {
        id: DEFAULT_CONFIG_ID,
        host: input.host.trim(),
        appid: input.appid.trim(),
        appSecret,
        enterpriseId: input.enterpriseId.trim(),
        defaultUserId: input.defaultUserId.trim(),
        defaultPlatformUserId: input.defaultPlatformUserId.trim(),
        dataCollectionName: input.dataCollectionName.trim(),
        importType: input.importType.trim(),
        salaryPeriod: input.salaryPeriod.trim(),
        workHoursFieldKey: input.workHoursFieldKey.trim(),
        isCheckEmpty: input.isCheckEmpty,
        enabled: input.enabled
      },
      update: {
        host: input.host.trim(),
        appid: input.appid.trim(),
        appSecret,
        enterpriseId: input.enterpriseId.trim(),
        defaultUserId: input.defaultUserId.trim(),
        defaultPlatformUserId: input.defaultPlatformUserId.trim(),
        dataCollectionName: input.dataCollectionName.trim(),
        importType: input.importType.trim(),
        salaryPeriod: input.salaryPeriod.trim(),
        workHoursFieldKey: input.workHoursFieldKey.trim(),
        isCheckEmpty: input.isCheckEmpty,
        enabled: input.enabled
      }
    });

    return publicConfig({ ...row, hasAppSecret: !!row.appSecret });
  };
}
