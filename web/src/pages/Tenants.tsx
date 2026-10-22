import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Receipt, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '../components/ui';
import { CredentialsChoice, CredentialsDialog, type CredentialsMode, type GeneratedCredentials } from '../components/Credentials';
import { api, type Tenant } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';

const slugify = (v: string) =>
  v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

function TenantForm({ tenant, onClose, resellers }: { tenant: Tenant | null; onClose: () => void; resellers?: { id: string; name: string }[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: tenant?.name ?? '',
    slug: tenant?.slug ?? '',
    contactEmail: tenant?.contactEmail ?? '',
    status: tenant?.status ?? 'active',
    notes: tenant?.notes ?? '',
    // Only the platform admin assigns a customer to a reseller
    ...(resellers ? { resellerId: tenant?.resellerId ?? '' } : {}),
  });
  const [admin, setAdmin] = useState({ name: '', email: '', credentials: 'invite' as CredentialsMode, mustChangePassword: true });
  const [issued, setIssued] = useState<{ credentials: GeneratedCredentials; name: string } | null>(null);
  const [slugTouched, setSlugTouched] = useState(Boolean(tenant));
  const body = () => ('resellerId' in form ? { ...form, resellerId: form.resellerId || null } : form);
  const save = useMutation({
    mutationFn: () =>
      tenant
        ? api.put<{ invited?: string | null; inviteError?: string | null; credentials?: GeneratedCredentials | null }>(`/tenants/${tenant.id}`, body())
        : api.post<{ invited?: string | null; inviteError?: string | null; credentials?: GeneratedCredentials | null }>('/tenants', { ...body(), admin: admin.email.trim() ? admin : null }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['tenants'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (res.inviteError) toast.warning(t('tenants.inviteFailed', { error: res.inviteError }));
      else if (res.invited) toast.success(t('tenants.createdInvited', { email: res.invited }));
      else toast.success(tenant ? t('tenants.updated') : t('tenants.created'));
      // Generated login details stay on screen until they have been passed on
      if (res.credentials) setIssued({ credentials: res.credentials, name: admin.name });
      else onClose();
    },
  });
  if (issued) return <CredentialsDialog credentials={issued.credentials} name={issued.name} onClose={onClose} />;
  return (
    <Modal
      open
      onClose={onClose}
      title={tenant ? t('tenants.edit') : t('tenants.new')}
      description={t('tenants.formDescription')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="accent" loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('tenants.name')} htmlFor="t-name">
          <Input
            id="t-name"
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugTouched ? form.slug : slugify(e.target.value) })}
          />
        </Field>
        <Field label={t('tenants.slug')} htmlFor="t-slug" hint={t('tenants.slugHint')}>
          <Input
            id="t-slug"
            value={form.slug}
            onChange={(e) => {
              setSlugTouched(true);
              setForm({ ...form, slug: slugify(e.target.value) });
            }}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('tenants.contactEmail')} htmlFor="t-mail">
            <Input id="t-mail" type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
          </Field>
          <Field label={t('tenants.status')} htmlFor="t-status">
            <Select id="t-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Tenant['status'] })}>
              <option value="active">{t('common.active')}</option>
              <option value="suspended">{t('common.suspended')}</option>
            </Select>
          </Field>
        </div>
        {resellers && resellers.length > 0 && (
          <Field label={t('resellers.reseller')} htmlFor="t-reseller" hint={t('resellers.tenantHint')}>
            <Select id="t-reseller" value={form.resellerId ?? ''} onChange={(e) => setForm({ ...form, resellerId: e.target.value })}>
              <option value="">{t('resellers.direct')}</option>
              {resellers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {!tenant && (
          <div className="rounded-xl border border-line p-4">
            <p className="text-sm font-semibold">{t('tenants.adminTitle')}</p>
            <p className="mb-3 text-xs text-muted">{t('tenants.adminHint')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('tenants.adminName')} htmlFor="t-admin-name">
                <Input id="t-admin-name" value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} />
              </Field>
              <Field label={t('tenants.adminEmail')} htmlFor="t-admin-mail">
                <Input id="t-admin-mail" type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} />
              </Field>
            </div>
            <div className="mt-4">
              <CredentialsChoice
                value={admin.credentials}
                onChange={(credentials) => setAdmin({ ...admin, credentials })}
                mustChange={admin.mustChangePassword}
                onMustChange={(mustChangePassword) => setAdmin({ ...admin, mustChangePassword })}
              />
            </div>
          </div>
        )}
        <Field label={t('tenants.notes')} htmlFor="t-notes">
          <Textarea id="t-notes" rows={3} className="font-sans text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        {save.error && <p className="text-sm text-offline">{save.error.message}</p>}
      </div>
    </Modal>
  );
}

export function TenantsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Tenant | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Tenant | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['tenants'], queryFn: () => api.get<{ tenants: Tenant[] }>('/tenants') });
  const isPlatform = useAuth().data?.user?.role === 'superadmin';
  const resellers = useQuery({ queryKey: ['resellers'], queryFn: () => api.get<{ resellers: { id: string; name: string }[] }>('/resellers'), enabled: isPlatform });
  const limit = useQuery({ queryKey: ['reseller'], queryFn: () => api.get<{ reseller: { maxTenants: number | null; tenantCount: number } }>('/reseller'), enabled: !isPlatform });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/tenants/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] });
      toast.success(t('tenants.deleted'));
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tenants = (data?.tenants ?? []).filter((tn) => `${tn.name} ${tn.slug} ${tn.contactEmail ?? ''}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <PageHeader
        eyebrow={t('tenants.eyebrow')}
        title={t('tenants.title')}
        description={isPlatform ? t('tenants.description') : t('tenants.descriptionReseller')}
        actions={
          <div className="flex items-center gap-3">
            {limit.data?.reseller.maxTenants != null && (
              <span className="text-sm text-muted">{t('resellers.usage', { count: limit.data.reseller.tenantCount, max: limit.data.reseller.maxTenants })}</span>
            )}
            <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              {t('tenants.new')}
            </Button>
          </div>
        }
      />
      <Card>
        <div className="border-b border-line p-4">
          <div className="relative max-w-sm">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input placeholder={t('tenants.search')} className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        {isLoading ? (
          <div className="p-8">
            <Spinner />
          </div>
        ) : !tenants.length ? (
          <EmptyState
            icon={<Building2 className="size-6" />}
            title={query ? t('tenants.noneFound') : t('tenants.empty')}
            description={query ? t('tenants.noneFoundHint') : t('tenants.emptyHint')}
            action={!query && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>{t('tenants.new')}</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-6 py-3 font-medium">{t('tenants.colTenant')}</th>
                  <th className="px-6 py-3 font-medium">{t('tenants.colStatus')}</th>
                  <th className="hidden px-6 py-3 font-medium md:table-cell">{t('tenants.colUsers')}</th>
                  <th className="hidden px-6 py-3 font-medium md:table-cell">{t('tenants.colCreated')}</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tenants.map((tenant) => (
                  <tr key={tenant.id} className="transition hover:bg-sunken/50">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-lucht/25 text-sm font-bold text-nacht dark:text-lucht">{tenant.name.slice(0, 2).toUpperCase()}</span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{tenant.name}</p>
                          <p className="truncate text-xs text-muted">
                            {tenant.contactEmail ?? tenant.slug}
                            {isPlatform && tenant.resellerName && <span className="ml-2 rounded-full bg-sunken px-2 py-0.5 text-[11px]">{tenant.resellerName}</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3">{tenant.status === 'active' ? <Badge tone="online">{t('common.active')}</Badge> : <Badge tone="warning">{t('common.suspended')}</Badge>}</td>
                    <td className="hidden px-6 py-3 md:table-cell">
                      <Link to={`/users?tenant=${tenant.id}`} className="text-accent hover:underline">
                        {tenant.userCount ?? 0}
                      </Link>
                    </td>
                    <td className="hidden px-6 py-3 text-muted md:table-cell">{formatDate(tenant.createdAt)}</td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end gap-1">
                        {isPlatform && (
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/billing?tab=customers&edit=${tenant.id}`)} aria-label={t('tenants.billing')} title={t('tenants.billing')}>
                            <Receipt className="size-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setEditing(tenant)} aria-label={t('common.edit')}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleting(tenant)} aria-label={t('common.delete')}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <TenantForm tenant={editing === 'new' ? null : editing} resellers={isPlatform ? (resellers.data?.resellers ?? []) : undefined} onClose={() => setEditing(null)} />}
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={t('tenants.deleteTitle')}
        description={t('tenants.deleteText', { name: deleting?.name })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>
              {t('tenants.deleteConfirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{t('tenants.deleteTip')}</p>
      </Modal>
    </>
  );
}
