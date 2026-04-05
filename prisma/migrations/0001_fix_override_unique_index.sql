-- Drop the old unique constraint that does not handle NULLs correctly
ALTER TABLE feature_flag_overrides DROP CONSTRAINT IF EXISTS uq_override_context;

-- Create partial unique indexes for each NULL/NOT-NULL combination.
-- PostgreSQL's WHERE clause ensures NULL columns are matched with IS NULL,
-- so each index covers exactly one shape of override context.

-- All three nullable columns are NULL (global override per flag)
CREATE UNIQUE INDEX uq_override_000
  ON feature_flag_overrides (flag_id)
  WHERE tenant_id IS NULL AND user_id IS NULL AND environment IS NULL;

-- Only environment is NOT NULL
CREATE UNIQUE INDEX uq_override_001
  ON feature_flag_overrides (flag_id, environment)
  WHERE tenant_id IS NULL AND user_id IS NULL AND environment IS NOT NULL;

-- Only user_id is NOT NULL
CREATE UNIQUE INDEX uq_override_010
  ON feature_flag_overrides (flag_id, user_id)
  WHERE tenant_id IS NULL AND user_id IS NOT NULL AND environment IS NULL;

-- user_id and environment are NOT NULL
CREATE UNIQUE INDEX uq_override_011
  ON feature_flag_overrides (flag_id, user_id, environment)
  WHERE tenant_id IS NULL AND user_id IS NOT NULL AND environment IS NOT NULL;

-- Only tenant_id is NOT NULL
CREATE UNIQUE INDEX uq_override_100
  ON feature_flag_overrides (flag_id, tenant_id)
  WHERE tenant_id IS NOT NULL AND user_id IS NULL AND environment IS NULL;

-- tenant_id and environment are NOT NULL
CREATE UNIQUE INDEX uq_override_101
  ON feature_flag_overrides (flag_id, tenant_id, environment)
  WHERE tenant_id IS NOT NULL AND user_id IS NULL AND environment IS NOT NULL;

-- tenant_id and user_id are NOT NULL
CREATE UNIQUE INDEX uq_override_110
  ON feature_flag_overrides (flag_id, tenant_id, user_id)
  WHERE tenant_id IS NOT NULL AND user_id IS NOT NULL AND environment IS NULL;

-- All three are NOT NULL
CREATE UNIQUE INDEX uq_override_111
  ON feature_flag_overrides (flag_id, tenant_id, user_id, environment)
  WHERE tenant_id IS NOT NULL AND user_id IS NOT NULL AND environment IS NOT NULL;
