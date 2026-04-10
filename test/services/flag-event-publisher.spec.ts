import { FlagEventPublisher } from '../../src/services/flag-event-publisher';

describe('FlagEventPublisher', () => {
  let publisher: FlagEventPublisher;
  let eventEmitter: { emit: jest.Mock };

  describe('when emitEvents is true and emitter is provided', () => {
    beforeEach(() => {
      eventEmitter = { emit: jest.fn() };
      publisher = new FlagEventPublisher({ environment: 'test', emitEvents: true }, eventEmitter);
    });

    it('should call eventEmitter.emit()', () => {
      publisher.emit('flag.evaluated', { key: 'my-flag', result: true });

      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    });

    it('should pass correct event name and payload', () => {
      const payload = { key: 'my-flag', result: true, userId: 'u1' };

      publisher.emit('flag.evaluated', payload);

      expect(eventEmitter.emit).toHaveBeenCalledWith('flag.evaluated', payload);
    });
  });

  describe('when emitEvents is false', () => {
    beforeEach(() => {
      eventEmitter = { emit: jest.fn() };
      publisher = new FlagEventPublisher({ environment: 'test', emitEvents: false }, eventEmitter);
    });

    it('should not call eventEmitter.emit()', () => {
      publisher.emit('flag.evaluated', { key: 'my-flag' });

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('when emitEvents is undefined (defaults to falsy)', () => {
    beforeEach(() => {
      eventEmitter = { emit: jest.fn() };
      publisher = new FlagEventPublisher({ environment: 'test' }, eventEmitter);
    });

    it('should not call eventEmitter.emit()', () => {
      publisher.emit('flag.evaluated', { key: 'my-flag' });

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('when eventEmitter is undefined', () => {
    beforeEach(() => {
      publisher = new FlagEventPublisher({ environment: 'test', emitEvents: true }, undefined);
    });

    it('should not throw and should do nothing', () => {
      expect(() => publisher.emit('flag.evaluated', { key: 'my-flag' })).not.toThrow();
    });
  });

  describe('when eventEmitter is null (cast)', () => {
    beforeEach(() => {
      publisher = new FlagEventPublisher({ environment: 'test', emitEvents: true }, null as any);
    });

    it('should not throw and should do nothing', () => {
      expect(() => publisher.emit('flag.evaluated', { key: 'my-flag' })).not.toThrow();
    });
  });
});
