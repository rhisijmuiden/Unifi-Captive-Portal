import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clapperboard, Film, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ImageUpload, Segmented, useConfirm } from '../components/controls';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Switch } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatBytes, formatDay } from '../lib/format';
import { currentLocale } from '../i18n';
import { useTenantScope } from '../lib/tenant';

type Day = { day: string; views: number; clicks: number };
type Ad = {
  id: string;
  name: string;
  kind: 'image' | 'video';
  mediaId: string | null;
  mediaUrl: string | null;
  linkUrl: string | null;
  placement: 'before' | 'after';
  seconds: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  stats: { views: number; clicks: number; today: { views: number; clicks: number }; days: Day[] };
};

const MAX_VIDEO = 25 * 1024 * 1024;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-CA') : '');
const pct = (clicks: number, views: number) => (views ? `${((clicks / views) * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : '–');

/** Uploads an mp4 or WebM as the raw file; images go through the regular data-URL upload. */
function VideoUpload({ value, onChange }: { value: string | null; onChange: (url: string | null) => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_VIDEO) return toast.error(t('ads.videoHint', { size: formatBytes(MAX_VIDEO) }));
    setBusy(true);
    try {
      const res = await fetch('/api/media/video', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': file.type, 'x-requested-with': 'captive-portal', 'x-locale': currentLocale() }, body: file });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data?.error ?? `HTTP ${res.status}`);
      onChange(data.url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="space-y-2">
      {value ? (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-2">
          <video src={value} muted className="h-14 w-24 rounded-lg bg-black object-cover" />
          <div className="flex flex-1 flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
              {t('editor.replace')}
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => onChange(null)}>
              {t('editor.removeImage')}
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-line px-4 py-5 text-sm text-muted transition hover:border-koraal hover:text-ink">
          <Film className="size-5" />
          <span className="font-medium">{busy ? '…' : t('ads.uploadVideo')}</span>
          <span className="text-xs">{t('ads.videoHint', { size: formatBytes(MAX_VIDEO) })}</span>
        </button>
      )}
      <input ref={input} type="file" accept="video/mp4,video/webm" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}

function AdDialog({ ad, open, onClose }: { ad: Ad | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const empty = { name: '', kind: 'image' as Ad['kind'], mediaUrl: null as string | null, linkUrl: '', placement: 'before' as Ad['placement'], seconds: 5, active: true, startsAt: '', endsAt: '' };
  const [f, setF] = useState(empty);
  useEffect(() => {
    if (open) setF(ad ? { name: ad.name, kind: ad.kind, mediaUrl: ad.mediaUrl, linkUrl: ad.linkUrl ?? '', placement: ad.placement, seconds: ad.seconds, active: ad.active, startsAt: day(ad.startsAt), endsAt: day(ad.endsAt) } : empty);
  }, [open, ad]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name,
        kind: f.kind,
        mediaId: f.mediaUrl?.split('/').pop() ?? null,
        linkUrl: f.placement === 'after' ? f.linkUrl : '',
        placement: f.placement,
        seconds: f.seconds,
        active: f.active,
        // Whole days in the browser's time zone: from the start of the first to the end of the last
        startsAt: f.startsAt ? new Date(`${f.startsAt}T00:00`).toISOString() : null,
        endsAt: f.endsAt ? new Date(`${f.endsAt}T23:59:59`).toISOString() : null,
      };
      return ad ? api.put(`/ads/${ad.id}`, body) : api.post('/ads', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ads'] });
      toast.success(t('common.saved'));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={ad ? t('ads.edit') : t('ads.add')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="accent" loading={save.isPending} disabled={!f.name.trim() || !f.mediaUrl} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('ads.name')} htmlFor="ad-name">
          <Input id="ad-name" autoFocus maxLength={80} placeholder={t('ads.namePlaceholder')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label={t('ads.kind')}>
          <Segmented
            value={f.kind}
            onChange={(kind) => setF({ ...f, kind, mediaUrl: kind === f.kind ? f.mediaUrl : null })}
            options={[
              { value: 'image', label: t('ads.kinds.image') },
              { value: 'video', label: t('ads.kinds.video') },
            ]}
          />
        </Field>
        <div className="sm:col-span-2">{f.kind === 'image' ? <ImageUpload value={f.mediaUrl} onChange={(mediaUrl) => setF({ ...f, mediaUrl })} /> : <VideoUpload value={f.mediaUrl} onChange={(mediaUrl) => setF({ ...f, mediaUrl })} />}</div>
        <Field label={t('ads.placement')} hint={t(`ads.placementHints.${f.placement}`)}>
          <Segmented
            value={f.placement}
            onChange={(placement) => setF({ ...f, placement })}
            options={[
              { value: 'before', label: t('ads.placements.before') },
              { value: 'after', label: t('ads.placements.after') },
            ]}
          />
        </Field>
        <Field label={t('ads.seconds')} htmlFor="ad-sec" hint={t('ads.secondsHint')}>
          <Input id="ad-sec" type="number" min={0} max={60} value={f.seconds} onChange={(e) => setF({ ...f, seconds: Number(e.target.value) })} />
        </Field>
        {f.placement === 'after' && (
          <Field label={t('ads.link')} htmlFor="ad-link" hint={t('ads.linkHint')}>
            <Input id="ad-link" type="url" placeholder="https://" value={f.linkUrl} onChange={(e) => setF({ ...f, linkUrl: e.target.value.trim() })} />
          </Field>
        )}
        <Field label={t('ads.period')} hint={t('ads.periodHint')}>
          <div className="flex items-center gap-2">
            <Input type="date" className="min-w-0" aria-label={t('ads.from')} value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />
            <span className="text-muted">–</span>
            <Input type="date" className="min-w-0" aria-label={t('ads.until')} value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
          </div>
        </Field>
        <div className="sm:col-span-2">
          <Switch checked={f.active} onChange={(active) => setF({ ...f, active })} label={t('ads.active')} />
        </div>
      </div>
    </Modal>
  );
}

/** Views per day for the last 30 days. */
function Spark({ days }: { days: Day[] }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...days.map((d) => d.views));
  const map = new Map(days.map((d) => [d.day, d]));
  const series = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86_400_000).toLocaleDateString('en-CA')).map((d) => map.get(d) ?? { day: d, views: 0, clicks: 0 });
  return (
    <div className="flex h-10 items-end gap-px" role="img" aria-label={t('ads.last30')}>
      {series.map((d) => (
        <div key={d.day} title={`${formatDay(d.day)}: ${d.views} / ${d.clicks}`} className="flex-1 rounded-t-[2px] bg-koraal/80" style={{ height: `${Math.max(d.views ? 8 : 3, (d.views / max) * 100)}%`, opacity: d.views ? 1 : 0.2 }} />
      ))}
    </div>
  );
}

export function AdsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const scope = useTenantScope();
  const [dialog, ask] = useConfirm();
  const [editing, setEditing] = useState<Ad | null>(null);
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['ads'], queryFn: () => api.get<{ ads: Ad[] }>('/ads') });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/ads/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ads'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (ad: Ad) => api.put(`/ads/${ad.id}`, { active: !ad.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ads'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const ads = data?.ads ?? [];
  const now = Date.now();
  const state = (a: Ad) => (!a.active ? 'paused' : a.endsAt && Date.parse(a.endsAt) < now ? 'ended' : a.startsAt && Date.parse(a.startsAt) > now ? 'planned' : 'live');

  return (
    <>
      <PageHeader
        eyebrow={t('nav.marketing')}
        title={t('ads.title')}
        description={t('ads.description')}
        actions={
          scope.canManage && (
            <Button
              variant="accent"
              icon={<Plus className="size-4" />}
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              {t('ads.add')}
            </Button>
          )
        }
      />
      {isLoading ? (
        <Spinner />
      ) : !ads.length ? (
        <Card>
          <EmptyState icon={<Clapperboard className="size-6" />} title={t('ads.empty')} description={t('ads.emptyHint')} />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {ads.map((a) => {
            const s = state(a);
            return (
              <Card key={a.id} className="flex flex-col overflow-hidden">
                <div className="relative aspect-video bg-sunken">
                  {a.mediaUrl && (a.kind === 'video' ? <video src={a.mediaUrl} muted loop playsInline className="size-full object-cover" onMouseEnter={(e) => void e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} /> : <img src={a.mediaUrl} alt="" className="size-full object-cover" />)}
                  <div className="absolute top-3 left-3 flex gap-1 rounded-full bg-raised/90 p-1 shadow-card backdrop-blur">
                    <Badge tone={s === 'live' ? 'online' : s === 'planned' ? 'info' : 'neutral'}>{t(`ads.states.${s}`)}</Badge>
                    <Badge tone="neutral">{t(`ads.placements.${a.placement}`)}</Badge>
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-4 p-5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold">{a.name}</h3>
                      <p className="truncate text-xs text-muted">
                        {a.kind === 'video' ? t('ads.kinds.video') : t('ads.kinds.image')} · {a.seconds ? t('ads.secondsShort', { count: a.seconds }) : t('ads.noWait')}
                        {(a.startsAt || a.endsAt) && ` · ${a.startsAt ? formatDay(a.startsAt) : '…'} – ${a.endsAt ? formatDay(a.endsAt) : '…'}`}
                      </p>
                    </div>
                    {scope.canManage && (
                      <div className="flex shrink-0">
                        <button
                          className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink"
                          aria-label={t('common.edit')}
                          onClick={() => {
                            setEditing(a);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-offline" aria-label={t('common.delete')} onClick={async () => (await ask(t('ads.deleteConfirm', { name: a.name }))) && remove.mutate(a.id)}>
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-center">
                    {[
                      [t('ads.views'), a.stats.views.toLocaleString()],
                      [t('ads.clicks'), a.placement === 'after' && a.linkUrl ? a.stats.clicks.toLocaleString() : '–'],
                      [t('ads.ctr'), a.placement === 'after' && a.linkUrl ? pct(a.stats.clicks, a.stats.views) : '–'],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl bg-sunken px-2 py-2.5">
                        <dt className="text-xs text-muted">{label}</dt>
                        <dd className="text-lg font-semibold tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div>
                    <Spark days={a.stats.days} />
                    <p className="mt-1.5 text-xs text-muted">{t('ads.today', { views: a.stats.today.views, clicks: a.stats.today.clicks })}</p>
                  </div>
                  {scope.canManage && <Switch checked={a.active} onChange={() => toggle.mutate(a)} label={t('ads.active')} />}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <AdDialog open={open} ad={editing} onClose={() => setOpen(false)} />
      {dialog}
    </>
  );
}
