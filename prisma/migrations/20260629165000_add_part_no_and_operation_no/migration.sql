ALTER TABLE "work_report"."work_order_parts" ADD COLUMN IF NOT EXISTS "part_no" TEXT;
ALTER TABLE "work_report"."operation_pool" ADD COLUMN IF NOT EXISTS "operation_no" TEXT;
