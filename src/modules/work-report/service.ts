import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { AuthenticatedUser } from "../../middleware/auth.js";
import { AppError } from "../../lib/errors.js";
import { WorkReportImportService, MAX_IMPORT_OPERATIONS, type ThirdPartyImportOperation } from "./import-service.js";
import { WorkReportQueryService } from "./report-service.js";
import { AssignmentService } from "./assignment-service.js";
import { ClaimableOperationService } from "./claimable-service.js";
import { WorkReportStatisticsService } from "./statistics-service.js";
import { WorkReportAdminQueryService } from "./admin-query-service.js";
import { OperationWorkerAssignmentService } from "./operation-worker-assignment-service.js";
import { TeamService } from "./team-service.js";
import { TeamOperationAssignmentService } from "./team-operation-assignment-service.js";
import type { PermissionGroup } from "./permissions.js";
<<<<<<< HEAD
import { ASSIGNMENT_STATUS } from "./constants.js";
import { getPeriodRangeAsiaShanghai } from "./date-utils.js";
import { uniqueValues } from "../../lib/arrays.js";
=======
import type { StaffStatsPeriod, WorkReportPeriod } from "./report-period.js";
>>>>>>> cfc0d358c612a7d670e7cd55486af5c0261303cf

export { MAX_IMPORT_OPERATIONS, type ThirdPartyImportOperation, type PermissionGroup };

export class WorkReportService {
  private readonly importService: WorkReportImportService;
  private readonly reports: WorkReportQueryService;
  private readonly assignments: AssignmentService;
  private readonly claimable: ClaimableOperationService;
  private readonly statistics: WorkReportStatisticsService;
  private readonly admin: WorkReportAdminQueryService;
  private readonly operationWorkerAssignments: OperationWorkerAssignmentService;
  private readonly teams: TeamService;
  private readonly teamOperationAssignments: TeamOperationAssignmentService;

  constructor(private readonly db: PrismaClient = prisma) {
    this.importService = new WorkReportImportService(db);
    this.reports = new WorkReportQueryService(db);
    this.assignments = new AssignmentService(db);
    this.claimable = new ClaimableOperationService(db);
    this.statistics = new WorkReportStatisticsService(db);
    this.admin = new WorkReportAdminQueryService(db);
    this.operationWorkerAssignments = new OperationWorkerAssignmentService(db);
    this.teams = new TeamService(db);
    this.teamOperationAssignments = new TeamOperationAssignmentService(db);
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

  getStatistics = (period: WorkReportPeriod, user: AuthenticatedUser) => this.statistics.getStatistics(period, user);

  getMyReports = (period: WorkReportPeriod, user: AuthenticatedUser) => this.statistics.getMyReports(period, user);

<<<<<<< HEAD
  getStaffStats = (period: string, operationNames?: string[], company?: string) =>
    this.statistics.getStaffStats(period, operationNames, company);

  listOperationNames = async (period: string, company?: string) => {
    if (!["month", "lastMonth"].includes(period)) {
      throw new AppError(400, "period 必须是 month 或 lastMonth");
    }
    const { start, end } = getPeriodRangeAsiaShanghai(period);
    const results = await this.db.operationAssignment.findMany({
      where: {
        status: { not: ASSIGNMENT_STATUS.cancelled },
        actualEndAt: { gte: start, lt: end, not: null },
        ...(company ? { workOrder: { company } } : {})
      },
      select: {
        operationPool: { select: { operationName: true } }
      },
      distinct: ["operationPoolId"]
    });
    return uniqueValues(
      results
        .map((r) => r.operationPool?.operationName)
        .filter((name): name is string => typeof name === "string" && name.length > 0)
    ).sort();
  };

  listOperationWorkerAssignments = (operationCode?: string) => this.operationWorkerAssignments.list(operationCode);

  createOperationWorkerAssignment = (operationCode: string, workerId: string, workerName: string) =>
    this.operationWorkerAssignments.create(operationCode, workerId, workerName);

  deleteOperationWorkerAssignment = (id: string) => this.operationWorkerAssignments.delete(id);

  batchDeleteOperationWorkerAssignments = (ids: string[]) => this.operationWorkerAssignments.batchDelete(ids);

  syncOperationWorkerAssignments = () => this.operationWorkerAssignments.syncFromAssignments();

  listUnmappedWorkers = (keyword?: string, page?: number, pageSize?: number) =>
    this.operationWorkerAssignments.listUnmappedWorkers(keyword, page, pageSize);
=======
  getStaffStats = (period: StaffStatsPeriod) => this.statistics.getStaffStats(period);
>>>>>>> cfc0d358c612a7d670e7cd55486af5c0261303cf

  getOrders = (page = 1, pageSize = 50) => this.admin.getOrders(page, pageSize);

  searchWorkers = (keyword = "", page = 1, pageSize = 20) => this.admin.searchWorkers(keyword, page, pageSize);

  getWorkerPermissions = () => this.admin.getWorkerPermissions();

  updateWorkerPermission = (workerId: string, permissionGroup: PermissionGroup) =>
    this.admin.updateWorkerPermission(workerId, permissionGroup);

  importThirdPartyOperations = (operations: ThirdPartyImportOperation[], user: AuthenticatedUser) =>
    this.importService.importThirdPartyOperations(operations, user);

  completeOperation = (orderNo: string, partNo: string, operationNo: string, company?: string) =>
    this.admin.completeOperation(orderNo, partNo, operationNo, company);

  // Team management
  listTeams = () => this.teams.list();

  createTeam = (name: string, description?: string) => this.teams.create(name, description);

  updateTeam = (id: string, name: string, description?: string) => this.teams.update(id, name, description);

  deleteTeam = (id: string) => this.teams.delete(id);

  getTeamMembers = (teamId: string) => this.teams.getMembers(teamId);

  addTeamMember = (teamId: string, userId: string) => this.teams.addMember(teamId, userId);

  removeTeamMember = (teamId: string, userId: string) => this.teams.removeMember(teamId, userId);

  setWorkerTeam = (userId: string, teamId: string | null) => this.teams.setMemberTeam(userId, teamId);

  // Team operation assignments
  listTeamOperations = (teamId: string) => this.teamOperationAssignments.list(teamId);

  createTeamOperation = (teamId: string, operationCode: string, operationName?: string) =>
    this.teamOperationAssignments.create(teamId, operationCode, operationName);

  deleteTeamOperation = (id: string) => this.teamOperationAssignments.delete(id);

  batchDeleteTeamOperations = (ids: string[]) => this.teamOperationAssignments.batchDelete(ids);

  syncTeamOperations = () => this.teamOperationAssignments.syncFromWorkerAssignments();
}

export const workReportService = new WorkReportService();
