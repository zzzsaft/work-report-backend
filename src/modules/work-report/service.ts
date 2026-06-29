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

export class WorkReportService {
  private readonly importService: WorkReportImportService;

  constructor(private readonly db: PrismaClient = prisma) {
    this.importService = new WorkReportImportService(db);
  }

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

  searchClaimableProducts = async (keyword?: string) => {
    const normalized = keyword?.trim();
    const products = await this.db.workOrder.findMany({
      where: {
        operationPools: { some: { status: { in: [...CLAIMABLE_OPERATION_STATUSES] } } },
        ...(normalized
          ? {
              OR: [
                { orderNo: { contains: normalized, mode: "insensitive" } },
                { productCode: { contains: normalized, mode: "insensitive" } },
                { productName: { contains: normalized, mode: "insensitive" } }
              ]
            }
          : {})
      },
      include: {
        operationPools: {
          where: { status: { in: [...CLAIMABLE_OPERATION_STATUSES] } }
        }
      },
      orderBy: [{ updatedAt: "desc" }],
      take: normalized ? 50 : 20
    });

    return products.map(serializeProduct);
  };

  getClaimableParts = async (productId: string) => {
    const parts = await this.db.workOrderPart.findMany({
      where: {
        workOrderId: productId,
        operationPools: { some: { status: { in: [...CLAIMABLE_OPERATION_STATUSES] } } }
      },
      include: {
        operationPools: {
          where: { status: { in: [...CLAIMABLE_OPERATION_STATUSES] } }
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
      include: { workOrder: true, part: true }
    });

    return operations.sort((a, b) => Number(a.operationNo || 0) - Number(b.operationNo || 0)).map(serializeOperation);
  };

  claimOperation = async (operationId: string, user: AuthenticatedUser) => {
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
      }
    });

    const totalHours = Number(
      assignments.reduce((total, item) => total + (item.estimatedHours ?? 0), 0).toFixed(2)
    );
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

  importThirdPartyOperations = (operations: ThirdPartyImportOperation[], user: AuthenticatedUser) =>
    this.importService.importThirdPartyOperations(operations, user);
}

export const workReportService = new WorkReportService();
