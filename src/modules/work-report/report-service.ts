import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { uniqueValues } from "../../lib/arrays.js";
import { ASSIGNMENT_STATUS } from "./constants.js";
import { calculateHourAllocations } from "./hour-allocation.js";
import { serializeReportRecord } from "./report-serializers.js";
import { reportDateRange } from "./date-utils.js";

const MAX_REPORTS_PAGE_SIZE = 100;

export class WorkReportQueryService {
  constructor(private readonly db: PrismaClient) {}

getReports = async (filters: {
    keyword?: string;
    orderNo?: string;
    company?: string;
    operatorName?: string;
    status?: string;
    operationCode?: string;
    operationName?: string;
    startTime?: string;
    endTime?: string;
    page?: number;
    pageSize?: number;
  } = {}) => {
    const where: Record<string, unknown> = { status: { not: ASSIGNMENT_STATUS.cancelled } };
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

    if (filters.company) {
      where.workOrder = {
        ...(where.workOrder as Record<string, unknown>),
        company: filters.company
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
          part: { select: { partNo: true, partCode: true, partName: true } },
          operationPool: { select: { operationCode: true, operationName: true, estimatedHours: true, operationNote: true } },
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
        part: { select: { partNo: true, partCode: true, partName: true } },
        operationPool: { select: { operationCode: true, operationName: true, estimatedHours: true, operationNote: true } },
        session: {
          select: { id: true, startedAt: true, completedAt: true, accumulatedSeconds: true }
        }
      }
    });

    return serializeReportRecord(updated!);
  };
}
