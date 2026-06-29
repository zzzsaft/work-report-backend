CREATE TABLE IF NOT EXISTS work_report.xft_integration_configs (
  id TEXT PRIMARY KEY DEFAULT 'default',
  host TEXT NOT NULL,
  appid TEXT NOT NULL,
  app_secret TEXT NOT NULL,
  enterprise_id TEXT NOT NULL,
  default_user_id TEXT NOT NULL DEFAULT 'U0000',
  default_platform_user_id TEXT NOT NULL DEFAULT 'AUTO0001',
  data_collection_name TEXT NOT NULL,
  import_type TEXT NOT NULL DEFAULT 'ADD',
  salary_period TEXT NOT NULL,
  work_hours_field_key TEXT NOT NULL,
  is_check_empty BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
