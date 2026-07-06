import type { PrismaClient } from "@prisma/client";
import { uniqueValues } from "../../lib/arrays.js";
import { calculateHourAllocations, defaultHourAllocation } from "../work-report/hour-allocation.js";
import { getSalaryPeriodRange, roundHours } from "./period.js";
import type { PersistedXftConfig, XftHoursRow, XftManualHoursInput } from "./types.js";

export class XftHoursService {
  constructor(
    private readonly db: PrismaClient,
    private readonly requireReadyConfig: (salaryPeriod?: string) => Promise<PersistedXftConfig>
  ) {}

previewHours = async (salaryPeriod?: string): Promise<XftHoursRow[]> => {
    const configRow = await this.requireReadyConfig(salaryPeriod);
    const { start, end } = getSalaryPeriodRange(configRow.salaryPeriod);

    const assignments = await this.db.operationAssignment.findMany({
      where: {
        status: { not: "cancelled" },
        OR: [
          { claimedAt: { gte: start, lt: end } },
          { claimedAt: null, plannedStart: { gte: start, lt: end } }
        ]
      },
      select: {
        id: true,
        operationPoolId: true,
        workerId: true,
        workerName: true,
        estimatedHours: true,
        actualStartAt: true,
        actualEndAt: true,
        operationPool: {
          select: {
            estimatedHours: true
          }
        },
        worker: {
          select: {
            employeeNo: true,
            name: true
          }
        }
      },
      orderBy: [{ workerName: "asc" }, { plannedStart: "asc" }]
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
            status: { not: "cancelled" }
          },
          select: {
            id: true,
            operationPoolId: true,
            estimatedHours: true,
            actualStartAt: true,
            actualEndAt: true,
            operationPool: {
              select: {
                estimatedHours: true
              }
            }
          }
        })
      : [];
    const allocations = calculateHourAllocations(allocationParticipants);

    const grouped = new Map<string, XftHoursRow>();
    for (const assignment of assignments) {
      const staffNumber = assignment.worker.employeeNo || assignment.workerId;
      const key = staffNumber;
      const hourAllocation = allocations.get(assignment.id) ?? defaultHourAllocation(assignment);
      const allocatedHours = hourAllocation.allocatedHours;
      const existing = grouped.get(key);
      if (existing) {
        existing.hours = roundHours(existing.hours + allocatedHours);
        if (existing.hourAllocation) {
          existing.hourAllocation.totalCount += 1;
          if (hourAllocation.allocationApplied) existing.hourAllocation.appliedCount += 1;
        }
        continue;
      }
      grouped.set(key, {
        lineId: grouped.size + 1,
        staffName: assignment.workerName || assignment.worker.name,
        staffNumber,
        hours: roundHours(allocatedHours),
        identityNumber: "",
        staffId: "",
        hourAllocation: {
          allocationTemporary: true,
          method: "actual_duration_ratio",
          appliedCount: hourAllocation.allocationApplied ? 1 : 0,
          totalCount: 1
        }
      });
    }

    return Array.from(grouped.values()).filter((row) => row.hours > 0);
  };

normalizeManualRows = (rows: XftManualHoursInput[]) =>
    rows.map((row, index) => ({
      lineId: index + 1,
      staffName: row.staffName.trim(),
      staffNumber: row.staffNumber.trim(),
      hours: roundHours(row.hours),
      identityNumber: row.identityNumber?.trim() || "",
      staffId: row.staffId?.trim() || ""
    }));
}
