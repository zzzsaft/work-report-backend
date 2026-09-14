import { PrismaClient } from "@prisma/client";
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
import { SystemConfigService } from "./system-config-service.js";
import type { PermissionGroup } from "./permissions.js";
import { ASSIGNMENT_STATUS } from "./constants.js";
import { getPeriodRangeAsiaShanghai } from "./date-utils.js";
import { uniqueValues } from "../../lib/arrays.js";
import type { StaffStatsPeriod, WorkReportPeriod } from "./report-period.js";

export { MAX_IMPORT_OPERATIONS, type ThirdPartyImportOperation, type PermissionGroup };

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

interface UserContextCache {
  company: string | null;
  operationCodes: string[] | null;
  timestamp: number;
}

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
  private readonly systemConfig: SystemConfigService;

  private readonly userContextCache = new Map<string, UserContextCache>();

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
    this.systemConfig = new SystemConfigService(db);
  }

  // 解析用户的公司 + 班组工序权限，带 5 分钟内存缓存
  private resolveUserContext = async (user?: AuthenticatedUser): Promise<{ company: string | null; operationCodes: string[] | null }> => {
    if (!user) return { company: null, operationCodes: null };

    const cached = this.userContextCache.get(user.id);
    const now = Date.now();
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return { company: cached.company, operationCodes: cached.operationCodes };
    }

    const [company, operationCodes] = await Promise.all([
      this.resolveUserCompany(user),
      this.resolveTeamOperationCodes(user)
    ]);

    this.userContextCache.set(user.id, { company, operationCodes, timestamp: now });
    return { company, operationCodes };
  };

  // 班组-工序权限校验开启时，返回当前用户班组已分配的工序编码；未开启返回 null（不标记）
  private resolveTeamOperationCodes = async (user?: AuthenticatedUser): Promise<string[] | null> => {
    if (!user) return null;
    const config = await this.systemConfig.get();
    if (!config.teamOperationPermissionEnabled) return null;
    const worker = await this.db.user.findUnique({
      where: { id: user.id },
      select: { teamId: true }
    });
    if (!worker?.teamId) return [];
    const rows = await this.db.teamOperationAssignment.findMany({
      where: { teamId: worker.teamId },
      select: { operationCode: true }
    });
    return rows.map((row) => row.operationCode);
  };

  // 根据用户企微部门映射到公司标识：精诚(jctimes) / 精艺(JingyiMT)
  private resolveUserCompany = async (user?: AuthenticatedUser): Promise<string | null> => {
    if (!user) return null;
    const userDepts = await this.db.wecomUserDepartment.findMany({
      where: { userId: user.id },
      select: { departmentId: true }
    });
    if (!userDepts.length) return null;

    const deptIds = userDepts.map((d) => d.departmentId);
    const allDepts = await this.db.wecomDepartment.findMany({
      where: { departmentId: { in: deptIds } },
      select: { departmentId: true, parentId: true }
    });
    const deptMap = new Map(allDepts.map((d) => [d.departmentId, d.parentId]));

    for (const startId of deptIds) {
      let current: number | undefined = startId;
      while (current && current !== 1) {
        if (current === 2) return "jctimes";
        if (current === 16) return "JingyiMT";
        current = deptMap.get(current);
      }
    }
    return null;
  };

  searchClaimableProducts = async (keyword = "", page = 1, pageSize = 4, user?: AuthenticatedUser) => {
    const { operationCodes, company } = await this.resolveUserContext(user);
    return this.claimable.searchClaimableProducts(keyword, page, pageSize, operationCodes, company);
  };

  getClaimableParts = async (productId: string, user?: AuthenticatedUser) => {
    const { operationCodes, company } = await this.resolveUserContext(user);
    return this.claimable.getClaimableParts(productId, operationCodes, company);
  };

  getClaimableOperations = async (partId: string, user?: AuthenticatedUser) => {
    const { operationCodes, company } = await this.resolveUserContext(user);
    return this.claimable.getClaimableOperations(partId, operationCodes, company);
  };

  claimOperation = async (
    operationId: string,
    user: AuthenticatedUser,
    options?: { startTime?: Date; endTime?: Date; quantity?: number }
  ) => {
    const config = await this.systemConfig.get();
    return this.assignments.claimOperation(operationId, user, options, config.teamOperationPermissionEnabled);
  };

  getAssignments = (user: AuthenticatedUser) => this.assignments.getAssignments(user);

  removeClaimedAssignment = (assignmentId: string, user: AuthenticatedUser) =>
    this.assignments.removeClaimedAssignment(assignmentId, user);

  getStatistics = (period: WorkReportPeriod, user: AuthenticatedUser) => this.statistics.getStatistics(period, user);

  getMyReports = (period: WorkReportPeriod, user: AuthenticatedUser) => this.statistics.getMyReports(period, user);

  getStaffStats = (period: StaffStatsPeriod, operationNames?: string[], company?: string) =>
    this.statistics.getStaffStats(period, operationNames, company);

  getTeamOperationStats = (company?: string, teamName?: string) => this.statistics.getTeamOperationStats(company, teamName);

  listOperationNames = async (period: StaffStatsPeriod, company?: string) => {
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

  getOrders = (page = 1, pageSize = 50) => this.admin.getOrders(page, pageSize);

  searchWorkers = (keyword = "", page = 1, pageSize = 20) => this.admin.searchWorkers(keyword, page, pageSize);

  getWorkerPermissions = () => this.admin.getWorkerPermissions();

  updateWorkerPermission = (workerId: string, permissionGroup: PermissionGroup) =>
    this.admin.updateWorkerPermission(workerId, permissionGroup);

  importThirdPartyOperations = (operations: ThirdPartyImportOperation[], user: AuthenticatedUser) =>
    this.importService.importThirdPartyOperations(operations, user);

  completeOperation = (orderNo: string, partNo: string, operationNo: string, company?: string) =>
    this.admin.completeOperation(orderNo, partNo, operationNo, company);

  getReports = (query: Parameters<WorkReportQueryService["getReports"]>[0]) => this.reports.getReports(query);

  updateAssignmentHours = (assignmentId: string, estimatedHours: number) =>
    this.reports.updateAssignmentHours(assignmentId, estimatedHours);

  // ===== Team Management =====
  listTeams = () => this.teams.list();
  createTeam = (name: string, description?: string) => this.teams.create(name, description);
  updateTeam = (id: string, name: string, description?: string) => this.teams.update(id, name, description);
  deleteTeam = (id: string) => this.teams.delete(id);
  getTeamMembers = (teamId: string) => this.teams.getMembers(teamId);
  addTeamMember = (teamId: string, userId: string) => this.teams.addMember(teamId, userId);
  removeTeamMember = (teamId: string, userId: string) => this.teams.removeMember(teamId, userId);
  setWorkerTeam = (userId: string, teamId: string | null) => this.teams.setMemberTeam(userId, teamId);
  batchSetWorkerTeam = (userIds: string[], teamId: string | null) => this.teams.batchSetMemberTeams(userIds, teamId);

  // ===== Team Operation Assignment =====
  listTeamOperations = (teamId: string) => this.teamOperationAssignments.list(teamId);
  createTeamOperation = (teamId: string, operationCode: string, operationName?: string) =>
    this.teamOperationAssignments.create(teamId, operationCode, operationName);
  deleteTeamOperation = (id: string) => this.teamOperationAssignments.delete(id);
  batchDeleteTeamOperations = (ids: string[]) => this.teamOperationAssignments.batchDelete(ids);
  syncTeamOperations = () => this.teamOperationAssignments.syncFromWorkerAssignments();

  // ===== System Config =====
  getSystemConfig = () => this.systemConfig.get();
  updateSystemConfig = (data: { teamOperationPermissionEnabled?: boolean }) => this.systemConfig.update(data);

  resetDemo = () => {
    throw new AppError(501, "resetDemo is not implemented");
  };
}

export const workReportService = new WorkReportService();
