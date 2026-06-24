CREATE TABLE "work_report"."express_request_logs" (
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

CREATE TABLE "work_report"."axios_request_logs" (
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

CREATE INDEX "express_request_logs_created_at_idx" ON "work_report"."express_request_logs"("created_at");
CREATE INDEX "express_request_logs_method_path_idx" ON "work_report"."express_request_logs"("method", "path");
CREATE INDEX "express_request_logs_status_code_idx" ON "work_report"."express_request_logs"("status_code");
CREATE INDEX "express_request_logs_user_id_idx" ON "work_report"."express_request_logs"("user_id");

CREATE INDEX "axios_request_logs_created_at_idx" ON "work_report"."axios_request_logs"("created_at");
CREATE INDEX "axios_request_logs_method_url_idx" ON "work_report"."axios_request_logs"("method", "url");
CREATE INDEX "axios_request_logs_status_code_idx" ON "work_report"."axios_request_logs"("status_code");
