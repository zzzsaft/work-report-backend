import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { OPERATION_POOL_STATUS } from "./constants.js";

export class TeamOperationAssignmentService {
  constructor(private readonly db: PrismaClient) {}

  list = async (teamId: string) => {
    const team = await this.db.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new AppError(404, "班组不存在");
    }
    return this.db.teamOperationAssignment.findMany({
      where: { teamId },
      orderBy: [{ operationCode: "asc" }]
    });
  };

  create = async (teamId: string, operationCode: string, operationName?: string) => {
    const team = await this.db.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new AppError(404, "班组不存在");
    }

    const code = operationCode.toUpperCase();
    let name = operationName ?? "";

    if (!name) {
      const pool = await this.db.operationPool.findFirst({
        where: {
          operationCode: { equals: code, mode: "insensitive" as const },
          status: { in: [OPERATION_POOL_STATUS.available, OPERATION_POOL_STATUS.claimed] }
        },
        orderBy: { createdAt: "desc" }
      });
      name = pool?.operationName ?? "";
    }

    return this.db.teamOperationAssignment.upsert({
      where: {
        teamId_operationCode: {
          teamId,
          operationCode: code
        }
      },
      create: {
        teamId,
        operationCode: code,
        operationName: name
      },
      update: {
        operationName: name
      }
    });
  };

  delete = async (id: string) => {
    const record = await this.db.teamOperationAssignment.findUnique({ where: { id } });
    if (!record) {
      throw new AppError(404, "班组工序映射记录不存在");
    }
    await this.db.teamOperationAssignment.delete({ where: { id } });
    return { count: 1 };
  };

  batchDelete = async (ids: string[]) => {
    const result = await this.db.teamOperationAssignment.deleteMany({
      where: { id: { in: ids } }
    });
    return { count: result.count };
  };

  syncFromWorkerAssignments = async () => {
    // Derive from operationAssignment (领取记录) + operationPool instead of operationWorkerAssignment
    const assignments = await this.db.operationAssignment.findMany({
      where: {
        status: { not: "cancelled" }
      },
      select: {
        workerId: true,
        operationPool: {
          select: { operationCode: true, operationName: true }
        }
      }
    });

    const teamOps = new Map<string, { operationCode: string; operationName: string }[]>();

    // Get team info for all workers
    const workerIds = [...new Set(assignments.map((a) => a.workerId))];
    const workers = await this.db.user.findMany({
      where: { id: { in: workerIds } },
      select: { id: true, teamId: true }
    });
    const workerMap = new Map(workers.map((w) => [w.id, w]));

    for (const a of assignments) {
      const worker = workerMap.get(a.workerId);
      const teamId = worker?.teamId;
      if (!teamId) continue;
      const op = a.operationPool;
      if (!op?.operationCode) continue;

      if (!teamOps.has(teamId)) {
        teamOps.set(teamId, []);
      }
      const ops = teamOps.get(teamId)!;
      if (!ops.some((o) => o.operationCode === op.operationCode)) {
        ops.push({ operationCode: op.operationCode, operationName: op.operationName ?? "" });
      }
    }

    let upserted = 0;
    for (const [teamId, ops] of teamOps) {
      for (const op of ops) {
        await this.db.teamOperationAssignment.upsert({
          where: {
            teamId_operationCode: {
              teamId,
              operationCode: op.operationCode
            }
          },
          create: {
            teamId,
            operationCode: op.operationCode,
            operationName: op.operationName
          },
          update: {
            operationName: op.operationName
          }
        });
        upserted++;
      }
    }

    return { count: upserted };
  };
}
