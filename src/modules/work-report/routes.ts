import { Router } from "express";
import { z } from "zod";
import { AppError, asyncHandler } from "../../lib/errors.js";
import { getCapabilitiesForRoles, requireCapability } from "../../middleware/auth.js";
import { MAX_IMPORT_OPERATIONS, workReportService } from "./service.js";

export const workReportRouter = Router();

const requireUser = (req: Parameters<Parameters<typeof asyncHandler>[0]>[0]) => {
  if (!req.user) throw new AppError(401, "token 缺失或失效");
  return req.user;
};

const notImplemented = () => {
  throw new AppError(501, "v2 报工流程暂未实现");
};

const importOperationSchema = z.object({
  orderNo: z.string().trim().min(1),
  productCode: z.string().trim().min(1),
  productName: z.string().trim().min(1),
  orderPlannedQuantity: z.coerce.number().int().positive(),
  orderCompletedQuantity: z.coerce.number().int().min(0).optional(),
  dueDate: z.coerce.date(),
  orderStatus: z.string().trim().min(1).optional(),
  partCode: z.string().trim().min(1),
  partName: z.string().trim().min(1),
  partPlannedQuantity: z.coerce.number().int().positive(),
  partCompletedQuantity: z.coerce.number().int().min(0).optional(),
  operationCode: z.string().trim().min(1),
  operationName: z.string().trim().min(1),
  operationNote: z.string().trim().optional(),
  plannedQuantity: z.coerce.number().int().positive(),
  plannedStart: z.coerce.date().optional(),
  remainingQuantity: z.coerce.number().int().min(0).optional(),
  estimatedHours: z.coerce.number().positive(),
  maxClaimWorkers: z.coerce.number().int().positive().nullable().optional(),
  status: z.enum(["available", "claimed", "closed"]).optional(),
  source: z.string().trim().min(1).optional()
});

const importOperationsSchema = z.union([
  z.array(importOperationSchema).min(1).max(MAX_IMPORT_OPERATIONS),
  z.object({ operations: z.array(importOperationSchema).min(1).max(MAX_IMPORT_OPERATIONS) })
]);

workReportRouter.get(
  "/me/capabilities",
  asyncHandler(async (req, res) => {
    res.json(getCapabilitiesForRoles(requireUser(req).roles));
  })
);

workReportRouter.get(
  "/assignments",
  asyncHandler(async (req, res) => {
    res.json(await workReportService.getAssignments(requireUser(req)));
  })
);

workReportRouter.get(
  "/assignments/current",
  asyncHandler(async () => {
    notImplemented();
  })
);

workReportRouter.post(
  "/assignments/:id/select",
  asyncHandler(async () => {
    notImplemented();
  })
);

for (const action of ["start", "pause", "resume", "complete"]) {
  workReportRouter.post(
    `/assignments/:id/${action}`,
    asyncHandler(async () => {
      notImplemented();
    })
  );
}

workReportRouter.get(
  "/claim/products",
  asyncHandler(async (req, res) => {
    const query = z.object({ keyword: z.string().optional() }).parse(req.query);
    res.json(await workReportService.searchClaimableProducts(query.keyword));
  })
);

workReportRouter.get(
  "/claim/products/:productId/parts",
  asyncHandler(async (req, res) => {
    res.json(await workReportService.getClaimableParts(req.params.productId));
  })
);

workReportRouter.get(
  "/claim/parts/:partId/operations",
  asyncHandler(async (req, res) => {
    res.json(await workReportService.getClaimableOperations(req.params.partId));
  })
);

workReportRouter.post(
  "/claim/operations/:operationId/claim",
  asyncHandler(async (req, res) => {
    res.status(201).json(await workReportService.claimOperation(req.params.operationId, requireUser(req)));
  })
);

workReportRouter.delete(
  "/assignments/:assignmentId/claim",
  asyncHandler(async (req, res) => {
    await workReportService.removeClaimedAssignment(req.params.assignmentId, requireUser(req));
    res.status(204).send();
  })
);

workReportRouter.get(
  "/statistics/me",
  asyncHandler(async (req, res) => {
    const query = z.object({ period: z.string().default("week") }).parse(req.query);
    res.json(await workReportService.getStatistics(query.period, requireUser(req)));
  })
);

workReportRouter.get(
  "/attendance/me",
  asyncHandler(async () => {
    notImplemented();
  })
);

workReportRouter.get(
  "/admin/dashboard",
  requireCapability("canViewAdmin"),
  asyncHandler(async () => {
    notImplemented();
  })
);

workReportRouter.get(
  "/admin/orders",
  requireCapability("canViewAdmin"),
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        page: z.coerce.number().int().default(1),
        pageSize: z.coerce.number().int().default(50)
      })
      .parse(req.query);
    res.json(await workReportService.getOrders(query.page, query.pageSize));
  })
);

workReportRouter.get(
  "/admin/workers",
  requireCapability("canAssignWorkers"),
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        keyword: z.string().optional(),
        page: z.coerce.number().int().default(1),
        pageSize: z.coerce.number().int().default(20)
      })
      .parse(req.query);
    res.json(await workReportService.searchWorkers(query.keyword, query.page, query.pageSize));
  })
);

workReportRouter.get(
  "/admin/reports",
  requireCapability("canViewAdmin"),
  asyncHandler(async () => {
    notImplemented();
  })
);

workReportRouter.get(
  "/admin/exceptions",
  requireCapability("canReviewExceptions"),
  asyncHandler(async () => {
    notImplemented();
  })
);

workReportRouter.post(
  "/admin/exceptions/:id/resolve",
  requireCapability("canReviewExceptions"),
  asyncHandler(async () => {
    notImplemented();
  })
);

workReportRouter.post(
  "/leader/operations/import",
  requireCapability("canImportOperations"),
  asyncHandler(async (req, res) => {
    const payload = importOperationsSchema.parse(req.body);
    const operations = Array.isArray(payload) ? payload : payload.operations;
    res.json(await workReportService.importOperations(operations, requireUser(req)));
  })
);

workReportRouter.post(
  "/admin/assignments",
  requireCapability("canAssignWorkers"),
  asyncHandler(async () => {
    notImplemented();
  })
);

workReportRouter.delete(
  "/admin/assignments/:assignmentId",
  requireCapability("canForceRemoveAssignments"),
  asyncHandler(async () => {
    notImplemented();
  })
);
