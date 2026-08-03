import { describe, expect, it, vi } from "vitest";
import { AssignmentHoursService } from "../src/modules/work-report/assignment-hours-service.js";
import {
  staffStatsPeriodQuerySchema,
  workReportPeriodQuerySchema
} from "../src/modules/work-report/report-period.js";

describe("AssignmentHoursService", () => {
  it("loads each operation pool once and calculates allocations for all participants", async () => {
    const participants = [
      {
        id: "assignment-1",
        operationPoolId: "operation-1",
        estimatedHours: 8,
        actualStartAt: new Date("2026-08-01T00:00:00.000Z"),
        actualEndAt: new Date("2026-08-01T01:00:00.000Z"),
        operationPool: { estimatedHours: 8 }
      },
      {
        id: "assignment-2",
        operationPoolId: "operation-1",
        estimatedHours: 8,
        actualStartAt: new Date("2026-08-01T00:00:00.000Z"),
        actualEndAt: new Date("2026-08-01T03:00:00.000Z"),
        operationPool: { estimatedHours: 8 }
      }
    ];
    const findMany = vi.fn().mockResolvedValue(participants);
    const service = new AssignmentHoursService({ operationAssignment: { findMany } } as never);

    const allocations = await service.getAllocationsForAssignments([
      { operationPoolId: "operation-1" },
      { operationPoolId: "operation-1" }
    ]);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        operationPoolId: { in: ["operation-1"] },
        status: { not: "cancelled" }
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
    expect(allocations.get("assignment-1")?.allocatedHours).toBe(2);
    expect(allocations.get("assignment-2")?.allocatedHours).toBe(6);
  });

  it("does not query participants when no valid operation pool is present", async () => {
    const findMany = vi.fn();
    const service = new AssignmentHoursService({ operationAssignment: { findMany } } as never);

    await expect(service.getAllocationsForAssignments([{ operationPoolId: null }])).resolves.toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("work report period schemas", () => {
  it("applies endpoint defaults and returns centralized validation messages", () => {
    expect(workReportPeriodQuerySchema.parse({})).toEqual({ period: "week" });
    expect(staffStatsPeriodQuerySchema.parse({})).toEqual({ period: "month" });

    expect(() => workReportPeriodQuerySchema.parse({ period: "year" })).toThrow(
      "period 必须是 day、week、month、lastMonth"
    );
    expect(() => staffStatsPeriodQuerySchema.parse({ period: "week" })).toThrow(
      "period 必须是 month、lastMonth"
    );
  });
});
