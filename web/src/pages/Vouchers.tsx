import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Download, Plus, Printer, Search, Ticket, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { durationLabel, guestStrings, type GuestLocale } from '@shared/guestStrings';
import { useConfirm } from '../components/controls';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner } from '../components/ui';
import i18n from '../i18n';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useTenantScope } from '../lib/tenant';

export type Voucher = {
  id: string;
  code: string;
  batch: string | null;
  note: string | null;
  durationMinutes: number;
  maxUses: number;
  uses: number;
  dataLimitMb: number | null;
  downKbps: number | null;
  upKbps: number | null;
  validUntil: string | null;
  createdAt: string;
  status: 'unused' | 'partly' | 'used' | 'expired' | 'revoked';
};

const tones = { unused: 'online', partly: 'info', used: 'neutral', expired: 'warning', revoked: 'offline' } as const;
export const duration = (minutes: number) => durationLabel(guestStrings[(i18n.resolvedLanguage as GuestLocale) ?? 'en'] ?? guestStrings.en, minutes);

function Tile({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <Card className="p-5">
      <span className="grid size-10 place-items-center rounded-xl bg-koraal/12 text-accent">{icon}</span>
      <p className="display mt-4 text-3xl">{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </Card>
  );
}

function CreateDialog({ open, onClose, batches }: { open: boolean; onClose: () => void; batches: string[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const empty = { count: 10, batch: '', note: '', durationMinutes: 1440, maxUses: 1, dataLimitMb: '', downKbps: '', upKbps: '', validUntil: '' };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const create = useMutation({
    mutationFn: () =>
      api.post<{ vouchers: Voucher[] }>('/vouchers', {
        count: Number(f.count),
        batch: f.batch || null,
        note: f.note || null,
        durationMinutes: Number(f.durationMinutes),
        maxUses: Number(f.maxUses),
        dataLimitMb: f.dataLimitMb ? Number(f.dataLimitMb) : null,
        downKbps: f.downKbps ? Number(f.downKbps) : null,
        upKbps: f.upKbps ? Number(f.upKbps) : null,
        validUntil: f.validUntil ? new Date(`${f.validUntil}T23:59:59`).toISOString() : null,
      }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['vouchers'] });
      toast.success(t('vouchers.created', { count: d.vouchers.length }));
      setF(empty);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('vouchers.createTitle')}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="accent" loading={create.isPending} onClick={() => create.mutate()}>
            {t('vouchers.create')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('vouchers.count')} htmlFor="v-count">
          <Input id="v-count" type="number" min={1} max={500} value={f.count} onChange={set('count')} />
        </Field>
        <Field label={t('vouchers.duration')} htmlFor="v-dur">
          <Select id="v-dur" value={f.durationMinutes} onChange={set('durationMinutes')}>
            {[60, 120, 240, 480, 1440, 2880, 4320, 10080, 43200].map((m) => (
              <option key={m} value={m}>
                {duration(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('vouchers.batch')} htmlFor="v-batch" hint={t('vouchers.batchHint')}>
          <Input id="v-batch" list="v-batches" maxLength={80} value={f.batch} onChange={set('batch')} />
          <datalist id="v-batches">
            {batches.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </Field>
        <Field label={t('vouchers.maxUses')} htmlFor="v-uses" hint={t('vouchers.maxUsesHint')}>
          <Input id="v-uses" type="number" min={1} max={10000} value={f.maxUses} onChange={set('maxUses')} />
        </Field>
        <Field label={t('vouchers.validUntil')} htmlFor="v-valid" hint={t('vouchers.validUntilHint')}>
          <Input id="v-valid" type="date" value={f.validUntil} onChange={set('validUntil')} />
        </Field>
        <Field label={t('vouchers.note')} htmlFor="v-note">
          <Input id="v-note" maxLength={200} value={f.note} onChange={set('note')} />
        </Field>
      </div>
      <p className="mt-6 text-sm font-semibold">{t('vouchers.limits')}</p>
      <p className="mb-3 text-xs text-muted">{t('vouchers.limitsHint')}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={`${t('portalSettings.dataLimit')} (MB)`} htmlFor="v-data">
          <Input id="v-data" type="number" min={1} placeholder={t('portalSettings.unlimited')} value={f.dataLimitMb} onChange={set('dataLimitMb')} />
        </Field>
        <Field label={`${t('portalSettings.down')} (kbps)`} htmlFor="v-down">
          <Input id="v-down" type="number" min={64} value={f.downKbps} onChange={set('downKbps')} />
        </Field>
        <Field label={`${t('portalSettings.up')} (kbps)`} htmlFor="v-up">
          <Input id="v-up" type="number" min={64} value={f.upKbps} onChange={set('upKbps')} />
        </Field>
      </div>
    </Modal>
  );
}

export function VouchersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const scope = useTenantScope();
  const [confirmDialog, ask] = useConfirm();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [batch, setBatch] = useState('');
  const [status, setStatus] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['vouchers'], queryFn: () => api.get<{ vouchers: Voucher[]; batches: string[] }>('/vouchers') });
  const settings = useQuery({ queryKey: ['portal-settings'], queryFn: () => api.get<{ settings: { auth: { methods: string[] } } }>('/portal-settings') });
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.vouchers ?? []).filter(
      (v) => (!batch || v.batch === batch) && (!status || v.status === status) && (!q || v.code.toLowerCase().includes(q) || (v.note ?? '').toLowerCase().includes(q)),
    );
  }, [data, search, batch, status]);

  const action = useMutation({
    mutationFn: ({ v, kind }: { v: Voucher; kind: 'revoke' | 'delete' }) => (kind === 'revoke' ? api.post(`/vouchers/${v.id}/revoke`) : api.del(`/vouchers/${v.id}`)),
    onSuccess: (_d, { kind }) => {
      qc.invalidateQueries({ queryKey: ['vouchers'] });
      toast.success(kind === 'revoke' ? t('vouchers.revoked') : t('common.delete'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteBatch = useMutation({
    mutationFn: () => api.del<{ deleted: number }>(`/vouchers?batch=${encodeURIComponent(batch)}`),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['vouchers'] });
      toast.success(t('vouchers.deletedBatch', { count: d.deleted }));
    },
  });

  const exportCsv = () => {
    const rows = [['code', 'status', 'batch', 'note', 'minutes', 'uses', 'max_uses', 'valid_until', 'created_at'], ...list.map((v) => [v.code, v.status, v.batch ?? '', v.note ?? '', v.durationMinutes, v.uses, v.maxUses, v.validUntil ?? '', v.createdAt])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `vouchers${batch ? `-${batch}` : ''}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const all = data?.vouchers ?? [];
  const methodOff = settings.data && !settings.data.settings.auth.methods.includes('voucher');

  return (
    <>
      <PageHeader
        eyebrow={t('nav.portals')}
        title={t('vouchers.title')}
        description={t('vouchers.description')}
        actions={
          <>
            <Button variant="secondary" icon={<Printer className="size-4" />} disabled={!list.length} onClick={() => navigate(`/vouchers/print${batch ? `?batch=${encodeURIComponent(batch)}` : ''}${status ? `${batch ? '&' : '?'}status=${status}` : ''}`)}>
              {t('vouchers.print')}
            </Button>
            <Button variant="secondary" icon={<Download className="size-4" />} disabled={!list.length} onClick={exportCsv}>
              {t('vouchers.export')}
            </Button>
            {scope.canManage && (
              <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
                {t('vouchers.create')}
              </Button>
            )}
          </>
        }
      />
      {methodOff && (
        <p className="mb-6 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t('vouchers.methodOff')}{' '}
          <Link to="/portal-settings" className="font-semibold underline">
            {t('nav.portalSettings')}
          </Link>
        </p>
      )}
      {isLoading ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Tile icon={<Ticket className="size-5" />} label={t('vouchers.total')} value={all.length} />
            <Tile icon={<Ticket className="size-5" />} label={t('vouchers.unused')} value={all.filter((v) => v.status === 'unused' || v.status === 'partly').length} />
            <Tile icon={<Ticket className="size-5" />} label={t('vouchers.used')} value={all.filter((v) => v.uses > 0).length} />
          </div>
          <Card className="mt-6">
            <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
              <div className="relative min-w-[200px] flex-1">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                <Input className="pl-9" placeholder={t('vouchers.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select className="w-auto" value={batch} onChange={(e) => setBatch(e.target.value)} aria-label={t('vouchers.colBatch')}>
                <option value="">{t('vouchers.allBatches')}</option>
                {(data?.batches ?? []).map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
              <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('vouchers.colStatus')}>
                <option value="">{t('vouchers.allStatuses')}</option>
                {(['unused', 'partly', 'used', 'expired', 'revoked'] as const).map((s) => (
                  <option key={s} value={s}>
                    {t(`vouchers.status.${s}`)}
                  </option>
                ))}
              </Select>
              {batch && scope.canManage && (
                <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} onClick={async () => (await ask(t('vouchers.confirmDeleteBatch', { batch }))) && deleteBatch.mutate()}>
                  {t('vouchers.deleteBatch')}
                </Button>
              )}
            </div>
            {!list.length ? (
              <EmptyState icon={<Ticket className="size-6" />} title={t('vouchers.empty')} description={t('vouchers.emptyHint')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="px-6 py-3 font-medium">{t('vouchers.colCode')}</th>
                      <th className="px-6 py-3 font-medium">{t('vouchers.colStatus')}</th>
                      <th className="hidden px-6 py-3 font-medium md:table-cell">{t('vouchers.colAccess')}</th>
                      <th className="hidden px-6 py-3 font-medium md:table-cell">{t('vouchers.colUses')}</th>
                      <th className="hidden px-6 py-3 font-medium lg:table-cell">{t('vouchers.colValid')}</th>
                      <th className="hidden px-6 py-3 font-medium lg:table-cell">{t('vouchers.colBatch')}</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {list.slice(0, 1000).map((v) => (
                      <tr key={v.id} className="transition hover:bg-sunken/50">
                        <td className="px-6 py-3">
                          <p className="font-mono font-semibold tracking-wider">{v.code}</p>
                          {v.note && <p className="text-xs text-muted">{v.note}</p>}
                        </td>
                        <td className="px-6 py-3">
                          <Badge tone={tones[v.status]}>{t(`vouchers.status.${v.status}`)}</Badge>
                        </td>
                        <td className="hidden px-6 py-3 text-muted md:table-cell">{duration(v.durationMinutes)}</td>
                        <td className="hidden px-6 py-3 text-muted md:table-cell">
                          {v.uses} / {v.maxUses}
                        </td>
                        <td className="hidden px-6 py-3 text-muted lg:table-cell">{formatDate(v.validUntil)}</td>
                        <td className="hidden px-6 py-3 text-muted lg:table-cell">{v.batch ?? '—'}</td>
                        <td className="px-6 py-3 text-right whitespace-nowrap">
                          {scope.canManage && v.status !== 'revoked' && (
                            <Button variant="ghost" size="sm" aria-label={t('vouchers.revoke')} title={t('vouchers.revoke')} onClick={async () => (await ask(t('vouchers.confirmRevoke', { code: v.code }))) && action.mutate({ v, kind: 'revoke' })}>
                              <Ban className="size-4" />
                            </Button>
                          )}
                          {scope.canManage && (
                            <Button variant="ghost" size="sm" aria-label={t('common.delete')} title={t('common.delete')} onClick={async () => (await ask(t('vouchers.confirmDelete', { code: v.code }))) && action.mutate({ v, kind: 'delete' })}>
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      <CreateDialog open={open} onClose={() => setOpen(false)} batches={data?.batches ?? []} />
      {confirmDialog}
    </>
  );
}

/** Printable voucher cards, 10 per A4 page. */
export function VoucherPrintPage() {
  const { t } = useTranslation();
  const params = new URLSearchParams(window.location.search);
  const batch = params.get('batch');
  const status = params.get('status');
  const { data } = useQuery({ queryKey: ['vouchers'], queryFn: () => api.get<{ vouchers: Voucher[] }>('/vouchers') });
  const design = useQuery({ queryKey: ['portal-design'], queryFn: () => api.get<{ design: { theme: { accent: string }; blocks: { type: string; src?: string | null }[] } }>('/portal-design') });
  const list = (data?.vouchers ?? []).filter((v) => (!batch || v.batch === batch) && (status ? v.status === status : v.status === 'unused' || v.status === 'partly'));
  const accent = design.data?.design.theme.accent ?? '#FF6B57';
  const logo = design.data?.design.blocks.find((b) => b.type === 'logo' && b.src)?.src;
  return (
    <div className="min-h-screen bg-white text-[#14213D]">
      <style>{'@page{size:A4;margin:10mm}@media print{body{background:#fff}}'}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-raised px-6 py-4 print:hidden">
        <Link to="/vouchers" className="text-sm font-semibold text-accent">
          ← {t('vouchers.printBack')}
        </Link>
        <span className="text-sm text-muted">{t('vouchers.printCount', { count: list.length })}</span>
        <Button variant="accent" icon={<Printer className="size-4" />} onClick={() => window.print()}>
          {t('vouchers.printNow')}
        </Button>
      </div>
      <div className="mx-auto grid max-w-[190mm] grid-cols-2 gap-[4mm] p-6 print:p-0">
        {list.map((v) => (
          <div key={v.id} className="flex h-[52mm] break-inside-avoid flex-col justify-between rounded-[4mm] border-2 border-dashed p-[5mm]" style={{ borderColor: `${accent}66` }}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11pt] font-bold" style={{ color: accent }}>
                {t('vouchers.printTitle')}
              </p>
              {logo && <img src={logo} alt="" className="h-[9mm] w-auto object-contain" />}
            </div>
            <p className="text-center font-mono text-[20pt] font-bold tracking-[0.15em]">{v.code}</p>
            <div className="text-[8.5pt] leading-snug text-[#4F5B73]">
              <p>{t('vouchers.printHow')}</p>
              <p className="font-semibold">
                {t('vouchers.printValid', { duration: duration(v.durationMinutes) })}
                {v.validUntil ? ` · ${t('vouchers.colValid')} ${formatDate(v.validUntil)}` : ''}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
