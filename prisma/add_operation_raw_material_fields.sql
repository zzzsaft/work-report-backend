-- =====================================================================
-- 工序表(operation_pool)新增原料及原产品相关字段
--   ylpartnum      原料编号
--   yldescription  原料描述
--   mfgcomment     原料备注
--   cpnum          原产品编号
--   cpdes          原产品描述
-- 说明：幂等脚本，可重复执行；仅在列不存在时执行 ADD COLUMN。
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report'
      AND table_name = 'operation_pool'
      AND column_name = 'ylpartnum'
  ) THEN
    ALTER TABLE "work_report"."operation_pool"
      ADD COLUMN "ylpartnum" TEXT NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report'
      AND table_name = 'operation_pool'
      AND column_name = 'yldescription'
  ) THEN
    ALTER TABLE "work_report"."operation_pool"
      ADD COLUMN "yldescription" TEXT NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report'
      AND table_name = 'operation_pool'
      AND column_name = 'mfgcomment'
  ) THEN
    ALTER TABLE "work_report"."operation_pool"
      ADD COLUMN "mfgcomment" TEXT NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report'
      AND table_name = 'operation_pool'
      AND column_name = 'cpnum'
  ) THEN
    ALTER TABLE "work_report"."operation_pool"
      ADD COLUMN "cpnum" TEXT NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'work_report'
      AND table_name = 'operation_pool'
      AND column_name = 'cpdes'
  ) THEN
    ALTER TABLE "work_report"."operation_pool"
      ADD COLUMN "cpdes" TEXT NOT NULL DEFAULT '';
  END IF;
END $$;
