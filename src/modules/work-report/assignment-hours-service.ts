import type { PrismaClient } from "@prisma/client";
import { uniqueValues } from "../../lib/arrays.js";
import { ASSIGNMENT_STATUS } from "./constants.js";
import { calculateHourAllocations } from "./hour-allocation.js";

interface AssignmentOperationPoolRef {
  operationPoolId?: string | null;
}

export class AssignmentHoursService {
  constructor(private readonly db: PrismaClient) {}

  getAllocationsForAssignments = async (assignments: AssignmentOperationPoolRef[]) => {
    const operationPoolIds = uniqueValues(
      assignments
        .map((assignment) => assignment.operationPoolId)
        .filter((operationPoolId): operationPoolId is string => typeof operationPoolId === "string")
    );
    if (operationPoolIds.length === 0) return calculateHourAllocations([]);

    const participants = await this.db.operationAssignment.findMany({
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
    });

    return calculateHourAllocations(participants);
  };
}
