import { AppError } from "../../lib/errors.js";

export const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * 3600_000);

export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export const getPeriodRange = (period: string, now = new Date()) => {
  const today = startOfDay(now);

  if (period === "day") {
    return { start: today, end: addDays(today, 1) };
  }

  if (period === "week") {
    const mondayOffset = (today.getDay() + 6) % 7;
    const start = addDays(today, -mondayOffset);
    return { start, end: addDays(start, 7) };
  }

  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return { start, end };
};

export const getDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const dateOnlyPattern = /^\d{4}[-/]\d{2}[-/]\d{2}$/;

const parseReportDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AppError(400, "日期格式无效");
  return parsed;
};

export const reportDateRange = (startTime?: string, endTime?: string) => {
  if (!startTime && !endTime) return undefined;

  const range: Record<string, Date> = {};
  if (startTime) range.gte = parseReportDate(startTime);
  if (endTime) {
    const endDate = parseReportDate(endTime);
    range.lt = dateOnlyPattern.test(endTime) ? addDays(endDate, 1) : endDate;
  }
  return range;
};
