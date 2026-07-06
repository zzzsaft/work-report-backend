ALTER TABLE "work_report"."wecom_departments"
  ADD COLUMN IF NOT EXISTS "department_leader" JSONB;
