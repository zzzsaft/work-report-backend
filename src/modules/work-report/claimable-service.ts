import type { PrismaClient } from "@prisma/client";
import { CLAIMABLE_OPERATION_STATUSES } from "./constants.js";
import { serializeOperation, serializePart, serializeProduct } from "./serializers.js";

const MAX_CLAIM_PRODUCTS_PAGE_SIZE = 50;

export class ClaimableOperationService {
  constructor(private readonly db: PrismaClient) {}

searchClaimableProducts = async (keyword = "", page = 1, pageSize = 4) => {
    const safePage = Math.max(page, 1);
    const safePageSize = Math.min(Math.max(pageSize, 1), MAX_CLAIM_PRODUCTS_PAGE_SIZE);
    const normalized = keyword?.trim();
    const where = {
      operationPools: { some: { status: { in: [...CLAIMABLE_OPERATION_STATUSES] } } },
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
            where: { status: { in: [...CLAIMABLE_OPERATION_STATUSES] } },
            select: { remainingQuantity: true }
          }
        },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        orderBy: [{ createdAt: "desc" }, { productCode: "asc" }, { id: "asc" }]
      })
    ]);

    return {
      items: products.map(serializeProduct),
      page: safePage,
      pageSize: safePageSize,
      total,
      hasMore: safePage * safePageSize < total
    };
  };

getClaimableParts = async (productId: string) => {
    const parts = await this.db.workOrderPart.findMany({
      where: {
        workOrderId: productId,
        operationPools: { some: { status: { in: [...CLAIMABLE_OPERATION_STATUSES] } } }
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
          where: { status: { in: [...CLAIMABLE_OPERATION_STATUSES] } },
          select: { remainingQuantity: true }
        }
      }
    });

    return parts.sort((a, b) => Number(a.partNo || 0) - Number(b.partNo || 0)).map(serializePart);
  };

getClaimableOperations = async (partId: string) => {
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

    return operations.sort((a, b) => Number(a.operationNo || 0) - Number(b.operationNo || 0)).map(serializeOperation);
  };
}
