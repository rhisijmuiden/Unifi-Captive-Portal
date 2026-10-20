import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { EmptyState, Select } from '../components/ui';
import { api, type Tenant } from './api';
import { useAuth } from './auth';

const STORAGE_KEY = 'tenant';

const remembered = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

/**
 * The customer a portal page works on. Customer users are bound to their own company;
 * platform admins pick one (kept in ?tenant= and remembered on this device).
 */
export function useTenantScope() {
  const { data: auth } = useAuth();
  const user = auth!.user!;
  const isPlatform = user.role === 'superadmin';
  const [params, setParams] = useSearchParams();
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: () => api.get<{ tenants: Tenant[] }>('/tenants'), enabled: isPlatform });
  const list = tenants.data?.tenants ?? [];
  const fromUrl = params.get('tenant') ?? '';
  const candidate = fromUrl || remembered();
  const selected = isPlatform ? (list.find((tn) => tn.id === candidate)?.id ?? (list.length === 1 ? list[0].id : '')) : (user.tenantId ?? '');

  useEffect(() => {
    if (!isPlatform || !selected) return;
    try {
      localStorage.setItem(STORAGE_KEY, selected);
    } catch {
      /* not remembered, still works */
    }
  }, [isPlatform, selected]);

  const select = (id: string) => setParams(id ? { tenant: id } : {}, { replace: true });
  const canManage = user.role !== 'tenant_user';
  return {
    tenantId: selected,
    isPlatform,
    canManage,
    tenants: list,
    loading: isPlatform && tenants.isLoading,
    select,
    // Query string and body field the API expects from platform admins
    qs: isPlatform && selected ? `?tenantId=${selected}` : '',
    body: isPlatform && selected ? { tenantId: selected } : {},
  };
}

export function TenantPicker({ scope }: { scope: ReturnType<typeof useTenantScope> }) {
  const { t } = useTranslation();
  if (!scope.isPlatform) return null;
  return (
    <Select aria-label={t('tenantPicker.label')} className="w-full min-w-[220px] sm:w-auto" value={scope.tenantId} onChange={(e) => scope.select(e.target.value)}>
      <option value="">{t('tenantPicker.choose')}</option>
      {scope.tenants.map((tn) => (
        <option key={tn.id} value={tn.id}>
          {tn.name}
        </option>
      ))}
    </Select>
  );
}

export function ChooseTenant() {
  const { t } = useTranslation();
  return <EmptyState icon={<Building2 className="size-6" />} title={t('tenantPicker.emptyTitle')} description={t('tenantPicker.emptyText')} />;
}
