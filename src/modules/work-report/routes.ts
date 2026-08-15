import { Router } from "express";
import { z } from "zod";
import { AppError, asyncHandler } from "../../lib/errors.js";
import {
  getCapabilitiesForRoles,
  requireCapability,
  requirePermissionManagement
} from "../../middleware/auth.js";
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
  dueDate: dateStringSchema.nullable().optional(),
  status: z.enum(["available", "closed"]).optional(),
  company: z.string().trim().optional()
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

const permissionGroupSchema = z.enum(["worker", "leader", "admin"]);
const companyFilterSchema = z.enum(["jctimes", "JingyiMT"]).optional();
const updateWorkerPermissionSchema = z.object({
  permissionGroup: permissionGroupSchema
});

const parseThirdPartyImportPayload = (body: unknown) => {
  const payload = thirdPartyImportSchema.parse(body);
  return Array.isArray(payload) ? payload : payload.operations;
};

const actualTimeSchema = z
  .object({
    startTime: z.string().trim().min(1).optional(),
    endTime: z.string().trim().min(1).optional()
  })
  .optional()
  .superRefine((value, ctx) => {
    if (!value?.startTime && !value?.endTime) return;
    if (!value.startTime || !value.endTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "startTime 和 endTime 必须同时提供"
      });
      return;
    }

    const start = new Date(value.startTime);
    const end = new Date(value.endTime);
    if (Number.isNaN(start.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startTime"],
        message: "startTime 格式无效"
      });
    }
    if (Number.isNaN(end.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "endTime 格式无效"
      });
    }
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end < start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "endTime 不能早于 startTime"
      });
    }
  });

const parseActualTimeOptions = (body: unknown) => {
  const value = actualTimeSchema.parse(body);
  if (!value?.startTime || !value.endTime) return undefined;
  return {
    startTime: new Date(value.startTime),
    endTime: new Date(value.endTime)
  };
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
    const query = z
      .object({
        keyword: z.string().optional(),
        page: z.coerce.number().int().default(1),
        pageSize: z.coerce.number().int().default(4)
      })
      .parse(req.query);
    res.json(await workReportService.searchClaimableProducts(query.keyword, query.page, query.pageSize));
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
    res.status(201).json(
      await workReportService.claimOperation(req.params.operationId, requireUser(req), parseActualTimeOptions(req.body))
    );
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
  "/reports/me",
  asyncHandler(async (req, res) => {
    const query = z.object({ period: z.string().default("week") }).parse(req.query);
    res.json(await workReportService.getMyReports(query.period, requireUser(req)));
  })
);

workReportRouter.get(
  "/admin/staff-stats",
  requireCapability("canViewAdmin"),
  asyncHandler(async (req, res) => {
    const query = z.object({
      period: z.string().default("month"),
      operationNames: z.union([z.string().optional(), z.array(z.string()).optional()]).optional(),
      company: companyFilterSchema
    }).parse(req.query);
    const names = Array.isArray(query.operationNames)
      ? query.operationNames.filter(Boolean)
      : query.operationNames
        ? [query.operationNames]
        : [];
    res.json(await workReportService.getStaffStats(query.period, names.length ? names : undefined, query.company));
  })
);

workReportRouter.get(
  "/admin/staff-operation-names",
  requireCapability("canViewAdmin"),
  asyncHandler(async (req, res) => {
    const query = z.object({
      period: z.string().default("month"),
      company: companyFilterSchema
    }).parse(req.query);
    res.json(await workReportService.listOperationNames(query.period, query.company));
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
  "/admin/worker-permissions",
  requirePermissionManagement,
  asyncHandler(async (_req, res) => {
    res.json(await workReportService.getWorkerPermissions());
  })
);

workReportRouter.patch(
  "/admin/workers/:workerId/permission",
  requirePermissionManagement,
  asyncHandler(async (req, res) => {
    const body = updateWorkerPermissionSchema.parse(req.body);
    res.json(
      await workReportService.updateWorkerPermission(req.params.workerId, body.permissionGroup)
    );
  })
);

workReportRouter.get(
  "/admin/reports",
  requireCapability("canViewAdmin"),
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        keyword: z.string().optional(),
        orderNo: z.string().optional(),
        company: companyFilterSchema,
        operatorName: z.string().optional(),
        status: z.string().optional(),
        operationCode: z.string().optional(),
        operationName: z.string().optional(),
        startTime: dateStringSchema.optional(),
        endTime: dateStringSchema.optional(),
        page: z.coerce.number().int().default(1),
        pageSize: z.coerce.number().int().default(50)
      })
      .parse(req.query);
    res.json(await workReportService.getReports(query));
  })
);

workReportRouter.patch(
  "/admin/reports/:id/hours",
  requireCapability("canViewAdmin"),
  asyncHandler(async (req, res) => {
    const body = z.object({ estimatedHours: z.coerce.number().positive() }).parse(req.body);
    res.json(await workReportService.updateAssignmentHours(req.params.id, body.estimatedHours));
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
  "/api/operations/complete",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        orderNo: z.string().trim().min(1),
        partNo: z.string().trim().min(1),
        operationNo: z.string().trim().min(1),
        company: z.string().trim().optional()
      })
      .parse(req.body);
    res.json(await workReportService.completeOperation(body.orderNo, body.partNo, body.operationNo, body.company));
  })
);

workReportRouter.post(
  "/admin/assignments",
  asyncHandler(async () => {
    notImplemented();
  })
);

workReportRouter.get(
  "/admin/operation-worker-assignments",
  asyncHandler(async (req, res) => {
    const query = z.object({ operationCode: z.string().optional() }).parse(req.query);
    res.json(await workReportService.listOperationWorkerAssignments(query.operationCode));
  })
);

workReportRouter.post(
  "/admin/operation-worker-assignments",
  asyncHandler(async (req, res) => {
    const body = z.object({
      operationCode: z.string().trim().min(1),
      workerId: z.string().trim().min(1),
      workerName: z.string().trim().min(1)
    }).parse(req.body);
    res.status(201).json(await workReportService.createOperationWorkerAssignment(body.operationCode, body.workerId, body.workerName));
  })
);

workReportRouter.delete(
  "/admin/operation-worker-assignments/:id",
  asyncHandler(async (req, res) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    res.json(await workReportService.deleteOperationWorkerAssignment(params.id));
  })
);

workReportRouter.post(
  "/admin/operation-worker-assignments/batch-delete",
  asyncHandler(async (req, res) => {
    const body = z.object({ ids: z.array(z.string().min(1)) }).parse(req.body);
    res.json(await workReportService.batchDeleteOperationWorkerAssignments(body.ids));
  })
);

workReportRouter.post(
  "/admin/operation-worker-assignments/sync",
  asyncHandler(async (req, res) => {
    res.json(await workReportService.syncOperationWorkerAssignments());
  })
);

workReportRouter.get(
  "/admin/operation-worker-assignments/unmapped-workers",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        keyword: z.string().optional(),
        page: z.coerce.number().int().default(1),
        pageSize: z.coerce.number().int().default(10)
      })
      .parse(req.query);
    res.json(await workReportService.listUnmappedWorkers(query.keyword, query.page, query.pageSize));
  })
);

workReportRouter.delete(
  "/admin/assignments/:assignmentId",
  asyncHandler(async () => {
    notImplemented();
  })
);

// ===== Team Management Routes =====

workReportRouter.get(
  "/admin/teams",
  asyncHandler(async (_req, res) => {
    res.json(await workReportService.listTeams());
  })
);

workReportRouter.post(
  "/admin/teams",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1),
        description: z.string().trim().optional()
      })
      .parse(req.body);
    res.status(201).json(await workReportService.createTeam(body.name, body.description));
  })
);

workReportRouter.put(
  "/admin/teams/:id",
  asyncHandler(async (req, res) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z
      .object({
        name: z.string().trim().min(1),
        description: z.string().trim().optional()
      })
      .parse(req.body);
    res.json(await workReportService.updateTeam(params.id, body.name, body.description));
  })
);

workReportRouter.delete(
  "/admin/teams/:id",
  asyncHandler(async (req, res) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    res.json(await workReportService.deleteTeam(params.id));
  })
);

workReportRouter.get(
  "/admin/teams/:id/members",
  asyncHandler(async (req, res) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    res.json(await workReportService.getTeamMembers(params.id));
  })
);

workReportRouter.post(
  "/admin/teams/:id/members",
  asyncHandler(async (req, res) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ userId: z.string().trim().min(1) }).parse(req.body);
    res.status(201).json(await workReportService.addTeamMember(params.id, body.userId));
  })
);

workReportRouter.delete(
  "/admin/teams/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const params = z
      .object({ id: z.string().min(1), userId: z.string().min(1) })
      .parse(req.params);
    res.json(await workReportService.removeTeamMember(params.id, params.userId));
  })
);

workReportRouter.patch(
  "/admin/workers/:userId/team",
  asyncHandler(async (req, res) => {
    const params = z.object({ userId: z.string().min(1) }).parse(req.params);
    const body = z.object({ teamId: z.string().trim().nullable() }).parse(req.body);
    res.json(await workReportService.setWorkerTeam(params.userId, body.teamId));
  })
);

// ===== Team Operation Assignment Routes =====

workReportRouter.get(
  "/admin/teams/:id/operations",
  asyncHandler(async (req, res) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    res.json(await workReportService.listTeamOperations(params.id));
  })
);

workReportRouter.post(
  "/admin/teams/:id/operations",
  asyncHandler(async (req, res) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z
      .object({
        operationCode: z.string().trim().min(1),
        operationName: z.string().trim().optional()
      })
      .parse(req.body);
    res
      .status(201)
      .json(
        await workReportService.createTeamOperation(params.id, body.operationCode, body.operationName)
      );
  })
);

workReportRouter.delete(
  "/admin/team-operations/:id",
  asyncHandler(async (req, res) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    res.json(await workReportService.deleteTeamOperation(params.id));
  })
);

workReportRouter.post(
  "/admin/team-operations/batch-delete",
  asyncHandler(async (req, res) => {
    const body = z.object({ ids: z.array(z.string().min(1)) }).parse(req.body);
    res.json(await workReportService.batchDeleteTeamOperations(body.ids));
  })
);

workReportRouter.post(
  "/admin/team-operations/sync",
  asyncHandler(async (_req, res) => {
    res.json(await workReportService.syncTeamOperations());
  })
);
