-- Add original product fields to operation_pool
ALTER TABLE "work_report"."operation_pool" ADD COLUMN IF NOT EXISTS "cpnum" TEXT NOT NULL DEFAULT '';
ALTER TABLE "work_report"."operation_pool" ADD COLUMN IF NOT EXISTS "cpdes" TEXT NOT NULL DEFAULT '';
