import type { PrismaClient } from "@prisma/client";
import type { AuthenticatedUser } from "../../middleware/auth.js";
import { AppError } from "../../lib/errors.js";
import { uniqueValues } from "../../lib/arrays.js";
import { ASSIGNMENT_STATUS } from "./constants.js";
import { calculateHourAllocations, defaultHourAllocation } from "./hour-allocation.js";
import { getDateKey, getPeriodRange } from "./date-utils.js";

export class WorkReportStatisticsService {
  constructor(private readonly db: PrismaClient) {}

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
}
