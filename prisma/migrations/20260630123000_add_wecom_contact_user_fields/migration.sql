ALTER TABLE "work_report"."users"
  ADD COLUMN "department" JSONB,
  ADD COLUMN "department_order" JSONB,
  ADD COLUMN "position" TEXT,
  ADD COLUMN "is_leader_in_dept" JSONB,
  ADD COLUMN "direct_leader" JSONB,
  ADD COLUMN "telephone" TEXT,
  ADD COLUMN "alias" TEXT,
  ADD COLUMN "extattr" JSONB,
  ADD COLUMN "wecom_status" INTEGER,
  ADD COLUMN "external_profile" JSONB,
  ADD COLUMN "external_position" TEXT,
  ADD COLUMN "open_userid" TEXT,
  ADD COLUMN "main_department" INTEGER;
