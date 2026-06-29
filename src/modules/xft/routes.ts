import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/errors.js";
import { requireCapability } from "../../middleware/auth.js";
import { xftService } from "./service.js";

const salaryPeriodSchema = z.string().trim().regex(/^\d{6}$/, "薪资期间必须是 YYYYMM 格式");

const xftConfigSchema = z.object({
  host: z.string().trim().url(),
  appid: z.string().trim().min(1),
  appSecret: z.string().trim().optional(),
  enterpriseId: z.string().trim().min(1),
  defaultUserId: z.string().trim().min(1).default("U0000"),
  defaultPlatformUserId: z.string().trim().min(1).default("AUTO0001"),
  dataCollectionName: z.string().trim().min(1),
  importType: z.string().trim().min(1).default("ADD"),
  salaryPeriod: salaryPeriodSchema,
  workHoursFieldKey: z.string().trim().min(1),
  isCheckEmpty: z.boolean().default(false),
  enabled: z.boolean().default(true)
});

const salaryPeriodBodySchema = z.object({
  salaryPeriod: salaryPeriodSchema.optional()
});

const manualHoursSchema = salaryPeriodBodySchema.extend({
  rows: z
    .array(
      z.object({
        staffName: z.string().trim().min(1),
        staffNumber: z.string().trim().min(1),
        hours: z.coerce.number().positive(),
        identityNumber: z.string().trim().optional(),
        staffId: z.string().trim().optional()
      })
    )
    .min(1)
    .max(40000)
});

export const xftRouter = Router();

xftRouter.get(
  "/admin/xft/config",
  requireCapability("canImportOperations"),
  asyncHandler(async (_req, res) => {
    res.json(await xftService.getConfig());
  })
);

xftRouter.put(
  "/admin/xft/config",
  requireCapability("canImportOperations"),
  asyncHandler(async (req, res) => {
    res.json(await xftService.saveConfig(xftConfigSchema.parse(req.body)));
  })
);

xftRouter.post(
  "/admin/xft/import-hours/preview",
  requireCapability("canImportOperations"),
  asyncHandler(async (req, res) => {
    const body = salaryPeriodBodySchema.parse(req.body);
    res.json(await xftService.previewHours(body.salaryPeriod));
  })
);

xftRouter.post(
  "/admin/xft/import-hours",
  requireCapability("canImportOperations"),
  asyncHandler(async (req, res) => {
    const body = salaryPeriodBodySchema.parse(req.body);
    res.json(await xftService.importPreviewedHours(body.salaryPeriod));
  })
);

xftRouter.post(
  "/admin/xft/import-hours/manual",
  requireCapability("canImportOperations"),
  asyncHandler(async (req, res) => {
    const body = manualHoursSchema.parse(req.body);
    res.json(await xftService.importManualHours(body.rows, body.salaryPeriod));
  })
);
