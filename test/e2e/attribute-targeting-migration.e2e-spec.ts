import {
  getPrisma,
  disconnectPrisma,
  cleanDatabase,
} from './helpers/prisma-test.helper';

describe('attribute targeting migration schema (e2e)', () => {
  const prisma = getPrisma();

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
});
