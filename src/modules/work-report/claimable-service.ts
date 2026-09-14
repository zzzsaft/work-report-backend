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
// 产品/部件有权限：至少一道工序属于班组已分配工序
const hasAnyPermission = (codes: string[], operationCodes: string[] | null) => {
  if (operationCodes === null) return true;
  return codes.some((c) => hasPermissionFor(c, operationCodes));
};

export class ClaimableOperationService {
  constructor(private readonly db: PrismaClient) {}

searchClaimableProducts = async (keyword = "", page = 1, pageSize = 4, operationCodes: string[] | null = null) => {
    const safePage = Math.max(page, 1);
    const safePageSize = Math.min(Math.max(pageSize, 1), MAX_CLAIM_PRODUCTS_PAGE_SIZE);
    const normalized = keyword?.trim();
    const where = {
      operationPools: { some: poolStatusWhere },
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

    const [total, products] = await Promise.all([
      this.db.workOrder.count({ where }),
      this.db.workOrder.findMany({
        where,
        select: {
          id: true,
          orderNo: true,
          productCode: true,
          productName: true,
          plannedQuantity: true,
          completedQuantity: true,
          operationPools: {
            where: poolStatusWhere,
            select: { remainingQuantity: true, operationCode: true }
          }
        },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        orderBy: [{ createdAt: "desc" }, { productCode: "asc" }, { id: "asc" }]
      })
    ]);

    const decorated = products.map((p) => ({
      ...p,
      hasPermission: hasAnyPermission(p.operationPools.map((o) => o.operationCode), operationCodes)
    }));
    decorated.sort((a, b) => {
      if (a.hasPermission !== b.hasPermission) return a.hasPermission ? -1 : 1;
      return 0; // 保持 DB 原有排序
    });

    return {
      items: decorated.map((p) => ({ ...serializeProduct(p), hasPermission: p.hasPermission })),
      page: safePage,
      pageSize: safePageSize,
      total,
      hasMore: safePage * safePageSize < total
    };
  };

getClaimableParts = async (productId: string, operationCodes: string[] | null = null) => {
    const parts = await this.db.workOrderPart.findMany({
      where: {
        workOrderId: productId,
        operationPools: { some: poolStatusWhere }
      },
      select: {
        id: true,
        workOrderId: true,
        partNo: true,
        partCode: true,
        partName: true,
        plannedQuantity: true,
        completedQuantity: true,
        operationPools: {
          where: poolStatusWhere,
          select: { remainingQuantity: true, operationCode: true }
        }
      }
    });

    const decorated = parts.map((p) => ({
      ...p,
      hasPermission: hasAnyPermission(p.operationPools.map((o) => o.operationCode), operationCodes)
    }));
    decorated.sort((a, b) => {
      if (a.hasPermission !== b.hasPermission) return a.hasPermission ? -1 : 1;
      return Number(a.partNo || 0) - Number(b.partNo || 0);
    });

    return decorated.map((p) => ({ ...serializePart(p), hasPermission: p.hasPermission }));
  };

getClaimableOperations = async (partId: string, operationCodes: string[] | null = null) => {
    const operations = await this.db.operationPool.findMany({
      where: {
        partId,
        status: { in: [...CLAIMABLE_OPERATION_STATUSES] }
      },
      select: {
        id: true,
        workOrderId: true,
        partId: true,
        operationNo: true,
        operationCode: true,
        operationName: true,
        operationNote: true,
        plannedQuantity: true,
        plannedStart: true,
        estimatedHours: true,
        claimedWorkers: true,
        maxClaimWorkers: true,
        status: true,
        workOrder: {
          select: {
            orderNo: true,
            productCode: true,
            productName: true
          }
        },
        part: {
          select: {
            partNo: true,
            partCode: true,
            partName: true
          }
        }
      }
    });

    // 有权限的排前面，无权限的排后面；同权限组内按 operationNo 数字排序
    const decorated = operations.map((op) => ({
      ...op,
      hasPermission: hasPermissionFor(op.operationCode, operationCodes)
    }));

    decorated.sort((a, b) => {
      if (a.hasPermission !== b.hasPermission) return a.hasPermission ? -1 : 1;
      return Number(a.operationNo || 0) - Number(b.operationNo || 0);
    });

    return decorated.map((op) => ({
      id: op.id,
      productId: op.workOrderId,
      partId: op.partId,
      orderNo: op.workOrder.orderNo,
      productCode: op.workOrder.productCode,
      productName: op.workOrder.productName,
      partNo: op.part.partNo ?? "",
      partCode: op.part.partCode,
      partName: op.part.partName,
      operationNo: op.operationNo ?? "",
      operationCode: op.operationCode,
      operationName: op.operationName,
      operationNote: op.operationNote,
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
