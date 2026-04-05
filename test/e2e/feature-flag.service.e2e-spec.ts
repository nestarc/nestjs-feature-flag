import { Test, TestingModule } from '@nestjs/testing';
import { FeatureFlagModule } from '../../src/feature-flag.module';
import { FeatureFlagService } from '../../src/services/feature-flag.service';
import { getPrisma, cleanDatabase, disconnectPrisma } from './helpers/prisma-test.helper';

describe('FeatureFlagService (integration)', () => {
  let module: TestingModule;
  let service: FeatureFlagService;
  const prisma = getPrisma();

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        FeatureFlagModule.forRoot({
          environment: 'test',
          prisma,
          cacheTtlMs: 0,
        }),
      ],
    }).compile();

    service = module.get(FeatureFlagService);
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await module.close();
    await disconnectPrisma();
  });

  describe('CRUD', () => {
    it('should create and retrieve a flag', async () => {
      const created = await service.create({
        key: 'TEST_FLAG',
        enabled: true,
        description: 'A test flag',
      });

      expect(created.key).toBe('TEST_FLAG');
      expect(created.enabled).toBe(true);

      const all = await service.findAll();
      expect(all).toHaveLength(1);
      expect(all[0].key).toBe('TEST_FLAG');
    });

    it('should update a flag', async () => {
      await service.create({ key: 'UPD_FLAG', enabled: false });
      const updated = await service.update('UPD_FLAG', { enabled: true });
      expect(updated.enabled).toBe(true);
    });

    it('should archive a flag and exclude from findAll', async () => {
      await service.create({ key: 'ARC_FLAG' });
      const archived = await service.archive('ARC_FLAG');
      expect(archived.archivedAt).not.toBeNull();

      const all = await service.findAll();
      expect(all).toHaveLength(0);
    });
  });

  describe('evaluation', () => {
    it('should return false for a disabled flag', async () => {
      await service.create({ key: 'DISABLED', enabled: false });
      expect(await service.isEnabled('DISABLED')).toBe(false);
    });

    it('should return true for an enabled flag', async () => {
      await service.create({ key: 'ENABLED', enabled: true });
      expect(await service.isEnabled('ENABLED')).toBe(true);
    });

    it('should return false (defaultOnMissing) for non-existent flag', async () => {
      expect(await service.isEnabled('DOES_NOT_EXIST')).toBe(false);
    });

    it('should return false for an archived flag', async () => {
      await service.create({ key: 'ARCHIVED', enabled: true });
      await service.archive('ARCHIVED');
      expect(await service.isEnabled('ARCHIVED')).toBe(false);
    });

    it('should evaluate all active flags', async () => {
      await service.create({ key: 'FLAG_A', enabled: true });
      await service.create({ key: 'FLAG_B', enabled: false });

      const result = await service.evaluateAll();
      expect(result).toEqual({ FLAG_A: true, FLAG_B: false });
    });
  });

  describe('overrides', () => {
    it('should apply a user override', async () => {
      await service.create({ key: 'USR_FLAG', enabled: false });
      await service.setOverride('USR_FLAG', { userId: 'user-1', enabled: true });

      expect(await service.isEnabled('USR_FLAG', { userId: 'user-1' })).toBe(true);
      expect(await service.isEnabled('USR_FLAG')).toBe(false);
    });

    it('should apply a tenant override', async () => {
      await service.create({ key: 'TNT_FLAG', enabled: false });
      await service.setOverride('TNT_FLAG', { tenantId: 'tenant-1', enabled: true });

      expect(await service.isEnabled('TNT_FLAG', { tenantId: 'tenant-1' })).toBe(true);
    });

    it('should apply an environment override', async () => {
      await service.create({ key: 'ENV_FLAG', enabled: false });
      await service.setOverride('ENV_FLAG', { environment: 'test', enabled: true });

      expect(await service.isEnabled('ENV_FLAG')).toBe(true);
    });

    it('should update existing override instead of creating a duplicate', async () => {
      await service.create({ key: 'DUP_FLAG', enabled: false });
      await service.setOverride('DUP_FLAG', { userId: 'user-1', enabled: true });
      await service.setOverride('DUP_FLAG', { userId: 'user-1', enabled: false });

      expect(await service.isEnabled('DUP_FLAG', { userId: 'user-1' })).toBe(false);

      const flag = await prisma.featureFlag.findUnique({
        where: { key: 'DUP_FLAG' },
        include: { overrides: true },
      });
      const userOverrides = flag!.overrides.filter((o: any) => o.userId === 'user-1');
      expect(userOverrides).toHaveLength(1);
    });

    it('should enforce uniqueness for global override (all NULLs)', async () => {
      await service.create({ key: 'NULL_FLAG', enabled: false });
      await service.setOverride('NULL_FLAG', { enabled: true });
      await service.setOverride('NULL_FLAG', { enabled: false });

      const flag = await prisma.featureFlag.findUnique({
        where: { key: 'NULL_FLAG' },
        include: { overrides: true },
      });
      expect(flag!.overrides).toHaveLength(1);
      expect(flag!.overrides[0].enabled).toBe(false);
    });
  });

  describe('percentage rollout', () => {
    it('should deterministically evaluate per user', async () => {
      await service.create({ key: 'PCT_FLAG', enabled: false, percentage: 50 });

      const result1 = await service.isEnabled('PCT_FLAG', { userId: 'user-1' });
      const result2 = await service.isEnabled('PCT_FLAG', { userId: 'user-1' });
      expect(result1).toBe(result2);
    });
  });
});
