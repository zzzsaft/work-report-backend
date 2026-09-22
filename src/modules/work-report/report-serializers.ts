import { defaultHourAllocation, type HourAllocationResult } from "./hour-allocation.js";
import { getPermissionGroup, PERMISSION_GROUPS, type PermissionGroup } from "./permissions.js";

export const serializeWorkerPermission = (worker: {
  id: string;
  employeeNo: string | null;
  name: string;
  nameInitials: string | null;
  teamName: string | null;
  userRoles: { role: { code: string } }[];
}) => {
  const roles = worker.userRoles
    .map((item) => item.role.code)
    .filter((role) => PERMISSION_GROUPS.includes(role as PermissionGroup));
  const normalizedRoles = roles.length > 0 ? roles : ["worker"];

  return {
    id: worker.id,
    workerId: worker.id,
    employeeNo: worker.employeeNo || worker.id,
    name: worker.name,
    nameInitials: worker.nameInitials || "",
    teamName: worker.teamName || "",
    permissionGroup: getPermissionGroup(normalizedRoles),
    roles: normalizedRoles
  };
};

export const serializeReportRecord = (assignment: {
  id: string;
  operationPoolId: string;
  plannedQuantity: number;
  workOrder: { orderNo: string; productCode: string; productName: string };
  part: { partNo: string | null; partCode: string; partName: string };
  operationPool: { operationCode: string; operationName: string; estimatedHours: number; operationNote: string; ylpartnum: string; yldescription: string; mfgcomment: string; cpNum: string; cpDes: string; plannedQuantity: number };
  workerName: string;
  status: string;
  claimedAt: Date | null;
  estimatedHours: number | null;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  session: {
    id: string;
    startedAt: Date | null;
    completedAt: Date | null;
    accumulatedSeconds: number;
  } | null;
}, allocation?: HourAllocationResult) => {
  const durationSeconds = assignment.session?.accumulatedSeconds ?? 0;
  const durationHours = Math.round((durationSeconds / 3600) * 10) / 10;
  const hourAllocation = allocation ?? defaultHourAllocation(assignment);

  return {
    id: assignment.id,
    orderNo: assignment.workOrder.orderNo,
    productCode: assignment.workOrder.productCode,
    productName: assignment.workOrder.productName,
    partNo: assignment.part.partNo ?? "",
    partCode: assignment.part.partCode,
    partName: assignment.part.partName,
    operationCode: assignment.operationPool.operationCode,
    operationName: assignment.operationPool.operationName,
    operationNote: assignment.operationPool.operationNote,
    ylpartnum: assignment.operationPool.ylpartnum,
    yldescription: assignment.operationPool.yldescription,
    mfgcomment: assignment.operationPool.mfgcomment,
    cpNum: assignment.operationPool.cpNum,
    cpDes: assignment.operationPool.cpDes,
    operatorName: assignment.workerName,
    status: assignment.status,
    plannedQuantity: assignment.plannedQuantity,
    demandQuantity: assignment.operationPool.plannedQuantity,
    completedQuantity: assignment.plannedQuantity,
    claimedAt: assignment.claimedAt?.toISOString(),
    estimatedHours: assignment.estimatedHours ?? 0,
    allocatedHours: hourAllocation.allocatedHours,
    originalEstimatedHours: hourAllocation.originalEstimatedHours,
    hourAllocation,
    durationHours,
    startedAt: assignment.session?.startedAt?.toISOString(),
    completedAt: assignment.session?.completedAt?.toISOString(),
    actualStartAt: assignment.actualStartAt?.toISOString(),
    actualEndAt: assignment.actualEndAt?.toISOString(),
    photos: []
  };
};
