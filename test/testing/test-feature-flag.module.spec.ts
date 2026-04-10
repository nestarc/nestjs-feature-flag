import { Test } from '@nestjs/testing';
import { TestFeatureFlagModule } from '../../src/testing/test-feature-flag.module';
import { FeatureFlagService } from '../../src/services/feature-flag.service';

describe('TestFeatureFlagModule', () => {
  it('should provide a mock FeatureFlagService with preset flags', async () => {
    const module = await Test.createTestingModule({
      imports: [
        TestFeatureFlagModule.register({
          FEATURE_A: true,
          FEATURE_B: false,
        }),
      ],
    }).compile();

    const service = module.get(FeatureFlagService);

    expect(await service.isEnabled('FEATURE_A')).toBe(true);
    expect(await service.isEnabled('FEATURE_B')).toBe(false);
    expect(await service.isEnabled('UNKNOWN')).toBe(false);
  });

  it('should return all flags via evaluateAll', async () => {
    const module = await Test.createTestingModule({
      imports: [
        TestFeatureFlagModule.register({
          A: true,
          B: false,
        }),
      ],
    }).compile();

    const service = module.get(FeatureFlagService);
    const all = await service.evaluateAll();
    expect(all).toEqual({ A: true, B: false });
  });

  it('should default all flags to false when none provided', async () => {
    const module = await Test.createTestingModule({
      imports: [TestFeatureFlagModule.register()],
    }).compile();

    const service = module.get(FeatureFlagService);
    expect(await service.isEnabled('ANY')).toBe(false);
  });

  it('should expose mock create, update, archive, setOverride, removeOverride, findAll, invalidateCache', async () => {
    const module = await Test.createTestingModule({
      imports: [TestFeatureFlagModule.register({ FEATURE_A: true })],
    }).compile();

    const service = module.get(FeatureFlagService);

    await expect(service.create({ key: 'X' } as any)).resolves.toEqual({});
    await expect(service.update('X', {} as any)).resolves.toEqual({});
    await expect(service.archive('X')).resolves.toEqual({});
    await expect(service.setOverride('X', {} as any)).resolves.toBeUndefined();
    await expect(service.removeOverride('X', {} as any)).resolves.toBeUndefined();
    await expect(service.findAll()).resolves.toEqual([]);
    expect(() => service.invalidateCache()).not.toThrow();
  });

  it('should return flag data from findByKey for registered flags', async () => {
    const module = await Test.createTestingModule({
      imports: [TestFeatureFlagModule.register({ FEATURE_A: true })],
    }).compile();

    const service = module.get(FeatureFlagService);
    const result = await service.findByKey('FEATURE_A');
    expect(result).toEqual(expect.objectContaining({ key: 'FEATURE_A', enabled: true }));
  });

  it('should throw NotFoundException from findByKey for unknown flags', async () => {
    const module = await Test.createTestingModule({
      imports: [TestFeatureFlagModule.register({ FEATURE_A: true })],
    }).compile();

    const service = module.get(FeatureFlagService);
    await expect(service.findByKey('UNKNOWN')).rejects.toThrow('not found');
  });
});
