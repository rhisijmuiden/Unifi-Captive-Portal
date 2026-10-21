import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, MailPlus, Pencil, Plus, Search, ShieldCheck, ShieldOff, Trash2, Users as UsersIcon } from 'lucide-react';
import { Segmented } from '../components/controls';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Switch } from '../components/ui';
import { api, type Role, type Tenant, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';

function UserForm({ user, tenants, defaultTenant, onClose }: { user: User | null; tenants: Tenant[]; defaultTenant?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: auth } = useAuth();
  const me = auth!.user!;
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    role: (user?.role ?? 'tenant_admin') as Role,
    tenantId: user?.tenantId ?? defaultTenant ?? tenants[0]?.id ?? '',
    isActive: user?.isActive ?? true,
    sendInvite: true,
  });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, tenantId: form.role === 'superadmin' ? null : form.tenantId || null };
      return user ? api.put(`/users/${user.id}`, body) : api.post<{ inviteError: string | null }>('/users', body);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      const inviteError = (res as { inviteError?: string | null })?.inviteError;
      if (inviteError) toast.warning(t('users.inviteFailed', { error: inviteError }));
      else toast.success(user ? t('users.updated') : form.sendInvite ? t('users.inviteSent') : t('users.created'));
      onClose();
    },
  });
  const roles: Role[] = me.role === 'superadmin' ? ['superadmin', 'tenant_admin', 'tenant_user'] : ['tenant_admin', 'tenant_user'];

  return (
    <Modal
      open
      onClose={onClose}
      title={user ? t('users.editTitle') : t('users.inviteTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="accent" loading={save.isPending} onClick={() => save.mutate()}>
            {user ? t('common.save') : form.sendInvite ? t('users.invite') : t('users.create')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('users.name')} htmlFor="u-name">
            <Input id="u-name" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t('users.email')} htmlFor="u-mail">
            <Input id="u-mail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('users.role')} htmlFor="u-role">
            <Select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} disabled={user?.id === me.id}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          {me.role === 'superadmin' && form.role !== 'superadmin' && (
            <Field label={t('users.tenant')} htmlFor="u-tenant">
              <Select id="u-tenant" value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}>
                {!tenants.length && <option value="">{t('users.noTenants')}</option>}
                {tenants.map((tn) => (
                  <option key={tn.id} value={tn.id}>
                    {tn.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {user && user.id !== me.id && <Switch checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label={t('users.accountActive')} description={t('users.accountActiveHint')} />}
        {!user && <Switch checked={form.sendInvite} onChange={(v) => setForm({ ...form, sendInvite: v })} label={t('users.sendInvite')} description={t('users.sendInviteHint')} />}
        {save.error && <p className="text-sm text-offline">{save.error.message}</p>}
      </div>
    </Modal>
  );
}

type Security = { settings: { require2fa: 'off' | 'admins' | 'all' }; platform: { requireCustomers: 'off' | 'admins' | 'all' }; members: number; enrolled: number };

/** The customer's own two-factor policy for their team. */
function TeamSecurity() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['security-settings'], queryFn: () => api.get<Security>('/security-settings') });
  const save = useMutation({
    mutationFn: (require2fa: string) => api.put('/security-settings', { require2fa }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['security-settings'] });
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!data) return null;
  const levels = (['off', 'admins', 'all'] as const).map((v) => ({ value: v, label: t(`twoFactor.levels.${v}`) }));
  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-center gap-4 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-koraal/12 text-accent">
          <ShieldCheck className="size-5" />
        </span>
        <div className="min-w-[220px] flex-1">
          <p className="font-semibold">{t('twoFactor.teamPolicy')}</p>
          <p className="text-sm text-muted">
            {t('twoFactor.teamEnrolled', { enrolled: data.enrolled, members: data.members })}
            {data.platform.requireCustomers !== 'off' && ` · ${t('twoFactor.platformRequires', { level: t(`twoFactor.levels.${data.platform.requireCustomers}`).toLowerCase() })}`}
          </p>
        </div>
        <div className="w-full sm:w-auto">
          <Segmented value={data.settings.require2fa} options={levels} onChange={(v) => save.mutate(v)} label={t('twoFactor.teamPolicy')} />
        </div>
      </div>
    </Card>
  );
}

export function UsersPage() {
  const { t } = useTranslation();
  const { data: auth } = useAuth();
  const me = auth!.user!;
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tenantFilter = params.get('tenant') ?? '';
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<User | null | 'new'>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);

  const tenants = useQuery({ queryKey: ['tenants'], queryFn: () => api.get<{ tenants: Tenant[] }>('/tenants'), enabled: me.role === 'superadmin' });
  const users = useQuery({
    queryKey: ['users', tenantFilter],
    queryFn: () => api.get<{ users: User[] }>(`/users${tenantFilter ? `?tenantId=${tenantFilter}` : ''}`),
  });
  const tenantName = (id: string | null) => tenants.data?.tenants.find((tn) => tn.id === id)?.name;

  const invite = useMutation({
    mutationFn: (id: string) => api.post(`/users/${id}/invite`),
    onSuccess: () => toast.success(t('users.inviteResent')),
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(t('users.deleted'));
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reset2fa = useMutation({
    mutationFn: (id: string) => api.post(`/users/${id}/reset-2fa`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(t('twoFactor.resetDone'));
      setResetting(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = (users.data?.users ?? []).filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <PageHeader
        eyebrow={t('users.eyebrow')}
        title={me.role === 'superadmin' ? t('users.titleAdmin') : t('users.titleTeam')}
        description={me.role === 'superadmin' ? t('users.descriptionAdmin') : t('users.descriptionTeam')}
        actions={
          <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            {t('users.invite')}
          </Button>
        }
      />
      {me.role === 'tenant_admin' && <TeamSecurity />}
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input placeholder={t('users.search')} className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {me.role === 'superadmin' && (
            <Select className="w-auto min-w-[200px]" value={tenantFilter} onChange={(e) => setParams(e.target.value ? { tenant: e.target.value } : {})}>
              <option value="">{t('users.allTenants')}</option>
              {tenants.data?.tenants.map((tn) => (
                <option key={tn.id} value={tn.id}>
                  {tn.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        {users.isLoading ? (
          <div className="p-8">
            <Spinner />
          </div>
        ) : !list.length ? (
          <EmptyState icon={<UsersIcon className="size-6" />} title={t('users.empty')} description={t('users.emptyHint')} />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-4 px-6 py-3.5 transition hover:bg-sunken/50">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-nacht to-[#2b3d66] text-sm font-bold text-white dark:from-lucht dark:to-[#c9dcff] dark:text-nacht">
                  {u.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-[180px] flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {u.name}
                    {u.id === me.id && <Badge>{t('common.you')}</Badge>}
                    {!u.isActive && <Badge tone="offline">{t('common.inactive')}</Badge>}
                    {u.ssoLinked && (
                      <Badge tone="info">
                        <KeyRound className="size-3" /> SSO
                      </Badge>
                    )}
                    {u.twoFactorEnabled && (
                      <Badge tone="online">
                        <ShieldCheck className="size-3" /> 2FA
                      </Badge>
                    )}
                  </p>
                  <p className="text-sm text-muted">{u.email}</p>
                </div>
                <div className="hidden min-w-[160px] text-sm md:block">
                  <p>{t(`roles.${u.role}`)}</p>
                  <p className="text-xs text-muted">{u.role === 'superadmin' ? t('users.platform') : (tenantName(u.tenantId) ?? '')}</p>
                </div>
                <div className="hidden w-32 text-xs text-muted lg:block">{u.lastLoginAt ? t('users.activeAgo', { when: timeAgo(u.lastLoginAt) }) : u.hasPassword || u.ssoLinked ? t('users.neverLoggedIn') : <Badge tone="warning">{t('users.invited')}</Badge>}</div>
                <div className="ml-auto flex gap-1">
                  {!u.hasPassword && !u.ssoLinked && (
                    <Button variant="ghost" size="sm" onClick={() => invite.mutate(u.id)} aria-label={t('users.resendInvite')} title={t('users.resendInvite')}>
                      <MailPlus className="size-4" />
                    </Button>
                  )}
                  {u.twoFactorEnabled && u.id !== me.id && (
                    <Button variant="ghost" size="sm" onClick={() => setResetting(u)} aria-label={t('twoFactor.reset')} title={t('twoFactor.reset')}>
                      <ShieldOff className="size-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setEditing(u)} aria-label={t('common.edit')}>
                    <Pencil className="size-4" />
                  </Button>
                  {u.id !== me.id && (
                    <Button variant="ghost" size="sm" onClick={() => setDeleting(u)} aria-label={t('common.delete')}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && <UserForm user={editing === 'new' ? null : editing} tenants={tenants.data?.tenants ?? []} defaultTenant={tenantFilter || undefined} onClose={() => setEditing(null)} />}
      <Modal
        open={Boolean(resetting)}
        onClose={() => setResetting(null)}
        title={t('twoFactor.reset')}
        description={t('twoFactor.resetText', { name: resetting?.name })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetting(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={reset2fa.isPending} onClick={() => resetting && reset2fa.mutate(resetting.id)}>
              {t('twoFactor.reset')}
            </Button>
          </>
        }
      >
        <span />
      </Modal>
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={t('users.deleteTitle')}
        description={t('users.deleteText', { name: deleting?.name, email: deleting?.email })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <span />
      </Modal>
    </>
  );
}
