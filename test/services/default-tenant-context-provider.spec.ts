import { DefaultTenantContextProvider } from '../../src/services/default-tenant-context-provider';

describe('DefaultTenantContextProvider', () => {
  let provider: DefaultTenantContextProvider;
  let moduleRef: { get: jest.Mock };

  beforeEach(() => {
    moduleRef = { get: jest.fn() };
    provider = new DefaultTenantContextProvider(moduleRef as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return null when @nestarc/tenancy is not installed', () => {
    // The default test environment does not have @nestarc/tenancy installed,
    // so require() inside getCurrentTenantId() will throw and catch will return null.
    const result = provider.getCurrentTenantId();

    expect(result).toBeNull();
  });

  it('should return tenant id when @nestarc/tenancy is installed and tenant is available', () => {
    const fakeTenancyService = { getCurrentTenant: jest.fn().mockReturnValue('tenant-abc') };

    // Mock require('@nestarc/tenancy') by intercepting the module resolution
    jest.mock('@nestarc/tenancy', () => ({ TenancyService: class FakeTenancyService {} }), { virtual: true });

    moduleRef.get.mockReturnValue(fakeTenancyService);

    const result = provider.getCurrentTenantId();

    expect(result).toBe('tenant-abc');
    expect(moduleRef.get).toHaveBeenCalledWith(expect.any(Function), { strict: false });
    expect(fakeTenancyService.getCurrentTenant).toHaveBeenCalled();
  });

  it('should return null when tenancy service returns null', () => {
    jest.mock('@nestarc/tenancy', () => ({ TenancyService: class FakeTenancyService {} }), { virtual: true });

    const fakeTenancyService = { getCurrentTenant: jest.fn().mockReturnValue(null) };
    moduleRef.get.mockReturnValue(fakeTenancyService);

    const result = provider.getCurrentTenantId();

    expect(result).toBeNull();
  });

  it('should return null when tenancy service is undefined', () => {
    jest.mock('@nestarc/tenancy', () => ({ TenancyService: class FakeTenancyService {} }), { virtual: true });

    moduleRef.get.mockReturnValue(undefined);

    const result = provider.getCurrentTenantId();

    expect(result).toBeNull();
  });

  it('should return null when moduleRef.get throws', () => {
    jest.mock('@nestarc/tenancy', () => ({ TenancyService: class FakeTenancyService {} }), { virtual: true });

    moduleRef.get.mockImplementation(() => { throw new Error('Provider not found'); });

    const result = provider.getCurrentTenantId();

    expect(result).toBeNull();
  });
});
