import type { PrismaClient } from "@prisma/client";
import type { AuthenticatedUser } from "../../middleware/auth.js";
import { ASSIGNMENT_STATUS } from "./constants.js";
import { AssignmentHoursService } from "./assignment-hours-service.js";
import { defaultHourAllocation } from "./hour-allocation.js";
import { getDateKeyAsiaShanghai, getPeriodRangeAsiaShanghai } from "./date-utils.js";
import { serializeReportRecord } from "./report-serializers.js";
import type { StaffStatsPeriod, WorkReportPeriod } from "./report-period.js";

export class WorkReportStatisticsService {
  private readonly assignmentHours: AssignmentHoursService;

  constructor(private readonly db: PrismaClient) {
    this.assignmentHours = new AssignmentHoursService(db);
  }

getStatistics = async (period: WorkReportPeriod, user: AuthenticatedUser) => {
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
    const allocations = await this.assignmentHours.getAllocationsForAssignments(assignments);

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

  getMyReports = async (period: WorkReportPeriod, user: AuthenticatedUser) => {
    const { start, end } = getPeriodRangeAsiaShanghai(period);
    const assignments = await this.db.operationAssignment.findMany({
      where: {
        workerId: user.id,
        status: { not: ASSIGNMENT_STATUS.cancelled },
        actualEndAt: { gte: start, lt: end, not: null }
      },
      include: {
        workOrder: { select: { orderNo: true, productName: true } },
        part: { select: { partNo: true, partCode: true, partName: true } },
        operationPool: { select: { operationCode: true, operationName: true, estimatedHours: true, operationNote: true } },
        session: {
          select: { id: true, startedAt: true, completedAt: true, accumulatedSeconds: true }
        }
      },
      orderBy: [{ actualEndAt: "desc" }, { id: "desc" }]
    });

    const allocations = await this.assignmentHours.getAllocationsForAssignments(assignments);

    return assignments.map((assignment) => serializeReportRecord(assignment, allocations.get(assignment.id)));
  };

  getStaffStats = async (period: StaffStatsPeriod, operationNames?: string[], company?: string) => {
    const { start, end } = getPeriodRangeAsiaShanghai(period);
    const normalizedNames = (operationNames ?? [])
      .map((n) => n.trim())
      .filter((n) => n.length > 0);

    const where: Record<string, unknown> = {
      status: { not: ASSIGNMENT_STATUS.cancelled },
      actualEndAt: { gte: start, lt: end, not: null }
    };

    if (company) {
      where.workOrder = { company };
    }

    if (normalizedNames.length === 1) {
      where.operationPool = {
        operationName: { contains: normalizedNames[0], mode: "insensitive" as const }
      };
    } else if (normalizedNames.length > 1) {
      where.AND = normalizedNames.map((name) => ({
        operationPool: { operationName: { contains: name, mode: "insensitive" as const } }
      }));
    }

    const assignments = await this.db.operationAssignment.findMany({
      where,
      select: {
        id: true,
        workerId: true,
        workerName: true,
        operationPoolId: true,
        estimatedHours: true,
        actualStartAt: true,
        actualEndAt: true,
        operationPool: { select: { estimatedHours: true } }
      }
    });

    if (!assignments.length) return [];

    const allocations = await this.assignmentHours.getAllocationsForAssignments(assignments);

    const byWorker = new Map<string, { name: string; totalHours: number; completedOperations: number; attendanceDates: Set<string> }>();
    for (const item of assignments) {
      const key = item.workerId;
      const allocated = allocations.get(item.id) ?? defaultHourAllocation(item);
      const dateKey = item.actualEndAt ? getDateKeyAsiaShanghai(item.actualEndAt) : "";
      const existing = byWorker.get(key);
      if (existing) {
        existing.totalHours += allocated.allocatedHours;
        existing.completedOperations += 1;
        if (dateKey) existing.attendanceDates.add(dateKey);
      } else {
        byWorker.set(key, {
          name: item.workerName,
          totalHours: allocated.allocatedHours,
          completedOperations: 1,
          attendanceDates: new Set(dateKey ? [dateKey] : [])
        });
      }
    }

    return Array.from(byWorker.entries()).map(([workerId, data]) => ({
      workerId,
      workerName: data.name,
      totalHours: Number(data.totalHours.toFixed(2)),
      completedOperations: data.completedOperations,
      attendanceDays: data.attendanceDates.size
    })).sort((a, b) => b.totalHours - a.totalHours);
  };

  getTeamOperationStats = async (company?: string, teamName?: string) => {
    const { start: monthStart, end: monthEnd } = getPeriodRangeAsiaShanghai("month");

    const where: Record<string, unknown> = {
      status: { not: ASSIGNMENT_STATUS.cancelled },
      actualEndAt: { not: null }
    };
    if (company) {
      where.workOrder = { company };
    }

    const assignments = await this.db.operationAssignment.findMany({
      where,
      select: {
        id: true,
        workerId: true,
        workerName: true,
        operationPoolId: true,
        estimatedHours: true,
        actualStartAt: true,
        actualEndAt: true,
        worker: { select: { name: true, teamName: true } },
        operationPool: { select: { operationName: true, estimatedHours: true } }
      },
      orderBy: [{ workerName: "asc" }, { id: "asc" }]
    });

    if (!assignments.length) return [];

    // 实际工时沿用全量参与人分摊口径（多人协同按实际时长占比拆分标准工时）
    const allocations = await this.assignmentHours.getAllocationsForAssignments(assignments);

    interface TeamOperationRow {
      teamName: string;
      workerId: string;
      workerName: string;
      operationName: string;
      totalPlannedHours: number;
      totalActualHours: number;
      monthPlannedHours: number;
      monthActualHours: number;
    }

    const rows = new Map<string, TeamOperationRow>();
    for (const item of assignments) {
      const operationName = item.operationPool?.operationName?.trim() || "未命名工序";
      const teamName = item.worker?.teamName?.trim() || "未分配班组";
      const workerName = item.worker?.name || item.workerName;
      const key = `${item.workerId}__${operationName}`;
      const allocation = allocations.get(item.id) ?? defaultHourAllocation(item);
      const plannedHours = allocation.originalEstimatedHours;
      const actualHours = allocation.allocatedHours;
      const inMonth = item.actualEndAt !== null && item.actualEndAt >= monthStart && item.actualEndAt < monthEnd;

      let row = rows.get(key);
      if (!row) {
        row = {
          teamName,
          workerId: item.workerId,
          workerName,
          operationName,
          totalPlannedHours: 0,
          totalActualHours: 0,
          monthPlannedHours: 0,
          monthActualHours: 0
        };
        rows.set(key, row);
      }
      row.totalPlannedHours += plannedHours;
      row.totalActualHours += actualHours;
      if (inMonth) {
        row.monthPlannedHours += plannedHours;
        row.monthActualHours += actualHours;
      }
    }

    const round2 = (value: number) => Number(value.toFixed(2));

    return Array.from(rows.values())
      .filter((row) => !teamName || row.teamName === teamName)
      .map((row) => ({
        ...row,
        totalPlannedHours: round2(row.totalPlannedHours),
        totalActualHours: round2(row.totalActualHours),
        monthPlannedHours: round2(row.monthPlannedHours),
        monthActualHours: round2(row.monthActualHours),
        deviationHours: round2(row.totalActualHours - row.totalPlannedHours)
      }))
      .sort((a, b) =>
        a.teamName.localeCompare(b.teamName, "zh-Hans-CN") ||
        a.workerName.localeCompare(b.workerName, "zh-Hans-CN") ||
        a.operationName.localeCompare(b.operationName, "zh-Hans-CN")
      );
  };
}
