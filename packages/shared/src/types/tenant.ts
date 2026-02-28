export interface TenantContext {
  tenantId: string;
}

export interface PlatformContext {
  tenantId: null;
}

export type RequestContext = TenantContext | PlatformContext;
