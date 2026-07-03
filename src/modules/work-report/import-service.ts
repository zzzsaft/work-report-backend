import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import type { AuthenticatedUser } from "../../middleware/auth.js";
import { OPERATION_POOL_STATUS } from "./constants.js";

export const MAX_IMPORT_OPERATIONS = 40000;

const BULK_IMPORT_BATCH_SIZE = 1000;

export interface ThirdPartyImportOperation {
  orderNo: string;
  productCode: string;
  productName: string;
  partNo: string;
  partCode: string;
  partName: string;
  operationNo: string;
  operationCode: string;
  operationName: string;
  estimatedHours: number;
  operationNote?: string;
  plannedQuantity?: number;
  dueDate?: string | null;
  status?: "available" | "closed";
}

interface NormalizedThirdPartyImportOperation extends Omit<ThirdPartyImportOperation, "dueDate" | "operationNote" | "plannedQuantity" | "status"> {
  row: number;
  plannedQuantity: number;
  dueDate: Date;
  operationNote: string;
  status: "available" | "closed";
}

interface ImportResultItem {
  row: number;
  operationId: string;
  orderNo: string;
  partCode: string;
  operationCode: string;
}

interface ImportErrorItem {
  row: number;
  orderNo?: string;
  partCode?: string;
  operationCode?: string;
  message: string;
}

const chunkArray = <T>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const lastBy = <T>(items: T[], keyOf: (item: T) => string) => {
  const map = new Map<string, T>();
  for (const item of items) map.set(keyOf(item), item);
  return Array.from(map.values());
};

const normalizeThirdPartyOperations = (operations: ThirdPartyImportOperation[]) => {
  const normalized: NormalizedThirdPartyImportOperation[] = [];
  const errors: ImportErrorItem[] = [];

  for (const [index, item] of operations.entries()) {
    const row = index + 1;
    const plannedQuantity = item.plannedQuantity ?? 1;
    const dueDate = item.dueDate ? new Date(item.dueDate) : new Date();

    if (Number.isNaN(dueDate.getTime())) {
      errors.push({
        row,
        orderNo: item.orderNo,
        partCode: item.partCode,
        operationCode: item.operationCode,
        message: "交期格式无效"
      });
      continue;
    }

    normalized.push({
      ...item,
      row,
      plannedQuantity,
      dueDate,
      operationNote: item.operationNote ?? "",
      status: item.status ?? OPERATION_POOL_STATUS.available
    });
  }

  return { normalized, errors };
};

export class WorkReportImportService {
  constructor(private readonly db: PrismaClient) {}

  importThirdPartyOperations = async (operations: ThirdPartyImportOperation[], user: AuthenticatedUser) => {
    if (operations.length > MAX_IMPORT_OPERATIONS) {
      throw new AppError(400, `单次最多导入 ${MAX_IMPORT_OPERATIONS} 条工序`);
    }

    const { normalized, errors } = normalizeThirdPartyOperations(operations);
    const results: ImportResultItem[] = [];

    for (const batch of chunkArray(normalized, BULK_IMPORT_BATCH_SIZE)) {
      try {
        const batchResults = await this.db.$transaction(async (tx) => {
          const uniqueOrders = lastBy(batch, (item) => item.orderNo);
          const orderRows = uniqueOrders.map((item) => Prisma.sql`(
            ${randomUUID()},
            ${item.orderNo},
            ${item.productCode},
            ${item.productName},
            ${item.plannedQuantity},
            ${0},
            ${item.dueDate},
            ${"in_progress"},
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )`);

          await tx.$executeRaw`
            INSERT INTO work_report.work_orders (
              id, order_no, product_code, product_name, planned_quantity,
              completed_quantity, due_date, status, created_at, updated_at
            )
            VALUES ${Prisma.join(orderRows)}
            ON CONFLICT (order_no) DO UPDATE SET
              product_code = EXCLUDED.product_code,
              product_name = EXCLUDED.product_name,
              planned_quantity = EXCLUDED.planned_quantity,
              due_date = EXCLUDED.due_date,
              status = EXCLUDED.status,
              updated_at = CURRENT_TIMESTAMP
          `;

          const orders = await tx.workOrder.findMany({
            where: { orderNo: { in: uniqueOrders.map((item) => item.orderNo) } },
            select: { id: true, orderNo: true }
          });
          const orderIdByNo = new Map(orders.map((order) => [order.orderNo, order.id]));

          const uniqueParts = lastBy(batch, (item) => `${item.orderNo}\u0000${item.partCode}`);
          const partRows = uniqueParts.flatMap((item) => {
            const workOrderId = orderIdByNo.get(item.orderNo);
            if (!workOrderId) return [];

            return [Prisma.sql`(
              ${randomUUID()},
              ${workOrderId},
              ${item.partNo},
              ${item.partCode},
              ${item.partName},
              ${item.plannedQuantity},
              ${0},
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            )`];
          });

          if (partRows.length > 0) {
            await tx.$executeRaw`
              INSERT INTO work_report.work_order_parts (
                id, work_order_id, part_no, part_code, part_name,
                planned_quantity, completed_quantity, created_at, updated_at
              )
              VALUES ${Prisma.join(partRows)}
              ON CONFLICT (work_order_id, part_code) DO UPDATE SET
                part_no = EXCLUDED.part_no,
                part_name = EXCLUDED.part_name,
                planned_quantity = EXCLUDED.planned_quantity,
                updated_at = CURRENT_TIMESTAMP
            `;
          }

          const parts = await tx.workOrderPart.findMany({
            where: {
              workOrderId: { in: Array.from(orderIdByNo.values()) },
              partCode: { in: uniqueParts.map((item) => item.partCode) }
            },
            select: { id: true, workOrderId: true, partCode: true }
          });
          const partIdByOrderAndCode = new Map(
            parts.map((part) => [`${part.workOrderId}\u0000${part.partCode}`, part.id])
          );

          const validOperations = batch.flatMap((item) => {
            const workOrderId = orderIdByNo.get(item.orderNo);
            const partId = workOrderId ? partIdByOrderAndCode.get(`${workOrderId}\u0000${item.partCode}`) : undefined;
            if (!workOrderId || !partId) return [];
            return [{ item, workOrderId, partId }];
          });
          const uniqueOperations = lastBy(
            validOperations,
            ({ item, workOrderId, partId }) => `${workOrderId}\u0000${partId}\u0000${item.operationCode}`
          );

          const operationRows = uniqueOperations.map(({ item, workOrderId, partId }) => Prisma.sql`(
            ${randomUUID()},
            ${workOrderId},
            ${partId},
            ${item.operationNo},
            ${item.operationCode},
            ${item.operationName},
            ${item.operationNote},
            ${item.plannedQuantity},
            ${item.plannedQuantity},
            ${item.estimatedHours},
            ${item.status},
            ${"third_party"},
            ${user.id},
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )`);

          if (operationRows.length > 0) {
            await tx.$executeRaw`
              INSERT INTO work_report.operation_pool (
                id, work_order_id, part_id, operation_no, operation_code,
                operation_name, operation_note, planned_quantity, remaining_quantity,
                estimated_hours, status, source, created_by, created_at, updated_at
              )
              VALUES ${Prisma.join(operationRows)}
              ON CONFLICT (work_order_id, part_id, operation_code) DO UPDATE SET
                operation_no = EXCLUDED.operation_no,
                operation_name = EXCLUDED.operation_name,
                operation_note = EXCLUDED.operation_note,
                planned_quantity = EXCLUDED.planned_quantity,
                remaining_quantity = EXCLUDED.remaining_quantity,
                estimated_hours = EXCLUDED.estimated_hours,
                status = EXCLUDED.status,
                updated_at = CURRENT_TIMESTAMP
            `;
          }

          const operationKeyConditions = uniqueOperations.map(
            ({ item, workOrderId, partId }) =>
              Prisma.sql`(work_order_id = ${workOrderId} AND part_id = ${partId} AND operation_code = ${item.operationCode})`
          );

          const importedOperations =
            operationKeyConditions.length > 0
              ? await tx.$queryRaw<
                  { id: string; work_order_id: string; part_id: string; operation_code: string }[]
                >`
                  SELECT id, work_order_id::text, part_id::text, operation_code
                  FROM work_report.operation_pool
                  WHERE ${Prisma.join(operationKeyConditions, " OR ")}
                `
              : [];

          const operationIdByKey = new Map(
            importedOperations.map((operation) => [
              `${operation.work_order_id}\u0000${operation.part_id}\u0000${operation.operation_code}`,
              operation.id
            ])
          );

          return validOperations.flatMap(({ item, workOrderId, partId }) => {
            const operationId = operationIdByKey.get(`${workOrderId}\u0000${partId}\u0000${item.operationCode}`);
            if (!operationId) return [];

            return [{
              row: item.row,
              operationId,
              orderNo: item.orderNo,
              partCode: item.partCode,
              operationCode: item.operationCode
            }];
          });
        });

        results.push(...batchResults);
      } catch (error) {
        for (const item of batch) {
          errors.push({
            row: item.row,
            orderNo: item.orderNo,
            partCode: item.partCode,
            operationCode: item.operationCode,
            message: error instanceof Error ? error.message : "导入失败"
          });
        }
      }
    }

    return {
      accepted: results.length,
      rejected: errors.length,
      items: results,
      errors
    };
  };
}
