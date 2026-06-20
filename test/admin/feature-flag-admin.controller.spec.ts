import { Test } from '@nestjs/testing';
import { FeatureFlagAdminController } from '../../src/admin/feature-flag-admin.controller';
import { FeatureFlagService } from '../../src/services/feature-flag.service';

const mockFlag = {
  id: 'uuid-1',
  key: 'TEST_FLAG',
  description: null,
  enabled: true,
  percentage: 0,
  metadata: {},
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  overrides: [],
};

const mockService = {
  create: jest.fn().mockResolvedValue(mockFlag),
  findAll: jest.fn().mockResolvedValue([mockFlag]),
  findByKey: jest.fn().mockResolvedValue(mockFlag),
  update: jest.fn().mockResolvedValue(mockFlag),
  archive: jest.fn().mockResolvedValue({ ...mockFlag, archivedAt: new Date() }),
  setOverride: jest.fn().mockResolvedValue(undefined),
  removeOverride: jest.fn().mockResolvedValue(undefined),
  evaluateBoolean: jest.fn().mockResolvedValue({
    flagKey: 'TEST_FLAG',
    value: true,
    result: true,
    source: 'global',
    reason: 'GLOBAL',
    defaultUsed: false,
    evaluationTimeMs: 1,
  }),
};

describe('FeatureFlagAdminController', () => {
  let controller: FeatureFlagAdminController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [FeatureFlagAdminController],
      providers: [{ provide: FeatureFlagService, useValue: mockService }],
    }).compile();

    controller = module.get(FeatureFlagAdminController);
    jest.clearAllMocks();
  });

  it('should create a flag', async () => {
    const input = { key: 'TEST_FLAG', enabled: true };
    const result = await controller.create(input);
    expect(mockService.create).toHaveBeenCalledWith(input);
    expect(result.key).toBe('TEST_FLAG');
  });

  it('should list all flags', async () => {
    const result = await controller.findAll();
    expect(mockService.findAll).toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it('should get a single flag by key', async () => {
    const result = await controller.findByKey('TEST_FLAG');
    expect(mockService.findByKey).toHaveBeenCalledWith('TEST_FLAG');
    expect(result.key).toBe('TEST_FLAG');
  });

  it('should update a flag', async () => {
    const input = { enabled: false };
    await controller.update('TEST_FLAG', input);
    expect(mockService.update).toHaveBeenCalledWith('TEST_FLAG', input);
  });

  it('should archive a flag', async () => {
    const result = await controller.archive('TEST_FLAG');
    expect(mockService.archive).toHaveBeenCalledWith('TEST_FLAG');
    expect(result.archivedAt).not.toBeNull();
  });

  it('should set an override', async () => {
    const input = { attributes: { tenantId: 't-1' }, enabled: true };
    await controller.setOverride('TEST_FLAG', input);
    expect(mockService.setOverride).toHaveBeenCalledWith('TEST_FLAG', input);
  });

  it('should remove an override', async () => {
    const input = { attributes: { tenantId: 't-1' } };
    await controller.removeOverride('TEST_FLAG', input);
    expect(mockService.removeOverride).toHaveBeenCalledWith('TEST_FLAG', input);
  });

  it('should evaluate a flag with explicit context and options', async () => {
    const input = {
      context: { userId: 'user-1', tenantId: 'tenant-1' },
      defaultValue: true,
      trackExposure: true,
    };

    const result = await controller.evaluate('TEST_FLAG', input);

    expect(mockService.evaluateBoolean).toHaveBeenCalledWith(
      'TEST_FLAG',
      { userId: 'user-1', tenantId: 'tenant-1' },
      { defaultValue: true, trackExposure: true },
    );
    expect(result.value).toBe(true);
  });
});
