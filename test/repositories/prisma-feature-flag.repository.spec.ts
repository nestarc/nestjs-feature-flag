import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaFeatureFlagRepository } from '../../src/repositories/prisma-feature-flag.repository';

describe('PrismaFeatureFlagRepository', () => {
  let repository: PrismaFeatureFlagRepository;
  let prisma: {
    featureFlag: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    featureFlagOverride: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      featureFlag: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      featureFlagOverride: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    repository = new PrismaFeatureFlagRepository(prisma);
  });

  describe('createFlag', () => {
    it('should delegate to prisma.featureFlag.create with correct data', async () => {
      const input = { key: 'my-flag', description: 'A flag', enabled: true, percentage: 50, metadata: { foo: 'bar' } };
      const expected = { id: '1', ...input, overrides: [] };
      prisma.featureFlag.create.mockResolvedValue(expected);

      const result = await repository.createFlag(input);

      expect(prisma.featureFlag.create).toHaveBeenCalledWith({
        data: {
          key: 'my-flag',
          description: 'A flag',
          enabled: true,
          percentage: 50,
          metadata: { foo: 'bar' },
        },
        include: { overrides: true },
      });
      expect(result).toBe(expected);
    });

    it('should use defaults for optional fields', async () => {
      const input = { key: 'minimal-flag' };
      prisma.featureFlag.create.mockResolvedValue({ id: '1', key: 'minimal-flag', overrides: [] });

      await repository.createFlag(input);

      expect(prisma.featureFlag.create).toHaveBeenCalledWith({
        data: {
          key: 'minimal-flag',
          description: undefined,
          enabled: false,
          percentage: 0,
          metadata: {},
        },
        include: { overrides: true },
      });
    });

    it('should throw ConflictException on duplicate key (P2002)', async () => {
      prisma.featureFlag.create.mockRejectedValue({ code: 'P2002' });

      await expect(repository.createFlag({ key: 'dup' })).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException for percentage < 0', async () => {
      await expect(repository.createFlag({ key: 'x', percentage: -1 })).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for percentage > 100', async () => {
      await expect(repository.createFlag({ key: 'x', percentage: 101 })).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateFlag', () => {
    it('should delegate with correct where and data', async () => {
      const input = { enabled: true, description: 'Updated' };
      const expected = { id: '1', key: 'flag-1', overrides: [] };
      prisma.featureFlag.update.mockResolvedValue(expected);

      const result = await repository.updateFlag('flag-1', input);

      expect(prisma.featureFlag.update).toHaveBeenCalledWith({
        where: { key: 'flag-1' },
        data: { enabled: true, description: 'Updated' },
        include: { overrides: true },
      });
      expect(result).toBe(expected);
    });

    it('should only spread defined fields', async () => {
      const input = { enabled: false };
      prisma.featureFlag.update.mockResolvedValue({});

      await repository.updateFlag('flag-1', input);

      expect(prisma.featureFlag.update).toHaveBeenCalledWith({
        where: { key: 'flag-1' },
        data: { enabled: false },
        include: { overrides: true },
      });
    });

    it('should throw NotFoundException on missing key (P2025)', async () => {
      prisma.featureFlag.update.mockRejectedValue({ code: 'P2025' });

      await expect(repository.updateFlag('nope', { enabled: true })).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for invalid percentage', async () => {
      await expect(repository.updateFlag('x', { percentage: 200 })).rejects.toThrow(BadRequestException);
    });
  });

  describe('archiveFlag', () => {
    it('should set archivedAt to a Date', async () => {
      const expected = { id: '1', key: 'flag-1', archivedAt: new Date(), overrides: [] };
      prisma.featureFlag.update.mockResolvedValue(expected);

      const result = await repository.archiveFlag('flag-1');

      expect(prisma.featureFlag.update).toHaveBeenCalledWith({
        where: { key: 'flag-1' },
        data: { archivedAt: expect.any(Date) },
        include: { overrides: true },
      });
      expect(result).toBe(expected);
    });

    it('should throw NotFoundException on missing key (P2025)', async () => {
      prisma.featureFlag.update.mockRejectedValue({ code: 'P2025' });

      await expect(repository.archiveFlag('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findFlagByKey', () => {
    it('should delegate with include: { overrides: true }', async () => {
      const expected = { id: '1', key: 'flag-1', overrides: [] };
      prisma.featureFlag.findUnique.mockResolvedValue(expected);

      const result = await repository.findFlagByKey('flag-1');

      expect(prisma.featureFlag.findUnique).toHaveBeenCalledWith({
        where: { key: 'flag-1' },
        include: { overrides: true },
      });
      expect(result).toBe(expected);
    });

    it('should return null when flag does not exist', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(null);

      const result = await repository.findFlagByKey('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findFlagIdByKey', () => {
    it('should return id when flag exists', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue({ id: 'abc-123' });

      const result = await repository.findFlagIdByKey('flag-1');

      expect(prisma.featureFlag.findUnique).toHaveBeenCalledWith({ where: { key: 'flag-1' } });
      expect(result).toBe('abc-123');
    });

    it('should return null when flag does not exist', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(null);

      const result = await repository.findFlagIdByKey('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findAllActiveFlags', () => {
    it('should delegate with archivedAt: null', async () => {
      const expected = [{ id: '1', key: 'flag-1', overrides: [] }];
      prisma.featureFlag.findMany.mockResolvedValue(expected);

      const result = await repository.findAllActiveFlags();

      expect(prisma.featureFlag.findMany).toHaveBeenCalledWith({
        where: { archivedAt: null },
        include: { overrides: true },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(expected);
    });
  });

  describe('findOverride', () => {
    it('should delegate with select: { id: true }', async () => {
      const criteria = { tenantId: 't1', userId: 'u1', environment: 'prod' };
      const expected = { id: 'override-1' };
      prisma.featureFlagOverride.findFirst.mockResolvedValue(expected);

      const result = await repository.findOverride('flag-id', criteria);

      expect(prisma.featureFlagOverride.findFirst).toHaveBeenCalledWith({
        where: { flagId: 'flag-id', tenantId: 't1', userId: 'u1', environment: 'prod' },
        select: { id: true },
      });
      expect(result).toBe(expected);
    });

    it('should return null when no override exists', async () => {
      prisma.featureFlagOverride.findFirst.mockResolvedValue(null);

      const result = await repository.findOverride('flag-id', { tenantId: null, userId: null, environment: null });

      expect(result).toBeNull();
    });
  });

  describe('createOverride', () => {
    it('should delegate to prisma.featureFlagOverride.create', async () => {
      const criteria = { tenantId: 't1', userId: null, environment: 'staging' };
      prisma.featureFlagOverride.create.mockResolvedValue({});

      await repository.createOverride('flag-id', criteria, true);

      expect(prisma.featureFlagOverride.create).toHaveBeenCalledWith({
        data: { flagId: 'flag-id', tenantId: 't1', userId: null, environment: 'staging', enabled: true },
      });
    });

    it('should fall back to update on unique violation (P2002 race)', async () => {
      const criteria = { tenantId: null, userId: null, environment: null };
      prisma.featureFlagOverride.create.mockRejectedValue({ code: 'P2002' });
      prisma.featureFlagOverride.findFirst.mockResolvedValue({ id: 'existing-id' });
      prisma.featureFlagOverride.update.mockResolvedValue({});

      await repository.createOverride('flag-id', criteria, true);

      expect(prisma.featureFlagOverride.update).toHaveBeenCalledWith({
        where: { id: 'existing-id' },
        data: { enabled: true },
      });
    });
  });

  describe('updateOverrideEnabled', () => {
    it('should delegate with correct where and data', async () => {
      prisma.featureFlagOverride.update.mockResolvedValue({});

      await repository.updateOverrideEnabled('override-1', false);

      expect(prisma.featureFlagOverride.update).toHaveBeenCalledWith({
        where: { id: 'override-1' },
        data: { enabled: false },
      });
    });
  });

  describe('deleteOverride', () => {
    it('should delegate with correct where', async () => {
      prisma.featureFlagOverride.delete.mockResolvedValue({});

      await repository.deleteOverride('override-1');

      expect(prisma.featureFlagOverride.delete).toHaveBeenCalledWith({
        where: { id: 'override-1' },
      });
    });

    it('should silently succeed when record already deleted (P2025)', async () => {
      prisma.featureFlagOverride.delete.mockRejectedValue({ code: 'P2025' });

      await expect(repository.deleteOverride('gone-id')).resolves.toBeUndefined();
    });
  });
});
