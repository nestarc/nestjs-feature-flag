import { FlagEvaluatorService } from '../../src/services/flag-evaluator.service';
import { FeatureFlagWithOverrides, FlagOverride } from '../../src/interfaces/feature-flag.interface';
import { EvaluationContext } from '../../src/interfaces/evaluation-context.interface';

function makeContext(partial: EvaluationContext = {}): EvaluationContext {
  return partial;
}

// suppress unused-import: makeContext is used inline via type narrowing
void makeContext;

function makeFlag(partial: Partial<FeatureFlagWithOverrides> = {}): FeatureFlagWithOverrides {
  return {
    id: 'flag-1',
    key: 'TEST_FLAG',
    description: null,
    enabled: false,
    percentage: 0,
    metadata: {},
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    overrides: [],
    ...partial,
  };
}

function makeOverride(partial: Partial<FlagOverride> = {}): FlagOverride {
  return {
    id: 'override-1',
    flagId: 'flag-1',
    tenantId: null,
    userId: null,
    environment: null,
    enabled: true,
    ...partial,
  };
}

describe('FlagEvaluatorService', () => {
  let evaluator: FlagEvaluatorService;

  beforeEach(() => {
    evaluator = new FlagEvaluatorService();
  });

  describe('archived flags', () => {
    it('should return false for archived flags', () => {
      const flag = makeFlag({ archivedAt: new Date() });
      const result = evaluator.evaluate(flag, { userId: 'user-1' });
      expect(result.result).toBe(false);
      expect(result.source).toBe('global');
    });
  });

  describe('user overrides', () => {
    it('should use user override when it matches userId', () => {
      const flag = makeFlag({
        overrides: [makeOverride({ userId: 'user-1', enabled: true })],
      });
      const result = evaluator.evaluate(flag, { userId: 'user-1' });
      expect(result.result).toBe(true);
      expect(result.source).toBe('user_override');
    });

    it('should not use user override for different userId', () => {
      const flag = makeFlag({
        enabled: false,
        overrides: [makeOverride({ userId: 'user-1', enabled: true })],
      });
      const result = evaluator.evaluate(flag, { userId: 'user-2' });
      expect(result.result).toBe(false);
    });

    it('should skip user override when context has no userId', () => {
      const flag = makeFlag({
        enabled: false,
        overrides: [makeOverride({ userId: 'user-1', enabled: true })],
      });
      const result = evaluator.evaluate(flag, {});
      expect(result.result).toBe(false);
    });
  });

  describe('tenant overrides', () => {
    it('should use tenant override when it matches tenantId', () => {
      const flag = makeFlag({
        overrides: [makeOverride({ tenantId: 'tenant-1', enabled: true })],
      });
      const result = evaluator.evaluate(flag, { tenantId: 'tenant-1' });
      expect(result.result).toBe(true);
      expect(result.source).toBe('tenant_override');
    });

    it('should not use tenant override for different tenantId', () => {
      const flag = makeFlag({
        enabled: false,
        overrides: [makeOverride({ tenantId: 'tenant-1', enabled: true })],
      });
      const result = evaluator.evaluate(flag, { tenantId: 'tenant-2' });
      expect(result.result).toBe(false);
    });
  });

  describe('environment overrides', () => {
    it('should use environment override when it matches', () => {
      const flag = makeFlag({
        overrides: [makeOverride({ environment: 'staging', enabled: true })],
      });
      const result = evaluator.evaluate(flag, { environment: 'staging' });
      expect(result.result).toBe(true);
      expect(result.source).toBe('env_override');
    });

    it('should not use environment override for different env', () => {
      const flag = makeFlag({
        enabled: false,
        overrides: [makeOverride({ environment: 'staging', enabled: true })],
      });
      const result = evaluator.evaluate(flag, { environment: 'production' });
      expect(result.result).toBe(false);
    });
  });

  describe('override priority', () => {
    it('should prioritize user override over tenant override', () => {
      const flag = makeFlag({
        overrides: [
          makeOverride({ tenantId: 'tenant-1', enabled: false }),
          makeOverride({ userId: 'user-1', enabled: true }),
        ],
      });
      const result = evaluator.evaluate(flag, { userId: 'user-1', tenantId: 'tenant-1' });
      expect(result.result).toBe(true);
      expect(result.source).toBe('user_override');
    });

    it('should prioritize tenant override over environment override', () => {
      const flag = makeFlag({
        overrides: [
          makeOverride({ environment: 'staging', enabled: false }),
          makeOverride({ tenantId: 'tenant-1', enabled: true }),
        ],
      });
      const result = evaluator.evaluate(flag, {
        tenantId: 'tenant-1',
        environment: 'staging',
      });
      expect(result.result).toBe(true);
      expect(result.source).toBe('tenant_override');
    });
  });

  describe('percentage rollout', () => {
    it('should use percentage rollout when no override matches', () => {
      const flag = makeFlag({ percentage: 50 });
      const result = evaluator.evaluate(flag, { userId: 'user-1' });
      expect(result.source).toBe('percentage');
      expect(typeof result.result).toBe('boolean');
    });

    it('should be deterministic for same userId + flagKey', () => {
      const flag = makeFlag({ percentage: 50 });
      const r1 = evaluator.evaluate(flag, { userId: 'user-1' });
      const r2 = evaluator.evaluate(flag, { userId: 'user-1' });
      expect(r1.result).toBe(r2.result);
    });

    it('should fall back to global default when no identifier for percentage', () => {
      const flag = makeFlag({ percentage: 50, enabled: true });
      const result = evaluator.evaluate(flag, {});
      expect(result.result).toBe(true);
      expect(result.source).toBe('global');
    });

    it('should return true for 100% rollout', () => {
      const flag = makeFlag({ percentage: 100 });
      const result = evaluator.evaluate(flag, { userId: 'anyone' });
      expect(result.result).toBe(true);
      expect(result.source).toBe('percentage');
    });

    it('should distribute roughly according to percentage', () => {
      const flag = makeFlag({ key: 'ROLLOUT_FLAG', percentage: 30 });
      let enabledCount = 0;
      const total = 10_000;

      for (let i = 0; i < total; i++) {
        const result = evaluator.evaluate(flag, { userId: `user-${i}` });
        if (result.result) enabledCount++;
      }

      const actualPercentage = (enabledCount / total) * 100;
      expect(actualPercentage).toBeGreaterThan(25);
      expect(actualPercentage).toBeLessThan(35);
    });
  });

  describe('global default', () => {
    it('should return flag.enabled when no overrides and no percentage', () => {
      const flagOn = makeFlag({ enabled: true });
      expect(evaluator.evaluate(flagOn, {}).result).toBe(true);

      const flagOff = makeFlag({ enabled: false });
      expect(evaluator.evaluate(flagOff, {}).result).toBe(false);
    });

    it('should report source as global', () => {
      const flag = makeFlag({ enabled: true });
      expect(evaluator.evaluate(flag, {}).source).toBe('global');
    });
  });
});
