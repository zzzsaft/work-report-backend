CREATE TABLE IF NOT EXISTS "work_report"."operation_worker_assignments" (
  "id"              TEXT             NOT NULL,
  "operation_code"  TEXT             NOT NULL,
  "operation_note"  TEXT             NOT NULL DEFAULT '',
  "worker_id"        TEXT             NOT NULL,
  "worker_name"      TEXT             NOT NULL,
  "created_at"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "operation_worker_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "operation_worker_assignments_operation_code_worker_id_key"
  ON "work_report"."operation_worker_assignments"("operation_code", "worker_id");

CREATE INDEX IF NOT EXISTS "operation_worker_assignments_operation_code_idx"
  ON "work_report"."operation_worker_assignments"("operation_code");

CREATE INDEX IF NOT EXISTS "operation_worker_assignments_worker_id_idx"
  ON "work_report"."operation_worker_assignments"("worker_id");
