import { FlagContextResolver } from '../../src/services/flag-context-resolver';
import { FlagContext } from '../../src/services/flag-context';
import { TenantContextProvider } from '../../src/interfaces/tenant-context-provider.interface';
import { FeatureFlagModuleOptions } from '../../src/interfaces/feature-flag-options.interface';

describe('FlagContextResolver', () => {
  let resolver: FlagContextResolver;
  let flagContext: { getUserId: jest.Mock };
  let tenantProvider: { getCurrentTenantId: jest.Mock };
  let options: FeatureFlagModuleOptions;

  beforeEach(() => {
    flagContext = { getUserId: jest.fn().mockReturnValue('ambient-user') };
    tenantProvider = { getCurrentTenantId: jest.fn().mockReturnValue('ambient-tenant') };
    options = { environment: 'production' };

    resolver = new FlagContextResolver(
      options,
      flagContext as unknown as FlagContext,
      tenantProvider as TenantContextProvider,
    );
  });

  describe('userId resolution', () => {
    it('should return explicit userId when provided', () => {
      const result = resolver.resolve({ userId: 'explicit-user' });

      expect(result.userId).toBe('explicit-user');
      expect(flagContext.getUserId).not.toHaveBeenCalled();
    });

    it('should fall back to FlagContext.getUserId() when userId not in explicit', () => {
      const result = resolver.resolve({});

      expect(result.userId).toBe('ambient-user');
      expect(flagContext.getUserId).toHaveBeenCalled();
    });

    it('should fall back to FlagContext.getUserId() when no explicit context', () => {
      const result = resolver.resolve();

      expect(result.userId).toBe('ambient-user');
    });

    it('should use explicit null userId (explicit null overrides ambient)', () => {
      const result = resolver.resolve({ userId: null });

      expect(result.userId).toBeNull();
      expect(flagContext.getUserId).not.toHaveBeenCalled();
    });
  });

  describe('tenantId resolution', () => {
    it('should return explicit tenantId when provided', () => {
      const result = resolver.resolve({ tenantId: 'explicit-tenant' });

      expect(result.tenantId).toBe('explicit-tenant');
      expect(tenantProvider.getCurrentTenantId).not.toHaveBeenCalled();
    });

    it('should fall back to TenantContextProvider when tenantId not in explicit', () => {
      const result = resolver.resolve({});

      expect(result.tenantId).toBe('ambient-tenant');
      expect(tenantProvider.getCurrentTenantId).toHaveBeenCalled();
    });

    it('should use explicit null tenantId (explicit null overrides ambient)', () => {
      const result = resolver.resolve({ tenantId: null });

      expect(result.tenantId).toBeNull();
      expect(tenantProvider.getCurrentTenantId).not.toHaveBeenCalled();
    });
  });

  describe('environment resolution', () => {
    it('should return explicit environment when provided', () => {
      const result = resolver.resolve({ environment: 'staging' });

      expect(result.environment).toBe('staging');
    });

    it('should fall back to options.environment when environment not in explicit', () => {
      const result = resolver.resolve({});

      expect(result.environment).toBe('production');
    });

    it('should fall back to options.environment when no explicit context', () => {
      const result = resolver.resolve();

      expect(result.environment).toBe('production');
    });
  });

  describe('combined resolution', () => {
    it('should resolve all fields from explicit context', () => {
      const result = resolver.resolve({
        userId: 'u1',
        tenantId: 't1',
        environment: 'dev',
      });

      expect(result).toEqual({
        userId: 'u1',
        tenantId: 't1',
        environment: 'dev',
      });
    });

    it('should resolve all fields from ambient sources when no explicit context', () => {
      const result = resolver.resolve();

      expect(result).toEqual({
        userId: 'ambient-user',
        tenantId: 'ambient-tenant',
        environment: 'production',
      });
    });
  });
});
