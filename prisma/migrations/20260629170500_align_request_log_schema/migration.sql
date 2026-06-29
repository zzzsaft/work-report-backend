CREATE TABLE IF NOT EXISTS "work_report"."express_request_logs" (
  "id" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "original_url" TEXT NOT NULL,
  "status_code" INTEGER NOT NULL,
  "duration_ms" INTEGER NOT NULL,
  "ip" TEXT,
  "user_agent" TEXT,
  "user_id" TEXT,
  "request_body" JSONB,
  "response_body" JSONB,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "express_request_logs_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report' AND table_name = 'express_request_logs' AND column_name = 'originalUrl'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report' AND table_name = 'express_request_logs' AND column_name = 'original_url'
  ) THEN
    ALTER TABLE "work_report"."express_request_logs" RENAME COLUMN "originalUrl" TO "original_url";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report' AND table_name = 'express_request_logs' AND column_name = 'statusCode'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report' AND table_name = 'express_request_logs' AND column_name = 'status_code'
  ) THEN
    ALTER TABLE "work_report"."express_request_logs" RENAME COLUMN "statusCode" TO "status_code";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report' AND table_name = 'express_request_logs' AND column_name = 'durationMs'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report' AND table_name = 'express_request_logs' AND column_name = 'duration_ms'
  ) THEN
    ALTER TABLE "work_report"."express_request_logs" RENAME COLUMN "durationMs" TO "duration_ms";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report' AND table_name = 'express_request_logs' AND column_name = 'userAgent'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report' AND table_name = 'express_request_logs' AND column_name = 'user_agent'
  ) THEN
    ALTER TABLE "work_report"."express_request_logs" RENAME COLUMN "userAgent" TO "user_agent";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report' AND table_name = 'express_request_logs' AND column_name = 'userId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report' AND table_name = 'express_request_logs' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE "work_report"."express_request_logs" RENAME COLUMN "userId" TO "user_id";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report' AND table_name = 'express_request_logs' AND column_name = 'requestBody'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report' AND table_name = 'express_request_logs' AND column_name = 'request_body'
  ) THEN
    ALTER TABLE "work_report"."express_request_logs" RENAME COLUMN "requestBody" TO "request_body";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report' AND table_name = 'express_request_logs' AND column_name = 'responseBody'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report' AND table_name = 'express_request_logs' AND column_name = 'response_body'
  ) THEN
    ALTER TABLE "work_report"."express_request_logs" RENAME COLUMN "responseBody" TO "response_body";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report' AND table_name = 'express_request_logs' AND column_name = 'errorMessage'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report' AND table_name = 'express_request_logs' AND column_name = 'error_message'
  ) THEN
    ALTER TABLE "work_report"."express_request_logs" RENAME COLUMN "errorMessage" TO "error_message";
  END IF;
END $$;

ALTER TABLE "work_report"."express_request_logs" ADD COLUMN IF NOT EXISTS "original_url" TEXT NOT NULL DEFAULT '';
ALTER TABLE "work_report"."express_request_logs" ADD COLUMN IF NOT EXISTS "status_code" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "work_report"."express_request_logs" ADD COLUMN IF NOT EXISTS "duration_ms" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "work_report"."express_request_logs" ADD COLUMN IF NOT EXISTS "user_agent" TEXT;
ALTER TABLE "work_report"."express_request_logs" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "work_report"."express_request_logs" ADD COLUMN IF NOT EXISTS "request_body" JSONB;
ALTER TABLE "work_report"."express_request_logs" ADD COLUMN IF NOT EXISTS "response_body" JSONB;
ALTER TABLE "work_report"."express_request_logs" ADD COLUMN IF NOT EXISTS "error_message" TEXT;

CREATE TABLE IF NOT EXISTS "work_report"."axios_request_logs" (
  "id" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "base_url" TEXT,
  "status_code" INTEGER,
  "duration_ms" INTEGER NOT NULL,
  "request_body" JSONB,
  "response_body" JSONB,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "axios_request_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "express_request_logs_created_at_idx" ON "work_report"."express_request_logs"("created_at");
CREATE INDEX IF NOT EXISTS "express_request_logs_method_path_idx" ON "work_report"."express_request_logs"("method", "path");
CREATE INDEX IF NOT EXISTS "express_request_logs_status_code_idx" ON "work_report"."express_request_logs"("status_code");
CREATE INDEX IF NOT EXISTS "express_request_logs_user_id_idx" ON "work_report"."express_request_logs"("user_id");

CREATE INDEX IF NOT EXISTS "axios_request_logs_created_at_idx" ON "work_report"."axios_request_logs"("created_at");
CREATE INDEX IF NOT EXISTS "axios_request_logs_method_url_idx" ON "work_report"."axios_request_logs"("method", "url");
CREATE INDEX IF NOT EXISTS "axios_request_logs_status_code_idx" ON "work_report"."axios_request_logs"("status_code");
