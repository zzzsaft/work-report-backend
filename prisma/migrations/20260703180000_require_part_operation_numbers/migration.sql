UPDATE "work_report"."work_order_parts"
SET "part_no" = "part_code"
WHERE "part_no" IS NULL OR btrim("part_no") = '';

UPDATE "work_report"."operation_pool"
SET "operation_no" = "operation_code"
WHERE "operation_no" IS NULL OR btrim("operation_no") = '';

ALTER TABLE "work_report"."work_order_parts"
  ALTER COLUMN "part_no" SET NOT NULL;

ALTER TABLE "work_report"."operation_pool"
  ALTER COLUMN "operation_no" SET NOT NULL;

ALTER TABLE "work_report"."work_order_parts"
  DROP CONSTRAINT IF EXISTS "work_order_parts_work_order_id_part_code_key";

ALTER TABLE "work_report"."operation_pool"
  DROP CONSTRAINT IF EXISTS "operation_pool_work_order_id_part_id_operation_code_key";

CREATE UNIQUE INDEX IF NOT EXISTS "work_order_parts_work_order_id_part_no_key"
  ON "work_report"."work_order_parts" ("work_order_id", "part_no");

CREATE UNIQUE INDEX IF NOT EXISTS "operation_pool_work_order_id_part_id_operation_no_key"
  ON "work_report"."operation_pool" ("work_order_id", "part_id", "operation_no");
