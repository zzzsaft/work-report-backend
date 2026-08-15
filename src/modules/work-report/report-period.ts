import { z } from "zod";

export const WORK_REPORT_PERIODS = ["day", "week", "month", "lastMonth"] as const;
export const STAFF_STATS_PERIODS = ["month", "lastMonth"] as const;

const periodError = (allowedPeriods: readonly string[]) => ({
  errorMap: () => ({ message: `period 必须是 ${allowedPeriods.join("、")}` })
});

export const workReportPeriodSchema = z.enum(
  WORK_REPORT_PERIODS,
  periodError(WORK_REPORT_PERIODS)
);

export const staffStatsPeriodSchema = z.enum(
  STAFF_STATS_PERIODS,
  periodError(STAFF_STATS_PERIODS)
);

export const workReportPeriodQuerySchema = z.object({
  period: workReportPeriodSchema.default("week")
});

export const staffStatsPeriodQuerySchema = z.object({
  period: staffStatsPeriodSchema.default("month")
});

export type WorkReportPeriod = z.infer<typeof workReportPeriodSchema>;
export type StaffStatsPeriod = z.infer<typeof staffStatsPeriodSchema>;
