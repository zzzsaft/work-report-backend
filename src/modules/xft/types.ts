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

export interface XftImportError {
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
