import {
  getPrisma,
  disconnectPrisma,
  cleanDatabase,
} from './helpers/prisma-test.helper';

describe('attribute targeting migration schema (e2e)', () => {
  const prisma = getPrisma();

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
    const flag = await prisma.featureFlag.create({
      data: {
        key: 'MIGRATION_EMPTY_ATTRIBUTES',
        enabled: true,
        percentage: 0,
        metadata: {},
      },
    });

    await expect(
      prisma.$executeRaw`
        INSERT INTO feature_flag_overrides (flag_id, attributes, priority, enabled)
        VALUES (${flag.id}::uuid, '{}'::jsonb, 0, true)
      `,
    ).rejects.toThrow();
  });

  it('should enforce one override per flag and attributes object', async () => {
    const flag = await prisma.featureFlag.create({
      data: {
        key: 'MIGRATION_UNIQUE_ATTRIBUTES',
        enabled: true,
        percentage: 0,
        metadata: {},
      },
    });

    await prisma.$executeRaw`
      INSERT INTO feature_flag_overrides (flag_id, attributes, priority, enabled)
      VALUES (${flag.id}::uuid, '{"tenantId":"t-1"}'::jsonb, 0, true)
    `;

    await expect(
      prisma.$executeRaw`
        INSERT INTO feature_flag_overrides (flag_id, attributes, priority, enabled)
        VALUES (${flag.id}::uuid, '{"tenantId":"t-1"}'::jsonb, 10, false)
      `,
    ).rejects.toThrow();
  });
});
