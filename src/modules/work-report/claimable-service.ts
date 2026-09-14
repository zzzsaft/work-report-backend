import type { PrismaClient } from "@prisma/client";
import { CLAIMABLE_OPERATION_STATUSES } from "./constants.js";
import { serializePart, serializeProduct } from "./serializers.js";

const MAX_CLAIM_PRODUCTS_PAGE_SIZE = 50;

const poolStatusWhere = { status: { in: [...CLAIMABLE_OPERATION_STATUSES] } };

// 大小写不敏感匹配工序编码
const normalizeCode = (code: string) => code.toUpperCase();
const hasPermissionFor = (operationCode: string, operationCodes: string[] | null) => {
  if (operationCodes === null) return true;
  const upper = normalizeCode(operationCode);
  return operationCodes.some((c) => normalizeCode(c) === upper);
};

export class ClaimableOperationService {
  constructor(private readonly db: PrismaClient) {}

  searchClaimableProducts = async (keyword = "", page = 1, pageSize = 4, _operationCodes: string[] | null = null, company?: string | null) => {
    const safePage = Math.max(page, 1);
    const safePageSize = Math.min(Math.max(pageSize, 1), MAX_CLAIM_PRODUCTS_PAGE_SIZE);
    const normalized = keyword?.trim();
    const baseWhere = {
      operationPools: { some: poolStatusWhere },
      ...(company ? { company } : {}),
      ...(normalized
        ? {
            OR: [
              { orderNo: { contains: normalized, mode: "insensitive" as const } },
              { productCode: { contains: normalized, mode: "insensitive" as const } },
              { productName: { contains: normalized, mode: "insensitive" as const } }
            ]
          }
        : {})
    };

    // 产品级别不做权限过滤，直接 DB 分页（工序级别才做权限校验）
    const [total, products] = await Promise.all([
      this.db.workOrder.count({ where: baseWhere }),
      this.db.workOrder.findMany({
        where: baseWhere,
        select: {
          id: true, orderNo: true, productCode: true, productName: true,
          plannedQuantity: true, completedQuantity: true,
          operationPools: { where: poolStatusWhere, select: { remainingQuantity: true, operationCode: true } }
        },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        orderBy: [{ createdAt: "desc" }, { productCode: "asc" }, { id: "asc" }]
      })
    ]);
    return {
      items: products.map((p) => serializeProduct(p)),
      page: safePage, pageSize: safePageSize, total,
      hasMore: safePage * safePageSize < total
    };
  };

  getClaimableParts = async (productId: string, _operationCodes: string[] | null = null, company?: string | null) => {
    const parts = await this.db.workOrderPart.findMany({
      where: {
        workOrderId: productId,
        operationPools: { some: poolStatusWhere },
        ...(company ? { workOrder: { company } } : {})
      },
      select: {
        id: true, workOrderId: true, partNo: true, partCode: true, partName: true,
        plannedQuantity: true, completedQuantity: true,
        operationPools: { where: poolStatusWhere, select: { remainingQuantity: true, operationCode: true } }
      }
    });

    // 部件级别不做权限过滤，直接按 partNo 数字排序
    const sorted = [...parts].sort((a, b) => Number(a.partNo || 0) - Number(b.partNo || 0));
    return sorted.map((p) => serializePart(p));
  };

  getClaimableOperations = async (partId: string, operationCodes: string[] | null = null, company?: string | null) => {
    const operations = await this.db.operationPool.findMany({
      where: {
        partId,
        status: { in: [...CLAIMABLE_OPERATION_STATUSES] },
        ...(company ? { workOrder: { company } } : {})
      },
      select: {
        id: true, workOrderId: true, partId: true, operationNo: true, operationCode: true,
        operationName: true, operationNote: true, plannedQuantity: true, plannedStart: true,
        estimatedHours: true, claimedWorkers: true, maxClaimWorkers: true, status: true,
        workOrder: { select: { orderNo: true, productCode: true, productName: true } },
        part: { select: { partNo: true, partCode: true, partName: true } }
      }
    });

    const decorated = operations.map((op) => ({
      ...op,
      hasPermission: hasPermissionFor(op.operationCode, operationCodes)
    }));

    decorated.sort((a, b) => {
      if (a.hasPermission !== b.hasPermission) return a.hasPermission ? -1 : 1;
      return Number(a.operationNo || 0) - Number(b.operationNo || 0);
    });

    return decorated.map((op) => ({
      id: op.id, productId: op.workOrderId, partId: op.partId,
      orderNo: op.workOrder.orderNo, productCode: op.workOrder.productCode, productName: op.workOrder.productName,
      partNo: op.part.partNo ?? "", partCode: op.part.partCode, partName: op.part.partName,
      operationNo: op.operationNo ?? "", operationCode: op.operationCode,
      operationName: op.operationName, operationNote: op.operationNote,
      plannedQuantity: op.plannedQuantity,
      plannedStart: op.plannedStart?.toISOString() ?? null,
      estimatedHours: op.estimatedHours,
      claimedWorkers: op.claimedWorkers,
      maxClaimWorkers: op.maxClaimWorkers ?? undefined,
      status: op.status,
      hasPermission: op.hasPermission
    }));
  };
}
