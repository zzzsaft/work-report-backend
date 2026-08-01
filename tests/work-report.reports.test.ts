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
        part: { partCode: "P-001", partName: "零件A" },
        operationPool: { operationCode: "OP-001", operationName: "粗加工", estimatedHours: 2 },
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
          partCode: "P-001",
          partName: "零件A",
          operationCode: "OP-001",
          operationName: "粗加工",
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

it("summarizes non-cancelled assignments by claimed date first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 25, 10));

    const findMany = vi.fn().mockResolvedValue([
      {
        estimatedHours: 2.5,
        claimedAt: new Date(2026, 5, 22, 9),
        plannedStart: new Date(2026, 5, 21, 9)
      },
      {
        estimatedHours: 3,
        claimedAt: null,
        plannedStart: new Date(2026, 5, 23, 9)
      },
      {
        estimatedHours: null,
        claimedAt: new Date(2026, 5, 22, 14),
        plannedStart: new Date(2026, 5, 24, 9)
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

    expect(findMany).toHaveBeenCalledWith({
      where: {
        workerId: user.id,
        status: { not: "cancelled" },
        OR: [
          {
            claimedAt: {
              gte: new Date(2026, 5, 22),
              lt: new Date(2026, 5, 29)
            }
          },
          {
            claimedAt: null,
            plannedStart: {
              gte: new Date(2026, 5, 22),
              lt: new Date(2026, 5, 29)
            }
          }
        ]
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
    vi.setSystemTime(new Date(2026, 5, 25, 10));

    const findMany = vi.fn().mockResolvedValue([
      {
        estimatedHours: 1.25,
        claimedAt: new Date(2026, 5, 25, 9),
        plannedStart: new Date(2026, 5, 24, 9)
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

    expect(findMany).toHaveBeenCalledWith({
      where: {
        workerId: user.id,
        status: { not: "cancelled" },
        OR: [
          {
            claimedAt: {
              gte: new Date(2026, 5, 25),
              lt: new Date(2026, 5, 26)
            }
          },
          {
            claimedAt: null,
            plannedStart: {
              gte: new Date(2026, 5, 25),
              lt: new Date(2026, 5, 26)
            }
          }
        ]
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
    vi.setSystemTime(new Date(2026, 5, 25, 10));

    const userAssignment = {
      id: "assignment-1",
      operationPoolId: "operation-1",
      estimatedHours: 10,
      actualStartAt: new Date(2026, 5, 25, 8),
      actualEndAt: new Date(2026, 5, 25, 9),
      claimedAt: new Date(2026, 5, 25, 8),
      plannedStart: new Date(2026, 5, 25, 8),
      operationPool: { estimatedHours: 10 }
    };
    const coworkerAssignment = {
      id: "assignment-2",
      operationPoolId: "operation-1",
      estimatedHours: 10,
      actualStartAt: new Date(2026, 5, 25, 8),
      actualEndAt: new Date(2026, 5, 25, 11),
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
    // 2026-06-25 10:00 local (Beijing) is well inside June so no UTC boundary trick
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 25, 2))); // 2026-06-25T02:00Z = 2026-06-25T10:00+08:00

    const findMany = vi.fn().mockResolvedValue([
      {
        id: "m1",
        operationPoolId: "op1",
        estimatedHours: 2,
        claimedAt: new Date(Date.UTC(2026, 5, 1, 1)), // 2026-06-01 09:00 Beijing
        plannedStart: new Date(Date.UTC(2026, 4, 31, 1))
      },
      {
        id: "m2",
        operationPoolId: "op2",
        estimatedHours: 4,
        claimedAt: null,
        plannedStart: new Date(Date.UTC(2026, 5, 30, 1)) // 2026-06-30 09:00 Beijing
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
        OR: [
          {
            claimedAt: {
              gte: new Date(Date.UTC(2026, 4, 31, 16)),
              lt: new Date(Date.UTC(2026, 5, 30, 16))
            }
          },
          {
            claimedAt: null,
            plannedStart: {
              gte: new Date(Date.UTC(2026, 4, 31, 16)),
              lt: new Date(Date.UTC(2026, 5, 30, 16))
            }
          }
        ]
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
    // 核心用例: 用户反馈 2026-08-01 07:37 北京时看本月统计竟然包含 7 月数据
    // 对应 UTC 为 2026-07-31 23:37，若用本地时区(UTC)会误判月份为 7 月
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 31, 23, 37))); // 2026-07-31T23:37Z = 2026-08-01T07:37+08:00

    const findMany = vi.fn().mockResolvedValue([
      {
        id: "aug1",
        operationPoolId: "op-aug",
        estimatedHours: 3,
        claimedAt: new Date(Date.UTC(2026, 6, 31, 23, 0)) // 2026-08-01 07:00 Beijing (本月)
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
        OR: [
          {
            claimedAt: {
              gte: new Date(Date.UTC(2026, 6, 31, 16)),
              lt: new Date(Date.UTC(2026, 7, 31, 16))
            }
          },
          {
            claimedAt: null,
            plannedStart: {
              gte: new Date(Date.UTC(2026, 6, 31, 16)),
              lt: new Date(Date.UTC(2026, 7, 31, 16))
            }
          }
        ]
      })
    }));
  });

  it("month statistics excludes data from last Beijing day of previous month", async () => {
    // 2026-08-01 07:37 Beijing 访问时，7月31日 18:00 Beijing 的数据不应计入"本月"
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 31, 23, 37))); // 2026-08-01T07:37+08:00

    const julyClaim = new Date(Date.UTC(2026, 6, 31, 10, 0)); // 2026-07-31 18:00 Beijing (7月)
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "jul",
        operationPoolId: "op-jul",
        estimatedHours: 8,
        claimedAt: julyClaim
      }
    ]);
    const db = { operationAssignment: { findMany } };
    const service = new WorkReportService(db as never);

    const findManyArgs = findMany.mock.calls;
    const { OR } = (await (async () => {
      await service.getStatistics("month", user);
      return findMany.mock.calls[0][0].where as { OR: Array<{ claimedAt: { gte: Date; lt: Date } }> };
    })())!;

    const range = OR[0].claimedAt;
    // 7 月 31 日 18:00 Beijing 的记录 < 8 月范围的起点, 不应被计入
    expect(julyClaim.getTime() < range.gte.getTime() || julyClaim.getTime() >= range.lt.getTime()).toBe(true);
  });
});
