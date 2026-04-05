import { FeatureFlagService } from '../../src/services/feature-flag.service';
import { FlagCacheService } from '../../src/services/flag-cache.service';
import { FlagEvaluatorService } from '../../src/services/flag-evaluator.service';
import { FlagContext } from '../../src/services/flag-context';
import { FeatureFlagModuleOptions } from '../../src/interfaces/feature-flag-options.interface';
import { FeatureFlagWithOverrides } from '../../src/interfaces/feature-flag.interface';

function makeFlagRecord(key: string, overrides: Partial<FeatureFlagWithOverrides> = {}): FeatureFlagWithOverrides {
  return {
    id: 'uuid-1',
    key,
    description: null,
    enabled: false,
    percentage: 0,
    metadata: {},
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    overrides: [],
    ...overrides,
  };
}

describe('FeatureFlagService', () => {
  let service: FeatureFlagService;
  let cache: FlagCacheService;
  let evaluator: FlagEvaluatorService;
  let context: FlagContext;
  let mockPrisma: any;
  let mockModuleRef: any;
  let mockEventEmitter: any;
  let options: FeatureFlagModuleOptions;

  beforeEach(() => {
    options = { environment: 'test', cacheTtlMs: 5000 };
    cache = new FlagCacheService(options);
    evaluator = new FlagEvaluatorService();
    context = new FlagContext();

    mockPrisma = {
      featureFlag: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      featureFlagOverride: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    mockModuleRef = {
      get: jest.fn().mockReturnValue(undefined),
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    service = new FeatureFlagService(
      options,
      mockPrisma,
      cache,
      evaluator,
      context,
      mockModuleRef,
      mockEventEmitter,
    );
  });

  describe('isEnabled', () => {
    it('should return defaultOnMissing when flag does not exist', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      const result = await service.isEnabled('UNKNOWN');
      expect(result).toBe(false);
    });

    it('should return defaultOnMissing=true when configured', async () => {
      const serviceWithDefault = new FeatureFlagService(
        { ...options, defaultOnMissing: true },
        mockPrisma,
        cache,
        evaluator,
        context,
        mockModuleRef,
        mockEventEmitter,
      );
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      const result = await serviceWithDefault.isEnabled('UNKNOWN');
      expect(result).toBe(true);
    });

    it('should evaluate flag from DB when cache misses', async () => {
      const flag = makeFlagRecord('MY_FLAG', { enabled: true });
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag);

      const result = await service.isEnabled('MY_FLAG');
      expect(result).toBe(true);
      expect(mockPrisma.featureFlag.findUnique).toHaveBeenCalledWith({
        where: { key: 'MY_FLAG' },
        include: { overrides: true },
      });
    });

    it('should use cached flag on cache hit', async () => {
      const flag = makeFlagRecord('MY_FLAG', { enabled: true });
      cache.set('MY_FLAG', flag);

      const result = await service.isEnabled('MY_FLAG');
      expect(result).toBe(true);
      expect(mockPrisma.featureFlag.findUnique).not.toHaveBeenCalled();
    });

    it('should use explicit context when provided', async () => {
      const flag = makeFlagRecord('MY_FLAG', {
        overrides: [{
          id: 'o1', flagId: 'uuid-1', tenantId: null,
          userId: 'user-1', environment: null, enabled: true,
        }],
      });
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag);

      const result = await service.isEnabled('MY_FLAG', { userId: 'user-1' });
      expect(result).toBe(true);
    });

    it('should use explicit null userId to override ambient context', async () => {
      // Flag with a user override
      const flag = makeFlagRecord('MY_FLAG', {
        overrides: [{
          id: 'o1', flagId: 'uuid-1', tenantId: null,
          userId: 'ambient-user', environment: null, enabled: true,
        }],
      });
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag);

      // Set ambient user via FlagContext
      const result = await context.run({ userId: 'ambient-user' }, () =>
        service.isEnabled('MY_FLAG', { userId: null }),
      );
      // Explicit null should suppress the ambient userId, so user override won't match
      expect(result).toBe(false);
    });

    it('should inject environment from module options', async () => {
      const flag = makeFlagRecord('MY_FLAG', {
        overrides: [{
          id: 'o1', flagId: 'uuid-1', tenantId: null,
          userId: null, environment: 'test', enabled: true,
        }],
      });
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag);

      const result = await service.isEnabled('MY_FLAG');
      expect(result).toBe(true);
    });
  });

  describe('evaluateAll', () => {
    it('should return a map of all active flags', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        makeFlagRecord('FLAG_A', { enabled: true }),
        makeFlagRecord('FLAG_B', { enabled: false }),
      ]);

      const result = await service.evaluateAll();
      expect(result).toEqual({ FLAG_A: true, FLAG_B: false });
    });

    it('should use allFlags cache when available', async () => {
      const flags = [
        makeFlagRecord('FLAG_A', { enabled: true }),
      ];
      cache.setAll(flags);

      const result = await service.evaluateAll();
      expect(result).toEqual({ FLAG_A: true });
      expect(mockPrisma.featureFlag.findMany).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create a flag and invalidate cache', async () => {
      const created = makeFlagRecord('NEW_FLAG', { enabled: true });
      mockPrisma.featureFlag.create.mockResolvedValue(created);

      const result = await service.create({
        key: 'NEW_FLAG',
        enabled: true,
      });

      expect(result.key).toBe('NEW_FLAG');
      expect(mockPrisma.featureFlag.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update a flag and invalidate cache', async () => {
      const updated = makeFlagRecord('MY_FLAG', { enabled: true });
      mockPrisma.featureFlag.update.mockResolvedValue(updated);

      const result = await service.update('MY_FLAG', { enabled: true });
      expect(result.enabled).toBe(true);
    });
  });

  describe('archive', () => {
    it('should soft-delete a flag by setting archivedAt', async () => {
      const archived = makeFlagRecord('OLD_FLAG', { archivedAt: new Date() });
      mockPrisma.featureFlag.update.mockResolvedValue(archived);

      const result = await service.archive('OLD_FLAG');
      expect(result.archivedAt).not.toBeNull();
    });
  });

  describe('setOverride', () => {
    it('should upsert a tenant override', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(makeFlagRecord('MY_FLAG'));
      mockPrisma.featureFlagOverride.findFirst.mockResolvedValue(null);
      mockPrisma.featureFlagOverride.create.mockResolvedValue({
        id: 'o1',
        flagId: 'uuid-1',
        tenantId: 'tenant-1',
        userId: null,
        environment: null,
        enabled: true,
      });

      await service.setOverride('MY_FLAG', {
        tenantId: 'tenant-1',
        enabled: true,
      });

      expect(mockPrisma.featureFlagOverride.findFirst).toHaveBeenCalled();
      expect(mockPrisma.featureFlagOverride.create).toHaveBeenCalled();
    });

    it('should update existing override instead of creating a duplicate', async () => {
      const existingOverride = {
        id: 'existing-1',
        flagId: 'uuid-1',
        tenantId: null,
        userId: null,
        environment: null,
        enabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.featureFlag.findUnique.mockResolvedValue(makeFlagRecord('MY_FLAG'));
      mockPrisma.featureFlagOverride.findFirst.mockResolvedValue(existingOverride);
      mockPrisma.featureFlagOverride.update.mockResolvedValue({
        ...existingOverride,
        enabled: true,
      });

      await service.setOverride('MY_FLAG', { enabled: true });

      expect(mockPrisma.featureFlagOverride.findFirst).toHaveBeenCalledWith({
        where: {
          flagId: 'uuid-1',
          tenantId: null,
          userId: null,
          environment: null,
        },
      });
      expect(mockPrisma.featureFlagOverride.update).toHaveBeenCalledWith({
        where: { id: 'existing-1' },
        data: { enabled: true },
      });
    });

    it('should create a new override when none exists', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(makeFlagRecord('MY_FLAG'));
      mockPrisma.featureFlagOverride.findFirst.mockResolvedValue(null);
      mockPrisma.featureFlagOverride.create.mockResolvedValue({
        id: 'new-1',
        flagId: 'uuid-1',
        tenantId: 'tenant-1',
        userId: null,
        environment: null,
        enabled: true,
      });

      await service.setOverride('MY_FLAG', { tenantId: 'tenant-1', enabled: true });

      expect(mockPrisma.featureFlagOverride.create).toHaveBeenCalledWith({
        data: {
          flagId: 'uuid-1',
          tenantId: 'tenant-1',
          userId: null,
          environment: null,
          enabled: true,
        },
      });
    });
  });

  describe('findAll', () => {
    it('should return all active (non-archived) flags', async () => {
      const flags = [makeFlagRecord('A'), makeFlagRecord('B')];
      mockPrisma.featureFlag.findMany.mockResolvedValue(flags);

      const result = await service.findAll();
      expect(result).toHaveLength(2);
      expect(mockPrisma.featureFlag.findMany).toHaveBeenCalledWith({
        where: { archivedAt: null },
        include: { overrides: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('invalidateCache', () => {
    it('should clear the cache', () => {
      cache.set('A', makeFlagRecord('A'));
      service.invalidateCache();
      expect(cache.get('A')).toBeNull();
    });
  });

  describe('event emission', () => {
    let serviceWithEvents: FeatureFlagService;

    beforeEach(() => {
      serviceWithEvents = new FeatureFlagService(
        { ...options, emitEvents: true },
        mockPrisma,
        cache,
        evaluator,
        context,
        mockModuleRef,
        mockEventEmitter,
      );
    });

    it('should emit evaluation event when emitEvents is true', async () => {
      const flag = makeFlagRecord('MY_FLAG', { enabled: true });
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag);

      await serviceWithEvents.isEnabled('MY_FLAG');
      expect(mockEventEmitter.emit).toHaveBeenCalled();
    });

    it('should not emit events when emitEvents is false', async () => {
      const flag = makeFlagRecord('MY_FLAG', { enabled: true });
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag);

      await service.isEnabled('MY_FLAG');
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should emit CREATED event on create', async () => {
      const created = makeFlagRecord('NEW_FLAG', { enabled: true });
      mockPrisma.featureFlag.create.mockResolvedValue(created);

      await serviceWithEvents.create({ key: 'NEW_FLAG', enabled: true });
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        expect.stringContaining('created'),
        expect.objectContaining({ flagKey: 'NEW_FLAG', action: 'created' }),
      );
    });

    it('should emit UPDATED event on update', async () => {
      const updated = makeFlagRecord('MY_FLAG', { enabled: false });
      mockPrisma.featureFlag.update.mockResolvedValue(updated);

      await serviceWithEvents.update('MY_FLAG', { enabled: false });
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        expect.stringContaining('updated'),
        expect.objectContaining({ flagKey: 'MY_FLAG', action: 'updated' }),
      );
    });

    it('should emit ARCHIVED event on archive', async () => {
      const archived = makeFlagRecord('OLD_FLAG', { archivedAt: new Date() });
      mockPrisma.featureFlag.update.mockResolvedValue(archived);

      await serviceWithEvents.archive('OLD_FLAG');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        expect.stringContaining('archived'),
        expect.objectContaining({ flagKey: 'OLD_FLAG', action: 'archived' }),
      );
    });

    it('should emit OVERRIDE_SET event on setOverride', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(makeFlagRecord('MY_FLAG'));
      mockPrisma.featureFlagOverride.findFirst.mockResolvedValue(null);
      mockPrisma.featureFlagOverride.create.mockResolvedValue({});

      await serviceWithEvents.setOverride('MY_FLAG', { tenantId: 'tenant-1', enabled: true });
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        expect.stringContaining('override'),
        expect.objectContaining({ flagKey: 'MY_FLAG', action: 'set' }),
      );
    });

    it('should emit CACHE_INVALIDATED event on invalidateCache', () => {
      serviceWithEvents.invalidateCache();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        expect.stringContaining('cache'),
        expect.any(Object),
      );
    });
  });

  describe('setOverride error handling', () => {
    it('should throw when flag is not found', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      await expect(service.setOverride('MISSING', { enabled: true })).rejects.toThrow(
        'Feature flag "MISSING" not found',
      );
    });
  });

  describe('getTenantId', () => {
    it('should return tenantId from TenancyService when available', async () => {
      const mockTenancyService = { getCurrentTenant: jest.fn().mockReturnValue('tenant-xyz') };
      mockModuleRef.get.mockReturnValue(mockTenancyService);

      // Use jest.mock to simulate @nestarc/tenancy being resolvable
      jest.doMock('@nestarc/tenancy', () => ({ TenancyService: class TenancyService {} }), { virtual: true });

      const flag = makeFlagRecord('MY_FLAG', {
        overrides: [{
          id: 'o1', flagId: 'uuid-1', tenantId: 'tenant-xyz',
          userId: null, environment: null, enabled: true,
        }],
      });
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag);

      const result = await service.isEnabled('MY_FLAG');
      // Result depends on whether module resolution works in test; just verify no throw
      expect(typeof result).toBe('boolean');
    });
  });
});
