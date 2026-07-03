import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { WorkReportService } from "../src/modules/work-report/service.js";

const user = { id: "worker-1", name: "张师傅", roles: ["worker"] };

const createTx = (overrides: Record<string, unknown> = {}) => ({
  operationPool: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn()
  },
  operationAssignment: {
    findFirst: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn()
  },
  role: {
    upsert: vi.fn()
  },
  user: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn()
  },
  userRole: {
    create: vi.fn(),
    deleteMany: vi.fn()
  },
  workOrder: {
    upsert: vi.fn()
  },
  workOrderPart: {
    upsert: vi.fn()
  },
  ...overrides
});

describe("WorkReportService", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("returns paginated claimable products with stable ordering", async () => {
    const count = vi.fn().mockResolvedValue(5);
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "order-1",
        orderNo: "WO-001",
        productCode: "CP-001",
        productName: "产品A",
        plannedQuantity: 100,
        completedQuantity: 20,
        operationPools: [{ remainingQuantity: 30 }, { remainingQuantity: 15 }]
      }
    ]);
    const db = { workOrder: { count, findMany } };
    const service = new WorkReportService(db as never);

    await expect(service.searchClaimableProducts(" cp ", 2, 2)).resolves.toEqual({
      items: [
        {
          id: "order-1",
          orderNo: "WO-001",
          productCode: "CP-001",
          productName: "产品A",
          remainingQuantity: 45
        }
      ],
      page: 2,
      pageSize: 2,
      total: 5,
      hasMore: true
    });

    const where = {
      operationPools: { some: { status: { in: ["available", "claimed"] } } },
      OR: [
        { orderNo: { contains: "cp", mode: "insensitive" } },
        { productCode: { contains: "cp", mode: "insensitive" } },
        { productName: { contains: "cp", mode: "insensitive" } }
      ]
    };
    expect(count).toHaveBeenCalledWith({ where });
    expect(findMany).toHaveBeenCalledWith({
      where,
      select: {
        id: true,
        orderNo: true,
        productCode: true,
        productName: true,
        plannedQuantity: true,
        completedQuantity: true,
        operationPools: {
          where: { status: { in: ["available", "claimed"] } },
          select: { remainingQuantity: true }
        }
      },
      skip: 2,
      take: 2,
      orderBy: [{ createdAt: "desc" }, { productCode: "asc" }, { id: "asc" }]
    });
  });

  it("treats an empty claimable product keyword as omitted", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { workOrder: { count, findMany } };
    const service = new WorkReportService(db as never);

    await expect(service.searchClaimableProducts("   ")).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 4,
      total: 0,
      hasMore: false
    });

    expect(count).toHaveBeenCalledWith({
      where: {
        operationPools: { some: { status: { in: ["available", "claimed"] } } }
      }
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 4
      })
    );
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

  it("clamps claimable product pagination and preserves total when page is out of range", async () => {
    const count = vi.fn().mockResolvedValue(3);
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { workOrder: { count, findMany } };
    const service = new WorkReportService(db as never);

    await expect(service.searchClaimableProducts("", 2, 100)).resolves.toEqual({
      items: [],
      page: 2,
      pageSize: 50,
      total: 3,
      hasMore: false
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 50,
        take: 50
      })
    );
  });

  it("rejects duplicate claims", async () => {
    const tx = createTx();
    tx.operationPool.findUnique.mockResolvedValue({
      id: "op-1",
      workOrderId: "order-1",
      partId: "part-1",
      status: "available",
      claimedWorkers: 0,
      maxClaimWorkers: 2
    });
    tx.operationAssignment.findFirst.mockResolvedValue({ id: "assignment-1" });

    const db = { $transaction: vi.fn((handler) => handler(tx)) };
    const service = new WorkReportService(db as never);

    await expect(service.claimOperation("op-1", user)).rejects.toMatchObject(
      new AppError(409, "不能重复领取同一工序")
    );
  });

  it("claims operations with a guarded worker-count update", async () => {
    const tx = createTx();
    tx.operationPool.findUnique.mockResolvedValue({
      id: "op-1",
      workOrderId: "order-1",
      partId: "part-1",
      status: "available",
      claimedWorkers: 1,
      maxClaimWorkers: 2,
      plannedStart: new Date("2026-06-25T09:00:00+08:00"),
      estimatedHours: 1.5,
      plannedQuantity: 10
    });
    tx.operationAssignment.findFirst.mockResolvedValue(null);
    tx.operationPool.updateMany.mockResolvedValue({ count: 1 });
    tx.operationAssignment.create.mockResolvedValue({ id: "assignment-1" });
    tx.operationAssignment.findUniqueOrThrow.mockResolvedValue({
      id: "assignment-1",
      operationPoolId: "op-1",
      workOrderId: "order-1",
      partId: "part-1",
      workerId: user.id,
      workerName: user.name,
      source: "self_claimed",
      status: "assigned",
      plannedStart: new Date("2026-06-25T09:00:00+08:00"),
      plannedEnd: new Date("2026-06-25T10:30:00+08:00"),
      plannedQuantity: 10,
      estimatedHours: 1.5,
      canWorkerRemove: true,
      claimedAt: new Date("2026-06-25T09:00:00+08:00"),
      assignedById: null,
      assignedByName: null,
      assignedByRole: null,
      workOrder: {
        id: "order-1",
        orderNo: "WO-1",
        productCode: "PRD-1",
        productName: "产品"
      },
      part: {
        id: "part-1",
        partCode: "P-1",
        partName: "零件"
      },
      operationPool: {
        id: "op-1",
        operationCode: "OP-010",
        operationName: "粗加工",
        operationNote: ""
      },
      collaborators: [],
      session: null,
      assignedBy: null
    });

    const db = { $transaction: vi.fn((handler) => handler(tx)) };
    const service = new WorkReportService(db as never);

    await expect(service.claimOperation("op-1", user)).resolves.toMatchObject({
      id: "assignment-1",
      operationCode: "OP-010"
    });

    expect(tx.operationPool.updateMany).toHaveBeenCalledWith({
      where: {
        id: "op-1",
        status: "available",
        claimedWorkers: 1
      },
      data: {
        claimedWorkers: 2,
        status: "claimed"
      }
    });
  });

  it("rejects removing assignments that workers cannot remove", async () => {
    const tx = createTx();
    tx.operationAssignment.findUnique.mockResolvedValue({
      id: "assignment-1",
      workerId: user.id,
      source: "assigned",
      status: "assigned",
      canWorkerRemove: false,
      operationPoolId: "op-1",
      operationPool: { claimedWorkers: 1, status: "available" }
    });

    const db = { $transaction: vi.fn((handler) => handler(tx)) };
    const service = new WorkReportService(db as never);

    await expect(service.removeClaimedAssignment("assignment-1", user)).rejects.toMatchObject(
      new AppError(409, "该工序已开始或不可自行删除")
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
    vi.setSystemTime(new Date(2026, 5, 25, 10));

    const findMany = vi.fn().mockResolvedValue([
      {
        estimatedHours: 2,
        claimedAt: new Date(2026, 5, 1, 9),
        plannedStart: new Date(2026, 4, 31, 9)
      },
      {
        estimatedHours: 4,
        claimedAt: null,
        plannedStart: new Date(2026, 5, 30, 9)
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

    expect(findMany).toHaveBeenCalledWith({
      where: {
        workerId: user.id,
        status: { not: "cancelled" },
        OR: [
          {
            claimedAt: {
              gte: new Date(2026, 5, 1),
              lt: new Date(2026, 6, 1)
            }
          },
          {
            claimedAt: null,
            plannedStart: {
              gte: new Date(2026, 5, 1),
              lt: new Date(2026, 6, 1)
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

  it("returns worker permission groups from roles", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "worker-1",
        employeeNo: "EMP-001",
        name: "张师傅",
        nameInitials: "zsf",
        teamName: "生产一组",
        userRoles: [{ role: { code: "leader" } }]
      },
      {
        id: "worker-2",
        employeeNo: null,
        name: "李师傅",
        nameInitials: null,
        teamName: null,
        userRoles: []
      }
    ]);
    const db = { user: { findMany } };
    const service = new WorkReportService(db as never);

    await expect(service.getWorkerPermissions()).resolves.toEqual([
      {
        id: "worker-1",
        workerId: "worker-1",
        employeeNo: "EMP-001",
        name: "张师傅",
        nameInitials: "zsf",
        teamName: "生产一组",
        permissionGroup: "leader",
        roles: ["leader"]
      },
      {
        id: "worker-2",
        workerId: "worker-2",
        employeeNo: "worker-2",
        name: "李师傅",
        nameInitials: "",
        teamName: "",
        permissionGroup: "worker",
        roles: ["worker"]
      }
    ]);
  });

  it("updates a worker permission group by replacing roles", async () => {
    const tx = createTx();
    tx.user.findUnique.mockResolvedValue({ id: "worker-1" });
    tx.role.upsert.mockResolvedValue({ id: "role-admin", code: "admin" });
    tx.user.findUniqueOrThrow.mockResolvedValue({
      id: "worker-1",
      employeeNo: "EMP-001",
      name: "张师傅",
      nameInitials: "zsf",
      teamName: "生产一组",
      userRoles: [{ role: { code: "admin" } }]
    });

    const db = { $transaction: vi.fn((handler) => handler(tx)) };
    const service = new WorkReportService(db as never);

    await expect(service.updateWorkerPermission("worker-1", "admin")).resolves.toMatchObject({
      id: "worker-1",
      workerId: "worker-1",
      permissionGroup: "admin",
      roles: ["admin"]
    });

    expect(tx.role.upsert).toHaveBeenCalledWith({
      where: { code: "admin" },
      create: { code: "admin", name: "管理员" },
      update: { name: "管理员" }
    });
    expect(tx.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: "worker-1" } });
    expect(tx.userRole.create).toHaveBeenCalledWith({
      data: {
        userId: "worker-1",
        roleId: "role-admin"
      }
    });
  });

});
