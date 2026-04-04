import { FlagContextMiddleware } from '../../src/middleware/flag-context.middleware';
import { FlagContext } from '../../src/services/flag-context';

describe('FlagContextMiddleware', () => {
  let middleware: FlagContextMiddleware;
  let flagContext: FlagContext;

  beforeEach(() => {
    flagContext = new FlagContext();
  });

  it('should extract userId using userIdExtractor and set it in context', (done) => {
    middleware = new FlagContextMiddleware(flagContext, {
      environment: 'test',
      userIdExtractor: (req: any) => req.user?.id ?? null,
    });

    const req = { user: { id: 'user-123' } } as any;
    const res = {} as any;

    middleware.use(req, res, () => {
      expect(flagContext.getUserId()).toBe('user-123');
      done();
    });
  });

  it('should set null userId when userIdExtractor is not provided', (done) => {
    middleware = new FlagContextMiddleware(flagContext, {
      environment: 'test',
    });

    const req = {} as any;
    const res = {} as any;

    middleware.use(req, res, () => {
      expect(flagContext.getUserId()).toBeNull();
      done();
    });
  });

  it('should set null userId when extractor returns null', (done) => {
    middleware = new FlagContextMiddleware(flagContext, {
      environment: 'test',
      userIdExtractor: () => null,
    });

    const req = {} as any;
    const res = {} as any;

    middleware.use(req, res, () => {
      expect(flagContext.getUserId()).toBeNull();
      done();
    });
  });
});
