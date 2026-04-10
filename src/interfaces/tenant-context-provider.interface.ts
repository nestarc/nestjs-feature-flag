export interface TenantContextProvider {
  getCurrentTenantId(): string | null;
}
