import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { AuthenticatedUser } from "../../middleware/auth.js";
import { WorkReportImportService, MAX_IMPORT_OPERATIONS, type ThirdPartyImportOperation } from "./import-service.js";
import { WorkReportQueryService } from "./report-service.js";
import { AssignmentService } from "./assignment-service.js";
import { ClaimableOperationService } from "./claimable-service.js";
import { WorkReportStatisticsService } from "./statistics-service.js";
import { WorkReportAdminQueryService } from "./admin-query-service.js";
import type { PermissionGroup } from "./permissions.js";

export { MAX_IMPORT_OPERATIONS, type ThirdPartyImportOperation, type PermissionGroup };

export class WorkReportService {
  private readonly importService: WorkReportImportService;
  private readonly reports: WorkReportQueryService;
  private readonly assignments: AssignmentService;
  private readonly claimable: ClaimableOperationService;
  private readonly statistics: WorkReportStatisticsService;
  private readonly admin: WorkReportAdminQueryService;

  constructor(private readonly db: PrismaClient = prisma) {
    this.importService = new WorkReportImportService(db);
    this.reports = new WorkReportQueryService(db);
    this.assignments = new AssignmentService(db);
    this.claimable = new ClaimableOperationService(db);
    this.statistics = new WorkReportStatisticsService(db);
    this.admin = new WorkReportAdminQueryService(db);
  }

  getReports = (filters: Parameters<WorkReportQueryService["getReports"]>[0] = {}) =>
    this.reports.getReports(filters);

  updateAssignmentHours = (assignmentId: string, estimatedHours: number) =>
    this.reports.updateAssignmentHours(assignmentId, estimatedHours);

  getAssignments = (user: AuthenticatedUser) => this.assignments.getAssignments(user);

  searchClaimableProducts = (keyword = "", page = 1, pageSize = 4) =>
    this.claimable.searchClaimableProducts(keyword, page, pageSize);

  getClaimableParts = (productId: string) => this.claimable.getClaimableParts(productId);

  getClaimableOperations = (partId: string) => this.claimable.getClaimableOperations(partId);

  claimOperation = (
    operationId: string,
    user: AuthenticatedUser,
    options?: { startTime?: Date; endTime?: Date }
  ) => this.assignments.claimOperation(operationId, user, options);

  removeClaimedAssignment = (assignmentId: string, user: AuthenticatedUser) =>
    this.assignments.removeClaimedAssignment(assignmentId, user);

  getStatistics = (period: string, user: AuthenticatedUser) => this.statistics.getStatistics(period, user);

  getOrders = (page = 1, pageSize = 50) => this.admin.getOrders(page, pageSize);

  searchWorkers = (keyword = "", page = 1, pageSize = 20) => this.admin.searchWorkers(keyword, page, pageSize);

  getWorkerPermissions = () => this.admin.getWorkerPermissions();

  updateWorkerPermission = (workerId: string, permissionGroup: PermissionGroup) =>
    this.admin.updateWorkerPermission(workerId, permissionGroup);

  importThirdPartyOperations = (operations: ThirdPartyImportOperation[], user: AuthenticatedUser) =>
    this.importService.importThirdPartyOperations(operations, user);

  completeOperation = (orderNo: string, partNo: string, operationNo: string) =>
    this.admin.completeOperation(orderNo, partNo, operationNo);
}

export const workReportService = new WorkReportService();
