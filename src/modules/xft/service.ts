import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { XftApiClient } from "./api-client.js";
import { XftConfigService } from "./config-service.js";
import { XftHoursService } from "./hours-service.js";
import { XftImportService } from "./import-service.js";
import type { PersistedXftConfig, XftConfigInput, XftHttpClient, XftManualHoursInput } from "./types.js";

export type { PersistedXftConfig, XftConfigInput, XftHoursRow, XftHttpClient, XftManualHoursInput } from "./types.js";
export { encryptXftBody, decryptXftBody, buildEncryptedXftRequestBody } from "./crypto.js";
export { getSalaryPeriodRange } from "./period.js";
export { buildXftCollectionPayload } from "./payload.js";
export { XftApiClient } from "./api-client.js";

export class XftService {
  private readonly configService: XftConfigService;
  private readonly hoursService: XftHoursService;
  private readonly importService: XftImportService;

  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly clientFactory: (configRow: PersistedXftConfig) => XftHttpClient = (configRow) =>
      new XftApiClient(configRow)
  ) {
    this.configService = new XftConfigService(db);
    this.hoursService = new XftHoursService(db, this.configService.requireReadyConfig);
    this.importService = new XftImportService(this.configService.requireReadyConfig, this.clientFactory);
  }

  getConfig = () => this.configService.getConfig();

  saveConfig = (input: XftConfigInput) => this.configService.saveConfig(input);

  previewHours = (salaryPeriod?: string) => this.hoursService.previewHours(salaryPeriod);

  importPreviewedHours = async (salaryPeriod?: string) =>
    this.importService.importRows(await this.previewHours(salaryPeriod), salaryPeriod);

  importManualHours = async (rows: XftManualHoursInput[], salaryPeriod?: string) =>
    this.importService.importRows(this.hoursService.normalizeManualRows(rows), salaryPeriod);
}

export const xftService = new XftService();
