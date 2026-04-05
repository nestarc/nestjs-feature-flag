import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FEATURE_FLAG_KEY, FEATURE_FLAG_OPTIONS_KEY } from '../../src/feature-flag.constants';
import { FeatureFlag } from '../../src/decorators/feature-flag.decorator';
import { FeatureFlagGuard } from '../../src/guards/feature-flag.guard';

describe('@FeatureFlag', () => {
  it('should set flag key metadata on a method', () => {
    class TestController {
      @FeatureFlag('MY_FLAG')
      handler() {}
    }

    const key = Reflect.getMetadata(FEATURE_FLAG_KEY, TestController.prototype.handler);
    expect(key).toBe('MY_FLAG');
  });

  it('should set flag options metadata on a method', () => {
    class TestController {
      @FeatureFlag('MY_FLAG', { statusCode: 402, fallback: { msg: 'upgrade' } })
      handler() {}
    }

    const options = Reflect.getMetadata(FEATURE_FLAG_OPTIONS_KEY, TestController.prototype.handler);
    expect(options).toEqual({ statusCode: 402, fallback: { msg: 'upgrade' } });
  });

  it('should set flag key metadata on a class', () => {
    @FeatureFlag('MODULE_FLAG')
    class TestController {}

    const key = Reflect.getMetadata(FEATURE_FLAG_KEY, TestController);
    expect(key).toBe('MODULE_FLAG');
  });

  it('should default options to empty object', () => {
    class TestController {
      @FeatureFlag('MY_FLAG')
      handler() {}
    }

    const options = Reflect.getMetadata(FEATURE_FLAG_OPTIONS_KEY, TestController.prototype.handler);
    expect(options).toEqual({});
  });

  it('should apply FeatureFlagGuard via UseGuards', () => {
    class TestController {
      @FeatureFlag('MY_FLAG')
      handler() {}
    }

    const guards = Reflect.getMetadata(GUARDS_METADATA, TestController.prototype.handler);
    expect(guards).toBeDefined();
    expect(guards).toContain(FeatureFlagGuard);
  });

  it('should apply FeatureFlagGuard at class level', () => {
    @FeatureFlag('MODULE_FLAG')
    class TestController {}

    const guards = Reflect.getMetadata(GUARDS_METADATA, TestController);
    expect(guards).toBeDefined();
    expect(guards).toContain(FeatureFlagGuard);
  });
});
