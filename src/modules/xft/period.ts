import { AppError } from "../../lib/errors.js";

const SALARY_PERIOD_PATTERN = /^\d{6}$/;

export const currentSalaryPeriod = () => {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
};

export const getSalaryPeriodRange = (salaryPeriod: string) => {
  if (!SALARY_PERIOD_PATTERN.test(salaryPeriod)) {
    throw new AppError(400, "薪资期间必须是 YYYYMM 格式");
  }

  const year = Number(salaryPeriod.slice(0, 4));
  const month = Number(salaryPeriod.slice(4, 6));
  if (month < 1 || month > 12) throw new AppError(400, "薪资期间月份无效");

  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 1)
  };
};

export const roundHours = (value: number) => Number(value.toFixed(2));
