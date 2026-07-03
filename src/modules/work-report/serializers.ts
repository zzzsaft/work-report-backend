import type {
  AssignmentCollaborator,
  OperationAssignment,
  OperationPool,
  User,
  WorkOrder,
  WorkOrderPart,
  WorkSession
} from "@prisma/client";
import { defaultHourAllocation } from "./hour-allocation.js";

type AssignmentRow = OperationAssignment & {
  workOrder: WorkOrder;
  part: WorkOrderPart;
  operationPool: OperationPool;
  collaborators: AssignmentCollaborator[];
  session: WorkSession | null;
  assignedBy: User | null;
};

export const toDateTime = (value: Date | null | undefined) => value?.toISOString();
export const toDate = (value: Date) => value.toISOString().slice(0, 10);

export const serializeAssignment = (assignment: AssignmentRow) => {
  const hourAllocation = defaultHourAllocation(assignment);

  return {
    id: assignment.id,
    workOrderId: assignment.workOrderId,
    orderNo: assignment.workOrder.orderNo,
    productCode: assignment.workOrder.productCode,
    productName: assignment.workOrder.productName,
    partNo: assignment.part.partNo ?? "",
    partCode: assignment.part.partCode,
    partName: assignment.part.partName,
    operationNo: assignment.operationPool.operationNo ?? "",
    operationCode: assignment.operationPool.operationCode,
    operationName: assignment.operationPool.operationName,
    operationNote: assignment.operationPool.operationNote,
    plannedQuantity: assignment.plannedQuantity,
    plannedStart: assignment.plannedStart.toISOString(),
    plannedEnd: assignment.plannedEnd.toISOString(),
    collaborators: assignment.collaborators.length
      ? assignment.collaborators.map((item) => item.name)
      : [assignment.workerName],
    source: assignment.source,
    canWorkerRemove: assignment.canWorkerRemove,
    estimatedHours: assignment.estimatedHours ?? undefined,
    allocatedHours: hourAllocation.allocatedHours,
    originalEstimatedHours: hourAllocation.originalEstimatedHours,
    hourAllocation,
    actualStartAt: toDateTime(assignment.actualStartAt),
    actualEndAt: toDateTime(assignment.actualEndAt),
    claimedAt: toDateTime(assignment.claimedAt),
    assignedBy: assignment.assignedById
      ? {
          id: assignment.assignedById,
          name: assignment.assignedByName || assignment.assignedBy?.name || "",
          role: assignment.assignedByRole || "system"
        }
      : undefined,
    status: assignment.status,
    session: assignment.session
      ? {
          id: assignment.session.id,
          assignmentId: assignment.session.assignmentId,
          operatorId: assignment.session.operatorId,
          operatorName: assignment.session.operatorName,
          status: assignment.session.status,
          startedAt: toDateTime(assignment.session.startedAt),
          completedAt: toDateTime(assignment.session.completedAt),
          accumulatedSeconds: assignment.session.accumulatedSeconds,
          currentRunStartedAt: toDateTime(assignment.session.currentRunStartedAt),
          pauses: [],
          photos: [],
          completedQuantity: assignment.session.completedQuantity ?? undefined,
          note: assignment.session.note ?? undefined
        }
      : undefined
  };
};

type ProductRow = Pick<
  WorkOrder,
  "id" | "orderNo" | "productCode" | "productName" | "plannedQuantity" | "completedQuantity"
> & {
  operationPools?: Array<Pick<OperationPool, "remainingQuantity">>;
};

type PartRow = Pick<
  WorkOrderPart,
  "id" | "workOrderId" | "partNo" | "partCode" | "partName" | "plannedQuantity" | "completedQuantity"
> & {
  operationPools?: Array<Pick<OperationPool, "remainingQuantity">>;
};

type OperationRow = Pick<
  OperationPool,
  | "id"
  | "workOrderId"
  | "partId"
  | "operationNo"
  | "operationCode"
  | "operationName"
  | "operationNote"
  | "plannedQuantity"
  | "plannedStart"
  | "estimatedHours"
  | "claimedWorkers"
  | "maxClaimWorkers"
  | "status"
> & {
  workOrder: Pick<WorkOrder, "orderNo" | "productCode" | "productName">;
  part: Pick<WorkOrderPart, "partCode" | "partName">;
};

export const serializeProduct = (order: ProductRow) => ({
  id: order.id,
  orderNo: order.orderNo,
  productCode: order.productCode,
  productName: order.productName,
  remainingQuantity:
    order.operationPools?.reduce((total, operation) => total + operation.remainingQuantity, 0) ??
    Math.max(order.plannedQuantity - order.completedQuantity, 0)
});

export const serializePart = (part: PartRow) => ({
  id: part.id,
  productId: part.workOrderId,
  partNo: part.partNo ?? "",
  partCode: part.partCode,
  partName: part.partName,
  operationCount: part.operationPools?.length ?? 0,
  remainingQuantity:
    part.operationPools?.reduce((total, operation) => total + operation.remainingQuantity, 0) ??
    Math.max(part.plannedQuantity - part.completedQuantity, 0)
});

export const serializeOperation = (operation: OperationRow) => ({
  id: operation.id,
  productId: operation.workOrderId,
  partId: operation.partId,
  orderNo: operation.workOrder.orderNo,
  productCode: operation.workOrder.productCode,
  productName: operation.workOrder.productName,
  partCode: operation.part.partCode,
  partName: operation.part.partName,
  operationNo: operation.operationNo ?? "",
  operationCode: operation.operationCode,
  operationName: operation.operationName,
  operationNote: operation.operationNote,
  plannedQuantity: operation.plannedQuantity,
  plannedStart: toDateTime(operation.plannedStart),
  estimatedHours: operation.estimatedHours,
  claimedWorkers: operation.claimedWorkers,
  maxClaimWorkers: operation.maxClaimWorkers ?? undefined,
  status: operation.status
});

export const serializeWorkOrder = (order: WorkOrder) => ({
  id: order.id,
  orderNo: order.orderNo,
  productCode: order.productCode,
  productName: order.productName,
  plannedQuantity: order.plannedQuantity,
  completedQuantity: order.completedQuantity,
  dueDate: toDate(order.dueDate),
  progress:
    order.plannedQuantity > 0 ? Math.round((order.completedQuantity / order.plannedQuantity) * 100) : 0,
  status: order.status
});
