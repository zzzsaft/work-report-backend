import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { addHours } from "./date-utils.js";
import { ASSIGNMENT_STATUS, OPERATION_POOL_STATUS } from "./constants.js";

export class OperationWorkerAssignmentService {
  constructor(private readonly db: PrismaClient) {}

  /** 从持久化表中读取映射列表 */
  list = async (operationCode?: string) => {
    const where = operationCode
      ? { operationCode: { contains: operationCode, mode: "insensitive" as const } }
      : {};

    return this.db.operationWorkerAssignment.findMany({
      where,
      orderBy: [{ operationCode: "asc" }, { workerName: "asc" }]
    });
  };

  /** 从领取记录同步到持久化表（增量 upsert，不删除已有数据） */
  syncFromAssignments = async () => {
    const assignments = await this.db.operationAssignment.findMany({
      where: { status: { not: "cancelled" as const } },
      include: { operationPool: true },
      orderBy: [{ createdAt: "desc" }]
    });

    const filtered = assignments.filter((a) => a.operationPool !== null);

    const deduped = new Map<string, {
      operationCode: string;
      operationName: string;
      workerId: string;
      workerName: string;
    }>();

    for (const a of filtered) {
      const op = a.operationPool!;
      const key = `${op.operationCode}|${a.workerId}`;
      if (!deduped.has(key)) {
        deduped.set(key, {
          operationCode: op.operationCode,
          operationName: op.operationName ?? "",
          workerId: a.workerId,
          workerName: a.workerName
        });
      }
    }

    let upserted = 0;
    for (const entry of deduped.values()) {
      await this.db.operationWorkerAssignment.upsert({
        where: {
          operationCode_workerId: {
            operationCode: entry.operationCode,
            workerId: entry.workerId
          }
        },
        create: {
          operationCode: entry.operationCode,
          operationName: entry.operationName,
          workerId: entry.workerId,
          workerName: entry.workerName
        },
        update: {
          operationName: entry.operationName,
          workerName: entry.workerName
        }
      });
      upserted++;
    }

    return { count: upserted };
  };

  /** 手动添加映射 */
  create = async (operationCode: string, workerId: string, workerName: string) => {
    // 查找工序信息以获取 operationName
    const pool = await this.db.operationPool.findFirst({
      where: {
        operationCode: { equals: operationCode, mode: "insensitive" as const },
        status: { in: [OPERATION_POOL_STATUS.available, OPERATION_POOL_STATUS.claimed] }
      },
      orderBy: { createdAt: "desc" }
    });

    const operationName = pool?.operationName ?? "";

    // upsert 到持久化表
    const record = await this.db.operationWorkerAssignment.upsert({
      where: {
        operationCode_workerId: {
          operationCode: operationCode.toUpperCase(),
          workerId
        }
      },
      create: {
        operationCode: operationCode.toUpperCase(),
        operationName,
        workerId,
        workerName
      },
      update: {
        operationName,
        workerName
      }
    });

    // 同时在 operation_assignment 中创建一条记录，保持领取数据的一致性
    if (pool) {
      const now = new Date();
      const plannedStart = pool.plannedStart ?? now;
      const plannedEnd = addHours(plannedStart, pool.estimatedHours || 1);

      await this.db.operationAssignment.create({
        data: {
          operationPoolId: pool.id,
          workOrderId: pool.workOrderId,
          partId: pool.partId,
          workerId,
          workerName,
          source: "admin_assigned",
          status: ASSIGNMENT_STATUS.assigned,
          plannedStart,
          plannedEnd,
          plannedQuantity: pool.plannedQuantity,
          estimatedHours: pool.estimatedHours,
          canWorkerRemove: true,
          claimedAt: now,
          collaborators: {
            create: [{ userId: workerId, name: workerName }]
          }
        }
      });
    }

    return record;
  };

  /** 删除单条映射 */
  delete = async (id: string) => {
    const record = await this.db.operationWorkerAssignment.findUnique({ where: { id } });
    if (!record) {
      throw new AppError(404, "映射记录不存在");
    }

    await this.db.operationWorkerAssignment.delete({ where: { id } });
    return { count: 1 };
  };

  /** 批量删除映射 */
  batchDelete = async (ids: string[]) => {
    const result = await this.db.operationWorkerAssignment.deleteMany({
      where: { id: { in: ids } }
    });

    return { count: result.count };
  };

  /** 查询未分配任何工序映射的人员列表（带分页） */
  listUnmappedWorkers = async (keyword = "", page = 1, pageSize = 10) => {
    const safePage = Math.max(page, 1);
    const safePageSize = Math.min(Math.max(pageSize, 1), 100);
    const normalized = keyword.trim();

    const mappedWorkerIds = await this.db.operationWorkerAssignment.findMany({
      select: { workerId: true },
      distinct: ["workerId"]
    });
    const excludedIds = mappedWorkerIds.map((r) => r.workerId);

    const where: Record<string, unknown> = {
      ...(excludedIds.length ? { id: { notIn: excludedIds } } : {})
    };
    if (normalized) {
      where.OR = [
        { name: { contains: normalized, mode: "insensitive" as const } },
        { employeeNo: { contains: normalized, mode: "insensitive" as const } },
        { teamName: { contains: normalized, mode: "insensitive" as const } },
        { nameInitials: { contains: normalized, mode: "insensitive" as const } }
      ];
    }

    const [users, total] = await Promise.all([
      this.db.user.findMany({
        where,
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        orderBy: { name: "asc" }
      }),
      this.db.user.count({ where })
    ]);

    return {
      items: users.map((u) => ({
        id: u.id,
        employeeNo: u.employeeNo || u.id,
        name: u.name,
        nameInitials: u.nameInitials || "",
        teamName: u.teamName || ""
      })),
      total
    };
  };
}
