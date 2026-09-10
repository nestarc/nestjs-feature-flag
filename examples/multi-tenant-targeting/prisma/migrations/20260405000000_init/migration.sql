-- CreateTable
CREATE TABLE "feature_flags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "percentage" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flag_overrides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "flag_id" UUID NOT NULL,
    "tenant_id" TEXT,
    "user_id" TEXT,
    "environment" TEXT,
    "enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "feature_flag_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- CreateIndex
CREATE INDEX "idx_override_flag_id" ON "feature_flag_overrides"("flag_id");

-- AddForeignKey
ALTER TABLE "feature_flag_overrides"
    ADD CONSTRAINT "feature_flag_overrides_flag_id_fkey"
    FOREIGN KEY ("flag_id") REFERENCES "feature_flags"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique indexes for NULL-safe override uniqueness.
-- PostgreSQL treats NULL != NULL in standard unique constraints,
-- so we need one partial index per NULL/NOT-NULL combination.

CREATE UNIQUE INDEX uq_override_000
  ON feature_flag_overrides (flag_id)
  WHERE tenant_id IS NULL AND user_id IS NULL AND environment IS NULL;

CREATE UNIQUE INDEX uq_override_001
  ON feature_flag_overrides (flag_id, environment)
  WHERE tenant_id IS NULL AND user_id IS NULL AND environment IS NOT NULL;

CREATE UNIQUE INDEX uq_override_010
  ON feature_flag_overrides (flag_id, user_id)
  WHERE tenant_id IS NULL AND user_id IS NOT NULL AND environment IS NULL;

CREATE UNIQUE INDEX uq_override_011
  ON feature_flag_overrides (flag_id, user_id, environment)
  WHERE tenant_id IS NULL AND user_id IS NOT NULL AND environment IS NOT NULL;

CREATE UNIQUE INDEX uq_override_100
  ON feature_flag_overrides (flag_id, tenant_id)
  WHERE tenant_id IS NOT NULL AND user_id IS NULL AND environment IS NULL;

CREATE UNIQUE INDEX uq_override_101
  ON feature_flag_overrides (flag_id, tenant_id, environment)
  WHERE tenant_id IS NOT NULL AND user_id IS NULL AND environment IS NOT NULL;

CREATE UNIQUE INDEX uq_override_110
  ON feature_flag_overrides (flag_id, tenant_id, user_id)
  WHERE tenant_id IS NOT NULL AND user_id IS NOT NULL AND environment IS NULL;

CREATE UNIQUE INDEX uq_override_111
  ON feature_flag_overrides (flag_id, tenant_id, user_id, environment)
  WHERE tenant_id IS NOT NULL AND user_id IS NOT NULL AND environment IS NOT NULL;
