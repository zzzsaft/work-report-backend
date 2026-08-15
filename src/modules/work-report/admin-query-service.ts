import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { INACTIVE_ASSIGNMENT_STATUSES, OPERATION_POOL_STATUS } from "./constants.js";
import { serializeOperation, serializeWorkOrder } from "./serializers.js";
import { roleNames, type PermissionGroup } from "./permissions.js";
import { serializeWorkerPermission } from "./report-serializers.js";

export class WorkReportAdminQueryService {
  constructor(private readonly db: PrismaClient) {}

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

completeOperation = async (orderNo: string, partNo: string, operationNo: string, company?: string) => {
    const operation = await this.db.operationPool.findFirst({
      where: {
        workOrder: {
          orderNo,
          ...(company ? { company } : {})
        },
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
