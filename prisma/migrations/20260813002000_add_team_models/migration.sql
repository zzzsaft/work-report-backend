-- Step 1: Create teams table
CREATE TABLE IF NOT EXISTS work_report.teams (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT teams_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS teams_name_key ON work_report.teams (name);

-- Step 2: Create team_operation_assignments table
CREATE TABLE IF NOT EXISTS work_report.team_operation_assignments (
  id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  operation_code TEXT NOT NULL,
  operation_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT team_operation_assignments_pkey PRIMARY KEY (id),
  CONSTRAINT team_operation_assignments_team_id_fkey FOREIGN KEY (team_id)
    REFERENCES work_report.teams (id) ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS team_operation_assignments_team_id_operation_code_key
  ON work_report.team_operation_assignments (team_id, operation_code);
CREATE INDEX IF NOT EXISTS team_operation_assignments_team_id_idx
  ON work_report.team_operation_assignments (team_id);
CREATE INDEX IF NOT EXISTS team_operation_assignments_operation_code_idx
  ON work_report.team_operation_assignments (operation_code);

-- Step 3: Add team_id column to users table
ALTER TABLE work_report.users ADD COLUMN IF NOT EXISTS team_id TEXT;
CREATE INDEX IF NOT EXISTS users_team_id_idx ON work_report.users (team_id);

-- Step 4: Migrate existing team names to teams table
INSERT INTO work_report.teams (id, name, description, created_at, updated_at)
SELECT
  'team-' || LOWER(REPLACE(REPLACE(team_name, ' ', '-'), '/', '-')),
  team_name,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT team_name
  FROM work_report.users
  WHERE team_name IS NOT NULL AND team_name != ''
) AS distinct_teams
WHERE NOT EXISTS (
  SELECT 1 FROM work_report.teams t WHERE t.name = distinct_teams.team_name
);

-- Step 5: Link users to their teams
UPDATE work_report.users u
SET team_id = t.id
FROM work_report.teams t
WHERE u.team_name = t.name
  AND u.team_id IS NULL;

-- Step 6: Migrate operation_worker_assignments to team_operation_assignments
-- Map workers to their teams, then aggregate operations per team
INSERT INTO work_report.team_operation_assignments (id, team_id, operation_code, operation_name, created_at, updated_at)
SELECT DISTINCT ON (w.team_id, owa.operation_code)
  gen_random_uuid()::text as id,
  w.team_id,
  owa.operation_code,
  owa.operation_name,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM work_report.operation_worker_assignments owa
INNER JOIN work_report.users w ON w.id = owa.worker_id
WHERE w.team_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM work_report.team_operation_assignments toa
    WHERE toa.team_id = w.team_id
      AND toa.operation_code = owa.operation_code
  );

-- Step 7: Set default team_id for users without team
INSERT INTO work_report.teams (id, name, description, created_at, updated_at)
VALUES ('team-default', '未分配班组', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (name) DO NOTHING;

UPDATE work_report.users
SET team_id = 'team-default'
WHERE team_id IS NULL;
