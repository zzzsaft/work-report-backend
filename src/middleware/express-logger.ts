import type { RequestHandler, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { EXPRESS_LOG_OPTIONS, sanitizeLogPayload } from "../lib/log-sanitizer.js";

type SendBody = Parameters<Response["send"]>[0];

const shouldLogResponseBody = (path: string) =>
  path !== "/leader/operations/import" &&
  path !== "/api/operations/import" &&
  path !== "/admin/xft/import-hours" &&
  path !== "/admin/xft/import-hours/manual";

export const expressLogger: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  let responseBody: unknown;
  let errorMessage: string | undefined;

  res.json = ((body: unknown) => {
    responseBody = body;
    return originalJson(body);
  }) as Response["json"];

  res.send = ((body: SendBody) => {
    if (responseBody === undefined) responseBody = body;
    return originalSend(body);
  }) as Response["send"];

  res.once("finish", () => {
    const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
    if (res.statusCode >= 500) {
      errorMessage = typeof responseBody === "object" && responseBody && "message" in responseBody
        ? String((responseBody as { message?: unknown }).message)
        : undefined;
    }

    void prisma.expressRequestLog
      .create({
        data: {
          method: req.method,
          path: req.path,
          originalUrl: req.originalUrl,
          statusCode: res.statusCode,
          durationMs,
          ip: req.ip,
          userAgent: req.get("user-agent"),
          userId: req.user?.id,
          requestBody: sanitizeLogPayload(req.body, EXPRESS_LOG_OPTIONS) ?? Prisma.JsonNull,
          responseBody: shouldLogResponseBody(req.path)
            ? sanitizeLogPayload(responseBody, EXPRESS_LOG_OPTIONS) ?? Prisma.JsonNull
            : Prisma.JsonNull,
          errorMessage
        }
      })
      .catch((error) => {
        console.error("Failed to write express request log", error);
      });
  });

  next();
};
