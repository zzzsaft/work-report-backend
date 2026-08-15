import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { WorkReportService } from "../src/modules/work-report/service.js";

const user = { id: "worker-1", name: "张师傅", roles: ["worker"] };

describe("WorkReportService reports and statistics", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

it("returns paginated report records and treats datetime endTime as an exact boundary", async () => {
    const count = vi.fn().mockResolvedValue(3);
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "assignment-1",
        operationPoolId: "operation-1",
        workOrder: { orderNo: "WO-001", productName: "产品A" },
        part: { partNo: "01", partCode: "P-001", partName: "零件A" },
        operationPool: { operationCode: "OP-001", operationName: "粗加工", estimatedHours: 2, operationNote: "切削后去毛刺并测量尺寸。" },
        workerName: "张师傅",
        status: "completed",
        claimedAt: new Date("2026-07-01T01:00:00.000Z"),
        estimatedHours: 2,
        actualStartAt: new Date("2026-07-01T01:00:00.000Z"),
        actualEndAt: new Date("2026-07-01T03:00:00.000Z"),
        session: {
          id: "session-1",
          startedAt: new Date("2026-07-01T01:00:00.000Z"),
          completedAt: new Date("2026-07-01T03:00:00.000Z"),
          accumulatedSeconds: 7200
        }
      }
    ]);
    const db = { operationAssignment: { count, findMany } };
    const service = new WorkReportService(db as never);

    await expect(
      service.getReports({
        orderNo: "WO",
        startTime: "2026-07-01T00:00:00",
        endTime: "2026-07-01T12:00:00",
        page: 2,
        pageSize: 1
      })
    ).resolves.toEqual({
      items: [
        {
          id: "assignment-1",
          orderNo: "WO-001",
          productName: "产品A",
          partNo: "01",
          partCode: "P-001",
          partName: "零件A",
          operationCode: "OP-001",
          operationName: "粗加工",
          operationNote: "切削后去毛刺并测量尺寸。",
          operatorName: "张师傅",
          status: "completed",
          claimedAt: "2026-07-01T01:00:00.000Z",
          estimatedHours: 2,
          allocatedHours: 2,
          originalEstimatedHours: 2,
          hourAllocation: {
            allocatedHours: 2,
            originalEstimatedHours: 2,
            allocationApplied: true,
            allocationTemporary: true,
            allocationMethod: "actual_duration_ratio",
            allocationRatio: 1,
            allocationBasisSeconds: 7200,
            allocationParticipantCount: 1
          },
          durationHours: 2,
          startedAt: "2026-07-01T01:00:00.000Z",
          completedAt: "2026-07-01T03:00:00.000Z",
          actualStartAt: "2026-07-01T01:00:00.000Z",
          actualEndAt: "2026-07-01T03:00:00.000Z",
          photos: []
        }
      ],
      page: 2,
      pageSize: 1,
      total: 3,
      hasMore: true
    });

    const where = {
      status: { not: "cancelled" },
      workOrder: { orderNo: { contains: "WO", mode: "insensitive" } },
      claimedAt: {
        gte: new Date("2026-07-01T00:00:00"),
        lt: new Date("2026-07-01T12:00:00")
      }
    };
    expect(count).toHaveBeenCalledWith({ where });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        skip: 1,
        take: 1
      })
    );
  });

  it("filters report records by company", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { operationAssignment: { count, findMany } };
    const service = new WorkReportService(db as never);

    await service.getReports({ company: "jctimes" });

    expect(count).toHaveBeenCalledWith({
      where: {
        status: { not: "cancelled" },
        workOrder: { company: "jctimes" }
      }
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: { not: "cancelled" },
        workOrder: { company: "jctimes" }
      }
    }));
  });

  it("filters staff statistics by company", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 25, 2)));

    const findMany = vi.fn().mockResolvedValue([]);
    const db = { operationAssignment: { findMany } };
    const service = new WorkReportService(db as never);

    await service.getStaffStats("month", undefined, "JingyiMT");

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { not: "cancelled" },
        workOrder: { company: "JingyiMT" }
      })
    }));
  });

it("summarizes non-cancelled assignments by completion date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 25, 2))); // 2026-06-25T10:00+08:00

    const findMany = vi.fn().mockResolvedValue([
      {
        id: "a1",
        operationPoolId: "op1",
        estimatedHours: 2.5,
        actualEndAt: new Date(Date.UTC(2026, 5, 22, 1)), // 2026-06-22 09:00 Beijing
        claimedAt: new Date(Date.UTC(2026, 5, 22, 1)),
        plannedStart: new Date(Date.UTC(2026, 5, 21, 1))
      },
      {
        id: "a2",
        operationPoolId: "op2",
        estimatedHours: 3,
        actualEndAt: new Date(Date.UTC(2026, 5, 23, 1)), // 2026-06-23 09:00 Beijing
        claimedAt: null,
        plannedStart: new Date(Date.UTC(2026, 5, 23, 1))
      },
      {
        id: "a3",
        operationPoolId: "op3",
        estimatedHours: null,
        actualEndAt: new Date(Date.UTC(2026, 5, 22, 6)), // 2026-06-22 14:00 Beijing
        claimedAt: new Date(Date.UTC(2026, 5, 22, 6)),
        plannedStart: new Date(Date.UTC(2026, 5, 24, 1))
      }
    ]);
    const db = { operationAssignment: { findMany } };
    const service = new WorkReportService(db as never);

    await expect(service.getStatistics("week", user)).resolves.toMatchObject({
      period: "week",
      totalHours: 5.5,
      regularHours: 5.5,
      overtimeHours: 0,
      completedOperations: 3,
      attendanceDays: 2
    });

    // 北京时间本周: 2026-06-22 00:00+08:00 ~ 2026-06-29 00:00+08:00
    // 对应 UTC: 2026-06-21 16:00Z ~ 2026-06-28 16:00Z
    expect(findMany).toHaveBeenCalledWith({
      where: {
        workerId: user.id,
        status: { not: "cancelled" },
        actualEndAt: {
          gte: new Date(Date.UTC(2026, 5, 21, 16)),
          lt: new Date(Date.UTC(2026, 5, 28, 16)),
          not: null
        }
      },
      select: {
        id: true,
        operationPoolId: true,
        estimatedHours: true,
        actualStartAt: true,
        actualEndAt: true,
        claimedAt: true,
        plannedStart: true,
        operationPool: { select: { estimatedHours: true } }
      }
    });
  });

  it("supports day statistics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 25, 2))); // 2026-06-25T10:00+08:00

    const findMany = vi.fn().mockResolvedValue([
      {
        id: "d1",
        operationPoolId: "op1",
        estimatedHours: 1.25,
        actualEndAt: new Date(Date.UTC(2026, 5, 25, 1)), // 2026-06-25 09:00 Beijing
        claimedAt: new Date(Date.UTC(2026, 5, 25, 1)),
        plannedStart: new Date(Date.UTC(2026, 5, 24, 1))
      }
    ]);
    const db = { operationAssignment: { findMany } };
    const service = new WorkReportService(db as never);

    await expect(service.getStatistics("day", user)).resolves.toMatchObject({
      period: "day",
      totalHours: 1.25,
      regularHours: 1.25,
      overtimeHours: 0,
      completedOperations: 1,
      attendanceDays: 1
    });

    // 北京时间今日: 2026-06-25 00:00+08:00 ~ 2026-06-26 00:00+08:00
    // 对应 UTC: 2026-06-24 16:00Z ~ 2026-06-25 16:00Z
    expect(findMany).toHaveBeenCalledWith({
      where: {
        workerId: user.id,
        status: { not: "cancelled" },
        actualEndAt: {
          gte: new Date(Date.UTC(2026, 5, 24, 16)),
          lt: new Date(Date.UTC(2026, 5, 25, 16)),
          not: null
        }
      },
      select: {
        id: true,
        operationPoolId: true,
        estimatedHours: true,
        actualStartAt: true,
        actualEndAt: true,
        claimedAt: true,
        plannedStart: true,
        operationPool: { select: { estimatedHours: true } }
      }
    });
  });

  it("allocates one operation's standard hours by actual duration ratio", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 25, 2))); // 2026-06-25T10:00+08:00

    const userAssignment = {
      id: "assignment-1",
      operationPoolId: "operation-1",
      estimatedHours: 10,
      actualStartAt: new Date(Date.UTC(2026, 5, 25, 0)), // Beijing 08:00
      actualEndAt: new Date(Date.UTC(2026, 5, 25, 1)),   // Beijing 09:00
      claimedAt: new Date(Date.UTC(2026, 5, 25, 0)),
      plannedStart: new Date(Date.UTC(2026, 5, 25, 0)),
      operationPool: { estimatedHours: 10 }
    };
    const coworkerAssignment = {
      id: "assignment-2",
      operationPoolId: "operation-1",
      estimatedHours: 10,
      actualStartAt: new Date(Date.UTC(2026, 5, 25, 0)), // Beijing 08:00
      actualEndAt: new Date(Date.UTC(2026, 5, 25, 3)),   // Beijing 11:00
      operationPool: { estimatedHours: 10 }
    };
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([userAssignment])
      .mockResolvedValueOnce([userAssignment, coworkerAssignment]);
    const db = { operationAssignment: { findMany } };
    const service = new WorkReportService(db as never);

    await expect(service.getStatistics("day", user)).resolves.toMatchObject({
      period: "day",
      totalHours: 2.5,
      regularHours: 2.5,
      hourAllocation: {
        allocationTemporary: true,
        method: "actual_duration_ratio",
        appliedCount: 1,
        totalCount: 1,
        items: [
          {
            assignmentId: "assignment-1",
            operationPoolId: "operation-1",
            allocatedHours: 2.5,
            originalEstimatedHours: 10,
            allocationApplied: true,
            allocationTemporary: true,
            allocationMethod: "actual_duration_ratio",
            allocationRatio: 0.25,
            allocationBasisSeconds: 3600,
            allocationParticipantCount: 2
          }
        ]
      }
    });

    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          operationPoolId: { in: ["operation-1"] },
          status: { not: "cancelled" }
        }
      })
    );
  });

  it("supports month statistics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 25, 2))); // 2026-06-25T10:00+08:00

    const findMany = vi.fn().mockResolvedValue([
      {
        id: "m1",
        operationPoolId: "op1",
        estimatedHours: 2,
        actualEndAt: new Date(Date.UTC(2026, 5, 1, 1)),  // 2026-06-01 09:00 Beijing
        claimedAt: new Date(Date.UTC(2026, 5, 1, 1)),
        plannedStart: new Date(Date.UTC(2026, 4, 31, 1))
      },
      {
        id: "m2",
        operationPoolId: "op2",
        estimatedHours: 4,
        actualEndAt: new Date(Date.UTC(2026, 5, 30, 1)), // 2026-06-30 09:00 Beijing
        claimedAt: null,
        plannedStart: new Date(Date.UTC(2026, 5, 30, 1))
      }
    ]);
    const db = { operationAssignment: { findMany } };
    const service = new WorkReportService(db as never);

    await expect(service.getStatistics("month", user)).resolves.toMatchObject({
      period: "month",
      totalHours: 6,
      regularHours: 6,
      overtimeHours: 0,
      completedOperations: 2,
      attendanceDays: 2
    });

    // 北京时间 6月 范围: 2026-06-01 00:00+08:00 ~ 2026-07-01 00:00+08:00
    // 对应 UTC: 2026-05-31 16:00Z ~ 2026-06-30 16:00Z
    expect(findMany).toHaveBeenCalledWith({
      where: {
        workerId: user.id,
        status: { not: "cancelled" },
        actualEndAt: {
          gte: new Date(Date.UTC(2026, 4, 31, 16)),
          lt: new Date(Date.UTC(2026, 5, 30, 16)),
          not: null
        }
      },
      select: {
        id: true,
        operationPoolId: true,
        estimatedHours: true,
        actualStartAt: true,
        actualEndAt: true,
        claimedAt: true,
        plannedStart: true,
        operationPool: { select: { estimatedHours: true } }
      }
    });
  });

  it("month statistics correctly handles Beijing early morning when UTC is still previous day", async () => {
    // 核心用例: 2026-08-01 07:37 北京时看本月统计
    // 对应 UTC 为 2026-07-31 23:37
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 31, 23, 37))); // 2026-08-01T07:37+08:00

    const findMany = vi.fn().mockResolvedValue([
      {
        id: "aug1",
        operationPoolId: "op-aug",
        estimatedHours: 3,
        actualEndAt: new Date(Date.UTC(2026, 6, 31, 23, 0)), // 2026-08-01 07:00 Beijing (本月)
        claimedAt: new Date(Date.UTC(2026, 6, 31, 23, 0))
      }
    ]);
    const db = { operationAssignment: { findMany } };
    const service = new WorkReportService(db as never);

    await expect(service.getStatistics("month", user)).resolves.toMatchObject({
      period: "month",
      totalHours: 3,
      attendanceDays: 1
    });

    // 期望区间为北京时间 8 月: 2026-08-01 00:00+08:00 ~ 2026-09-01 00:00+08:00
    // 即 UTC: 2026-07-31 16:00Z ~ 2026-08-31 16:00Z
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        actualEndAt: {
          gte: new Date(Date.UTC(2026, 6, 31, 16)),
          lt: new Date(Date.UTC(2026, 7, 31, 16)),
          not: null
        }
      })
    }));
  });

  it("month statistics excludes data from last Beijing day of previous month", async () => {
    // 2026-08-01 07:37 Beijing 访问时，7月31日 18:00 Beijing 完工的数据不应计入"本月"
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 31, 23, 37))); // 2026-08-01T07:37+08:00

    const julyCompletion = new Date(Date.UTC(2026, 6, 31, 10, 0)); // 2026-07-31 18:00 Beijing (7月)
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "jul",
        operationPoolId: "op-jul",
        estimatedHours: 8,
        actualEndAt: julyCompletion,
        claimedAt: julyCompletion
      }
    ]);
    const db = { operationAssignment: { findMany } };
    const service = new WorkReportService(db as never);

    await service.getStatistics("month", user);
    const where = findMany.mock.calls[0][0].where as { actualEndAt: { gte: Date; lt: Date } };

    // 7 月 31 日 18:00 Beijing 的完工时间 < 8 月范围起点, 不应被计入
    expect(julyCompletion.getTime() < where.actualEndAt.gte.getTime() || julyCompletion.getTime() >= where.actualEndAt.lt.getTime()).toBe(true);
  });

  it("supports lastMonth statistics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 15, 2))); // 2026-07-15T10:00+08:00

    const findMany = vi.fn().mockResolvedValue([
      {
        id: "lm1",
        operationPoolId: "op1",
        estimatedHours: 3,
        actualEndAt: new Date(Date.UTC(2026, 5, 20, 1)), // 2026-06-20 09:00 Beijing
        claimedAt: new Date(Date.UTC(2026, 5, 20, 1))
      },
      {
        id: "lm2",
        operationPoolId: "op2",
        estimatedHours: 4,
        actualEndAt: new Date(Date.UTC(2026, 5, 30, 6)), // 2026-06-30 14:00 Beijing
        claimedAt: new Date(Date.UTC(2026, 5, 30, 6))
      }
    ]);
    const db = { operationAssignment: { findMany } };
    const service = new WorkReportService(db as never);

    await expect(service.getStatistics("lastMonth", user)).resolves.toMatchObject({
      period: "lastMonth",
      totalHours: 7,
      regularHours: 7,
      overtimeHours: 0,
      completedOperations: 2,
      attendanceDays: 2
    });

    // 上月范围: 2026-06-01 00:00+08:00 ~ 2026-07-01 00:00+08:00
    // 对应 UTC: 2026-05-31 16:00Z ~ 2026-06-30 16:00Z
    expect(findMany).toHaveBeenCalledWith({
      where: {
        workerId: user.id,
        status: { not: "cancelled" },
        actualEndAt: {
          gte: new Date(Date.UTC(2026, 4, 31, 16)),
          lt: new Date(Date.UTC(2026, 5, 30, 16)),
          not: null
        }
      },
      select: expect.any(Object)
    });
  });
});
