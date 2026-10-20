import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, MailPlus, Pencil, Plus, Search, Trash2, Users as UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Switch } from '../components/ui';
import { api, roleLabel, type Role, type Tenant, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';

function UserForm({ user, tenants, defaultTenant, onClose }: { user: User | null; tenants: Tenant[]; defaultTenant?: string; onClose: () => void }) {
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
      if (inviteError) toast.warning(`Gebruiker aangemaakt, maar uitnodiging niet verstuurd: ${inviteError}`);
      else toast.success(user ? 'Gebruiker bijgewerkt' : form.sendInvite ? 'Uitnodiging verstuurd' : 'Gebruiker aangemaakt');
      onClose();
    },
  });
  const roles: Role[] = me.role === 'superadmin' ? ['superadmin', 'tenant_admin', 'tenant_user'] : ['tenant_admin', 'tenant_user'];

  return (
    <Modal
      open
      onClose={onClose}
      title={user ? 'Gebruiker bewerken' : 'Gebruiker uitnodigen'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuleren
          </Button>
          <Button variant="accent" loading={save.isPending} onClick={() => save.mutate()}>
            {user ? 'Opslaan' : form.sendInvite ? 'Uitnodigen' : 'Aanmaken'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Naam" htmlFor="u-name">
            <Input id="u-name" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="E-mailadres" htmlFor="u-mail">
            <Input id="u-mail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rol" htmlFor="u-role">
            <Select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} disabled={user?.id === me.id}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {roleLabel[r]}
                </option>
              ))}
            </Select>
          </Field>
          {me.role === 'superadmin' && form.role !== 'superadmin' && (
            <Field label="Klant" htmlFor="u-tenant">
              <Select id="u-tenant" value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}>
                {!tenants.length && <option value="">Maak eerst een klant aan</option>}
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {user && user.id !== me.id && <Switch checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Account actief" description="Een inactief account kan niet meer inloggen." />}
        {!user && <Switch checked={form.sendInvite} onChange={(v) => setForm({ ...form, sendInvite: v })} label="Stuur uitnodiging per e-mail" description="De gebruiker kiest zelf een wachtwoord, of logt in met Microsoft." />}
        {save.error && <p className="text-sm text-offline">{save.error.message}</p>}
      </div>
    </Modal>
  );
}

export function UsersPage() {
  const { data: auth } = useAuth();
  const me = auth!.user!;
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tenantFilter = params.get('tenant') ?? '';
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<User | null | 'new'>(null);
  const [deleting, setDeleting] = useState<User | null>(null);

  const tenants = useQuery({ queryKey: ['tenants'], queryFn: () => api.get<{ tenants: Tenant[] }>('/tenants'), enabled: me.role === 'superadmin' });
  const users = useQuery({
    queryKey: ['users', tenantFilter],
    queryFn: () => api.get<{ users: User[] }>(`/users${tenantFilter ? `?tenantId=${tenantFilter}` : ''}`),
  });
  const tenantName = (id: string | null) => tenants.data?.tenants.find((t) => t.id === id)?.name;

  const invite = useMutation({
    mutationFn: (id: string) => api.post(`/users/${id}/invite`),
    onSuccess: () => toast.success('Uitnodiging opnieuw verstuurd'),
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Gebruiker verwijderd');
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = (users.data?.users ?? []).filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <PageHeader
        eyebrow="Beheer"
        title={me.role === 'superadmin' ? 'Gebruikers' : 'Team'}
        description={me.role === 'superadmin' ? 'Platformbeheerders en de gebruikers van je klanten.' : 'Collega’s die jullie portals mogen beheren.'}
        actions={
          <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Uitnodigen
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input placeholder="Zoek op naam of e-mail…" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {me.role === 'superadmin' && (
            <Select className="w-auto min-w-[200px]" value={tenantFilter} onChange={(e) => setParams(e.target.value ? { tenant: e.target.value } : {})}>
              <option value="">Alle klanten</option>
              {tenants.data?.tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
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
          <EmptyState icon={<UsersIcon className="size-6" />} title="Geen gebruikers" description="Nodig iemand uit om samen portals te beheren." />
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
                    {u.id === me.id && <Badge>Jij</Badge>}
                    {!u.isActive && <Badge tone="offline">Inactief</Badge>}
                    {u.ssoLinked && (
                      <Badge tone="info">
                        <KeyRound className="size-3" /> SSO
                      </Badge>
                    )}
                  </p>
                  <p className="text-sm text-muted">{u.email}</p>
                </div>
                <div className="hidden min-w-[160px] text-sm md:block">
                  <p>{roleLabel[u.role]}</p>
                  <p className="text-xs text-muted">{u.role === 'superadmin' ? 'Platform' : (tenantName(u.tenantId) ?? '')}</p>
                </div>
                <div className="hidden w-32 text-xs text-muted lg:block">{u.lastLoginAt ? `Actief ${timeAgo(u.lastLoginAt)}` : u.hasPassword || u.ssoLinked ? 'Nog niet ingelogd' : <Badge tone="warning">Uitgenodigd</Badge>}</div>
                <div className="ml-auto flex gap-1">
                  {!u.hasPassword && !u.ssoLinked && (
                    <Button variant="ghost" size="sm" onClick={() => invite.mutate(u.id)} aria-label="Uitnodiging opnieuw sturen" title="Uitnodiging opnieuw sturen">
                      <MailPlus className="size-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setEditing(u)} aria-label="Bewerken">
                    <Pencil className="size-4" />
                  </Button>
                  {u.id !== me.id && (
                    <Button variant="ghost" size="sm" onClick={() => setDeleting(u)} aria-label="Verwijderen">
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
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Gebruiker verwijderen?"
        description={`${deleting?.name} (${deleting?.email}) kan daarna niet meer inloggen.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Annuleren
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>
              Verwijderen
            </Button>
          </>
        }
      >
        <span />
      </Modal>
    </>
  );
}
