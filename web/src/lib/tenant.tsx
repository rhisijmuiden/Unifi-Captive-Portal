import { useAuth } from './auth';

/**
 * The customer a portal page works on. Portal pages only exist in a customer's own
 * environment: the platform admin creates customers but does not manage their portals.
 */
export function useTenantScope() {
  const { data: auth } = useAuth();
  const user = auth!.user!;
  return {
    tenantId: user.tenantId ?? '',
    canManage: user.role === 'tenant_admin',
  };
}
