CREATE TABLE IF NOT EXISTS "work_report"."wecom_departments" (
  "id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "department_id" INTEGER NOT NULL,
  "name" TEXT,
  "name_en" TEXT,
  "parent_id" INTEGER NOT NULL,
  "order_value" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wecom_departments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "work_report"."wecom_user_departments" (
  "client_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "department_id" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wecom_user_departments_pkey" PRIMARY KEY ("client_id", "user_id", "department_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wecom_departments_client_id_department_id_key"
  ON "work_report"."wecom_departments"("client_id", "department_id");

CREATE INDEX IF NOT EXISTS "wecom_departments_client_id_parent_id_idx"
  ON "work_report"."wecom_departments"("client_id", "parent_id");

CREATE INDEX IF NOT EXISTS "wecom_user_departments_client_id_department_id_idx"
  ON "work_report"."wecom_user_departments"("client_id", "department_id");

CREATE INDEX IF NOT EXISTS "wecom_user_departments_user_id_idx"
  ON "work_report"."wecom_user_departments"("user_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'work_report'
      AND table_name = 'wecom_user_departments'
      AND constraint_name = 'wecom_user_departments_client_id_department_id_fkey'
  ) THEN
    ALTER TABLE "work_report"."wecom_user_departments"
      ADD CONSTRAINT "wecom_user_departments_client_id_department_id_fkey"
      FOREIGN KEY ("client_id", "department_id")
      REFERENCES "work_report"."wecom_departments"("client_id", "department_id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
