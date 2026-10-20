import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  CircleAlert,
  Copy,
  DatabaseBackup,
  FolderOpen,
  HardDrive,
  History,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Segmented } from '../components/controls';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Switch, cx } from '../components/ui';
import i18n from '../i18n';
import { api, ApiError } from '../lib/api';
import { formatBytes, formatDate, timeAgo } from '../lib/format';

type TargetType = 'local' | 'ftp' | 'ftps' | 'scp';
type Schedule = { enabled: boolean; fullEvery: 'day' | 'week' | 'month'; weekday: number; monthDay: number; hour: number; incremental: 'off' | '1h' | '6h' | '12h' | '24h' };
type Target = {
  id: string;
  name: string;
  type: TargetType;
  host: string;
  port: number;
  username: string;
  passwordSet: boolean;
  tlsMode: 'explicit' | 'implicit';
  verifyCertificate: boolean;
  authMethod: 'key' | 'password';
  hostKey: string;
  path: string;
  schedule: Schedule;
  keepFull: number;
  lastSetId: string | null;
  lastFullAt: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
};
type Run = {
  id: string;
  targetName: string;
  setId: string | null;
  type: 'full' | 'incremental';
  trigger: 'schedule' | 'manual';
  status: 'success' | 'failed';
  entries: number | null;
  sizeBytes: number | null;
  storedBytes: number | null;
  removedSets: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string;
};
type Progress = { phase: 'database' | 'files' | 'upload' | 'download' | 'assemble' | 'cleanup'; done: number; total: number };
type Job = { kind: 'backup' | 'restore'; targetId: string; targetName: string; type?: 'full' | 'incremental'; setId?: string; startedAt: string; progress: Progress | null };
type RestoreStatus = { state: 'idle' | 'preparing' | 'queued' | 'running' | 'success' | 'failed'; code?: string; message?: string; setId?: string; updatedAt?: string };
type Overview = {
  settings: { passphraseSet: boolean; notifyOnFailure: boolean; sshPublicKey: string };
  targets: Target[];
  runs: Run[];
  job: Job | null;
  restore: RestoreStatus;
  restoreAvailable: boolean;
  localBase: string;
};
type SetInfo = { id: string; type: 'full' | 'incremental'; chain: string; createdAt: string; appVersion: string; hostname: string; entries: number; sizeBytes: number; storedBytes: number; ownServer: boolean };

const ACTIVE_RESTORE = ['preparing', 'queued', 'running'];
const typeIcon: Record<TargetType, typeof Server> = { local: HardDrive, ftp: Server, ftps: ShieldCheck, scp: KeyRound };

const weekdayName = (d: number) => new Intl.DateTimeFormat(i18n.resolvedLanguage === 'nl' ? 'nl-NL' : 'en-GB', { weekday: 'long' }).format(new Date(2026, 9, 18 + d));
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

function scheduleSummary(s: Schedule) {
  const t = i18n.t.bind(i18n);
  if (!s.enabled) return t('backups.summary.manual');
  const full =
    s.fullEvery === 'day'
      ? t('backups.summary.daily', { time: hourLabel(s.hour) })
      : s.fullEvery === 'week'
        ? t('backups.summary.weekly', { day: weekdayName(s.weekday), time: hourLabel(s.hour) })
        : t('backups.summary.monthly', { day: s.monthDay, time: hourLabel(s.hour) });
  return s.incremental === 'off' ? full : `${full} · ${t(`backups.summary.incr_${s.incremental}`)}`;
}

function useCopy() {
  const { t } = useTranslation();
  return (value: string) =>
    navigator.clipboard.writeText(value).then(
      () => toast.success(t('common.copied')),
      () => toast.error(value),
    );
}

// ── Progress and status banners ────────────────────────────────────────────

function JobBanner({ job }: { job: Job }) {
  const { t } = useTranslation();
  const p = job.progress;
  const pct = p && p.total ? Math.round((p.done / p.total) * 100) : null;
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex items-center gap-4 px-6 py-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-koraal/12 text-accent">
          <Loader2 className="size-5 animate-spin" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {job.kind === 'backup'
              ? t(job.type === 'incremental' ? 'backups.job.incremental' : 'backups.job.full', { name: job.targetName })
              : t('backups.job.restore', { name: job.targetName })}
          </p>
          <p className="text-sm text-muted">
            {p ? t(`backups.phase.${p.phase}`, { done: p.done, total: p.total }) : t('backups.phase.starting')} · {timeAgo(job.startedAt)}
          </p>
        </div>
      </div>
      <div className="h-1 bg-sunken">
        <div className={cx('h-full bg-koraal transition-all', pct === null && 'w-1/3 animate-pulse')} style={pct !== null ? { width: `${Math.max(4, pct)}%` } : undefined} />
      </div>
    </Card>
  );
}

function RestoreBanner({ status, unreachable }: { status: RestoreStatus; unreachable: boolean }) {
  const { t } = useTranslation();
  const active = ACTIVE_RESTORE.includes(status.state);
  const text = status.code ? t(`backups.restoreCode.${status.code}`, { defaultValue: status.message ?? status.code }) : status.message;
  const tone = status.state === 'success' ? 'online' : status.state === 'failed' ? 'offline' : 'info';
  return (
    <Card className="mb-6">
      <div className="flex items-start gap-4 px-6 py-4">
        <div className={cx('grid size-10 shrink-0 place-items-center rounded-xl', tone === 'online' ? 'bg-online/12 text-online' : tone === 'offline' ? 'bg-offline/12 text-offline' : 'bg-lucht/25 text-nacht dark:text-lucht')}>
          {active || unreachable ? <Loader2 className="size-5 animate-spin" /> : tone === 'online' ? <CheckCircle2 className="size-5" /> : <CircleAlert className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t(`backups.restoreState.${unreachable ? 'restarting' : status.state}`)}</p>
          <p className="text-sm text-muted">
            {unreachable ? t('backups.restoreRestarting') : text}
            {status.setId && <span className="ml-1 font-mono text-xs">({status.setId})</span>}
          </p>
          {status.state === 'success' && <p className="mt-1 text-sm text-muted">{t('backups.restoreSignInAgain')}</p>}
        </div>
        {status.updatedAt && <span className="hidden text-xs text-muted sm:block">{timeAgo(status.updatedAt)}</span>}
      </div>
    </Card>
  );
}

// ── Location form ──────────────────────────────────────────────────────────

type Form = Omit<Target, 'id' | 'passwordSet' | 'lastSetId' | 'lastFullAt' | 'lastSuccessAt' | 'lastAttemptAt' | 'lastError'> & { password: string };

const defaultPort: Record<TargetType, number> = { local: 0, ftp: 21, ftps: 21, scp: 22 };

function emptyForm(): Form {
  return {
    name: '',
    type: 'scp',
    host: '',
    port: 22,
    username: '',
    password: '',
    tlsMode: 'explicit',
    verifyCertificate: true,
    authMethod: 'key',
    hostKey: '',
    path: '/backups/captive-portal',
    schedule: { enabled: true, fullEvery: 'week', weekday: 0, monthDay: 1, hour: 2, incremental: '24h' },
    keepFull: 4,
  };
}

function TargetModal({ target, overview, onClose }: { target: Target | null; overview: Overview; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const copy = useCopy();
  const [form, setForm] = useState<Form>(() => (target ? { ...target, password: '' } : emptyForm()));
  const [test, setTest] = useState<{ ok: true; hostKey: string; sets: number } | { ok: false; error: string } | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setSchedule = <K extends keyof Schedule>(k: K, v: Schedule[K]) => setForm((f) => ({ ...f, schedule: { ...f.schedule, [k]: v } }));

  const sshKey = useQuery({
    queryKey: ['backup-ssh-key'],
    queryFn: () => api.post<{ publicKey: string }>('/backups/ssh-key', {}),
    enabled: form.type === 'scp' && form.authMethod === 'key',
    staleTime: Infinity,
  });

  const changeType = (type: TargetType) =>
    setForm((f) => ({
      ...f,
      type,
      port: f.port === defaultPort[f.type] || !f.port ? (type === 'ftps' && f.tlsMode === 'implicit' ? 990 : defaultPort[type]) : f.port,
      path: type === 'local' && !f.path.startsWith(overview.localBase) ? `${overview.localBase}/local` : type !== 'local' && f.path.startsWith(overview.localBase) ? '/backups/captive-portal' : f.path,
    }));

  const payload = () => ({ ...form, password: form.password || undefined });
  const runTest = useMutation({
    mutationFn: () => api.post<{ hostKey: string; sets: number }>('/backups/targets/test', { ...payload(), id: target?.id }),
    onSuccess: (res) => {
      setTest({ ok: true, ...res });
      // Remember the host key that was just checked, so the first backup trusts the same server
      if (res.hostKey && !form.hostKey) set('hostKey', res.hostKey);
    },
    onError: (e: Error) => setTest({ ok: false, error: e.message }),
  });
  const save = useMutation({
    mutationFn: () => (target ? api.put<Target>(`/backups/targets/${target.id}`, payload()) : api.post<Target>('/backups/targets', payload())),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backups'] });
      toast.success(t('backups.targetSaved'));
      onClose();
    },
  });

  const remote = form.type !== 'local';
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={target ? t('backups.editTarget') : t('backups.newTarget')}
      description={t('backups.targetDescription')}
      footer={
        <>
          <Button variant="secondary" className="mr-auto" loading={runTest.isPending} icon={<RefreshCw className="size-4" />} onClick={() => runTest.mutate()}>
            {t('backups.test')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="accent" loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label={t('backups.name')} htmlFor="bt-name">
          <Input id="bt-name" placeholder={t('backups.namePlaceholder')} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={t('backups.type')} hint={t(`backups.typeHint.${form.type}`)}>
          <Segmented
            value={form.type}
            onChange={changeType}
            label={t('backups.type')}
            options={[
              { value: 'scp', label: 'SCP (SSH)' },
              { value: 'ftps', label: 'FTPS' },
              { value: 'ftp', label: 'FTP' },
              { value: 'local', label: t('backups.local') },
            ]}
          />
        </Field>

        {remote && (
          <>
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <Field label={t('backups.host')} htmlFor="bt-host">
                <Input id="bt-host" placeholder="backup.example.com" value={form.host} onChange={(e) => set('host', e.target.value.trim())} />
              </Field>
              <Field label={t('backups.port')} htmlFor="bt-port">
                <Input id="bt-port" type="number" value={form.port || ''} placeholder={String(defaultPort[form.type])} onChange={(e) => set('port', Number(e.target.value))} />
              </Field>
            </div>
            {form.type === 'ftps' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('backups.tlsMode')} htmlFor="bt-tls" hint={t(`backups.tlsHint.${form.tlsMode}`)}>
                  <Select
                    id="bt-tls"
                    value={form.tlsMode}
                    onChange={(e) => {
                      const mode = e.target.value as Form['tlsMode'];
                      setForm((f) => ({ ...f, tlsMode: mode, port: mode === 'implicit' && (f.port === 21 || !f.port) ? 990 : mode === 'explicit' && f.port === 990 ? 21 : f.port }));
                    }}
                  >
                    <option value="explicit">{t('backups.tlsExplicit')}</option>
                    <option value="implicit">{t('backups.tlsImplicit')}</option>
                  </Select>
                </Field>
                <div className="pt-7">
                  <Switch checked={form.verifyCertificate} onChange={(v) => set('verifyCertificate', v)} label={t('backups.verifyCertificate')} description={t('backups.verifyCertificateHint')} />
                </div>
              </div>
            )}
            {form.type === 'ftp' && (
              <p className="flex gap-2 rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
                <TriangleAlert className="size-4 shrink-0" />
                {t('backups.ftpWarning')}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('backups.username')} htmlFor="bt-user">
                <Input id="bt-user" autoComplete="off" value={form.username} onChange={(e) => set('username', e.target.value)} />
              </Field>
              {form.type === 'scp' ? (
                <Field label={t('backups.authMethod')} htmlFor="bt-auth">
                  <Select id="bt-auth" value={form.authMethod} onChange={(e) => set('authMethod', e.target.value as Form['authMethod'])}>
                    <option value="key">{t('backups.authKey')}</option>
                    <option value="password">{t('backups.authPassword')}</option>
                  </Select>
                </Field>
              ) : (
                <PasswordField form={form} target={target} onChange={(v) => set('password', v)} />
              )}
            </div>
            {form.type === 'scp' && form.authMethod === 'password' && <PasswordField form={form} target={target} onChange={(v) => set('password', v)} />}
            {form.type === 'scp' && form.authMethod === 'key' && (
              <div className="rounded-xl border border-line bg-surface p-3">
                <p className="mb-2 text-xs text-muted">{t('backups.publicKeyHint')}</p>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 rounded-lg bg-sunken px-2 py-1.5 font-mono text-[11px] break-all">{sshKey.data?.publicKey ?? '…'}</code>
                  <Button size="sm" variant="secondary" icon={<Copy className="size-3.5" />} disabled={!sshKey.data} onClick={() => sshKey.data && copy(sshKey.data.publicKey)}>
                    {t('common.copy')}
                  </Button>
                </div>
              </div>
            )}
            {form.type === 'scp' && form.hostKey && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Lock className="size-3.5" />
                {t('backups.hostKey')} <code className="font-mono text-ink">{form.hostKey}</code>
                <button type="button" className="text-accent hover:underline" onClick={() => set('hostKey', '')}>
                  {t('backups.forgetHostKey')}
                </button>
              </div>
            )}
          </>
        )}

        <Field label={t('backups.path')} htmlFor="bt-path" hint={remote ? t('backups.pathHint') : t('backups.localPathHint', { base: overview.localBase })}>
          <Input id="bt-path" className="font-mono" value={form.path} onChange={(e) => set('path', e.target.value)} />
        </Field>

        {test && (
          <div className={cx('flex gap-2 rounded-xl px-3 py-2 text-sm', test.ok ? 'bg-online/10 text-online' : 'bg-offline/10 text-offline')}>
            {test.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}
            <span>
              {test.ok ? t('backups.testOk', { count: test.sets }) : test.error}
              {test.ok && test.hostKey && <span className="mt-0.5 block font-mono text-xs">{test.hostKey}</span>}
            </span>
          </div>
        )}

        <div className="space-y-4 rounded-2xl border border-line p-4">
          <Switch checked={form.schedule.enabled} onChange={(v) => setSchedule('enabled', v)} label={t('backups.scheduleEnabled')} description={t('backups.scheduleHint')} />
          {form.schedule.enabled && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('backups.fullEvery')} htmlFor="bt-every">
                  <Select id="bt-every" value={form.schedule.fullEvery} onChange={(e) => setSchedule('fullEvery', e.target.value as Schedule['fullEvery'])}>
                    <option value="day">{t('backups.every.day')}</option>
                    <option value="week">{t('backups.every.week')}</option>
                    <option value="month">{t('backups.every.month')}</option>
                  </Select>
                </Field>
                {form.schedule.fullEvery === 'week' && (
                  <Field label={t('backups.weekday')} htmlFor="bt-wd">
                    <Select id="bt-wd" value={form.schedule.weekday} onChange={(e) => setSchedule('weekday', Number(e.target.value))}>
                      {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                        <option key={d} value={d}>
                          {weekdayName(d)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {form.schedule.fullEvery === 'month' && (
                  <Field label={t('backups.monthDay')} htmlFor="bt-md">
                    <Select id="bt-md" value={form.schedule.monthDay} onChange={(e) => setSchedule('monthDay', Number(e.target.value))}>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label={t('backups.hour')} htmlFor="bt-hour">
                  <Select id="bt-hour" value={form.schedule.hour} onChange={(e) => setSchedule('hour', Number(e.target.value))}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {hourLabel(h)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label={t('backups.incremental')} htmlFor="bt-incr" hint={t('backups.incrementalHint')}>
                <Select id="bt-incr" value={form.schedule.incremental} onChange={(e) => setSchedule('incremental', e.target.value as Schedule['incremental'])}>
                  {(['off', '1h', '6h', '12h', '24h'] as const).map((v) => (
                    <option key={v} value={v}>
                      {t(`backups.incr.${v}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          <Field label={t('backups.keepFull')} htmlFor="bt-keep" hint={t('backups.keepFullHint')}>
            <Input id="bt-keep" type="number" min={1} max={100} className="w-28" value={form.keepFull} onChange={(e) => set('keepFull', Number(e.target.value))} />
          </Field>
        </div>
        {save.error && <p className="text-sm text-offline">{save.error.message}</p>}
      </div>
    </Modal>
  );
}

function PasswordField({ form, target, onChange }: { form: Form; target: Target | null; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <Field label={t('backups.password')} htmlFor="bt-pass">
      <Input id="bt-pass" type="password" autoComplete="new-password" placeholder={target?.passwordSet ? t('smtp.secretStored') : ''} value={form.password} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

// ── Restore ────────────────────────────────────────────────────────────────

function SetsModal({ target, overview, onClose }: { target: Target; overview: Overview; onClose: () => void }) {
  const { t } = useTranslation();
  const sets = useQuery({ queryKey: ['backup-sets', target.id], queryFn: () => api.get<SetInfo[]>(`/backups/targets/${target.id}/sets`), retry: false });
  const [restoring, setRestoring] = useState<SetInfo | null>(null);
  return (
    <>
      <Modal open={!restoring} wide onClose={onClose} title={t('backups.setsTitle', { name: target.name })} description={t('backups.setsDescription')}>
        {sets.isLoading ? (
          <div className="grid place-items-center py-10">
            <Spinner />
          </div>
        ) : sets.error ? (
          <p className="flex gap-2 rounded-xl bg-offline/10 px-3 py-2 text-sm text-offline">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {sets.error.message}
          </p>
        ) : !sets.data?.length ? (
          <EmptyState icon={<FolderOpen className="size-6" />} title={t('backups.noSets')} description={t('backups.noSetsHint')} />
        ) : (
          <div className="-mx-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-6 py-2 font-medium">{t('backups.colDate')}</th>
                  <th className="px-3 py-2 font-medium">{t('backups.colType')}</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">{t('backups.colServer')}</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">{t('backups.colSize')}</th>
                  <th className="px-6 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sets.data.map((s) => (
                  <tr key={s.id} className="hover:bg-sunken/50">
                    <td className="px-6 py-2.5">
                      <span className="block font-medium">{formatDate(s.createdAt)}</span>
                      <span className="font-mono text-[11px] text-muted">v{s.appVersion}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={s.type === 'full' ? 'accent' : 'neutral'}>{t(`backups.kind.${s.type}`)}</Badge>
                    </td>
                    <td className="hidden px-3 py-2.5 sm:table-cell">
                      {s.hostname} {s.ownServer && <span className="text-xs text-muted">({t('backups.thisServer')})</span>}
                    </td>
                    <td className="hidden px-3 py-2.5 text-right text-muted tabular-nums sm:table-cell">{formatBytes(s.storedBytes)}</td>
                    <td className="px-6 py-2.5 text-right">
                      <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" />} disabled={!overview.restoreAvailable || Boolean(overview.job)} onClick={() => setRestoring(s)}>
                        {t('backups.restore')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!overview.restoreAvailable && <p className="mt-4 text-xs text-muted">{t('backups.restoreUnavailable')}</p>}
      </Modal>
      {restoring && <ConfirmRestore target={target} set={restoring} onBack={() => setRestoring(null)} onDone={onClose} />}
    </>
  );
}

function ConfirmRestore({ target, set, onBack, onDone }: { target: Target; set: SetInfo; onBack: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [understood, setUnderstood] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const restore = useMutation({
    mutationFn: () => api.post(`/backups/targets/${target.id}/sets/${set.id}/restore`, { confirm: true, passphrase: passphrase || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backups'] });
      toast.success(t('backups.restoreStarted'));
      onDone();
    },
  });
  return (
    <Modal
      open
      onClose={onBack}
      title={t('backups.confirmTitle')}
      description={t('backups.confirmDescription', { date: formatDate(set.createdAt) })}
      footer={
        <>
          <Button variant="ghost" onClick={onBack}>
            {t('common.back')}
          </Button>
          <Button variant="danger" disabled={!understood} loading={restore.isPending} icon={<RotateCcw className="size-4" />} onClick={() => restore.mutate()}>
            {t('backups.restoreNow')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="space-y-2 rounded-xl bg-warning/10 p-4 text-sm">
          {(['confirm1', 'confirm2', 'confirm3', 'confirm4'] as const).map((k) => (
            <li key={k} className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>{t(`backups.${k}`, { version: set.appVersion })}</span>
            </li>
          ))}
        </ul>
        <Field label={t('backups.otherPassphrase')} htmlFor="rs-pass" hint={t('backups.otherPassphraseHint')}>
          <Input id="rs-pass" type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
        </Field>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[#FF6B57]" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          {t('backups.understood')}
        </label>
        {restore.error && <p className="text-sm text-offline">{restore.error.message}</p>}
      </div>
    </Modal>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

function SettingsCard({ overview }: { overview: Overview }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const copy = useCopy();
  const [passphrase, setPassphrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const save = useMutation({
    mutationFn: (body: { passphrase?: string; notifyOnFailure?: boolean }) => api.put<Overview>('/backups/settings', body),
    onSuccess: (data) => {
      qc.setQueryData(['backups'], data);
      setPassphrase('');
      setRepeat('');
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const regenerate = useMutation({
    mutationFn: () => api.post<{ publicKey: string }>('/backups/ssh-key', { regenerate: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backups'] });
      qc.removeQueries({ queryKey: ['backup-ssh-key'] });
      toast.success(t('backups.keyRegenerated'));
    },
  });
  const mismatch = Boolean(repeat) && repeat !== passphrase;
  return (
    <div className="min-w-0 space-y-6">
      <Card>
        <CardHeader title={t('backups.encryption')} description={t('backups.encryptionHint')} />
        <div className="space-y-4 p-6">
          <div className="flex items-center gap-2 text-sm">
            {overview.settings.passphraseSet ? <Badge tone="online">{t('backups.passphraseSet')}</Badge> : <Badge tone="warning">{t('backups.passphraseMissing')}</Badge>}
          </div>
          <Field label={overview.settings.passphraseSet ? t('backups.newPassphrase') : t('backups.passphrase')} htmlFor="bk-pass">
            <Input id="bk-pass" type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </Field>
          <Field label={t('backups.repeatPassphrase')} htmlFor="bk-pass2" error={mismatch ? t('backups.passphraseMismatch') : undefined}>
            <Input id="bk-pass2" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </Field>
          <p className="text-xs text-muted">{t('backups.passphraseWarning')}</p>
          <Button variant="accent" className="w-full" disabled={!passphrase || passphrase !== repeat} loading={save.isPending} onClick={() => save.mutate({ passphrase })}>
            {t('backups.savePassphrase')}
          </Button>
          <div className="border-t border-line pt-4">
            <Switch checked={overview.settings.notifyOnFailure} onChange={(v) => save.mutate({ notifyOnFailure: v })} label={t('backups.notify')} description={t('backups.notifyHint')} />
          </div>
        </div>
      </Card>
      {overview.settings.sshPublicKey && (
        <Card>
          <CardHeader title={t('backups.sshKey')} description={t('backups.sshKeyHint')} />
          <div className="space-y-3 p-6">
            <code className="block rounded-lg bg-sunken px-2 py-1.5 font-mono text-[11px] break-all">{overview.settings.sshPublicKey}</code>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" icon={<Copy className="size-3.5" />} onClick={() => copy(overview.settings.sshPublicKey)}>
                {t('common.copy')}
              </Button>
              <Button size="sm" variant="ghost" loading={regenerate.isPending} onClick={() => window.confirm(t('backups.confirmRegenerate')) && regenerate.mutate()}>
                {t('backups.regenerate')}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function TargetRow({ target, overview, onEdit, onBrowse }: { target: Target; overview: Overview; onEdit: () => void; onBrowse: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const Icon = typeIcon[target.type];
  const run = useMutation({
    mutationFn: (type: 'full' | 'incremental') => api.post(`/backups/targets/${target.id}/run`, { type }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/backups/targets/${target.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backups'] });
      toast.success(t('backups.targetDeleted'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const busy = Boolean(overview.job) || !overview.settings.passphraseSet;
  const failed = Boolean(target.lastError) && (!target.lastSuccessAt || (target.lastAttemptAt ?? '') > target.lastSuccessAt);
  return (
    <li className="px-6 py-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-sunken text-muted">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{target.name}</p>
            <Badge>{target.type === 'local' ? t('backups.local') : target.type === 'scp' ? 'SCP' : target.type.toUpperCase()}</Badge>
            {failed ? <Badge tone="offline">{t('backups.lastFailed')}</Badge> : target.lastSuccessAt ? <Badge tone="online">{t('backups.lastOk', { when: timeAgo(target.lastSuccessAt) })}</Badge> : <Badge tone="warning">{t('backups.never')}</Badge>}
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-muted">{target.type === 'local' ? target.path : `${target.username ? `${target.username}@` : ''}${target.host}${target.port ? `:${target.port}` : ''} ${target.path}`}</p>
          <p className="mt-1 text-xs text-muted">{scheduleSummary(target.schedule)} · {t('backups.keeps', { count: target.keepFull })}</p>
          {failed && <p className="mt-1.5 rounded-lg bg-offline/8 px-2 py-1 text-xs text-offline">{target.lastError}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 sm:pl-14">
        <Button size="sm" variant="secondary" icon={<DatabaseBackup className="size-3.5" />} disabled={busy} loading={run.isPending && run.variables === 'full'} onClick={() => run.mutate('full')}>
          {t('backups.runFull')}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} loading={run.isPending && run.variables === 'incremental'} onClick={() => run.mutate('incremental')}>
          {t('backups.runIncremental')}
        </Button>
        <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" />} onClick={onBrowse}>
          {t('backups.browse')}
        </Button>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={onEdit} aria-label={t('common.edit')} />
        <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label={t('common.delete')} onClick={() => window.confirm(t('backups.confirmDelete', { name: target.name })) && remove.mutate()} />
      </div>
    </li>
  );
}

function HistoryCard({ runs }: { runs: Run[] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader title={t('backups.history')} description={t('backups.historyHint')} />
      {!runs.length ? (
        <EmptyState icon={<History className="size-6" />} title={t('backups.noHistory')} description={t('backups.noHistoryHint')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-6 py-3 font-medium">{t('backups.colDate')}</th>
                <th className="px-3 py-3 font-medium">{t('backups.colTarget')}</th>
                <th className="px-3 py-3 font-medium">{t('backups.colType')}</th>
                <th className="hidden px-3 py-3 text-right font-medium md:table-cell">{t('backups.colSize')}</th>
                <th className="px-6 py-3 font-medium">{t('backups.colResult')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs.map((r) => (
                <tr key={r.id} className="align-top hover:bg-sunken/50">
                  <td className="px-6 py-2.5 whitespace-nowrap">
                    {formatDate(r.startedAt)}
                    <span className="block text-xs text-muted">{t(`backups.trigger.${r.trigger}`)}</span>
                  </td>
                  <td className="px-3 py-2.5">{r.targetName}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={r.type === 'full' ? 'accent' : 'neutral'}>{t(`backups.kind.${r.type}`)}</Badge>
                  </td>
                  <td className="hidden px-3 py-2.5 text-right text-muted tabular-nums md:table-cell">{r.storedBytes !== null ? formatBytes(r.storedBytes) : '—'}</td>
                  <td className="px-6 py-2.5">
                    {r.status === 'success' ? (
                      <span className="text-online">
                        {t('backups.success')}
                        {Boolean(r.removedSets) && <span className="block text-xs text-muted">{t('backups.removed', { count: r.removedSets ?? 0 })}</span>}
                      </span>
                    ) : (
                      <span className="line-clamp-3 block max-w-[18rem] text-xs break-words text-offline" title={r.error ?? undefined}>{r.error}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function BackupsPage() {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Target | 'new' | null>(null);
  const [browsing, setBrowsing] = useState<Target | null>(null);
  const overview = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get<Overview>('/backups'),
    // Poll while something runs; during a restore the server restarts, so errors are expected
    refetchInterval: (q) => (q.state.data?.job || ACTIVE_RESTORE.includes(q.state.data?.restore.state ?? '') || q.state.error ? 2500 : false),
    retry: false,
  });
  const err = overview.error;
  // After a restore the sessions come from the backup, so this session may be gone
  useEffect(() => {
    if (err instanceof ApiError && err.status === 401) window.location.assign('/login');
  }, [err]);

  const data = overview.data;
  if (!data) return overview.isLoading ? <Spinner /> : <p className="text-sm text-offline">{err?.message}</p>;
  const unreachable = Boolean(err) && !(err instanceof ApiError && err.status < 500);
  const recentRestore = data.restore.state !== 'idle' && data.restore.updatedAt && Date.now() - new Date(data.restore.updatedAt).getTime() < 24 * 3600_000;

  return (
    <>
      <PageHeader
        eyebrow={t('common.system')}
        title={t('backups.title')}
        description={t('backups.description')}
        actions={
          <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            {t('backups.newTarget')}
          </Button>
        }
      />
      {data.job && <JobBanner job={data.job} />}
      {(recentRestore || unreachable) && <RestoreBanner status={data.restore} unreachable={unreachable && ACTIVE_RESTORE.includes(data.restore.state)} />}
      {!data.settings.passphraseSet && (
        <Card className="mb-6 border-warning/40">
          <div className="flex gap-3 px-6 py-4 text-sm">
            <TriangleAlert className="size-5 shrink-0 text-warning" />
            <span>{t('backups.setPassphraseFirst')}</span>
          </div>
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title={t('backups.locations')} description={t('backups.locationsHint')} />
            {!data.targets.length ? (
              <EmptyState
                icon={<DatabaseBackup className="size-6" />}
                title={t('backups.empty')}
                description={t('backups.emptyHint')}
                action={
                  <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                    {t('backups.newTarget')}
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-line">
                {data.targets.map((target) => (
                  <TargetRow key={target.id} target={target} overview={data} onEdit={() => setEditing(target)} onBrowse={() => setBrowsing(target)} />
                ))}
              </ul>
            )}
          </Card>
          <HistoryCard runs={data.runs} />
        </div>
        <SettingsCard overview={data} />
      </div>
      {editing && <TargetModal target={editing === 'new' ? null : editing} overview={data} onClose={() => setEditing(null)} />}
      {browsing && <SetsModal target={browsing} overview={data} onClose={() => setBrowsing(null)} />}
    </>
  );
}

