-- Step 1: Update all existing work orders to set company = 'jctimes'
UPDATE work_report.work_orders SET company = 'jctimes' WHERE company IS NULL;

-- Step 2: Drop the old unique constraint on order_no
-- Prisma creates a unique index named work_orders_order_no_key for @unique fields
DROP INDEX IF EXISTS work_report.work_orders_order_no_key;

-- Step 3: Create the new composite unique index on (order_no, company)
CREATE UNIQUE INDEX IF NOT EXISTS work_orders_order_no_company_idx
  ON work_report.work_orders (order_no, company);
