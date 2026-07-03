import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import type { AuthenticatedUser } from "../../middleware/auth.js";
import {
  ASSIGNMENT_STATUS,
  CLAIMABLE_OPERATION_STATUSES,
  INACTIVE_ASSIGNMENT_STATUSES,
  OPERATION_POOL_STATUS
} from "./constants.js";
import {
  serializeAssignment,
  serializeOperation,
  serializePart,
  serializeProduct,
  serializeWorkOrder
} from "./serializers.js";
import {
  MAX_IMPORT_OPERATIONS,
  WorkReportImportService,
  type ThirdPartyImportOperation
} from "./import-service.js";
import {
  calculateHourAllocations,
  defaultHourAllocation,
  type HourAllocationInput,
  type HourAllocationResult
} from "./hour-allocation.js";

export { MAX_IMPORT_OPERATIONS, type ThirdPartyImportOperation };

const assignmentInclude = {
  workOrder: true,
  part: true,
  operationPool: true,
  collaborators: true,
  session: true,
  assignedBy: true
} as const;

const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * 3600_000);

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const getPeriodRange = (period: string, now = new Date()) => {
  const today = startOfDay(now);

  if (period === "day") {
    return { start: today, end: addDays(today, 1) };
  }

  if (period === "week") {
    const mondayOffset = (today.getDay() + 6) % 7;
    const start = addDays(today, -mondayOffset);
    return { start, end: addDays(start, 7) };
  }

  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return { start, end };
};

const getDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const CLAIM_CONFLICT_MESSAGE = "该工序领取状态已变化，请重试";
const MAX_CLAIM_PRODUCTS_PAGE_SIZE = 50;
const MAX_REPORTS_PAGE_SIZE = 100;
const PERMISSION_GROUPS = ["worker", "leader", "admin"] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

const roleNames: Record<PermissionGroup, string> = {
  worker: "员工",
  leader: "小组长",
  admin: "管理员"
};

const getPermissionGroup = (roles: string[]): PermissionGroup => {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("leader")) return "leader";
  return "worker";
};

const serializeWorkerPermission = (worker: {
  id: string;
  employeeNo: string | null;
  name: string;
  nameInitials: string | null;
  teamName: string | null;
  userRoles: { role: { code: string } }[];
}) => {
  const roles = worker.userRoles
    .map((item) => item.role.code)
    .filter((role) => PERMISSION_GROUPS.includes(role as PermissionGroup));
  const normalizedRoles = roles.length > 0 ? roles : ["worker"];

  return {
    id: worker.id,
    workerId: worker.id,
    employeeNo: worker.employeeNo || worker.id,
    name: worker.name,
    nameInitials: worker.nameInitials || "",
    teamName: worker.teamName || "",
    permissionGroup: getPermissionGroup(normalizedRoles),
    roles: normalizedRoles
  };
};

const serializeReportRecord = (assignment: {
  id: string;
  operationPoolId: string;
  workOrder: { orderNo: string; productName: string };
  part: { partCode: string; partName: string };
  operationPool: { operationCode: string; operationName: string; estimatedHours: number };
  workerName: string;
  status: string;
  claimedAt: Date | null;
  estimatedHours: number | null;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  session: {
    id: string;
    startedAt: Date | null;
    completedAt: Date | null;
    accumulatedSeconds: number;
  } | null;
}, allocation?: HourAllocationResult) => {
  const durationSeconds = assignment.session?.accumulatedSeconds ?? 0;
  const durationHours = Math.round((durationSeconds / 3600) * 10) / 10;
  const hourAllocation = allocation ?? defaultHourAllocation(assignment);

  return {
    id: assignment.id,
    orderNo: assignment.workOrder.orderNo,
    productName: assignment.workOrder.productName,
    partCode: assignment.part.partCode,
    partName: assignment.part.partName,
    operationCode: assignment.operationPool.operationCode,
    operationName: assignment.operationPool.operationName,
    operatorName: assignment.workerName,
    status: assignment.status,
    claimedAt: assignment.claimedAt?.toISOString(),
    estimatedHours: assignment.estimatedHours ?? 0,
    allocatedHours: hourAllocation.allocatedHours,
    originalEstimatedHours: hourAllocation.originalEstimatedHours,
    hourAllocation,
    durationHours,
    startedAt: assignment.session?.startedAt?.toISOString(),
    completedAt: assignment.session?.completedAt?.toISOString(),
    actualStartAt: assignment.actualStartAt?.toISOString(),
    actualEndAt: assignment.actualEndAt?.toISOString(),
    photos: []
  };
};

const dateOnlyPattern = /^\d{4}[-/]\d{2}[-/]\d{2}$/;

const parseReportDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AppError(400, "日期格式无效");
  return parsed;
};

const reportDateRange = (startTime?: string, endTime?: string) => {
  if (!startTime && !endTime) return undefined;

  const range: Record<string, Date> = {};
  if (startTime) range.gte = parseReportDate(startTime);
  if (endTime) {
    const endDate = parseReportDate(endTime);
    range.lt = dateOnlyPattern.test(endTime) ? addDays(endDate, 1) : endDate;
  }
  return range;
};

const uniqueValues = <T>(values: T[]) => Array.from(new Set(values));

export class WorkReportService {
  private readonly importService: WorkReportImportService;

  constructor(private readonly db: PrismaClient = prisma) {
    this.importService = new WorkReportImportService(db);
  }

  getReports = async (filters: {
    keyword?: string;
    orderNo?: string;
    operatorName?: string;
    status?: string;
    operationCode?: string;
    operationName?: string;
    startTime?: string;
    endTime?: string;
    page?: number;
    pageSize?: number;
  } = {}) => {
    const where: Record<string, unknown> = {};
    const safePage = Math.max(filters.page ?? 1, 1);
    const safePageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), MAX_REPORTS_PAGE_SIZE);

    if (filters.keyword) {
      where.OR = [
        { workOrder: { orderNo: { contains: filters.keyword, mode: "insensitive" as const } } },
        { workOrder: { productName: { contains: filters.keyword, mode: "insensitive" as const } } },
        { part: { partCode: { contains: filters.keyword, mode: "insensitive" as const } } },
        { part: { partName: { contains: filters.keyword, mode: "insensitive" as const } } },
        { operationPool: { operationCode: { contains: filters.keyword, mode: "insensitive" as const } } },
        { operationPool: { operationName: { contains: filters.keyword, mode: "insensitive" as const } } },
        { workerName: { contains: filters.keyword, mode: "insensitive" as const } }
      ];
    }

    if (filters.orderNo) {
      where.workOrder = {
        ...(where.workOrder as Record<string, unknown>),
        orderNo: { contains: filters.orderNo, mode: "insensitive" as const }
      };
    }

    if (filters.operatorName) {
      where.workerName = { contains: filters.operatorName, mode: "insensitive" as const };
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.operationCode) {
      where.operationPool = {
        ...(where.operationPool as Record<string, unknown>),
        operationCode: { contains: filters.operationCode, mode: "insensitive" as const }
      };
    }

    if (filters.operationName) {
      where.operationPool = {
        ...(where.operationPool as Record<string, unknown>),
        operationName: { contains: filters.operationName, mode: "insensitive" as const }
      };
    }

    const claimedAtRange = reportDateRange(filters.startTime, filters.endTime);
    if (claimedAtRange) where.claimedAt = claimedAtRange;

    const [total, assignments] = await Promise.all([
      this.db.operationAssignment.count({ where }),
      this.db.operationAssignment.findMany({
        where,
        include: {
          workOrder: { select: { orderNo: true, productName: true } },
          part: { select: { partCode: true, partName: true } },
          operationPool: { select: { operationCode: true, operationName: true, estimatedHours: true } },
          session: {
            select: { id: true, startedAt: true, completedAt: true, accumulatedSeconds: true }
          }
        },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        orderBy: [{ claimedAt: "desc" }, { id: "desc" }]
      })
    ]);
    const operationPoolIds = uniqueValues(
      assignments
        .map((assignment) => assignment.operationPoolId)
        .filter((operationPoolId): operationPoolId is string => typeof operationPoolId === "string")
    );
    const allocationParticipants = operationPoolIds.length
      ? await this.db.operationAssignment.findMany({
          where: {
            operationPoolId: { in: operationPoolIds },
            status: { not: ASSIGNMENT_STATUS.cancelled }
          },
          select: {
            id: true,
            operationPoolId: true,
            estimatedHours: true,
            actualStartAt: true,
            actualEndAt: true,
            operationPool: { select: { estimatedHours: true } }
          }
        })
      : [];
    const allocations = calculateHourAllocations(allocationParticipants);

    return {
      items: assignments.map((assignment) => serializeReportRecord(assignment, allocations.get(assignment.id))),
      page: safePage,
      pageSize: safePageSize,
      total,
      hasMore: safePage * safePageSize < total
    };
  };

  updateAssignmentHours = async (assignmentId: string, estimatedHours: number) => {
    const assignment = await this.db.operationAssignment.findUnique({
      where: { id: assignmentId }
    });

    if (!assignment) {
      throw new AppError(404, "报工记录不存在");
    }

    await this.db.operationAssignment.update({
      where: { id: assignmentId },
      data: { estimatedHours }
    });

    const updated = await this.db.operationAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        workOrder: { select: { orderNo: true, productName: true } },
        part: { select: { partCode: true, partName: true } },
        operationPool: { select: { operationCode: true, operationName: true, estimatedHours: true } },
        session: {
          select: { id: true, startedAt: true, completedAt: true, accumulatedSeconds: true }
        }
      }
    });

    return serializeReportRecord(updated!);
  };

  getAssignments = async (user: AuthenticatedUser) => {
    const assignments = await this.db.operationAssignment.findMany({
      where: {
        workerId: user.id,
        status: { notIn: [...INACTIVE_ASSIGNMENT_STATUSES] }
      },
      include: assignmentInclude,
      orderBy: [{ claimedAt: "desc" }, { plannedStart: "desc" }]
    });

    return assignments.map(serializeAssignment);
  };

  searchClaimableProducts = async (keyword = "", page = 1, pageSize = 4) => {
    const safePage = Math.max(page, 1);
    const safePageSize = Math.min(Math.max(pageSize, 1), MAX_CLAIM_PRODUCTS_PAGE_SIZE);
    const normalized = keyword?.trim();
    const where = {
      operationPools: { some: { status: { in: [...CLAIMABLE_OPERATION_STATUSES] } } },
      ...(normalized
        ? {
            OR: [
              { orderNo: { contains: normalized, mode: "insensitive" as const } },
              { productCode: { contains: normalized, mode: "insensitive" as const } },
              { productName: { contains: normalized, mode: "insensitive" as const } }
            ]
          }
        : {})
    };

    const [total, products] = await Promise.all([
      this.db.workOrder.count({ where }),
      this.db.workOrder.findMany({
        where,
        select: {
          id: true,
          orderNo: true,
          productCode: true,
          productName: true,
          plannedQuantity: true,
          completedQuantity: true,
          operationPools: {
            where: { status: { in: [...CLAIMABLE_OPERATION_STATUSES] } },
            select: { remainingQuantity: true }
          }
        },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        orderBy: [{ createdAt: "desc" }, { productCode: "asc" }, { id: "asc" }]
      })
    ]);

    return {
      items: products.map(serializeProduct),
      page: safePage,
      pageSize: safePageSize,
      total,
      hasMore: safePage * safePageSize < total
    };
  };

  getClaimableParts = async (productId: string) => {
    const parts = await this.db.workOrderPart.findMany({
      where: {
        workOrderId: productId,
        operationPools: { some: { status: { in: [...CLAIMABLE_OPERATION_STATUSES] } } }
      },
      select: {
        id: true,
        workOrderId: true,
        partNo: true,
        partCode: true,
        partName: true,
        plannedQuantity: true,
        completedQuantity: true,
        operationPools: {
          where: { status: { in: [...CLAIMABLE_OPERATION_STATUSES] } },
          select: { remainingQuantity: true }
        }
      }
    });

    return parts.sort((a, b) => Number(a.partNo || 0) - Number(b.partNo || 0)).map(serializePart);
  };

  getClaimableOperations = async (partId: string) => {
    const operations = await this.db.operationPool.findMany({
      where: {
        partId,
        status: { in: [...CLAIMABLE_OPERATION_STATUSES] }
      },
      select: {
        id: true,
        workOrderId: true,
        partId: true,
        operationNo: true,
        operationCode: true,
        operationName: true,
        operationNote: true,
        plannedQuantity: true,
        plannedStart: true,
        estimatedHours: true,
        claimedWorkers: true,
        maxClaimWorkers: true,
        status: true,
        workOrder: {
          select: {
            orderNo: true,
            productCode: true,
            productName: true
          }
        },
        part: {
          select: {
            partCode: true,
            partName: true
          }
        }
      }
    });

    return operations.sort((a, b) => Number(a.operationNo || 0) - Number(b.operationNo || 0)).map(serializeOperation);
  };

  claimOperation = async (
    operationId: string,
    user: AuthenticatedUser,
    options?: { startTime?: Date; endTime?: Date }
  ) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const assignment = await this.db.$transaction(async (tx) => {
          const operation = await tx.operationPool.findUnique({
            where: { id: operationId },
            include: { workOrder: true, part: true }
          });

          if (!operation) throw new AppError(404, "工序不存在");
          if (operation.status !== OPERATION_POOL_STATUS.available) {
            throw new AppError(409, "该工序当前不可领取");
          }
          if (operation.maxClaimWorkers !== null && operation.claimedWorkers >= operation.maxClaimWorkers) {
            throw new AppError(409, "该工序领取人数已满");
          }

          const duplicated = await tx.operationAssignment.findFirst({
            where: {
              operationPoolId: operation.id,
              workerId: user.id,
              status: { notIn: [...INACTIVE_ASSIGNMENT_STATUSES] }
            }
          });
          if (duplicated) throw new AppError(409, "不能重复领取同一工序");

          const nextClaimedWorkers = operation.claimedWorkers + 1;
          const updateResult = await tx.operationPool.updateMany({
            where: {
              id: operation.id,
              status: OPERATION_POOL_STATUS.available,
              claimedWorkers: operation.claimedWorkers
            },
            data: {
              claimedWorkers: nextClaimedWorkers,
              status:
                operation.maxClaimWorkers !== null && nextClaimedWorkers >= operation.maxClaimWorkers
                  ? OPERATION_POOL_STATUS.claimed
                  : OPERATION_POOL_STATUS.available
            }
          });

          if (updateResult.count !== 1) {
            throw new AppError(409, CLAIM_CONFLICT_MESSAGE);
          }

          const plannedStart = operation.plannedStart ?? new Date();
          const plannedEnd = addHours(plannedStart, operation.estimatedHours || 1);
          const created = await tx.operationAssignment.create({
            data: {
              operationPoolId: operation.id,
              workOrderId: operation.workOrderId,
              partId: operation.partId,
              workerId: user.id,
              workerName: user.name,
              source: "self_claimed",
              status: ASSIGNMENT_STATUS.assigned,
              plannedStart,
              plannedEnd,
              plannedQuantity: operation.plannedQuantity,
              estimatedHours: operation.estimatedHours,
              actualStartAt: options?.startTime ?? null,
              actualEndAt: options?.endTime ?? null,
              canWorkerRemove: true,
              claimedAt: new Date(),
              collaborators: {
                create: [{ userId: user.id, name: user.name }]
              }
            }
          });

          return tx.operationAssignment.findUniqueOrThrow({
            where: { id: created.id },
            include: assignmentInclude
          });
        });

        return serializeAssignment(assignment);
      } catch (error) {
        if (
          error instanceof AppError &&
          error.statusCode === 409 &&
          error.message === CLAIM_CONFLICT_MESSAGE &&
          attempt < 2
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new AppError(409, CLAIM_CONFLICT_MESSAGE);
  };

  removeClaimedAssignment = async (assignmentId: string, user: AuthenticatedUser) => {
    await this.db.$transaction(async (tx) => {
      const assignment = await tx.operationAssignment.findUnique({
        where: { id: assignmentId },
        include: { operationPool: true }
      });

      if (!assignment || assignment.workerId !== user.id) throw new AppError(404, "工序不存在");
      if (
        assignment.source !== "self_claimed" ||
        assignment.status !== ASSIGNMENT_STATUS.assigned ||
        !assignment.canWorkerRemove
      ) {
        throw new AppError(409, "该工序已开始或不可自行删除");
      }

      await tx.operationAssignment.update({
        where: { id: assignment.id },
        data: {
          status: ASSIGNMENT_STATUS.cancelled,
          canWorkerRemove: false,
          cancelledReason: "worker_cancelled"
        }
      });

      const claimedWorkers = Math.max(assignment.operationPool.claimedWorkers - 1, 0);
      await tx.operationPool.update({
        where: { id: assignment.operationPoolId },
        data: {
          claimedWorkers,
          status:
            assignment.operationPool.status === OPERATION_POOL_STATUS.closed
              ? OPERATION_POOL_STATUS.closed
              : OPERATION_POOL_STATUS.available
        }
      });
    });
  };

  getStatistics = async (period: string, user: AuthenticatedUser) => {
    if (!["day", "week", "month"].includes(period)) {
      throw new AppError(400, "period 必须是 day、week 或 month");
    }

    const { start, end } = getPeriodRange(period);
    const assignments = await this.db.operationAssignment.findMany({
      where: {
        workerId: user.id,
        status: { not: ASSIGNMENT_STATUS.cancelled },
        OR: [
          { claimedAt: { gte: start, lt: end } },
          { claimedAt: null, plannedStart: { gte: start, lt: end } }
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
    const operationPoolIds = uniqueValues(
      assignments
        .map((assignment) => assignment.operationPoolId)
        .filter((operationPoolId): operationPoolId is string => typeof operationPoolId === "string")
    );
    const allocationParticipants = operationPoolIds.length
      ? await this.db.operationAssignment.findMany({
          where: {
            operationPoolId: { in: operationPoolIds },
            status: { not: ASSIGNMENT_STATUS.cancelled }
          },
          select: {
            id: true,
            operationPoolId: true,
            estimatedHours: true,
            actualStartAt: true,
            actualEndAt: true,
            operationPool: { select: { estimatedHours: true } }
          }
        })
      : [];
    const allocations = calculateHourAllocations(allocationParticipants);

    const totalHours = Number(
      assignments
        .reduce((total, item) => total + (allocations.get(item.id) ?? defaultHourAllocation(item)).allocatedHours, 0)
        .toFixed(2)
    );
    const allocatedAssignments = assignments.map((item) => ({
      assignmentId: item.id,
      operationPoolId: item.operationPoolId,
      ...(allocations.get(item.id) ?? defaultHourAllocation(item))
    }));
    const attendanceDays = new Set(
      assignments.map((item) => getDateKey(item.claimedAt ?? item.plannedStart))
    ).size;

    return {
      period,
      totalHours,
      regularHours: totalHours,
      overtimeHours: 0,
      completedOperations: assignments.length,
      attendanceDays,
      hourAllocation: {
        allocationTemporary: true,
        method: "actual_duration_ratio",
        appliedCount: allocatedAssignments.filter((item) => item.allocationApplied).length,
        totalCount: allocatedAssignments.length,
        items: allocatedAssignments
      },
      trend: []
    };
  };

  getOrders = async (page = 1, pageSize = 50) => {
    const safePage = Math.max(page, 1);
    const safePageSize = Math.min(Math.max(pageSize, 1), 100);
    const orders = await this.db.workOrder.findMany({
      skip: (safePage - 1) * safePageSize,
      take: safePageSize + 1,
      orderBy: { updatedAt: "desc" }
    });
    return {
      items: orders.slice(0, safePageSize).map(serializeWorkOrder),
      hasMore: orders.length > safePageSize
    };
  };

  searchWorkers = async (keyword = "", page = 1, pageSize = 20) => {
    const safePage = Math.max(page, 1);
    const safePageSize = Math.min(Math.max(pageSize, 1), 100);
    const normalized = keyword.trim();
    const where = normalized
      ? {
          OR: [
            { name: { contains: normalized, mode: "insensitive" as const } },
            { employeeNo: { contains: normalized, mode: "insensitive" as const } },
            { teamName: { contains: normalized, mode: "insensitive" as const } },
            { nameInitials: { contains: normalized, mode: "insensitive" as const } }
          ]
        }
      : {};

    const users = await this.db.user.findMany({
      where,
      skip: (safePage - 1) * safePageSize,
      take: safePageSize + 1,
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: {
            assignments: {
              where: { status: { notIn: [...INACTIVE_ASSIGNMENT_STATUSES] } }
            }
          }
        }
      }
    });

    return {
      items: users.slice(0, safePageSize).map((worker) => ({
        id: worker.id,
        employeeNo: worker.employeeNo || worker.id,
        name: worker.name,
        nameInitials: worker.nameInitials || "",
        teamName: worker.teamName || "",
        activeAssignmentCount: worker._count.assignments
      })),
      hasMore: users.length > safePageSize
    };
  };

  getWorkerPermissions = async () => {
    const workers = await this.db.user.findMany({
      orderBy: [{ teamName: "asc" }, { name: "asc" }],
      select: {
        id: true,
        employeeNo: true,
        name: true,
        nameInitials: true,
        teamName: true,
        userRoles: {
          select: {
            role: { select: { code: true } }
          }
        }
      }
    });

    return workers.map(serializeWorkerPermission);
  };

  updateWorkerPermission = async (workerId: string, permissionGroup: PermissionGroup) => {
    const worker = await this.db.$transaction(async (tx) => {
      const existingWorker = await tx.user.findUnique({ where: { id: workerId } });
      if (!existingWorker) throw new AppError(404, "员工不存在");

      const role = await tx.role.upsert({
        where: { code: permissionGroup },
        create: { code: permissionGroup, name: roleNames[permissionGroup] },
        update: { name: roleNames[permissionGroup] }
      });

      await tx.userRole.deleteMany({ where: { userId: workerId } });
      await tx.userRole.create({
        data: {
          userId: workerId,
          roleId: role.id
        }
      });

      return tx.user.findUniqueOrThrow({
        where: { id: workerId },
        include: {
          userRoles: {
            include: { role: true }
          }
        }
      });
    });

    return serializeWorkerPermission(worker);
  };

  importThirdPartyOperations = (operations: ThirdPartyImportOperation[], user: AuthenticatedUser) =>
    this.importService.importThirdPartyOperations(operations, user);

  completeOperation = async (orderNo: string, partNo: string, operationNo: string) => {
    const operation = await this.db.operationPool.findFirst({
      where: {
        workOrder: { orderNo },
        part: { partNo },
        operationNo
      },
      include: { workOrder: true, part: true }
    });

    if (!operation) {
      throw new AppError(404, "工序不存在");
    }

    if (operation.status === OPERATION_POOL_STATUS.closed) {
      throw new AppError(409, "工序已完工");
    }

    const updated = await this.db.operationPool.update({
      where: { id: operation.id },
      data: { status: OPERATION_POOL_STATUS.closed },
      include: { workOrder: true, part: true }
    });

    return serializeOperation(updated);
  };
}

export const workReportService = new WorkReportService();
