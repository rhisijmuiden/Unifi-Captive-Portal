import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Handshake, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BrandLogo } from '../components/BrandLogo';
import { ColorField, ImageUpload, useConfirm } from '../components/controls';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Switch, Textarea } from '../components/ui';
import { api, type Brand } from '../lib/api';
import { readableOn } from '../lib/brand';
import { formatDate } from '../lib/format';

type Reseller = {
  id: string;
  name: string;
  slug: string;
  contactEmail: string | null;
  status: 'active' | 'suspended';
  maxTenants: number | null;
  brandName: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  accentColor: string | null;
  websiteUrl: string | null;
  supportEmail: string | null;
  adminHostname: string | null;
  showPoweredBy: boolean;
  showDesignedBy: boolean;
  notes: string | null;
  createdAt: string;
  tenantCount: number;
  userCount: number;
};

type BrandForm = { brandName: string; logoUrl: string | null; logoDarkUrl: string | null; accentColor: string | null; websiteUrl: string; supportEmail: string };

const DEFAULT_ACCENT = '#FF6B57';

const slugify = (v: string) =>
  v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

/** Name, logos, colour and contact details: shared by the platform admin's form and the reseller's own page. */
function BrandFields({ form, onChange }: { form: BrandForm; onChange: (f: BrandForm) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <Field label={t('branding.brandName')} htmlFor="b-name" hint={t('branding.brandNameHint')}>
        <Input id="b-name" value={form.brandName} onChange={(e) => onChange({ ...form, brandName: e.target.value })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <ImageUpload value={form.logoUrl} onChange={(logoUrl) => onChange({ ...form, logoUrl })} label={t('branding.logo')} />
          <p className="mt-1 text-xs text-muted">{t('branding.logoHint')}</p>
        </div>
        <div>
          <ImageUpload value={form.logoDarkUrl} onChange={(logoDarkUrl) => onChange({ ...form, logoDarkUrl })} label={t('branding.logoDark')} />
          <p className="mt-1 text-xs text-muted">{t('branding.logoDarkHint')}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <ColorField label={t('branding.accent')} value={form.accentColor ?? DEFAULT_ACCENT} onChange={(accentColor) => onChange({ ...form, accentColor })} />
        </div>
        {form.accentColor && (
          <Button variant="ghost" size="sm" onClick={() => onChange({ ...form, accentColor: null })} aria-label={t('branding.accentReset')} title={t('branding.accentReset')}>
            <RotateCcw className="size-4" />
          </Button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('branding.website')} htmlFor="b-web">
          <Input id="b-web" type="url" placeholder="https://" value={form.websiteUrl} onChange={(e) => onChange({ ...form, websiteUrl: e.target.value })} />
        </Field>
        <Field label={t('branding.supportEmail')} htmlFor="b-support" hint={t('branding.supportHint')}>
          <Input id="b-support" type="email" value={form.supportEmail} onChange={(e) => onChange({ ...form, supportEmail: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

/** How the brand looks in the sidebar, on dark and light backgrounds. */
function BrandPreview({ form }: { form: BrandForm }) {
  const { t } = useTranslation();
  const brand: Brand = { name: form.brandName || '…', logoUrl: form.logoUrl, logoDarkUrl: form.logoDarkUrl, accentColor: form.accentColor, websiteUrl: null, supportEmail: null, showPoweredBy: false, showDesignedBy: false };
  const accent = form.accentColor ?? DEFAULT_ACCENT;
  const sample = (
    <span className="mt-4 inline-block rounded-lg px-3 py-1.5 text-sm font-semibold" style={{ background: accent, color: readableOn(accent) }}>
      {t('branding.sampleButton')}
    </span>
  );
  return (
    <div className="@container">
      <div className="grid gap-3 @md:grid-cols-2">
        <div className="rounded-xl bg-nacht p-4">
          <BrandLogo brand={brand} onDark />
          {sample}
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <BrandLogo brand={brand} />
          {sample}
        </div>
      </div>
    </div>
  );
}

const brandForm = (r: Partial<Brand & { brandName: string }> | null | undefined, fallbackName = ''): BrandForm => ({
  brandName: r?.brandName ?? r?.name ?? fallbackName,
  logoUrl: r?.logoUrl ?? null,
  logoDarkUrl: r?.logoDarkUrl ?? null,
  accentColor: r?.accentColor ?? null,
  websiteUrl: r?.websiteUrl ?? '',
  supportEmail: r?.supportEmail ?? '',
});

function ResellerForm({ reseller, onClose }: { reseller: Reseller | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: reseller?.name ?? '',
    slug: reseller?.slug ?? '',
    contactEmail: reseller?.contactEmail ?? '',
    status: reseller?.status ?? 'active',
    maxTenants: reseller?.maxTenants != null ? String(reseller.maxTenants) : '',
    adminHostname: reseller?.adminHostname ?? '',
    showPoweredBy: reseller?.showPoweredBy ?? true,
    showDesignedBy: reseller?.showDesignedBy ?? false,
    notes: reseller?.notes ?? '',
  });
  const [brand, setBrand] = useState<BrandForm>(brandForm(reseller));
  const [brandTouched, setBrandTouched] = useState(Boolean(reseller));
  const [slugTouched, setSlugTouched] = useState(Boolean(reseller));
  const [admin, setAdmin] = useState({ name: '', email: '' });
  const body = () => ({ ...form, ...brand, brandName: brand.brandName || form.name, maxTenants: form.maxTenants ? Number(form.maxTenants) : null });
  const save = useMutation({
    mutationFn: () =>
      reseller
        ? api.put<{ invited?: string | null; inviteError?: string | null }>(`/resellers/${reseller.id}`, body())
        : api.post<{ invited?: string | null; inviteError?: string | null }>('/resellers', { ...body(), admin: admin.email.trim() ? admin : null }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['resellers'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      if (res.inviteError) toast.warning(t('tenants.inviteFailed', { error: res.inviteError }));
      else if (res.invited) toast.success(t('tenants.createdInvited', { email: res.invited }));
      else toast.success(reseller ? t('resellers.updated') : t('resellers.created'));
      onClose();
    },
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={reseller ? t('resellers.edit') : t('resellers.new')}
      description={t('resellers.formDescription')}
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
      <div className="space-y-6">
        <section className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('resellers.name')} htmlFor="r-name">
              <Input
                id="r-name"
                autoFocus
                value={form.name}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value, slug: slugTouched ? form.slug : slugify(e.target.value) });
                  if (!brandTouched) setBrand({ ...brand, brandName: e.target.value });
                }}
              />
            </Field>
            <Field label={t('tenants.slug')} htmlFor="r-slug">
              <Input
                id="r-slug"
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setForm({ ...form, slug: slugify(e.target.value) });
                }}
              />
            </Field>
            <Field label={t('tenants.contactEmail')} htmlFor="r-mail">
              <Input id="r-mail" type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
            </Field>
            <Field label={t('tenants.status')} htmlFor="r-status" hint={t('resellers.statusHint')}>
              <Select id="r-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Reseller['status'] })}>
                <option value="active">{t('common.active')}</option>
                <option value="suspended">{t('common.suspended')}</option>
              </Select>
            </Field>
            <Field label={t('resellers.maxTenants')} htmlFor="r-max" hint={t('resellers.maxTenantsHint')}>
              <Input id="r-max" type="number" min={1} value={form.maxTenants} onChange={(e) => setForm({ ...form, maxTenants: e.target.value })} />
            </Field>
            <Field label={t('resellers.adminHostname')} htmlFor="r-host" hint={t('resellers.adminHostnameHint')}>
              <Input id="r-host" placeholder="wifi.partner.nl" value={form.adminHostname} onChange={(e) => setForm({ ...form, adminHostname: e.target.value })} />
            </Field>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-line p-4">
          <div>
            <p className="text-sm font-semibold">{t('branding.title')}</p>
            <p className="text-xs text-muted">{t('resellers.brandHint')}</p>
          </div>
          <BrandFields
            form={brand}
            onChange={(b) => {
              setBrandTouched(true);
              setBrand(b);
            }}
          />
          <BrandPreview form={{ ...brand, brandName: brand.brandName || form.name }} />
        </section>

        <section className="space-y-3 rounded-xl border border-line p-4">
          <div>
            <p className="text-sm font-semibold">{t('resellers.rhisTitle')}</p>
            <p className="text-xs text-muted">{t('resellers.rhisHint')}</p>
          </div>
          <Switch checked={form.showPoweredBy} onChange={(showPoweredBy) => setForm({ ...form, showPoweredBy })} label={t('resellers.showPoweredBy')} description={t('resellers.showPoweredByHint')} />
          <Switch checked={form.showDesignedBy} onChange={(showDesignedBy) => setForm({ ...form, showDesignedBy })} label={t('resellers.showDesignedBy')} description={t('resellers.showDesignedByHint')} />
        </section>

        {!reseller && (
          <section className="rounded-xl border border-line p-4">
            <p className="text-sm font-semibold">{t('resellers.adminTitle')}</p>
            <p className="mb-3 text-xs text-muted">{t('resellers.adminHint')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('tenants.adminName')} htmlFor="r-admin-name">
                <Input id="r-admin-name" value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} />
              </Field>
              <Field label={t('tenants.adminEmail')} htmlFor="r-admin-mail">
                <Input id="r-admin-mail" type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} />
              </Field>
            </div>
          </section>
        )}

        <Field label={t('tenants.notes')} htmlFor="r-notes">
          <Textarea id="r-notes" rows={3} className="font-sans text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        {save.error && <p className="text-sm text-offline">{save.error.message}</p>}
      </div>
    </Modal>
  );
}

/** Platform admin: white-label partners who resell the platform under their own brand. */
export function ResellersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Reseller | null | 'new'>(null);
  const [confirmDialog, confirm] = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ['resellers'], queryFn: () => api.get<{ resellers: Reseller[] }>('/resellers') });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/resellers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resellers'] });
      toast.success(t('resellers.deleted'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const resellers = data?.resellers ?? [];
  const newButton = (
    <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
      {t('resellers.new')}
    </Button>
  );

  return (
    <>
      <PageHeader eyebrow={t('tenants.eyebrow')} title={t('resellers.title')} description={t('resellers.description')} actions={newButton} />
      <Card>
        {isLoading ? (
          <div className="p-8">
            <Spinner />
          </div>
        ) : !resellers.length ? (
          <EmptyState icon={<Handshake className="size-6" />} title={t('resellers.empty')} description={t('resellers.emptyHint')} action={newButton} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-6 py-3 font-medium">{t('resellers.colReseller')}</th>
                  <th className="px-6 py-3 font-medium">{t('tenants.colStatus')}</th>
                  <th className="hidden px-6 py-3 font-medium md:table-cell">{t('resellers.colTenants')}</th>
                  <th className="hidden px-6 py-3 font-medium lg:table-cell">{t('resellers.colHostname')}</th>
                  <th className="hidden px-6 py-3 font-medium lg:table-cell">{t('resellers.colRhis')}</th>
                  <th className="hidden px-6 py-3 font-medium md:table-cell">{t('tenants.colCreated')}</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {resellers.map((r) => (
                  <tr key={r.id} className="transition hover:bg-sunken/50">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        {r.logoUrl ? (
                          <img src={r.logoUrl} alt="" className="h-9 w-24 shrink-0 object-contain object-left" />
                        ) : (
                          <span className="grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold" style={{ background: r.accentColor ?? DEFAULT_ACCENT, color: readableOn(r.accentColor ?? DEFAULT_ACCENT) }}>
                            {r.brandName.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.name}</p>
                          <p className="truncate text-xs text-muted">{r.brandName !== r.name ? r.brandName : (r.contactEmail ?? r.slug)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3">{r.status === 'active' ? <Badge tone="online">{t('common.active')}</Badge> : <Badge tone="warning">{t('common.suspended')}</Badge>}</td>
                    <td className="hidden px-6 py-3 md:table-cell">
                      {r.maxTenants != null ? t('resellers.usage', { count: r.tenantCount, max: r.maxTenants }) : r.tenantCount}
                      <span className="block text-xs text-muted">{t('resellers.teamCount', { count: r.userCount })}</span>
                    </td>
                    <td className="hidden px-6 py-3 font-mono text-xs lg:table-cell">{r.adminHostname ?? <span className="font-sans text-muted">{t('resellers.noHostname')}</span>}</td>
                    <td className="hidden px-6 py-3 lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {r.showPoweredBy && <Badge>Powered by</Badge>}
                        {r.showDesignedBy && <Badge>Designed by</Badge>}
                        {!r.showPoweredBy && !r.showDesignedBy && <span className="text-xs text-muted">{t('resellers.rhisNone')}</span>}
                      </div>
                    </td>
                    <td className="hidden px-6 py-3 text-muted md:table-cell">{formatDate(r.createdAt)}</td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={t('common.edit')}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('common.delete')}
                          onClick={async () => (await confirm(t('resellers.deleteText', { name: r.name }))) && remove.mutate(r.id)}
                        >
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
      {editing && <ResellerForm reseller={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {confirmDialog}
    </>
  );
}

type OwnReseller = Brand & { companyName: string; adminHostname: string | null; maxTenants: number | null; tenantCount: number };

/** Reseller admin: its own brand, shown to its team and its customers. */
export function BrandingPage() {
  const { data, isLoading } = useQuery({ queryKey: ['reseller'], queryFn: () => api.get<{ reseller: OwnReseller }>('/reseller') });
  if (isLoading || !data) return <Spinner />;
  return <BrandingEditor reseller={data.reseller} key={JSON.stringify(data.reseller)} />;
}

function BrandingEditor({ reseller }: { reseller: OwnReseller }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState<BrandForm>(brandForm(reseller));
  const save = useMutation({
    mutationFn: () => api.put('/reseller/branding', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth'] });
      qc.invalidateQueries({ queryKey: ['reseller'] });
      toast.success(t('branding.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <PageHeader
        eyebrow={reseller.companyName}
        title={t('branding.title')}
        description={t('branding.description')}
        actions={
          <Button variant="accent" loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="p-6">
          <BrandFields form={form} onChange={setForm} />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('branding.preview')} />
            <div className="p-6">
              <BrandPreview form={form} />
            </div>
          </Card>
          <Card>
            <CardHeader title={t('branding.addressTitle')} description={reseller.adminHostname ? t('branding.addressSet') : t('branding.addressNone')} />
            {reseller.adminHostname && <p className="px-6 py-4 font-mono text-sm">https://{reseller.adminHostname}</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
