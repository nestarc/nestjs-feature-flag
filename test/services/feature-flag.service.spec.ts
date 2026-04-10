import { NotFoundException } from '@nestjs/common';
import { FeatureFlagService } from '../../src/services/feature-flag.service';
import { FlagEvaluatorService } from '../../src/services/flag-evaluator.service';
import { FlagContextResolver } from '../../src/services/flag-context-resolver';
import { FlagEventPublisher } from '../../src/services/flag-event-publisher';
import { FeatureFlagModuleOptions } from '../../src/interfaces/feature-flag-options.interface';
import { FeatureFlagWithOverrides } from '../../src/interfaces/feature-flag.interface';
import { FeatureFlagRepository } from '../../src/interfaces/feature-flag-repository.interface';
import { CacheAdapter } from '../../src/interfaces/cache-adapter.interface';

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
  let evaluator: FlagEvaluatorService;
  let mockRepository: jest.Mocked<FeatureFlagRepository>;
  let mockContextResolver: jest.Mocked<Pick<FlagContextResolver, 'resolve'>>;
  let mockEventPublisher: jest.Mocked<Pick<FlagEventPublisher, 'emit'>>;
  let options: FeatureFlagModuleOptions;
  let mockCacheAdapter: jest.Mocked<CacheAdapter>;

  beforeEach(() => {
    options = { environment: 'test', cacheTtlMs: 5000 };
    evaluator = new FlagEvaluatorService();

    mockCacheAdapter = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      getAll: jest.fn().mockResolvedValue(null),
      setAll: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
    };

    mockRepository = {
      createFlag: jest.fn(),
      updateFlag: jest.fn(),
      archiveFlag: jest.fn(),
      findFlagByKey: jest.fn(),
      findFlagIdByKey: jest.fn(),
      findAllActiveFlags: jest.fn(),
      findOverride: jest.fn(),
      createOverride: jest.fn(),
      updateOverrideEnabled: jest.fn(),
      deleteOverride: jest.fn(),
    };

    mockContextResolver = {
      resolve: jest.fn().mockReturnValue({ environment: 'test' }),
    };

    mockEventPublisher = {
      emit: jest.fn(),
    };

    service = new FeatureFlagService(
      options,
      mockRepository,
      mockCacheAdapter,
      evaluator,
      mockContextResolver as any,
      mockEventPublisher as any,
    );
  });

  describe('isEnabled', () => {
    it('should return defaultOnMissing when flag does not exist', async () => {
      mockRepository.findFlagByKey.mockResolvedValue(null);
      const result = await service.isEnabled('UNKNOWN');
      expect(result).toBe(false);
    });

    it('should return defaultOnMissing=true when configured', async () => {
      const serviceWithDefault = new FeatureFlagService(
        { ...options, defaultOnMissing: true },
        mockRepository,
        mockCacheAdapter,
        evaluator,
        mockContextResolver as any,
        mockEventPublisher as any,
      );
      mockRepository.findFlagByKey.mockResolvedValue(null);
      const result = await serviceWithDefault.isEnabled('UNKNOWN');
      expect(result).toBe(true);
    });

    it('should evaluate flag from DB when cache misses', async () => {
      const flag = makeFlagRecord('MY_FLAG', { enabled: true });
      mockRepository.findFlagByKey.mockResolvedValue(flag);

      const result = await service.isEnabled('MY_FLAG');
      expect(result).toBe(true);
      expect(mockRepository.findFlagByKey).toHaveBeenCalledWith('MY_FLAG');
      expect(mockCacheAdapter.set).toHaveBeenCalledWith('MY_FLAG', flag, 5000);
    });

    it('should use cached flag on cache hit', async () => {
      const flag = makeFlagRecord('MY_FLAG', { enabled: true });
      mockCacheAdapter.get.mockResolvedValue(flag);

      const result = await service.isEnabled('MY_FLAG');
      expect(result).toBe(true);
      expect(mockRepository.findFlagByKey).not.toHaveBeenCalled();
    });

    it('should use explicit context when provided', async () => {
      const flag = makeFlagRecord('MY_FLAG', {
        overrides: [{
          id: 'o1', flagId: 'uuid-1', tenantId: null,
          userId: 'user-1', environment: null, enabled: true,
        }],
      });
      mockRepository.findFlagByKey.mockResolvedValue(flag);
      mockContextResolver.resolve.mockReturnValue({ userId: 'user-1' });

      const result = await service.isEnabled('MY_FLAG', { userId: 'user-1' });
      expect(result).toBe(true);
      expect(mockContextResolver.resolve).toHaveBeenCalledWith({ userId: 'user-1' });
    });

    it('should use explicit null userId to override ambient context', async () => {
      // Flag with a user override
      const flag = makeFlagRecord('MY_FLAG', {
        overrides: [{
          id: 'o1', flagId: 'uuid-1', tenantId: null,
          userId: 'ambient-user', environment: null, enabled: true,
        }],
      });
      mockRepository.findFlagByKey.mockResolvedValue(flag);

      // Simulate contextResolver returning context with null userId (explicit null suppresses ambient)
      mockContextResolver.resolve.mockReturnValue({ userId: null });

      const result = await service.isEnabled('MY_FLAG', { userId: null });
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
      mockRepository.findFlagByKey.mockResolvedValue(flag);
      mockContextResolver.resolve.mockReturnValue({ environment: 'test' });

      const result = await service.isEnabled('MY_FLAG');
      expect(result).toBe(true);
    });
  });

  describe('evaluateAll', () => {
    it('should return a map of all active flags', async () => {
      mockRepository.findAllActiveFlags.mockResolvedValue([
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
      mockCacheAdapter.getAll.mockResolvedValue(flags);

      const result = await service.evaluateAll();
      expect(result).toEqual({ FLAG_A: true });
      expect(mockRepository.findAllActiveFlags).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create a flag and invalidate cache', async () => {
      const created = makeFlagRecord('NEW_FLAG', { enabled: true });
      mockRepository.createFlag.mockResolvedValue(created);

      const result = await service.create({
        key: 'NEW_FLAG',
        enabled: true,
      });

      expect(result.key).toBe('NEW_FLAG');
      expect(mockRepository.createFlag).toHaveBeenCalled();
      expect(mockCacheAdapter.invalidate).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update a flag and invalidate cache', async () => {
      const updated = makeFlagRecord('MY_FLAG', { enabled: true });
      mockRepository.updateFlag.mockResolvedValue(updated);

      const result = await service.update('MY_FLAG', { enabled: true });
      expect(result.enabled).toBe(true);
      expect(mockCacheAdapter.invalidate).toHaveBeenCalledWith('MY_FLAG');
    });
  });

  describe('archive', () => {
    it('should soft-delete a flag by setting archivedAt', async () => {
      const archived = makeFlagRecord('OLD_FLAG', { archivedAt: new Date() });
      mockRepository.archiveFlag.mockResolvedValue(archived);

      const result = await service.archive('OLD_FLAG');
      expect(result.archivedAt).not.toBeNull();
    });
  });

  describe('setOverride', () => {
    it('should upsert a tenant override', async () => {
      mockRepository.findFlagIdByKey.mockResolvedValue('uuid-1');
      mockRepository.findOverride.mockResolvedValue(null);
      mockRepository.createOverride.mockResolvedValue(undefined);

      await service.setOverride('MY_FLAG', {
        tenantId: 'tenant-1',
        enabled: true,
      });

      expect(mockRepository.findOverride).toHaveBeenCalled();
      expect(mockRepository.createOverride).toHaveBeenCalled();
    });

    it('should update existing override instead of creating a duplicate', async () => {
      const existingOverride = { id: 'existing-1' };

      mockRepository.findFlagIdByKey.mockResolvedValue('uuid-1');
      mockRepository.findOverride.mockResolvedValue(existingOverride);
      mockRepository.updateOverrideEnabled.mockResolvedValue(undefined);

      await service.setOverride('MY_FLAG', { enabled: true });

      expect(mockRepository.findOverride).toHaveBeenCalledWith(
        'uuid-1',
        {
          tenantId: null,
          userId: null,
          environment: null,
        },
      );
      expect(mockRepository.updateOverrideEnabled).toHaveBeenCalledWith('existing-1', true);
    });

    it('should create a new override when none exists', async () => {
      mockRepository.findFlagIdByKey.mockResolvedValue('uuid-1');
      mockRepository.findOverride.mockResolvedValue(null);
      mockRepository.createOverride.mockResolvedValue(undefined);

      await service.setOverride('MY_FLAG', { tenantId: 'tenant-1', enabled: true });

      expect(mockRepository.createOverride).toHaveBeenCalledWith(
        'uuid-1',
        {
          tenantId: 'tenant-1',
          userId: null,
          environment: null,
        },
        true,
      );
    });
  });

  describe('findAll', () => {
    it('should return all active (non-archived) flags', async () => {
      const flags = [makeFlagRecord('A'), makeFlagRecord('B')];
      mockRepository.findAllActiveFlags.mockResolvedValue(flags);

      const result = await service.findAll();
      expect(result).toHaveLength(2);
      expect(mockRepository.findAllActiveFlags).toHaveBeenCalled();
    });
  });

  describe('invalidateCache', () => {
    it('should clear the cache', async () => {
      await service.invalidateCache();
      expect(mockCacheAdapter.invalidate).toHaveBeenCalled();
    });
  });

  describe('findByKey', () => {
    it('should return the flag when found', async () => {
      const mockFlagData = makeFlagRecord('TEST');
      mockRepository.findFlagByKey.mockResolvedValue(mockFlagData);
      const result = await service.findByKey('TEST');
      expect(result).toEqual(mockFlagData);
    });

    it('should throw NotFoundException when not found', async () => {
      mockRepository.findFlagByKey.mockResolvedValue(null);
      await expect(service.findByKey('MISSING')).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeOverride', () => {
    it('should delete existing override and invalidate cache', async () => {
      mockRepository.findFlagIdByKey.mockResolvedValue('flag-1');
      mockRepository.findOverride.mockResolvedValue({ id: 'ov-1' });
      mockRepository.deleteOverride.mockResolvedValue(undefined);

      await service.removeOverride('TEST', { tenantId: 't-1' });

      expect(mockRepository.deleteOverride).toHaveBeenCalledWith('ov-1');
      expect(mockCacheAdapter.invalidate).toHaveBeenCalledWith('TEST');
    });

    it('should throw NotFoundException when flag not found', async () => {
      mockRepository.findFlagIdByKey.mockResolvedValue(null);
      await expect(service.removeOverride('MISSING', {})).rejects.toThrow(NotFoundException);
    });

    it('should not fail when override does not exist', async () => {
      mockRepository.findFlagIdByKey.mockResolvedValue('flag-1');
      mockRepository.findOverride.mockResolvedValue(null);

      await expect(service.removeOverride('TEST', {})).resolves.not.toThrow();
    });
  });

  describe('event emission', () => {
    it('should emit evaluation event on isEnabled', async () => {
      const flag = makeFlagRecord('MY_FLAG', { enabled: true });
      mockRepository.findFlagByKey.mockResolvedValue(flag);

      await service.isEnabled('MY_FLAG');
      expect(mockEventPublisher.emit).toHaveBeenCalledWith(
        'feature-flag.evaluated',
        expect.objectContaining({ flagKey: 'MY_FLAG', result: true }),
      );
    });

    it('should not emit evaluation event when flag not found', async () => {
      mockRepository.findFlagByKey.mockResolvedValue(null);

      await service.isEnabled('UNKNOWN');
      expect(mockEventPublisher.emit).not.toHaveBeenCalled();
    });

    it('should emit CREATED event on create', async () => {
      const created = makeFlagRecord('NEW_FLAG', { enabled: true });
      mockRepository.createFlag.mockResolvedValue(created);

      await service.create({ key: 'NEW_FLAG', enabled: true });
      expect(mockEventPublisher.emit).toHaveBeenCalledWith(
        expect.stringContaining('created'),
        expect.objectContaining({ flagKey: 'NEW_FLAG', action: 'created' }),
      );
    });

    it('should emit UPDATED event on update', async () => {
      const updated = makeFlagRecord('MY_FLAG', { enabled: false });
      mockRepository.updateFlag.mockResolvedValue(updated);

      await service.update('MY_FLAG', { enabled: false });
      expect(mockEventPublisher.emit).toHaveBeenCalledWith(
        expect.stringContaining('updated'),
        expect.objectContaining({ flagKey: 'MY_FLAG', action: 'updated' }),
      );
    });

    it('should emit ARCHIVED event on archive', async () => {
      const archived = makeFlagRecord('OLD_FLAG', { archivedAt: new Date() });
      mockRepository.archiveFlag.mockResolvedValue(archived);

      await service.archive('OLD_FLAG');
      expect(mockEventPublisher.emit).toHaveBeenCalledWith(
        expect.stringContaining('archived'),
        expect.objectContaining({ flagKey: 'OLD_FLAG', action: 'archived' }),
      );
    });

    it('should emit OVERRIDE_SET event on setOverride', async () => {
      mockRepository.findFlagIdByKey.mockResolvedValue('uuid-1');
      mockRepository.findOverride.mockResolvedValue(null);
      mockRepository.createOverride.mockResolvedValue(undefined);

      await service.setOverride('MY_FLAG', { tenantId: 'tenant-1', enabled: true });
      expect(mockEventPublisher.emit).toHaveBeenCalledWith(
        expect.stringContaining('override'),
        expect.objectContaining({ flagKey: 'MY_FLAG', action: 'set' }),
      );
    });

    it('should emit OVERRIDE_REMOVED event on removeOverride', async () => {
      mockRepository.findFlagIdByKey.mockResolvedValue('flag-1');
      mockRepository.findOverride.mockResolvedValue({ id: 'ov-1' });
      mockRepository.deleteOverride.mockResolvedValue(undefined);

      await service.removeOverride('MY_FLAG', { tenantId: 'tenant-1' });
      expect(mockEventPublisher.emit).toHaveBeenCalledWith(
        expect.stringContaining('override'),
        expect.objectContaining({ flagKey: 'MY_FLAG', action: 'removed' }),
      );
    });

    it('should emit CACHE_INVALIDATED event on invalidateCache', async () => {
      await service.invalidateCache();
      expect(mockEventPublisher.emit).toHaveBeenCalledWith(
        expect.stringContaining('cache'),
        expect.any(Object),
      );
    });
  });

  describe('setOverride error handling', () => {
    it('should throw when flag is not found', async () => {
      mockRepository.findFlagIdByKey.mockResolvedValue(null);

      await expect(service.setOverride('MISSING', { enabled: true })).rejects.toThrow(
        'Feature flag "MISSING" not found',
      );
    });
  });

  describe('context resolution', () => {
    it('should delegate context resolution to FlagContextResolver', async () => {
      mockContextResolver.resolve.mockReturnValue({ tenantId: 'tenant-xyz', environment: 'test' });

      const flag = makeFlagRecord('MY_FLAG', {
        overrides: [{
          id: 'o1', flagId: 'uuid-1', tenantId: 'tenant-xyz',
          userId: null, environment: null, enabled: true,
        }],
      });
      mockRepository.findFlagByKey.mockResolvedValue(flag);

      const result = await service.isEnabled('MY_FLAG');
      expect(result).toBe(true);
      expect(mockContextResolver.resolve).toHaveBeenCalled();
    });
  });
});
