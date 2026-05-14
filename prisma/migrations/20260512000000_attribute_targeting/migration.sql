ALTER TABLE "feature_flag_overrides"
  ADD COLUMN "attributes" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "feature_flag_overrides"
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

UPDATE "feature_flag_overrides"
SET "attributes" = jsonb_strip_nulls(
  jsonb_build_object(
    'tenantId', "tenant_id",
    'userId', "user_id",
    'environment', "environment"
  )
);

-- v0.3.0 rejects empty targeting attributes. Legacy all-null/global overrides
-- become empty objects during backfill and are intentionally removed by this
-- breaking migration.
DELETE FROM "feature_flag_overrides"
WHERE "attributes" = '{}'::jsonb;

WITH ranked_overrides AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "flag_id", "attributes"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS row_number
  FROM "feature_flag_overrides"
)
DELETE FROM "feature_flag_overrides" target
USING ranked_overrides ranked
WHERE target."id" = ranked."id"
  AND ranked.row_number > 1;

DROP INDEX IF EXISTS "uq_override_000";
DROP INDEX IF EXISTS "uq_override_001";
DROP INDEX IF EXISTS "uq_override_010";
DROP INDEX IF EXISTS "uq_override_011";
DROP INDEX IF EXISTS "uq_override_100";
DROP INDEX IF EXISTS "uq_override_101";
DROP INDEX IF EXISTS "uq_override_110";
DROP INDEX IF EXISTS "uq_override_111";

ALTER TABLE "feature_flag_overrides"
  DROP COLUMN "tenant_id",
  DROP COLUMN "user_id",
  DROP COLUMN "environment";

CREATE UNIQUE INDEX "uq_feature_flag_override_attributes"
  ON "feature_flag_overrides"("flag_id", "attributes");

ALTER TABLE "feature_flag_overrides"
  ADD CONSTRAINT "chk_feature_flag_override_attributes_non_empty"
  CHECK (jsonb_typeof("attributes") = 'object' AND "attributes" <> '{}'::jsonb);
