import type { PersistedXftConfig, XftHoursRow } from "./types.js";

export const publicConfig = (configRow: PersistedXftConfig) => ({
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
