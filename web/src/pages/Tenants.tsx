import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '../components/ui';
import { api, type Tenant } from '../lib/api';
import { formatDate } from '../lib/format';

const slugify = (v: string) =>
  v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

function TenantForm({ tenant, onClose }: { tenant: Tenant | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: tenant?.name ?? '',
    slug: tenant?.slug ?? '',
    contactEmail: tenant?.contactEmail ?? '',
    status: tenant?.status ?? 'active',
    notes: tenant?.notes ?? '',
  });
  const [slugTouched, setSlugTouched] = useState(Boolean(tenant));
  const save = useMutation({
    mutationFn: () => (tenant ? api.put(`/tenants/${tenant.id}`, form) : api.post('/tenants', form)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(tenant ? 'Klant bijgewerkt' : 'Klant aangemaakt');
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={tenant ? 'Klant bewerken' : 'Nieuwe klant'}
      description="Een klant is een bedrijf met een eigen omgeving, eigen portals en eigen gebruikers."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuleren
          </Button>
          <Button variant="accent" loading={save.isPending} onClick={() => save.mutate()}>
            Opslaan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Bedrijfsnaam" htmlFor="t-name">
          <Input
            id="t-name"
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugTouched ? form.slug : slugify(e.target.value) })}
          />
        </Field>
        <Field label="Korte naam" htmlFor="t-slug" hint="Wordt gebruikt in links en mappen. Kleine letters, cijfers en streepjes.">
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
          <Field label="Contact e-mail" htmlFor="t-mail">
            <Input id="t-mail" type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
          </Field>
          <Field label="Status" htmlFor="t-status">
            <Select id="t-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Tenant['status'] })}>
              <option value="active">Actief</option>
              <option value="suspended">Opgeschort</option>
            </Select>
          </Field>
        </div>
        <Field label="Notities" htmlFor="t-notes">
          <Textarea id="t-notes" rows={3} className="font-sans text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        {save.error && <p className="text-sm text-offline">{save.error.message}</p>}
      </div>
    </Modal>
  );
}

export function TenantsPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Tenant | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Tenant | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['tenants'], queryFn: () => api.get<{ tenants: Tenant[] }>('/tenants') });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/tenants/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] });
      toast.success('Klant verwijderd');
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tenants = (data?.tenants ?? []).filter((t) => `${t.name} ${t.slug} ${t.contactEmail ?? ''}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <PageHeader
        eyebrow="Beheer"
        title="Klanten"
        description="Bedrijven die hun captive portals op dit platform draaien."
        actions={
          <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Nieuwe klant
          </Button>
        }
      />
      <Card>
        <div className="border-b border-line p-4">
          <div className="relative max-w-sm">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input placeholder="Zoek klant…" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        {isLoading ? (
          <div className="p-8">
            <Spinner />
          </div>
        ) : !tenants.length ? (
          <EmptyState
            icon={<Building2 className="size-6" />}
            title={query ? 'Geen klanten gevonden' : 'Nog geen klanten'}
            description={query ? 'Probeer een andere zoekterm.' : 'Voeg je eerste klant toe. Daarna kun je gebruikers uitnodigen en portals bouwen.'}
            action={!query && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Nieuwe klant</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-6 py-3 font-medium">Klant</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="hidden px-6 py-3 font-medium md:table-cell">Gebruikers</th>
                  <th className="hidden px-6 py-3 font-medium md:table-cell">Aangemaakt</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tenants.map((t) => (
                  <tr key={t.id} className="transition hover:bg-sunken/50">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-lucht/25 text-sm font-bold text-nacht dark:text-lucht">{t.name.slice(0, 2).toUpperCase()}</span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{t.name}</p>
                          <p className="truncate text-xs text-muted">{t.contactEmail ?? t.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3">{t.status === 'active' ? <Badge tone="online">Actief</Badge> : <Badge tone="warning">Opgeschort</Badge>}</td>
                    <td className="hidden px-6 py-3 md:table-cell">
                      <Link to={`/users?tenant=${t.id}`} className="text-accent hover:underline">
                        {t.userCount ?? 0}
                      </Link>
                    </td>
                    <td className="hidden px-6 py-3 text-muted md:table-cell">{formatDate(t.createdAt)}</td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(t)} aria-label="Bewerken">
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleting(t)} aria-label="Verwijderen">
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

      {editing && <TenantForm tenant={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Klant verwijderen?"
        description={`${deleting?.name} en alle gebruikers van deze klant worden definitief verwijderd.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Annuleren
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>
              Definitief verwijderen
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">Tip: kies liever voor "Opgeschort" als je de klant tijdelijk wilt blokkeren.</p>
      </Modal>
    </>
  );
}
