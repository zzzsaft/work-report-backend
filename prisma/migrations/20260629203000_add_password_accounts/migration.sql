ALTER TABLE "work_report"."users"
  ADD COLUMN "username" TEXT,
  ADD COLUMN "password_hash" TEXT,
  ADD COLUMN "last_login_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_username_key" ON "work_report"."users"("username");
