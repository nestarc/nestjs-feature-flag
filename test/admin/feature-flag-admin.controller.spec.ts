import { Test } from '@nestjs/testing';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PIPES_METADATA } from '@nestjs/common/constants';
import { FeatureFlagAdminController } from '../../src/admin/feature-flag-admin.controller';
import {
  CreateFeatureFlagDto,
  EvaluateFeatureFlagDto,
  SetOverrideDto,
  UpdateFeatureFlagDto,
} from '../../src/admin/feature-flag-admin.dto';
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
      bucketBy: 'tenantId',
      defaultValue: true,
      trackExposure: true,
    };

    const result = await controller.evaluate('TEST_FLAG', input);

    expect(mockService.evaluateBoolean).toHaveBeenCalledWith(
      'TEST_FLAG',
      { userId: 'user-1', tenantId: 'tenant-1' },
      { bucketBy: 'tenantId', defaultValue: true, trackExposure: true },
    );
    expect(result.value).toBe(true);
  });
});

describe('FeatureFlagAdminController request validation', () => {
  // Exercise the pipe configured on the controller, including its whitelist policy.
  const [pipe] = Reflect.getMetadata(
    PIPES_METADATA,
    FeatureFlagAdminController,
  ) as ValidationPipe[];

  describe.each([
    { name: 'create', metatype: CreateFeatureFlagDto, required: { key: 'TEST_FLAG' } },
    { name: 'update', metatype: UpdateFeatureFlagDto, required: {} },
  ])('$name', ({ metatype, required }) => {
    const validate = (input: Record<string, unknown>) =>
      pipe.transform({ ...required, ...input }, { type: 'body', metatype });

    it.each([null, -1, 101, 0.5, NaN, Infinity, -Infinity, '50', true])(
      'should reject percentage %p with a 400 error',
      async (percentage) => {
        await expect(validate({ percentage })).rejects.toMatchObject({ status: 400 });
      },
    );

    it.each([0, 50, 100])('should accept integer percentage %p', async (percentage) => {
      await expect(validate({ percentage })).resolves.toMatchObject({ percentage });
    });

    it('should accept omitted optional fields without injecting values', async () => {
      const result = await validate({});
      expect(result.percentage).toBeUndefined();
      expect(result.enabled).toBeUndefined();
      expect(result.metadata).toBeUndefined();
    });

    it.each(['enabled', 'metadata'])('should reject null %s', async (field) => {
      await expect(validate({ [field]: null })).rejects.toThrow(BadRequestException);
    });

    it('should preserve false, an empty metadata object, and a nullable description', async () => {
      const input = { enabled: false, metadata: {}, description: null };
      await expect(validate(input)).resolves.toMatchObject(input);
    });
  });

  it('should reject null override priority while accepting omitted priority', async () => {
    const input = { attributes: { plan: 'pro' }, enabled: true };
    const metadata = { type: 'body' as const, metatype: SetOverrideDto };
    await expect(pipe.transform({ ...input, priority: null }, metadata)).rejects.toThrow(
      BadRequestException,
    );
    await expect(pipe.transform(input, metadata)).resolves.toMatchObject(input);
  });

  it.each(['context', 'defaultValue', 'trackExposure', 'includeContextInEvent'])(
    'should reject null evaluation %s',
    async (field) => {
      await expect(
        pipe.transform({ [field]: null }, { type: 'body', metatype: EvaluateFeatureFlagDto }),
      ).rejects.toThrow(BadRequestException);
    },
  );

  it.each([null, '', 123, false, {}])('should reject invalid bucketBy %p', async (bucketBy) => {
    await expect(
      pipe.transform({ bucketBy }, { type: 'body', metatype: EvaluateFeatureFlagDto }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each(['userId', 'tenantId', 'accountId'])(
    'should accept bucketBy %p through the controller whitelist',
    async (bucketBy) => {
      const input = { context: { attributes: { accountId: 'account-1' } }, bucketBy };
      await expect(
        pipe.transform(input, { type: 'body', metatype: EvaluateFeatureFlagDto }),
      ).resolves.toMatchObject(input);
    },
  );

  it('should accept omitted evaluation options and explicit false values', async () => {
    const metadata = { type: 'body' as const, metatype: EvaluateFeatureFlagDto };
    await expect(pipe.transform({}, metadata)).resolves.toEqual(new EvaluateFeatureFlagDto());
    const input = {
      context: { userId: null },
      defaultValue: false,
      trackExposure: false,
      includeContextInEvent: false,
    };
    await expect(pipe.transform(input, metadata)).resolves.toMatchObject(input);
  });
});
