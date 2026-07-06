import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { WorkReportService } from "../src/modules/work-report/service.js";

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

describe("WorkReportService worker permissions", () => {
  beforeEach(() => {
    vi.useRealTimers();
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
