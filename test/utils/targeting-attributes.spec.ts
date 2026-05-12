import {
  isTargetingAttributeValue,
  isTargetingAttributes,
  normalizeTargetingAttributes,
  matchesTargetingAttributes,
} from '../../src/utils/targeting-attributes';

describe('targeting attributes utilities', () => {
  describe('isTargetingAttributeValue', () => {
    it('accepts primitive JSON values and null', () => {
      expect(isTargetingAttributeValue('KR')).toBe(true);
      expect(isTargetingAttributeValue(42)).toBe(true);
      expect(isTargetingAttributeValue(true)).toBe(true);
      expect(isTargetingAttributeValue(null)).toBe(true);
    });

    it('rejects arrays, objects, and undefined', () => {
      expect(isTargetingAttributeValue(['KR'])).toBe(false);
      expect(isTargetingAttributeValue({ country: 'KR' })).toBe(false);
      expect(isTargetingAttributeValue(undefined)).toBe(false);
    });

    it('rejects non-finite numbers', () => {
      expect(isTargetingAttributeValue(NaN)).toBe(false);
      expect(isTargetingAttributeValue(Infinity)).toBe(false);
      expect(isTargetingAttributeValue(-Infinity)).toBe(false);
    });
  });

  describe('isTargetingAttributes', () => {
    it('accepts a non-empty object with primitive values', () => {
      expect(isTargetingAttributes({ tenantId: 't-1', plan: 'pro', beta: true })).toBe(true);
    });

    it('rejects empty objects when allowEmpty is false', () => {
      expect(isTargetingAttributes({}, { allowEmpty: false })).toBe(false);
    });

    it('accepts empty objects when allowEmpty is true', () => {
      expect(isTargetingAttributes({}, { allowEmpty: true })).toBe(true);
    });

    it('rejects arrays and nested objects', () => {
      expect(isTargetingAttributes(['tenantId'])).toBe(false);
      expect(isTargetingAttributes({ plan: { name: 'pro' } })).toBe(false);
    });

    it('rejects attributes with non-finite number values', () => {
      expect(isTargetingAttributes({ rollout: NaN })).toBe(false);
      expect(isTargetingAttributes({ rollout: Infinity })).toBe(false);
      expect(isTargetingAttributes({ rollout: -Infinity })).toBe(false);
    });
  });

  describe('normalizeTargetingAttributes', () => {
    it('returns a shallow copy of valid attributes', () => {
      const input = { tenantId: 't-1', country: 'KR' };
      const result = normalizeTargetingAttributes(input, { allowEmpty: false });

      expect(result).toEqual(input);
      expect(result).not.toBe(input);
    });

    it('throws for invalid values', () => {
      expect(() => normalizeTargetingAttributes({ plan: ['pro'] }, { allowEmpty: false })).toThrow(
        'attributes must be a non-empty object with string, number, boolean, or null values',
      );
    });
  });

  describe('matchesTargetingAttributes', () => {
    it('matches when every override attribute exists in context with the same value', () => {
      expect(
        matchesTargetingAttributes(
          { tenantId: 't-1', plan: 'pro' },
          { tenantId: 't-1', plan: 'pro', country: 'KR' },
        ),
      ).toBe(true);
    });

    it('does not match when a value differs', () => {
      expect(matchesTargetingAttributes({ country: 'KR' }, { country: 'US' })).toBe(false);
    });

    it('does not match when a key is missing', () => {
      expect(matchesTargetingAttributes({ tenantId: 't-1', plan: 'pro' }, { tenantId: 't-1' })).toBe(
        false,
      );
    });

    it('does not match empty override attributes', () => {
      expect(matchesTargetingAttributes({}, { tenantId: 't-1' })).toBe(false);
    });
  });
});
