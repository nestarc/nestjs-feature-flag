import { VERSION } from '../src';

describe('package', () => {
  it('should export version', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
