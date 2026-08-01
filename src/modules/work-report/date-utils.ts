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

// ========== Asia/Shanghai 时区安全的日期工具（用于统计等日期敏感模块）==========

const ASIA_SHANGHAI_TZ = "Asia/Shanghai";

interface AsiaShanghaiParts {
  year: number;
  month: number; // 0-indexed, compatible with Date
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sunday, 1=Monday ... 6=Saturday (same as Date.getDay)
}

let cachedFormatter: Intl.DateTimeFormat | null = null;

const getShanghaiFormatter = () => {
  if (cachedFormatter) return cachedFormatter;
  cachedFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ASIA_SHANGHAI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false
  });
  return cachedFormatter;
};

const weekdayMap: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6
};

export const getAsiaShanghaiParts = (date: Date): AsiaShanghaiParts => {
  const parts = getShanghaiFormatter()
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {} as Record<string, string>);
  const rawHour = parts.hour ?? "0";
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
    hour: Number(rawHour === "24" ? "0" : rawHour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdayMap[parts.weekday ?? "Mon"] ?? 1
  };
};

/** 返回北京时间当日 00:00:00 对应的 Date 对象 */
export const startOfDayAsiaShanghai = (date: Date): Date => {
  const parts = getAsiaShanghaiParts(date);
  return new Date(
    Date.UTC(parts.year, parts.month, parts.day) - 8 * 3600 * 1000
  );
};

/** 将"北京时间的年月日"转为 Date 对象；timeZone 仍保持 Asia/Shanghai 凌晨 0 点 */
const shanghaiDate = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day) - 8 * 3600 * 1000);

/** 按北京时间计算的日期区间，和 getPeriodRange 接口保持一致但无本地时区副作用 */
export const getPeriodRangeAsiaShanghai = (period: string, now = new Date()) => {
  const todayStart = startOfDayAsiaShanghai(now);
  const todayParts = getAsiaShanghaiParts(todayStart);

  if (period === "day") {
    return {
      start: todayStart,
      end: shanghaiDate(todayParts.year, todayParts.month, todayParts.day + 1)
    };
  }

  if (period === "week") {
    // Monday = 1, so mapping weekday (Sun=0 ... Sat=6) -> mondayOffset
    const mondayOffset = (todayParts.weekday + 6) % 7;
    const weekStart = shanghaiDate(todayParts.year, todayParts.month, todayParts.day - mondayOffset);
    return {
      start: weekStart,
      end: shanghaiDate(todayParts.year, todayParts.month, todayParts.day - mondayOffset + 7)
    };
  }

  const monthStart = shanghaiDate(todayParts.year, todayParts.month, 1);
  const monthEnd = shanghaiDate(todayParts.year, todayParts.month + 1, 1);
  return { start: monthStart, end: monthEnd };
};

/** 以北京时间为基准的 YYYY-MM-DD key，解决 UTC 服务器 23:37 跨日/跨月导致 day/month 错误 */
export const getDateKeyAsiaShanghai = (date: Date): string => {
  const parts = getAsiaShanghaiParts(date);
  return (
    `${parts.year}-` +
    `${String(parts.month + 1).padStart(2, "0")}-` +
    `${String(parts.day).padStart(2, "0")}`
  );
};

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
