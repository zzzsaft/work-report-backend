import axios from "axios";
import { Prisma, type PrismaClient } from "@prisma/client";
import pkg from "sm-crypto";
import { config } from "../../lib/config.js";
import { AppError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { calculateHourAllocations, defaultHourAllocation } from "../work-report/hour-allocation.js";

const { sm2, sm3, sm4 } = pkg;

const DEFAULT_CONFIG_ID = "default";
const XFT_IMPORT_COLLECTION_PATH = "/sal/a/xft-sly/salary/api/import-collection-data";
const SALARY_PERIOD_PATTERN = /^\d{6}$/;

export interface XftConfigInput {
  host: string;
  appid: string;
  appSecret?: string;
  enterpriseId: string;
  defaultUserId: string;
  defaultPlatformUserId: string;
  dataCollectionName: string;
  importType: string;
  salaryPeriod: string;
  workHoursFieldKey: string;
  isCheckEmpty: boolean;
  enabled: boolean;
}

export interface XftManualHoursInput {
  staffName: string;
  staffNumber: string;
  hours: number;
  identityNumber?: string;
  staffId?: string;
}

export interface XftHoursRow {
  lineId: number;
  staffName: string;
  staffNumber: string;
  hours: number;
  identityNumber: string;
  staffId: string;
  hourAllocation?: {
    allocationTemporary: boolean;
    method: string;
    appliedCount: number;
    totalCount: number;
  };
}

export interface PersistedXftConfig extends XftConfigInput {
  appSecret: string;
  hasAppSecret: boolean;
}

interface XftImportError {
  row: number;
  staffName?: string;
  staffNumber?: string;
  message: string;
  errorCode?: string;
}

export interface XftHttpClient {
  get(path: string, query?: Record<string, string | number | boolean | null | undefined>): Promise<unknown>;
  post(path: string, payload: unknown): Promise<unknown>;
}

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const currentSalaryPeriod = () => {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
};

export const getSalaryPeriodRange = (salaryPeriod: string) => {
  if (!SALARY_PERIOD_PATTERN.test(salaryPeriod)) {
    throw new AppError(400, "薪资期间必须是 YYYYMM 格式");
  }

  const year = Number(salaryPeriod.slice(0, 4));
  const month = Number(salaryPeriod.slice(4, 6));
  if (month < 1 || month > 12) throw new AppError(400, "薪资期间月份无效");

  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 1)
  };
};

const roundHours = (value: number) => Number(value.toFixed(2));

const encryptionKey = (authoritySecret: string) => authoritySecret.slice(0, 32);

export const encryptXftBody = (body: string, authoritySecret: string) =>
  sm4.encrypt(body, encryptionKey(authoritySecret));

export const decryptXftBody = (body: string, authoritySecret: string) =>
  sm4.decrypt(body, encryptionKey(authoritySecret));

export const buildEncryptedXftRequestBody = (payload: unknown, authoritySecret: string) =>
  JSON.stringify({
    secretMsg: encryptXftBody(JSON.stringify(payload ?? {}), authoritySecret)
  });

const parseXftResponseData = (data: unknown, authoritySecret: string) => {
  if (typeof data !== "string") return data;

  const encrypted = data.trim().replace(/^"|"$/g, "");
  if (!encrypted) return data;

  try {
    const decrypted = decryptXftBody(encrypted, authoritySecret);
    try {
      return JSON.parse(decrypted) as unknown;
    } catch {
      return decrypted;
    }
  } catch {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return data;
    }
  }
};

const publicConfig = (configRow: PersistedXftConfig) => ({
  host: configRow.host,
  appid: configRow.appid,
  enterpriseId: configRow.enterpriseId,
  defaultUserId: configRow.defaultUserId,
  defaultPlatformUserId: configRow.defaultPlatformUserId,
  dataCollectionName: configRow.dataCollectionName,
  importType: configRow.importType,
  salaryPeriod: configRow.salaryPeriod,
  workHoursFieldKey: configRow.workHoursFieldKey,
  isCheckEmpty: configRow.isCheckEmpty,
  enabled: configRow.enabled,
  hasAppSecret: configRow.hasAppSecret
});

export const buildXftCollectionPayload = (
  configRow: Pick<
    PersistedXftConfig,
    "dataCollectionName" | "importType" | "salaryPeriod" | "isCheckEmpty" | "workHoursFieldKey"
  >,
  rows: XftHoursRow[]
) => ({
  importConfigInfo: {
    dataCollectionName: configRow.dataCollectionName,
    importType: configRow.importType,
    salaryPeriod: configRow.salaryPeriod,
    isCheckEmpty: configRow.isCheckEmpty
  },
  collectionDataList: rows.map((row) => ({
    lineId: row.lineId,
    staffName: row.staffName,
    staffNumber: row.staffNumber,
    identityNumber: row.identityNumber,
    staffId: row.staffId,
    collectionData: JSON.stringify({ [configRow.workHoursFieldKey]: row.hours })
  }))
});

export class XftApiClient implements XftHttpClient {
  constructor(private readonly configRow: PersistedXftConfig) {}

  private genHeaders(timestamp: number, body: string, requestPath: string, method: string) {
    const header: Record<string, string | number> = {
      "Content-Type": "application/json; charset=utf-8",
      appid: this.configRow.appid,
      "x-alb-timestamp": timestamp,
      apisign: sm2.doSignature(
        method === "POST"
          ? `POST ${requestPath}\nx-alb-digest: ${body}\nx-alb-timestamp: ${timestamp}`
          : `GET ${requestPath}\nx-alb-timestamp: ${timestamp}`,
        this.configRow.appSecret,
        { hash: true }
      ),
      "x-alb-verify": "sm3withsm2"
    };

    if (method === "POST") header["x-alb-digest"] = sm3(body);
    return header;
  }

  private buildPathWithQuery = (
    path: string,
    queryParams: Record<string, string | number | boolean | null | undefined> = {}
  ) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const query = new URLSearchParams({
      CSCAPPUID: this.configRow.appid,
      CSCPRJCOD: this.configRow.enterpriseId,
      CSCREQTIM: String(timestamp * 1000),
      CSCUSRNBR: this.configRow.defaultUserId,
      CSCUSRUID: this.configRow.defaultPlatformUserId
    });
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== null) query.set(key, String(value));
    }
    const pathWithQuery = `${path}?${query.toString()}`;
    return { timestamp, pathWithQuery };
  };

  get = async (path: string, queryParams: Record<string, string | number | boolean | null | undefined> = {}) => {
    const { timestamp, pathWithQuery } = this.buildPathWithQuery(path, queryParams);

    const response = await axios({
      method: "GET",
      url: `${trimTrailingSlash(this.configRow.host)}${pathWithQuery}`,
      timeout: 100000,
      responseType: "text",
      transformResponse: [(data) => data],
      headers: this.genHeaders(timestamp, "", pathWithQuery, "GET")
    });

    return parseXftResponseData(response.data, this.configRow.appSecret);
  };

  post = async (path: string, payload: unknown) => {
    const { timestamp, pathWithQuery } = this.buildPathWithQuery(path);
    const body = buildEncryptedXftRequestBody(payload ?? {}, this.configRow.appSecret);

    const response = await axios({
      method: "POST",
      url: `${trimTrailingSlash(this.configRow.host)}${pathWithQuery}`,
      data: body,
      timeout: 100000,
      responseType: "text",
      transformRequest: [(data) => data],
      transformResponse: [(data) => data],
      headers: this.genHeaders(timestamp, body, pathWithQuery, "POST")
    });

    return parseXftResponseData(response.data, this.configRow.appSecret);
  };
}

export class XftService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly clientFactory: (configRow: PersistedXftConfig) => XftHttpClient = (configRow) =>
      new XftApiClient(configRow)
  ) {}

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

  private requireReadyConfig = async (salaryPeriod?: string) => {
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

  previewHours = async (salaryPeriod?: string): Promise<XftHoursRow[]> => {
    const configRow = await this.requireReadyConfig(salaryPeriod);
    const { start, end } = getSalaryPeriodRange(configRow.salaryPeriod);

    const assignments = await this.db.operationAssignment.findMany({
      where: {
        status: { not: "cancelled" },
        OR: [
          { claimedAt: { gte: start, lt: end } },
          { claimedAt: null, plannedStart: { gte: start, lt: end } }
        ]
      },
      select: {
        id: true,
        operationPoolId: true,
        workerId: true,
        workerName: true,
        estimatedHours: true,
        actualStartAt: true,
        actualEndAt: true,
        operationPool: {
          select: {
            estimatedHours: true
          }
        },
        worker: {
          select: {
            employeeNo: true,
            name: true
          }
        }
      },
      orderBy: [{ workerName: "asc" }, { plannedStart: "asc" }]
    });
    const operationPoolIds = Array.from(
      new Set(
        assignments
          .map((assignment) => assignment.operationPoolId)
          .filter((operationPoolId): operationPoolId is string => typeof operationPoolId === "string")
      )
    );
    const allocationParticipants = operationPoolIds.length
      ? await this.db.operationAssignment.findMany({
          where: {
            operationPoolId: { in: operationPoolIds },
            status: { not: "cancelled" }
          },
          select: {
            id: true,
            operationPoolId: true,
            estimatedHours: true,
            actualStartAt: true,
            actualEndAt: true,
            operationPool: {
              select: {
                estimatedHours: true
              }
            }
          }
        })
      : [];
    const allocations = calculateHourAllocations(allocationParticipants);

    const grouped = new Map<string, XftHoursRow>();
    for (const assignment of assignments) {
      const staffNumber = assignment.worker.employeeNo || assignment.workerId;
      const key = staffNumber;
      const hourAllocation = allocations.get(assignment.id) ?? defaultHourAllocation(assignment);
      const allocatedHours = hourAllocation.allocatedHours;
      const existing = grouped.get(key);
      if (existing) {
        existing.hours = roundHours(existing.hours + allocatedHours);
        if (existing.hourAllocation) {
          existing.hourAllocation.totalCount += 1;
          if (hourAllocation.allocationApplied) existing.hourAllocation.appliedCount += 1;
        }
        continue;
      }
      grouped.set(key, {
        lineId: grouped.size + 1,
        staffName: assignment.workerName || assignment.worker.name,
        staffNumber,
        hours: roundHours(allocatedHours),
        identityNumber: "",
        staffId: "",
        hourAllocation: {
          allocationTemporary: true,
          method: "actual_duration_ratio",
          appliedCount: hourAllocation.allocationApplied ? 1 : 0,
          totalCount: 1
        }
      });
    }

    return Array.from(grouped.values()).filter((row) => row.hours > 0);
  };

  private normalizeManualRows = (rows: XftManualHoursInput[]) =>
    rows.map((row, index) => ({
      lineId: index + 1,
      staffName: row.staffName.trim(),
      staffNumber: row.staffNumber.trim(),
      hours: roundHours(row.hours),
      identityNumber: row.identityNumber?.trim() || "",
      staffId: row.staffId?.trim() || ""
    }));

  private importRows = async (rows: XftHoursRow[], salaryPeriod?: string) => {
    const configRow = await this.requireReadyConfig(salaryPeriod);
    const validRows = rows.filter((row) => row.hours > 0);
    if (validRows.length === 0) {
      return { accepted: 0, rejected: 0, items: [], errors: [] as XftImportError[] };
    }

    const payload = buildXftCollectionPayload(configRow, validRows);
    const response = await this.clientFactory(configRow).post(XFT_IMPORT_COLLECTION_PATH, payload) as { body?: unknown };
    const responseErrors = Array.isArray(response?.body) ? response.body : [];
    const errors: XftImportError[] = responseErrors
      .filter((item: Record<string, unknown>) => item?.errorMessage || item?.errorMsg)
      .map((item: Record<string, unknown>) => ({
        row: Number(item.lineId || 0),
        staffName: String(item.staffName || ""),
        staffNumber: String(item.staffNumber || ""),
        message: String(item.errorMessage || item.errorMsg || "薪福通导入失败"),
        errorCode: item.errorCode ? String(item.errorCode) : undefined
      }));

    const failedRows = new Set(errors.map((error) => error.row).filter(Boolean));
    const items = validRows
      .filter((row) => !failedRows.has(row.lineId))
      .map((row) => ({
        lineId: row.lineId,
        staffName: row.staffName,
        staffNumber: row.staffNumber,
        hours: row.hours
      }));

    return {
      accepted: items.length,
      rejected: errors.length,
      items,
      errors
    };
  };

  importPreviewedHours = async (salaryPeriod?: string) =>
    this.importRows(await this.previewHours(salaryPeriod), salaryPeriod);

  importManualHours = async (rows: XftManualHoursInput[], salaryPeriod?: string) =>
    this.importRows(this.normalizeManualRows(rows), salaryPeriod);
}

export const xftService = new XftService();
