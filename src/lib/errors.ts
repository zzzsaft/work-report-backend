import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export const asyncHandler =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, "接口不存在"));
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }

  if (error?.code === "P2025") {
    res.status(404).json({ message: "资源不存在" });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      message: "请求参数无效",
      errors: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
    return;
  }

  console.error(error);
  res.status(500).json({ message: "服务端异常" });
};
