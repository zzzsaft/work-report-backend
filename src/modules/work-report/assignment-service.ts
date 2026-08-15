import type { PrismaClient } from "@prisma/client";
import type { AuthenticatedUser } from "../../middleware/auth.js";
import { AppError } from "../../lib/errors.js";
import { ASSIGNMENT_STATUS, INACTIVE_ASSIGNMENT_STATUSES, OPERATION_POOL_STATUS } from "./constants.js";
import { serializeAssignment } from "./serializers.js";
import { addHours } from "./date-utils.js";

const CLAIM_CONFLICT_MESSAGE = "该工序领取状态已变化，请重试";
const RECLAIM_COOLDOWN_MS = 30 * 60 * 1000;

const assignmentInclude = {
  workOrder: true,
  part: true,
  operationPool: true,
  collaborators: true,
  session: true,
  assignedBy: true
} as const;

export class AssignmentService {
  constructor(private readonly db: PrismaClient) {}

getAssignments = async (user: AuthenticatedUser) => {
    const assignments = await this.db.operationAssignment.findMany({
      where: {
        workerId: user.id,
        status: { notIn: [...INACTIVE_ASSIGNMENT_STATUSES] }
      },
      include: assignmentInclude,
      orderBy: [{ claimedAt: "desc" }, { plannedStart: "desc" }]
    });

    return assignments.map((assignment) => serializeAssignment(assignment));
  };

claimOperation = async (
    operationId: string,
    user: AuthenticatedUser,
    options?: { startTime?: Date; endTime?: Date },
    permissionEnabled = false
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

          // 班组工序权限校验：员工所在班组必须已分配该工序，否则提示联系管理员
          if (permissionEnabled) {
            const worker = await tx.user.findUnique({
              where: { id: user.id },
              select: { teamId: true }
            });
            const teamId = worker?.teamId;
            if (!teamId) {
              throw new AppError(403, "您尚未加入班组，请联系管理员分配权限");
            }
            const teamOperation = await tx.teamOperationAssignment.findFirst({
              where: {
                teamId,
                operationCode: { equals: operation.operationCode, mode: "insensitive" as const }
              }
            });
            if (!teamOperation) {
              throw new AppError(403, "您的班组未分配该工序，请联系管理员分配权限");
            }
          }

          const duplicated = await tx.operationAssignment.findFirst({
            where: {
              operationPoolId: operation.id,
              workerId: user.id,
              status: { notIn: [...INACTIVE_ASSIGNMENT_STATUSES] }
            },
            orderBy: [{ claimedAt: "desc" }, { createdAt: "desc" }]
          });
          const duplicatedAt = duplicated?.claimedAt ?? duplicated?.createdAt;
          if (duplicatedAt && Date.now() - duplicatedAt.getTime() < RECLAIM_COOLDOWN_MS) {
            throw new AppError(409, "半小时内不能重复领取同一工序");
          }

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
}
