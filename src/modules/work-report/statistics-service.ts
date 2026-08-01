import type { PrismaClient } from "@prisma/client";
import type { AuthenticatedUser } from "../../middleware/auth.js";
import { AppError } from "../../lib/errors.js";
import { uniqueValues } from "../../lib/arrays.js";
import { ASSIGNMENT_STATUS } from "./constants.js";
import { calculateHourAllocations, defaultHourAllocation } from "./hour-allocation.js";
import { getDateKeyAsiaShanghai, getPeriodRangeAsiaShanghai } from "./date-utils.js";

export class WorkReportStatisticsService {
  constructor(private readonly db: PrismaClient) {}

getStatistics = async (period: string, user: AuthenticatedUser) => {
    if (!["day", "week", "month"].includes(period)) {
      throw new AppError(400, "period 必须是 day、week 或 month");
    }

    const { start, end } = getPeriodRangeAsiaShanghai(period);
    const assignments = await this.db.operationAssignment.findMany({
      where: {
        workerId: user.id,
        status: { not: ASSIGNMENT_STATUS.cancelled },
        actualEndAt: { gte: start, lt: end, not: null }
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
      assignments
        .map((item) => item.actualEndAt)
        .filter((date): date is Date => date !== null)
        .map((date) => getDateKeyAsiaShanghai(date))
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
