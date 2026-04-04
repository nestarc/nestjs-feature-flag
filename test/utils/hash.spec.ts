import { murmurhash3 } from '../../src/utils/hash';

describe('murmurhash3', () => {
  it('should return a non-negative 32-bit integer', () => {
    const result = murmurhash3('test-key');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('should be deterministic — same input always produces same output', () => {
    const a = murmurhash3('MY_FLAG:user-123');
    const b = murmurhash3('MY_FLAG:user-123');
    expect(a).toBe(b);
  });

  it('should produce different outputs for different inputs', () => {
    const a = murmurhash3('FLAG_A:user-1');
    const b = murmurhash3('FLAG_B:user-1');
    expect(a).not.toBe(b);
  });

  it('should support custom seed', () => {
    const a = murmurhash3('test', 0);
    const b = murmurhash3('test', 42);
    expect(a).not.toBe(b);
  });

  it('should distribute buckets uniformly across 0-99', () => {
    const buckets = new Array(100).fill(0);
    const iterations = 10_000;

    for (let i = 0; i < iterations; i++) {
      const bucket = murmurhash3(`FLAG_KEY:user-${i}`) % 100;
      buckets[bucket]++;
    }

    const expected = iterations / 100; // 100
    const tolerance = expected * 0.3; // ±30% per bucket

    for (let i = 0; i < 100; i++) {
      expect(buckets[i]).toBeGreaterThan(expected - tolerance);
      expect(buckets[i]).toBeLessThan(expected + tolerance);
    }
  });

  it('should handle empty string', () => {
    const result = murmurhash3('');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result)).toBe(true);
  });
});
