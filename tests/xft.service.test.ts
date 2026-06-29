import { beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import pkg from "sm-crypto";
import { AppError } from "../src/lib/errors.js";
import {
  buildXftCollectionPayload,
  decryptXftBody,
  encryptXftBody,
  getSalaryPeriodRange,
  XftApiClient,
  XftService,
  type XftHttpClient
} from "../src/modules/xft/service.js";

vi.mock("axios", () => ({
  default: vi.fn()
}));

const { sm2 } = pkg;
const xftKeyPair = sm2.generateKeyPairHex();

const persistedConfig = {
  id: "default",
  host: "https://api.cmbchina.com",
  appid: "appid",
  appSecret: xftKeyPair.privateKey,
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
  beforeEach(() => {
    vi.mocked(axios).mockClear();
  });

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
        update: expect.objectContaining({ appSecret: xftKeyPair.privateKey })
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
    const get = vi.fn();
    const post = vi.fn().mockResolvedValue({
      returnCode: "SUC0000",
      errorMsg: null,
      body: [{ lineId: 2, errorMessage: "员工不存在", errorCode: "SLZYC37" }]
    });
    const service = new XftService(
      { xftIntegrationConfig: { findUnique: vi.fn().mockResolvedValue(persistedConfig) } } as never,
      () => ({ get, post } satisfies XftHttpClient)
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

  it("encrypts xft POST bodies with secretMsg and decrypts encrypted responses", async () => {
    const responseBody = { returnCode: "SUC0000", errorMsg: null, body: { ok: true } };
    vi.mocked(axios).mockResolvedValueOnce({
      data: encryptXftBody(JSON.stringify(responseBody), persistedConfig.appSecret)
    });

    const client = new XftApiClient(persistedConfig);
    await expect(client.post("/hrm/hrm2/test", { hello: "world" })).resolves.toEqual(responseBody);

    const request = vi.mocked(axios).mock.calls[0][0] as {
      method: string;
      url: string;
      data: string;
      headers: Record<string, string>;
    };
    expect(request.method).toBe("POST");
    expect(request.url).toContain("/hrm/hrm2/test?CSCAPPUID=appid&CSCPRJCOD=enterprise&");
    expect(request.headers["x-alb-digest"]).toBeTruthy();

    const encryptedRequest = JSON.parse(request.data) as { secretMsg: string };
    expect(JSON.parse(decryptXftBody(encryptedRequest.secretMsg, persistedConfig.appSecret))).toEqual({
      hello: "world"
    });
  });

  it("decrypts encrypted xft GET responses", async () => {
    const responseBody = { returnCode: "SUC0000", body: { rows: [1] } };
    vi.mocked(axios).mockResolvedValueOnce({
      data: encryptXftBody(JSON.stringify(responseBody), persistedConfig.appSecret)
    });

    const client = new XftApiClient(persistedConfig);
    await expect(client.get("/hrm/hrm2/test", { page: 1 })).resolves.toEqual(responseBody);

    const request = vi.mocked(axios).mock.calls[0][0] as {
      method: string;
      url: string;
      headers: Record<string, string>;
    };
    expect(request.method).toBe("GET");
    expect(request.url).toContain("page=1");
    expect(request.headers["x-alb-digest"]).toBeUndefined();
  });
});
