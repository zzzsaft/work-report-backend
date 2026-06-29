import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors.js";
import {
  buildXftCollectionPayload,
  getSalaryPeriodRange,
  XftService,
  type XftHttpClient
} from "../src/modules/xft/service.js";

const persistedConfig = {
  id: "default",
  host: "https://api.cmbchina.com",
  appid: "appid",
  appSecret: "secret",
  enterpriseId: "enterprise",
  defaultUserId: "U0000",
  defaultPlatformUserId: "AUTO0001",
  dataCollectionName: "工时采集表",
  importType: "ADD",
  salaryPeriod: "202606",
  workHoursFieldKey: "WORK_HOURS",
  isCheckEmpty: false,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date()
};

describe("XftService", () => {
  it("validates salary periods and returns month boundaries", () => {
    expect(getSalaryPeriodRange("202606")).toEqual({
      start: new Date(2026, 5, 1),
      end: new Date(2026, 6, 1)
    });

    expect(() => getSalaryPeriodRange("202613")).toThrow(AppError);
  });

  it("hides appSecret when reading or saving config and keeps existing secret", async () => {
    const findUnique = vi.fn().mockResolvedValue(persistedConfig);
    const upsert = vi.fn().mockResolvedValue({ ...persistedConfig, host: "https://xft.example.com" });
    const service = new XftService({ xftIntegrationConfig: { findUnique, upsert } } as never);

    await expect(service.getConfig()).resolves.toMatchObject({
      host: "https://api.cmbchina.com",
      hasAppSecret: true
    });
    await expect(service.getConfig()).resolves.not.toHaveProperty("appSecret");

    await expect(
      service.saveConfig({
        host: "https://xft.example.com",
        appid: "appid",
        enterpriseId: "enterprise",
        defaultUserId: "U0000",
        defaultPlatformUserId: "AUTO0001",
        dataCollectionName: "工时采集表",
        importType: "ADD",
        salaryPeriod: "202606",
        workHoursFieldKey: "WORK_HOURS",
        isCheckEmpty: false,
        enabled: true
      })
    ).resolves.toMatchObject({ host: "https://xft.example.com", hasAppSecret: true });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ appSecret: "secret" })
      })
    );
  });

  it("summarizes hours by employee for a salary period", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        workerId: "u1",
        workerName: "小灰16",
        estimatedHours: 1.25,
        worker: { employeeNo: "000002", name: "小灰16" }
      },
      {
        workerId: "u1",
        workerName: "小灰16",
        estimatedHours: 2,
        worker: { employeeNo: "000002", name: "小灰16" }
      },
      {
        workerId: "u2",
        workerName: "张师傅",
        estimatedHours: null,
        worker: { employeeNo: null, name: "张师傅" }
      }
    ]);
    const service = new XftService({
      xftIntegrationConfig: { findUnique: vi.fn().mockResolvedValue(persistedConfig) },
      operationAssignment: { findMany }
    } as never);

    await expect(service.previewHours("202606")).resolves.toEqual([
      {
        lineId: 1,
        staffName: "小灰16",
        staffNumber: "000002",
        hours: 3.25,
        identityNumber: "",
        staffId: ""
      }
    ]);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { not: "cancelled" },
          OR: [
            { claimedAt: { gte: new Date(2026, 5, 1), lt: new Date(2026, 6, 1) } },
            { claimedAt: null, plannedStart: { gte: new Date(2026, 5, 1), lt: new Date(2026, 6, 1) } }
          ]
        }
      })
    );
  });

  it("builds xft collection payload with stringified collectionData", () => {
    expect(
      buildXftCollectionPayload(persistedConfig, [
        {
          lineId: 1,
          staffName: "小灰16",
          staffNumber: "000002",
          hours: 3.25,
          identityNumber: "",
          staffId: ""
        }
      ])
    ).toMatchObject({
      importConfigInfo: {
        dataCollectionName: "工时采集表",
        importType: "ADD",
        salaryPeriod: "202606",
        isCheckEmpty: false
      },
      collectionDataList: [
        {
          lineId: 1,
          staffName: "小灰16",
          staffNumber: "000002",
          collectionData: "{\"WORK_HOURS\":3.25}"
        }
      ]
    });
  });

  it("maps xft row errors into import result", async () => {
    const post = vi.fn().mockResolvedValue({
      returnCode: "SUC0000",
      errorMsg: null,
      body: [{ lineId: 2, errorMessage: "员工不存在", errorCode: "SLZYC37" }]
    });
    const service = new XftService(
      { xftIntegrationConfig: { findUnique: vi.fn().mockResolvedValue(persistedConfig) } } as never,
      () => ({ post } satisfies XftHttpClient)
    );

    await expect(
      service.importManualHours(
        [
          { staffName: "小灰16", staffNumber: "000002", hours: 1 },
          { staffName: "不存在", staffNumber: "NOPE", hours: 2 }
        ],
        "202606"
      )
    ).resolves.toMatchObject({
      accepted: 1,
      rejected: 1,
      errors: [{ row: 2, message: "员工不存在", errorCode: "SLZYC37" }]
    });

    expect(post).toHaveBeenCalledWith(
      "/sal/a/xft-sly/salary/api/import-collection-data",
      expect.objectContaining({
        collectionDataList: expect.arrayContaining([
          expect.objectContaining({ lineId: 1, collectionData: "{\"WORK_HOURS\":1}" })
        ])
      })
    );
  });
});
