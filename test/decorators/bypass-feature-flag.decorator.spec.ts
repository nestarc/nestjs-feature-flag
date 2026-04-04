import { BYPASS_FEATURE_FLAG_KEY } from '../../src/feature-flag.constants';
import { BypassFeatureFlag } from '../../src/decorators/bypass-feature-flag.decorator';

describe('@BypassFeatureFlag', () => {
  it('should set bypass metadata to true on a method', () => {
    class TestController {
      @BypassFeatureFlag()
      handler() {}
    }

    const bypass = Reflect.getMetadata(BYPASS_FEATURE_FLAG_KEY, TestController.prototype.handler);
    expect(bypass).toBe(true);
  });
});
