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
    attributes: { tenantId: 'tenant-1' },
    priority: 0,
    enabled: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
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
      expect(result.value).toBe(false);
      expect(result.source).toBe('global');
      expect(result.reason).toBe('ARCHIVED');
    });
  });

  describe('attribute overrides', () => {
    it('should use an override when all attributes match', () => {
      const flag = makeFlag({
        overrides: [makeOverride({ attributes: { tenantId: 'tenant-1', plan: 'pro' } })],
      });

      const result = evaluator.evaluate(flag, {
        tenantId: 'tenant-1',
        attributes: { tenantId: 'tenant-1', plan: 'pro', country: 'KR' },
      });

      expect(result.result).toBe(true);
      expect(result.source).toBe('override');
      expect(result.reason).toBe('OVERRIDE_MATCH');
      expect(result.matchedOverrideId).toBe('override-1');
    });

    it('should not use an override when any attribute differs', () => {
      const flag = makeFlag({
        enabled: false,
        overrides: [makeOverride({ attributes: { country: 'KR' } })],
      });

      const result = evaluator.evaluate(flag, {
        attributes: { country: 'US' },
      });

      expect(result.result).toBe(false);
      expect(result.source).toBe('global');
    });

    it('should not use an override when the context is missing an attribute', () => {
      const flag = makeFlag({
        enabled: false,
        overrides: [makeOverride({ attributes: { tenantId: 'tenant-1', plan: 'pro' } })],
      });

      const result = evaluator.evaluate(flag, {
        attributes: { tenantId: 'tenant-1' },
      });

      expect(result.result).toBe(false);
    });

    it('should prefer the override with more matching attributes', () => {
      const flag = makeFlag({
        overrides: [
          makeOverride({
            id: 'broad',
            attributes: { tenantId: 'tenant-1' },
            enabled: false,
          }),
          makeOverride({
            id: 'specific',
            attributes: { tenantId: 'tenant-1', plan: 'pro' },
            enabled: true,
          }),
        ],
      });

      const result = evaluator.evaluate(flag, {
        attributes: { tenantId: 'tenant-1', plan: 'pro' },
      });

      expect(result.result).toBe(true);
    });

    it('should use priority when specificity is tied', () => {
      const flag = makeFlag({
        overrides: [
          makeOverride({
            id: 'low-priority',
            attributes: { tenantId: 'tenant-1' },
            priority: 0,
            enabled: false,
          }),
          makeOverride({
            id: 'high-priority',
            attributes: { plan: 'pro' },
            priority: 20,
            enabled: true,
          }),
        ],
      });

      const result = evaluator.evaluate(flag, {
        attributes: { tenantId: 'tenant-1', plan: 'pro' },
      });

      expect(result.result).toBe(true);
    });

    it('should tie-break by earlier createdAt', () => {
      const flag = makeFlag({
        overrides: [
          makeOverride({
            id: 'b-override',
            attributes: { plan: 'pro' },
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            enabled: false,
          }),
          makeOverride({
            id: 'a-override',
            attributes: { plan: 'pro' },
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            enabled: true,
          }),
        ],
      });

      const result = evaluator.evaluate(flag, {
        attributes: { plan: 'pro' },
      });

      expect(result.result).toBe(true);
    });

    it('should handle serialized createdAt values when tie-breaking', () => {
      const flag = makeFlag({
        overrides: [
          makeOverride({
            id: 'later-override',
            attributes: { plan: 'pro' },
            createdAt: '2026-01-02T00:00:00.000Z' as unknown as Date,
            enabled: false,
          }),
          makeOverride({
            id: 'earlier-override',
            attributes: { plan: 'pro' },
            createdAt: '2026-01-01T00:00:00.000Z' as unknown as Date,
            enabled: true,
          }),
        ],
      });
      let result: ReturnType<FlagEvaluatorService['evaluate']> | undefined;

      expect(() => {
        result = evaluator.evaluate(flag, {
          attributes: { plan: 'pro' },
        });
      }).not.toThrow();
      expect(result?.result).toBe(true);
    });

    it('should tie-break by id when createdAt is tied', () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      const flag = makeFlag({
        overrides: [
          makeOverride({
            id: 'b-override',
            attributes: { plan: 'pro' },
            createdAt,
            enabled: false,
          }),
          makeOverride({
            id: 'a-override',
            attributes: { plan: 'pro' },
            createdAt,
            enabled: true,
          }),
        ],
      });

      const result = evaluator.evaluate(flag, {
        attributes: { plan: 'pro' },
      });

      expect(result.result).toBe(true);
    });

    it('should ignore empty override attributes defensively', () => {
      const flag = makeFlag({
        enabled: false,
        overrides: [makeOverride({ attributes: {}, enabled: true })],
      });

      const result = evaluator.evaluate(flag, {
        attributes: { tenantId: 'tenant-1' },
      });

      expect(result.result).toBe(false);
    });
  });

  describe('percentage rollout', () => {
    it('should use percentage rollout when no override matches', () => {
      const flag = makeFlag({ percentage: 50 });
      const result = evaluator.evaluate(flag, { userId: 'user-1' });
      expect(result.source).toBe('percentage');
      expect(typeof result.result).toBe('boolean');
      expect(result.reason).toMatch(/^PERCENTAGE_/);
      expect(result.targetingKey).toBe('user-1');
      expect(typeof result.bucket).toBe('number');
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
      expect(result.reason).toBe('PERCENTAGE_NO_TARGETING_KEY');
    });

    it('should return true for 100% rollout', () => {
      const flag = makeFlag({ percentage: 100 });
      const result = evaluator.evaluate(flag, { userId: 'anyone' });
      expect(result.result).toBe(true);
      expect(result.source).toBe('percentage');
      expect(result.reason).toBe('PERCENTAGE_MATCH');
    });

    it('should prefer explicit targetingKey for percentage rollout', () => {
      const flag = makeFlag({ percentage: 50 });
      const result = evaluator.evaluate(flag, {
        userId: 'user-1',
        targetingKey: 'stable-subject',
      });

      expect(result.targetingKey).toBe('stable-subject');
      expect(typeof result.bucket).toBe('number');
    });

    it('should use metadata bucketBy before legacy userId fallback', () => {
      const flag = makeFlag({ percentage: 50, metadata: { bucketBy: 'tenantId' } });
      const result = evaluator.evaluate(flag, {
        userId: 'user-1',
        tenantId: 'tenant-1',
      });

      expect(result.targetingKey).toBe('tenant-1');
    });

    it('should let evaluator options override metadata bucketBy', () => {
      const flag = makeFlag({ percentage: 50, metadata: { bucketBy: 'userId' } });
      const result = evaluator.evaluate(
        flag,
        {
          userId: 'user-1',
          tenantId: 'tenant-1',
        },
        { bucketBy: 'tenantId' },
      );

      expect(result.targetingKey).toBe('tenant-1');
    });

    it('should bucket by explicit userId, environment, and custom attributes', () => {
      const flag = makeFlag({ percentage: 50 });

      expect(
        evaluator.evaluate(flag, { userId: 'user-1', tenantId: 'tenant-1' }, {
          bucketBy: 'userId',
        }).targetingKey,
      ).toBe('user-1');
      expect(
        evaluator.evaluate(flag, { environment: 'production' }, {
          bucketBy: 'environment',
        }).targetingKey,
      ).toBe('production');
      expect(
        evaluator.evaluate(flag, { attributes: { accountId: 'acct-1' } }, {
          bucketBy: 'accountId',
        }).targetingKey,
      ).toBe('acct-1');
    });

    it('should fall back to global default when configured bucket values are missing', () => {
      const flag = makeFlag({ percentage: 50, enabled: true });

      const targetingKeyResult = evaluator.evaluate(flag, {}, {
        bucketBy: 'targetingKey',
      });
      const nullAttributeResult = evaluator.evaluate(
        flag,
        { attributes: { accountId: null } },
        { bucketBy: 'accountId' },
      );

      expect(targetingKeyResult).toEqual(
        expect.objectContaining({
          result: true,
          source: 'global',
          reason: 'PERCENTAGE_NO_TARGETING_KEY',
        }),
      );
      expect(nullAttributeResult.reason).toBe('PERCENTAGE_NO_TARGETING_KEY');
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
      expect(evaluator.evaluate(flag, {}).reason).toBe('GLOBAL');
    });
  });
});
