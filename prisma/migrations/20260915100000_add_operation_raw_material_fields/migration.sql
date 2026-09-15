-- Fields may already exist after running add_operation_raw_material_fields.sql.
ALTER TABLE "work_report"."operation_pool" ADD COLUMN IF NOT EXISTS "ylpartnum" TEXT NOT NULL DEFAULT '';
ALTER TABLE "work_report"."operation_pool" ADD COLUMN IF NOT EXISTS "yldescription" TEXT NOT NULL DEFAULT '';
ALTER TABLE "work_report"."operation_pool" ADD COLUMN IF NOT EXISTS "mfgcomment" TEXT NOT NULL DEFAULT '';
