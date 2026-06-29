import { Router } from "express";
import { z } from "zod";
import { AppError, asyncHandler } from "../../lib/errors.js";
import { getCapabilitiesForRoles, requireCapability } from "../../middleware/auth.js";
import { MAX_IMPORT_OPERATIONS, workReportService } from "./service.js";

const dateStringSchema = z.string().refine(
  (val) => {
    if (!val) return true;
    const formats = [
      /^\d{4}-\d{2}-\d{2}$/,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      /^\d{4}\/\d{2}\/\d{2}$/
    ];
    return formats.some((format) => format.test(val)) && !Number.isNaN(new Date(val).getTime());
  },
  { message: "Invalid date format" }
);

const thirdPartyImportOperationSchema = z.object({
  orderNo: z.string().trim().min(1),
  productCode: z.string().trim().min(1),
  productName: z.string().trim().min(1),
  partNo: z.coerce.string().trim().min(1),
  partCode: z.string().trim().min(1),
  partName: z.string().trim().min(1),
  operationNo: z.coerce.string().trim().min(1),
  operationCode: z.string().trim().min(1),
  operationName: z.string().trim().min(1),
  estimatedHours: z.coerce.number().positive(),
  operationNote: z.string().trim().optional(),
  plannedQuantity: z.coerce.number().positive().optional(),
  dueDate: dateStringSchema.nullable().optional()
});

const thirdPartyImportSchema = z.union([
  z.array(thirdPartyImportOperationSchema).min(1).max(MAX_IMPORT_OPERATIONS),
  z.object({ operations: z.array(thirdPartyImportOperationSchema).min(1).max(MAX_IMPORT_OPERATIONS) })
]);

export const workReportRouter = Router();

const requireUser = (req: Parameters<Parameters<typeof asyncHandler>[0]>[0]) => {
  if (!req.user) throw new AppError(401, "token 缺失或失效");
  return req.user;
};

const notImplemented = () => {
  throw new AppError(501, "v2 报工流程暂未实现");
};

const leaderImportRowSchema = z.object({
  productCode: z.string().trim().min(1),
  partCode: z.string().trim().min(1),
  operationCode: z.string().trim().min(1),
  operationName: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive(),
  estimatedHours: z.coerce.number().positive()
});

const leaderImportSchema = z.object({
  rows: z.array(leaderImportRowSchema).min(1).max(MAX_IMPORT_OPERATIONS)
});

const parseThirdPartyImportPayload = (body: unknown) => {
  const payload = thirdPartyImportSchema.parse(body);
  return Array.isArray(payload) ? payload : payload.operations;
};

const convertLeaderRowsToThirdPartyOperations = (body: unknown) => {
  const payload = leaderImportSchema.parse(body);
  return payload.rows.map((row) => ({
    orderNo: row.productCode,
    productCode: row.productCode,
    productName: row.productCode,
    partNo: row.partCode,
    partCode: row.partCode,
    partName: row.partCode,
    operationNo: row.operationCode,
    operationCode: row.operationCode,
    operationName: row.operationName,
    estimatedHours: row.estimatedHours,
    plannedQuantity: row.quantity,
    dueDate: null
  }));
};

const isThirdPartyImportPayload = (body: unknown) =>
  Array.isArray(body) || (typeof body === "object" && body !== null && "operations" in body);

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
    const operations = isThirdPartyImportPayload(req.body)
      ? parseThirdPartyImportPayload(req.body)
      : convertLeaderRowsToThirdPartyOperations(req.body);
    res.json(await workReportService.importThirdPartyOperations(operations, requireUser(req)));
  })
);

workReportRouter.post(
  "/api/operations/import",
  requireCapability("canImportOperations"),
  asyncHandler(async (req, res) => {
    const operations = parseThirdPartyImportPayload(req.body);
    res.json(await workReportService.importThirdPartyOperations(operations, requireUser(req)));
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
