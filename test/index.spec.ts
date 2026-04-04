import {
  FeatureFlagModule,
  FeatureFlagService,
  FeatureFlag,
  BypassFeatureFlag,
  FeatureFlagGuard,
  FlagContext,
  FeatureFlagEvents,
} from '../src';

describe('barrel exports', () => {
  it('should export all public API symbols', () => {
    expect(FeatureFlagModule).toBeDefined();
    expect(FeatureFlagService).toBeDefined();
    expect(FeatureFlag).toBeDefined();
    expect(BypassFeatureFlag).toBeDefined();
    expect(FeatureFlagGuard).toBeDefined();
    expect(FlagContext).toBeDefined();
    expect(FeatureFlagEvents).toBeDefined();
    expect(FeatureFlagEvents.EVALUATED).toBe('feature-flag.evaluated');
  });
});
