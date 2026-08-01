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

describe("WorkReportService claim flow", () => {
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

  it("rejects duplicate claims within 30 minutes", async () => {
    vi.setSystemTime(new Date("2026-06-25T09:00:00+08:00"));
    const tx = createTx();
    tx.operationPool.findUnique.mockResolvedValue({
      id: "op-1",
      workOrderId: "order-1",
      partId: "part-1",
      status: "available",
      claimedWorkers: 0,
      maxClaimWorkers: 2
    });
    tx.operationAssignment.findFirst.mockResolvedValue({ id: "assignment-1", claimedAt: new Date("2026-06-25T08:45:00+08:00"), createdAt: new Date("2026-06-25T08:45:00+08:00") });

    const db = { $transaction: vi.fn((handler) => handler(tx)) };
    const service = new WorkReportService(db as never);

    await expect(service.claimOperation("op-1", user)).rejects.toMatchObject(
      new AppError(409, "半小时内不能重复领取同一工序")
    );
  });

  it("claims the same operation again after 30 minutes", async () => {
    vi.setSystemTime(new Date("2026-06-25T09:20:00+08:00"));
    const tx = createTx();
    tx.operationPool.findUnique.mockResolvedValue({
      id: "op-1",
      workOrderId: "order-1",
      partId: "part-1",
      status: "available",
      claimedWorkers: 1,
      maxClaimWorkers: 3,
      plannedStart: new Date("2026-06-25T09:00:00+08:00"),
      estimatedHours: 1,
      plannedQuantity: 10
    });
    tx.operationAssignment.findFirst.mockResolvedValue({
      id: "assignment-old",
      claimedAt: new Date("2026-06-25T08:49:00+08:00"),
      createdAt: new Date("2026-06-25T08:49:00+08:00")
    });
    tx.operationPool.updateMany.mockResolvedValue({ count: 1 });
    tx.operationAssignment.create.mockResolvedValue({ id: "assignment-new" });
    tx.operationAssignment.findUniqueOrThrow.mockResolvedValue({
      id: "assignment-new",
      operationPoolId: "op-1",
      workOrderId: "order-1",
      partId: "part-1",
      workerId: user.id,
      workerName: user.name,
      source: "self_claimed",
      status: "assigned",
      plannedStart: new Date("2026-06-25T09:00:00+08:00"),
      plannedEnd: new Date("2026-06-25T10:00:00+08:00"),
      plannedQuantity: 10,
      estimatedHours: 1,
      canWorkerRemove: true,
      claimedAt: new Date("2026-06-25T09:20:00+08:00"),
      assignedById: null,
      assignedByName: null,
      assignedByRole: null,
      workOrder: { id: "order-1", orderNo: "WO-1", productCode: "PRD-1", productName: "产品" },
      part: { id: "part-1", partCode: "P-1", partName: "零件" },
      operationPool: { id: "op-1", operationCode: "OP-010", operationName: "粗加工", operationNote: "" },
      collaborators: [],
      session: null,
      assignedBy: null
    });

    const db = { $transaction: vi.fn((handler) => handler(tx)) };
    const service = new WorkReportService(db as never);

    await expect(service.claimOperation("op-1", user)).resolves.toMatchObject({ id: "assignment-new" });
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
});
