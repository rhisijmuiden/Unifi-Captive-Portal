import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, FileUp, Pencil, PlugZap, Plus, RefreshCw, Search, Trash2, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Segmented } from '../components/controls';
import { Section } from '../components/SignInSettings';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Switch, Textarea, cx } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, timeAgo } from '../lib/format';
import { useTenantScope } from '../lib/tenant';

type Source = 'manual' | 'csv' | 'api' | 'apaleo' | 'mews';
type Stay = { id: string; room: string; surname: string; arrival: string; departure: string; source: Source; devices: number };
type HotelForm = {
  source: 'manual' | 'apaleo' | 'mews';
  checkoutTime: string;
  devicesPerRoom: number;
  apaleoClientId: string;
  apaleoPropertyId: string;
  mewsPlatformUrl: string;
};
type HotelData = {
  settings: HotelForm & { apaleoClientSecretSet: boolean; mewsClientTokenSet: boolean; mewsAccessTokenSet: boolean };
  pmsReady: boolean;
  sync: { at: string; synced?: number; error?: string } | null;
};

/** "2026-10-21" in the browser's own time zone. */
const localDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA');
const localTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function StayDialog({ stay, open, onClose, checkoutTime }: { stay: Stay | null; open: boolean; onClose: () => void; checkoutTime: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const today = new Date().toLocaleDateString('en-CA');
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA');
  const empty = { room: '', surname: '', arrival: today, departure: tomorrow, time: checkoutTime };
  const [f, setF] = useState(empty);
  useEffect(() => {
    if (open) setF(stay ? { room: stay.room, surname: stay.surname, arrival: localDay(stay.arrival), departure: localDay(stay.departure), time: localTime(stay.departure) } : { ...empty, time: checkoutTime });
  }, [open, stay]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => {
      const body = { room: f.room, surname: f.surname, arrival: f.arrival, departure: `${f.departure} ${f.time}` };
      return stay ? api.put(`/hotel/stays/${stay.id}`, body) : api.post('/hotel/stays', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hotel-stays'] });
      toast.success(t('common.saved'));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={stay ? t('hotel.editStay') : t('hotel.addStay')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="accent" loading={save.isPending} disabled={!f.room.trim() || !f.surname.trim()} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('hotel.room')} htmlFor="st-room">
          <Input id="st-room" autoFocus maxLength={20} value={f.room} onChange={set('room')} />
        </Field>
        <Field label={t('hotel.surname')} htmlFor="st-name">
          <Input id="st-name" maxLength={80} value={f.surname} onChange={set('surname')} />
        </Field>
        <Field label={t('hotel.arrival')} htmlFor="st-arr">
          <Input id="st-arr" type="date" value={f.arrival} onChange={set('arrival')} />
        </Field>
        <Field label={t('hotel.departure')} htmlFor="st-dep">
          <div className="flex gap-2">
            <Input id="st-dep" type="date" value={f.departure} onChange={set('departure')} />
            <Input type="time" className="w-28" aria-label={t('hotel.checkoutTime')} value={f.time} onChange={set('time')} />
          </div>
        </Field>
      </div>
      <p className="mt-4 text-xs text-muted">{t('hotel.stayHint')}</p>
    </Modal>
  );
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [csv, setCsv] = useState('');
  const [replace, setReplace] = useState(false);
  const [result, setResult] = useState<{ imported: number; errorCount: number; errors: { line: number; reason: string }[] } | null>(null);
  const close = () => {
    setCsv('');
    setResult(null);
    onClose();
  };
  const run = useMutation({
    mutationFn: () => api.post<{ imported: number; errorCount: number; errors: { line: number; reason: string }[] }>('/hotel/stays/import', { csv, replace }),
    onSuccess: (d) => {
      setResult(d);
      qc.invalidateQueries({ queryKey: ['hotel-stays'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const readFile = (file: File | undefined) => file && file.text().then(setCsv);
  return (
    <Modal
      open={open}
      onClose={close}
      wide
      title={t('hotel.importTitle')}
      description={t('hotel.importHint')}
      footer={
        result ? (
          <Button variant="accent" onClick={close}>
            {t('common.close')}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button variant="accent" loading={run.isPending} disabled={!csv.trim()} onClick={() => run.mutate()}>
              {t('hotel.import')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-sm">
          <p className="font-semibold text-online">{t('hotel.imported', { count: result.imported })}</p>
          {result.errorCount > 0 && (
            <div className="rounded-xl bg-warning/12 p-3 text-warning">
              <p className="font-semibold">{t('hotel.importErrors', { count: result.errorCount })}</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {result.errors.map((e) => (
                  <li key={e.line}>{t('hotel.importError', { line: e.line, reason: t(`hotel.reasons.${e.reason as 'missing'}`) })}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line p-5 text-sm text-muted hover:border-koraal/60">
            <FileUp className="size-5" />
            {t('hotel.chooseFile')}
            <input type="file" accept=".csv,.txt,text/csv" className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} />
          </label>
          <Textarea rows={8} className="font-mono text-xs" placeholder={'room;surname;arrival;departure\n101;de Vries;2026-10-20;2026-10-23'} value={csv} onChange={(e) => setCsv(e.target.value)} />
          <Switch checked={replace} onChange={setReplace} label={t('hotel.replace')} description={t('hotel.replaceHint')} />
        </div>
      )}
    </Modal>
  );
}

function PmsSettings({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['hotel-settings'], queryFn: () => api.get<HotelData>('/hotel-settings') });
  const [form, setForm] = useState<HotelForm | null>(null);
  const [secrets, setSecrets] = useState({ apaleoClientSecret: '', mewsClientToken: '', mewsAccessToken: '' });
  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);
  const body = () => ({ ...form, ...Object.fromEntries(Object.entries(secrets).filter(([, v]) => v)) });
  const save = useMutation({
    mutationFn: () => api.put<HotelData>('/hotel-settings', body()),
    onSuccess: (d) => {
      setSecrets({ apaleoClientSecret: '', mewsClientToken: '', mewsAccessToken: '' });
      qc.setQueryData(['hotel-settings'], d);
      qc.invalidateQueries({ queryKey: ['hotel-stays'] });
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ stays: number }>('/hotel-settings/test', body()),
    onSuccess: (d) => toast.success(t('hotel.testOk', { count: d.stays })),
    onError: (e: Error) => toast.error(e.message),
  });
  const sync = useMutation({
    mutationFn: () => api.post<{ synced: number }>('/hotel/sync'),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['hotel-stays'] });
      qc.invalidateQueries({ queryKey: ['hotel-settings'] });
      toast.success(t('hotel.synced', { count: d.synced }));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!form || !data) return <Spinner />;
  const set = <K extends keyof HotelForm>(k: K, v: HotelForm[K]) => setForm({ ...form, [k]: v });
  const secret = (k: keyof typeof secrets, label: string, isSet: boolean) => (
    <Field label={label} htmlFor={`pms-${k}`}>
      <Input id={`pms-${k}`} type="password" autoComplete="off" placeholder={isSet ? `•••••• (${t('payments.keySet')})` : ''} value={secrets[k]} disabled={!canManage} onChange={(e) => setSecrets({ ...secrets, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Section
      title={t('hotel.settings')}
      description={t('hotel.settingsHint')}
      action={
        canManage && (
          <div className="flex gap-2">
            {form.source !== 'manual' && (
              <Button variant="secondary" size="sm" icon={<PlugZap className="size-4" />} loading={test.isPending} onClick={() => test.mutate()}>
                {t('signIn.test')}
              </Button>
            )}
            <Button variant="accent" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
              {t('common.save')}
            </Button>
          </div>
        )
      }
    >
      <Field label={t('hotel.source')}>
        <Segmented
          value={form.source}
          onChange={(v) => set('source', v)}
          options={[
            { value: 'manual', label: t('hotel.sources.manual') },
            { value: 'apaleo', label: 'Apaleo' },
            { value: 'mews', label: 'Mews' },
          ]}
        />
      </Field>
      {form.source === 'apaleo' && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Client ID" htmlFor="pms-ap-id">
            <Input id="pms-ap-id" autoComplete="off" value={form.apaleoClientId} disabled={!canManage} onChange={(e) => set('apaleoClientId', e.target.value)} />
          </Field>
          {secret('apaleoClientSecret', 'Client secret', data.settings.apaleoClientSecretSet)}
          <Field label={t('hotel.propertyId')} htmlFor="pms-ap-prop">
            <Input id="pms-ap-prop" autoComplete="off" placeholder="MUC" value={form.apaleoPropertyId} disabled={!canManage} onChange={(e) => set('apaleoPropertyId', e.target.value.toUpperCase())} />
          </Field>
          <p className="text-xs text-muted sm:col-span-3">{t('hotel.apaleoHint')}</p>
        </div>
      )}
      {form.source === 'mews' && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('hotel.platformUrl')} htmlFor="pms-mews-url">
            <Input id="pms-mews-url" value={form.mewsPlatformUrl} disabled={!canManage} onChange={(e) => set('mewsPlatformUrl', e.target.value.trim())} />
          </Field>
          {secret('mewsClientToken', 'Client token', data.settings.mewsClientTokenSet)}
          {secret('mewsAccessToken', 'Access token', data.settings.mewsAccessTokenSet)}
          <p className="text-xs text-muted sm:col-span-3">{t('hotel.mewsHint')}</p>
        </div>
      )}
      {form.source !== 'manual' && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-sunken p-4 text-sm">
          <RefreshCw className="size-5 text-accent" />
          <span className="flex-1 text-muted">
            {!data.sync ? t('hotel.neverSynced') : data.sync.error ? <span className="text-offline">{t('hotel.syncFailed', { when: timeAgo(data.sync.at), error: data.sync.error })}</span> : t('hotel.lastSync', { when: timeAgo(data.sync.at), count: data.sync.synced ?? 0 })}
          </span>
          {canManage && data.pmsReady && (
            <Button variant="secondary" size="sm" loading={sync.isPending} onClick={() => sync.mutate()}>
              {t('hotel.syncNow')}
            </Button>
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('hotel.checkoutTime')} htmlFor="h-checkout" hint={t('hotel.checkoutTimeHint')}>
          <Input id="h-checkout" type="time" value={form.checkoutTime} disabled={!canManage} onChange={(e) => set('checkoutTime', e.target.value)} />
        </Field>
        <Field label={t('hotel.devicesPerRoom')} htmlFor="h-devices" hint={t('hotel.devicesPerRoomHint')}>
          <Input id="h-devices" type="number" min={1} max={50} value={form.devicesPerRoom} disabled={!canManage} onChange={(e) => set('devicesPerRoom', Number(e.target.value))} />
        </Field>
      </div>
    </Section>
  );
}

export function HotelPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const scope = useTenantScope();
  const [filter, setFilter] = useState<'current' | 'upcoming' | 'all'>('current');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Stay | null>(null);
  const [dialog, setDialog] = useState<'stay' | 'import' | null>(null);
  const settings = useQuery({ queryKey: ['hotel-settings'], queryFn: () => api.get<HotelData>('/hotel-settings') });
  const { data, isLoading } = useQuery({ queryKey: ['hotel-stays', filter], queryFn: () => api.get<{ stays: Stay[] }>(`/hotel/stays?scope=${filter}`) });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/hotel/stays/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hotel-stays'] });
      toast.success(t('hotel.deleted'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const stays = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.stays ?? []).filter((s) => !q || s.room.toLowerCase().includes(q) || s.surname.toLowerCase().includes(q));
  }, [data, search]);
  const online = stays.reduce((n, s) => n + s.devices, 0);
  const fromPms = settings.data && settings.data.settings.source !== 'manual';

  return (
    <>
      <PageHeader
        eyebrow={t('nav.portals')}
        title={t('hotel.title')}
        description={t('hotel.description')}
        actions={
          scope.canManage && (
            <div className="flex gap-2">
              <Button variant="secondary" icon={<FileUp className="size-4" />} onClick={() => setDialog('import')}>
                {t('hotel.import')}
              </Button>
              <Button
                variant="accent"
                icon={<Plus className="size-4" />}
                onClick={() => {
                  setEditing(null);
                  setDialog('stay');
                }}
              >
                {t('hotel.addStay')}
              </Button>
            </div>
          )
        }
      />
      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
            <div className="flex gap-1 rounded-xl bg-sunken p-1">
              {(['current', 'upcoming', 'all'] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={cx('rounded-lg px-3 py-1.5 text-sm font-medium transition', filter === f ? 'bg-raised shadow-card' : 'text-muted hover:text-ink')}>
                  {t(`hotel.filters.${f}`)}
                </button>
              ))}
            </div>
            <div className="relative min-w-48 flex-1">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <Input className="pl-9" placeholder={t('hotel.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <span className="flex items-center gap-1.5 text-sm text-muted">
              <Users className="size-4" /> {t('hotel.devicesOnline', { count: online })}
            </span>
          </div>
          {isLoading ? (
            <Spinner />
          ) : !stays.length ? (
            <EmptyState icon={<BedDouble className="size-6" />} title={t('hotel.empty')} description={fromPms ? t('hotel.emptyPms') : t('hotel.emptyHint')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-semibold tracking-wide text-muted uppercase">
                  <tr className="border-b border-line">
                    <th className="px-6 py-3">{t('hotel.room')}</th>
                    <th className="px-3 py-3">{t('hotel.surname')}</th>
                    <th className="px-3 py-3">{t('hotel.arrival')}</th>
                    <th className="px-3 py-3">{t('hotel.departure')}</th>
                    <th className="px-3 py-3">{t('hotel.devices')}</th>
                    <th className="px-3 py-3">{t('hotel.source')}</th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {stays.map((s) => (
                    <tr key={s.id} className="hover:bg-sunken/50">
                      <td className="px-6 py-3 font-mono font-semibold">{s.room}</td>
                      <td className="px-3 py-3">{s.surname}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-muted">{formatDate(s.arrival)}</td>
                      <td className="px-3 py-3 whitespace-nowrap">{formatDate(s.departure)}</td>
                      <td className="px-3 py-3">{s.devices ? <Badge tone="online">{s.devices}</Badge> : <span className="text-muted">0</span>}</td>
                      <td className="px-3 py-3">
                        <Badge tone={s.source === 'apaleo' || s.source === 'mews' ? 'info' : 'neutral'}>{t(`hotel.sources.${s.source}`)}</Badge>
                      </td>
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        {scope.canManage && s.source !== 'apaleo' && s.source !== 'mews' && (
                          <>
                            <button
                              className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink"
                              aria-label={t('common.edit')}
                              onClick={() => {
                                setEditing(s);
                                setDialog('stay');
                              }}
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-offline" aria-label={t('common.delete')} onClick={() => remove.mutate(s.id)}>
                              <Trash2 className="size-4" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <PmsSettings canManage={scope.canManage} />
      </div>
      <StayDialog open={dialog === 'stay'} stay={editing} onClose={() => setDialog(null)} checkoutTime={settings.data?.settings.checkoutTime ?? '12:00'} />
      <ImportDialog open={dialog === 'import'} onClose={() => setDialog(null)} />
    </>
  );
}
