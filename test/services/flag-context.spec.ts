import { FlagContext } from '../../src/services/flag-context';

describe('FlagContext', () => {
  let context: FlagContext;

  beforeEach(() => {
    context = new FlagContext();
  });

  it('should return null userId outside of a run context', () => {
    expect(context.getUserId()).toBeNull();
  });

  it('should return userId within a run context', () => {
    context.run({ userId: 'user-123' }, () => {
      expect(context.getUserId()).toBe('user-123');
    });
  });

  it('should return null userId when store has null userId', () => {
    context.run({ userId: null }, () => {
      expect(context.getUserId()).toBeNull();
    });
  });

  it('should isolate contexts between nested runs', () => {
    context.run({ userId: 'outer' }, () => {
      expect(context.getUserId()).toBe('outer');

      context.run({ userId: 'inner' }, () => {
        expect(context.getUserId()).toBe('inner');
      });

      expect(context.getUserId()).toBe('outer');
    });
  });

  it('should return the callback return value', () => {
    const result = context.run({ userId: 'test' }, () => 42);
    expect(result).toBe(42);
  });
});
