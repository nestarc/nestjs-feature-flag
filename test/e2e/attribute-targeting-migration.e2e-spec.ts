import { readFileSync } from 'node:fs';

import {
  getPrisma,
  disconnectPrisma,
  cleanDatabase,
} from './helpers/prisma-test.helper';

describe('attribute targeting migration schema (e2e)', () => {
  const prisma = getPrisma();

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const migrationSql = readFileSync(
    'prisma/migrations/20260512000000_attribute_targeting/migration.sql',
    'utf8',
  );

  async function createFlag(key: string) {
    return prisma.featureFlag.create({
      data: {
        key,
        enabled: true,
        percentage: 0,
        metadata: {},
      },
    });
  }

  function uuidLiteral(id: string): string {
    expect(id).toMatch(uuidPattern);
    return `'${id}'::uuid`;
  }

  function rethrowConstraintName(insertSql: string): string {
    return `
      DO $$
      DECLARE
        constraint_name text;
      BEGIN
        ${insertSql};
      EXCEPTION
        WHEN check_violation OR unique_violation THEN
          GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
          RAISE EXCEPTION '%', constraint_name;
      END $$;
    `;
  }

  function splitSqlStatements(sql: string): string[] {
    return sql
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
  }

  function quoteIdentifier(identifier: string): string {
    expect(identifier).toMatch(/^[a-z][a-z0-9_]*$/);
    return `"${identifier}"`;
  }

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('should expose attributes and priority columns on feature_flag_overrides', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'feature_flag_overrides'
      ORDER BY column_name
    `;

    const columnNames = columns.map((column) => column.column_name);
    expect(columnNames).toContain('attributes');
    expect(columnNames).toContain('priority');
    expect(columnNames).not.toContain('tenant_id');
    expect(columnNames).not.toContain('user_id');
    expect(columnNames).not.toContain('environment');
  });

  it('should enforce non-empty attributes', async () => {
    const flag = await createFlag('MIGRATION_EMPTY_ATTRIBUTES');

    await expect(
      prisma.$executeRawUnsafe(
        rethrowConstraintName(`
          INSERT INTO feature_flag_overrides (flag_id, attributes, priority, enabled)
          VALUES (${uuidLiteral(flag.id)}, '{}'::jsonb, 0, true)
        `),
      ),
    ).rejects.toThrow('chk_feature_flag_override_attributes_non_empty');
  });

  it('should enforce object attributes', async () => {
    const flag = await createFlag('MIGRATION_OBJECT_ATTRIBUTES');

    await expect(
      prisma.$executeRawUnsafe(
        rethrowConstraintName(`
          INSERT INTO feature_flag_overrides (flag_id, attributes, priority, enabled)
          VALUES (${uuidLiteral(flag.id)}, '[]'::jsonb, 0, true)
        `),
      ),
    ).rejects.toThrow('chk_feature_flag_override_attributes_non_empty');
  });

  it('should enforce one override per flag and attributes object', async () => {
    const flag = await createFlag('MIGRATION_UNIQUE_ATTRIBUTES');

    await prisma.$executeRaw`
      INSERT INTO feature_flag_overrides (flag_id, attributes, priority, enabled)
      VALUES (${flag.id}::uuid, '{"tenantId":"t-1"}'::jsonb, 0, true)
    `;

    await expect(
      prisma.$executeRawUnsafe(
        rethrowConstraintName(`
          INSERT INTO feature_flag_overrides (flag_id, attributes, priority, enabled)
          VALUES (${uuidLiteral(flag.id)}, '{"tenantId":"t-1"}'::jsonb, 10, false)
        `),
      ),
    ).rejects.toThrow('uq_feature_flag_override_attributes');
  });

  it('should migrate legacy override data into attribute targeting rows', async () => {
    const schemaName = `attribute_migration_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const schemaIdentifier = quoteIdentifier(schemaName);

    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`CREATE SCHEMA ${schemaIdentifier}`);
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${schemaIdentifier}, public`);
        await tx.$executeRawUnsafe(`
          CREATE TABLE "feature_flag_overrides" (
            "id" UUID NOT NULL,
            "flag_id" UUID NOT NULL,
            "tenant_id" TEXT,
            "user_id" TEXT,
            "environment" TEXT,
            "enabled" BOOLEAN NOT NULL,
            "created_at" TIMESTAMPTZ NOT NULL,
            "updated_at" TIMESTAMPTZ NOT NULL,
            CONSTRAINT "feature_flag_overrides_pkey" PRIMARY KEY ("id")
          )
        `);

        await tx.$executeRawUnsafe(`
          INSERT INTO "feature_flag_overrides"
            ("id", "flag_id", "tenant_id", "user_id", "environment", "enabled", "created_at", "updated_at")
          VALUES
            (
              '00000000-0000-4000-8000-000000000101'::uuid,
              '00000000-0000-4000-8000-000000000001'::uuid,
              'tenant-1',
              'user-1',
              'production',
              true,
              '2026-01-01T00:00:00Z'::timestamptz,
              '2026-01-01T00:00:00Z'::timestamptz
            ),
            (
              '00000000-0000-4000-8000-000000000102'::uuid,
              '00000000-0000-4000-8000-000000000001'::uuid,
              NULL,
              NULL,
              NULL,
              false,
              '2026-01-02T00:00:00Z'::timestamptz,
              '2026-01-02T00:00:00Z'::timestamptz
            ),
            (
              '00000000-0000-4000-8000-000000000103'::uuid,
              '00000000-0000-4000-8000-000000000002'::uuid,
              'tenant-duplicate',
              NULL,
              NULL,
              false,
              '2026-01-03T00:00:00Z'::timestamptz,
              '2026-01-03T00:00:00Z'::timestamptz
            ),
            (
              '00000000-0000-4000-8000-000000000104'::uuid,
              '00000000-0000-4000-8000-000000000002'::uuid,
              'tenant-duplicate',
              NULL,
              NULL,
              true,
              '2026-01-04T00:00:00Z'::timestamptz,
              '2026-01-04T00:00:00Z'::timestamptz
            )
        `);

        for (const statement of splitSqlStatements(migrationSql)) {
          await tx.$executeRawUnsafe(statement);
        }

        const columns = await tx.$queryRaw<Array<{ column_name: string }>>`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = ${schemaName}
            AND table_name = 'feature_flag_overrides'
          ORDER BY column_name
        `;

        expect(columns.map((column) => column.column_name)).toEqual([
          'attributes',
          'created_at',
          'enabled',
          'flag_id',
          'id',
          'priority',
          'updated_at',
        ]);

        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            attributes: unknown;
            priority: number;
            enabled: boolean;
          }>
        >`
          SELECT id::text, attributes, priority, enabled
          FROM "feature_flag_overrides"
          ORDER BY id
        `;

        expect(rows).toEqual([
          {
            id: '00000000-0000-4000-8000-000000000101',
            attributes: {
              tenantId: 'tenant-1',
              userId: 'user-1',
              environment: 'production',
            },
            priority: 0,
            enabled: true,
          },
          {
            id: '00000000-0000-4000-8000-000000000104',
            attributes: {
              tenantId: 'tenant-duplicate',
            },
            priority: 0,
            enabled: true,
          },
        ]);
      });
    } finally {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${schemaIdentifier} CASCADE`);
    }
  });
});
