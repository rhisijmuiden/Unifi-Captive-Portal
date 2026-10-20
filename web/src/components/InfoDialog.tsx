import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpCircle, CheckCircle2, ExternalLink, FlaskConical, HardDriveDownload, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatDuration } from '../lib/format';
import { Badge, Button, cx, Modal, Spinner, Switch } from './ui';

type Info = {
  version: string;
  repository: string;
  node?: string;
  hostname?: string;
  uptimeSeconds?: number;
  processUptimeSeconds?: number;
  channel?: Channel;
  selfUpdate?: boolean;
  update?: UpdateStatus;
};
type Channel = 'stable' | 'test';
type UpdateStatus = { state: 'idle' | 'queued' | 'running' | 'success' | 'failed'; code?: string; version?: string; message?: string; log?: string; updatedAt?: string };
type UpdateCheck = {
  current: string;
  channel: Channel;
  latest: { version: string; name: string; notes: string; url: string; publishedAt: string | null; prerelease: boolean } | null;
  updateAvailable: boolean;
  checkedAt: string;
};

export function InfoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: auth } = useAuth();
  const isAdmin = auth?.user?.role === 'superadmin';
  const qc = useQueryClient();

  const info = useQuery({ queryKey: ['system-info'], queryFn: () => api.get<Info>('/system/info'), enabled: open });
  const check = useQuery({ queryKey: ['update-check'], queryFn: () => api.get<UpdateCheck>('/system/updates?force=1'), enabled: false, retry: false });
  const running = info.data?.update?.state === 'queued' || info.data?.update?.state === 'running';
  const status = useQuery({
    queryKey: ['update-status'],
    queryFn: () => api.get<UpdateStatus>('/system/update/status'),
    enabled: open && isAdmin && running,
    refetchInterval: 2500,
  });
  const live = status.data ?? info.data?.update;

  const [includeSystem, setIncludeSystem] = useState(true);
  const install = useMutation({
    mutationFn: (body: { version: string; system: boolean }) => api.post('/system/update', body),
    onSuccess: () => {
      toast.success(t('info.started'));
      qc.invalidateQueries({ queryKey: ['system-info'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setChannel = useMutation({
    mutationFn: (channel: Channel) => api.put('/settings/system', { updateChannel: channel }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['system-info'] });
      qc.removeQueries({ queryKey: ['update-check'] });
      check.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const channel = info.data?.channel ?? 'stable';
  const target = check.data?.updateAvailable && check.data.latest ? check.data.latest.version : (info.data?.version ?? '');
  const canUpdate = Boolean(info.data?.selfUpdate) && !running;

  return (
    <Modal open={open} onClose={onClose} title={t('info.title')} description={t('info.description')} wide>
      <div className="relative mb-6 overflow-hidden rounded-2xl signal-bg p-6 text-white">
        <div className="flex items-center gap-4">
          <div className="relative grid size-14 place-items-center">
            <span className="pulse-ring absolute inset-0 rounded-2xl border-2 border-koraal/70" />
            <img src="/rhis-icon.svg" alt="" className="relative size-14 rounded-2xl" />
          </div>
          <div>
            <p className="display text-xl">Captive Portal</p>
            <p className="text-sm text-white/70">
              {t('info.version')} <span className="font-mono text-lucht">{info.data?.version ?? auth?.version}</span>
            </p>
          </div>
        </div>
      </div>

      {info.isLoading ? (
        <Spinner />
      ) : (
        isAdmin &&
        info.data && (
          <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            {[
              [t('info.server'), info.data.hostname],
              ['Node.js', info.data.node],
              [t('info.uptimeServer'), info.data.uptimeSeconds !== undefined ? formatDuration(info.data.uptimeSeconds) : '—'],
              [t('info.uptimeApp'), info.data.processUptimeSeconds !== undefined ? formatDuration(info.data.processUptimeSeconds) : '—'],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="truncate font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        )
      )}

      {isAdmin ? (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">{t('info.channel')}</p>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-sunken p-1">
              {(
                [
                  ['stable', t('info.stable'), t('info.stableHint'), ShieldCheck],
                  ['test', t('info.test'), t('info.testHint'), FlaskConical],
                ] as const
              ).map(([value, label, hint, Icon]) => (
                <button
                  key={value}
                  type="button"
                  disabled={setChannel.isPending}
                  onClick={() => value !== channel && setChannel.mutate(value)}
                  className={cx('rounded-lg px-3 py-2 text-left transition', channel === value ? 'bg-raised shadow-card' : 'text-muted hover:text-ink')}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <Icon className={cx('size-4', channel === value && (value === 'test' ? 'text-warning' : 'text-online'))} /> {label}
                  </span>
                  <span className="block text-xs text-muted">{hint}</span>
                </button>
              ))}
            </div>
          </div>

          {live && live.state !== 'idle' && (
            <div className="rounded-xl border border-line bg-surface p-4 text-sm">
              <div className="flex items-center gap-2 font-medium">
                {live.state === 'success' ? <CheckCircle2 className="size-4 text-online" /> : live.state === 'failed' ? <TriangleAlert className="size-4 text-offline" /> : <Spinner className="size-4" />}
                {live.code ? t(`info.status.${live.code}`, { version: live.version, defaultValue: live.message }) : (live.message ?? live.state)}
                {live.version && <Badge>v{live.version}</Badge>}
              </div>
              {live.updatedAt && <p className="mt-1 text-xs text-muted">{formatDate(live.updatedAt)}</p>}
              {live.log && <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-nacht p-3 font-mono text-[11px] text-white/80">{live.log}</pre>}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
            <div className="text-sm">
              {check.data ? (
                check.data.updateAvailable && check.data.latest ? (
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <ArrowUpCircle className="size-4 text-accent" /> {t('info.available', { version: check.data.latest.version })}
                    {check.data.latest.prerelease && <Badge tone="warning">{t('info.test')}</Badge>}
                  </p>
                ) : (
                  <p className="flex items-center gap-2 font-medium">
                    <CheckCircle2 className="size-4 text-online" /> {channel === 'test' ? t('info.upToDateTest') : t('info.upToDate')}
                  </p>
                )
              ) : check.error ? (
                <p className="text-offline">{(check.error as Error).message}</p>
              ) : (
                <p className="text-muted">{t('info.checkPrompt')}</p>
              )}
              {check.data?.latest?.url && (
                <a href={check.data.latest.url} target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline">
                  {t('info.releaseNotes')} <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            <Button variant="secondary" icon={<RefreshCw className="size-4" />} loading={check.isFetching} onClick={() => check.refetch()}>
              {t('info.check')}
            </Button>
          </div>
          {check.data?.latest?.notes && check.data.updateAvailable && (
            <pre className="max-h-48 overflow-auto rounded-xl bg-sunken p-4 font-sans text-xs whitespace-pre-wrap text-muted">{check.data.latest.notes}</pre>
          )}

          <div className="space-y-4 rounded-xl border border-line p-4">
            <Switch
              checked={includeSystem}
              onChange={setIncludeSystem}
              label={t('info.fullUpdate')}
              description={t('info.fullUpdateHint')}
            />
            <div className="flex flex-wrap justify-end gap-2">
              {check.data?.updateAvailable && check.data.latest ? (
                <Button
                  variant="accent"
                  icon={<ArrowUpCircle className="size-4" />}
                  loading={install.isPending}
                  disabled={!canUpdate}
                  onClick={() => install.mutate({ version: target, system: includeSystem })}
                >
                  {t('info.updateTo', { version: check.data.latest.version })}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  icon={<HardDriveDownload className="size-4" />}
                  loading={install.isPending}
                  disabled={!canUpdate || !includeSystem}
                  onClick={() => install.mutate({ version: target, system: true })}
                >
                  {t('info.systemOnly')}
                </Button>
              )}
            </div>
          </div>
          {info.data && !info.data.selfUpdate && (
            <p className="text-xs text-muted">{t('info.notEnabled')} <code className="font-mono">sudo captive-portal-update</code>.</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">{t('info.managed')}</p>
      )}

      <p className="mt-6 text-xs text-muted">
        {t('info.source')}{' '}
        <a className="text-accent hover:underline" href={info.data?.repository ?? '#'} target="_blank" rel="noopener">
          GitHub
        </a>
        . Designed by{' '}
        <a className="text-accent hover:underline" href="https://rhis.nl" target="_blank" rel="noopener">
          RHIS
        </a>
        .
      </p>
    </Modal>
  );
}
