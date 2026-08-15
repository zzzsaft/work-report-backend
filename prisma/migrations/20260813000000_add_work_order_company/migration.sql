ALTER TABLE "work_report"."work_orders" ADD COLUMN "company" TEXT;

CREATE INDEX IF NOT EXISTS "work_orders_company_idx" ON "work_report"."work_orders"("company");
