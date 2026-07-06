import { buildXftCollectionPayload } from "./payload.js";
import type { PersistedXftConfig, XftHoursRow, XftHttpClient, XftImportError } from "./types.js";

const XFT_IMPORT_COLLECTION_PATH = "/sal/a/xft-sly/salary/api/import-collection-data";

export class XftImportService {
  constructor(
    private readonly requireReadyConfig: (salaryPeriod?: string) => Promise<PersistedXftConfig>,
    private readonly clientFactory: (configRow: PersistedXftConfig) => XftHttpClient
  ) {}

importRows = async (rows: XftHoursRow[], salaryPeriod?: string) => {
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
}
