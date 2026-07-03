ALTER TABLE "work_report"."operation_assignments"
  ADD COLUMN IF NOT EXISTS "actual_start_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "actual_end_at" TIMESTAMP(3);
