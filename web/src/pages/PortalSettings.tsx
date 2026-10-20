import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Gauge, HardDrive, Wifi } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import i18n, { languages, type Locale } from '../i18n';
import { Button, Card, CardHeader, Field, Input, PageHeader, Spinner, Switch, Textarea, cx } from '../components/ui';
import { api } from '../lib/api';
import { useTenantScope } from '../lib/tenant';

type Texts = Record<string, string>;
type PortalSettings = {
  title: Texts;
  welcome: Texts;
  terms: Texts;
  accentColor: string;
  requireTerms: boolean;
  timeLimitMinutes: number;
  dataLimitMb: number | null;
  downKbps: number | null;
  upKbps: number | null;
  successUrl: string | null;
};

const durations = [60, 240, 480, 1440, 10080];
const swatches = ['#FF6B57', '#14213D', '#2563EB', '#0F9D58', '#7C3AED', '#E11D48', '#F59E0B', '#0EA5E9'];

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="space-y-5 p-6">{children}</div>
    </Card>
  );
}

/** Number input where empty means "no limit". */
function Limit({ id, value, onChange, unit, icon }: { id: string; value: number | null; onChange: (v: number | null) => void; unit: string; icon: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted">{icon}</span>
      <Input id={id} type="number" min={1} className="pr-16 pl-9" placeholder={t('portalSettings.unlimited')} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} />
      <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">{unit}</span>
    </div>
  );
}

function Preview({ form, lang }: { form: PortalSettings; lang: Locale }) {
  const g = i18n.getFixedT(lang);
  const title = form.title[lang] || g('portalSettings.guest.defaultTitle');
  const welcome = form.welcome[lang] || g('portalSettings.guest.defaultWelcome');
  return (
    <div className="mx-auto w-full max-w-[300px] rounded-[2.2rem] border-[10px] border-nacht bg-nacht shadow-2xl">
      <div className="h-[540px] overflow-hidden rounded-[1.6rem] bg-[#F6F7FB] p-4 text-[#14213D]" style={{ backgroundImage: `radial-gradient(30rem 16rem at 120% -10%, ${form.accentColor}33, transparent)` }}>
        <div className="mt-8 rounded-2xl border border-[#e3e6ef] bg-white p-5 shadow-lg">
          <div className="mb-4 grid size-12 place-items-center rounded-xl" style={{ background: `${form.accentColor}22`, color: form.accentColor }}>
            <Wifi className="size-6" />
          </div>
          <p className="text-lg leading-tight font-bold">{title}</p>
          <p className="mt-2 line-clamp-4 text-xs whitespace-pre-line text-[#5b6478]">{welcome}</p>
          {form.requireTerms && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#e3e6ef] p-2.5 text-[11px]">
              <span className="mt-0.5 size-3.5 shrink-0 rounded border-2" style={{ borderColor: form.accentColor }} />
              {g('portalSettings.guest.acceptTerms')}
            </div>
          )}
          <div className="mt-4 rounded-xl py-2.5 text-center text-sm font-bold text-white" style={{ background: form.accentColor }}>
            {g('portalSettings.guest.connect')}
          </div>
        </div>
        <p className="mt-4 text-center text-[10px] text-[#5b6478]">Designed by RHIS</p>
      </div>
    </div>
  );
}

export function PortalSettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const scope = useTenantScope();
  const [lang, setLang] = useState<Locale>((i18n.resolvedLanguage as Locale) ?? 'en');
  const [form, setForm] = useState<PortalSettings | null>(null);
  const query = useQuery({
    queryKey: ['portal-settings', scope.tenantId],
    queryFn: () => api.get<{ settings: PortalSettings }>('/portal-settings'),
    enabled: Boolean(scope.tenantId),
  });
  useEffect(() => {
    if (query.data) setForm(query.data.settings);
  }, [query.data]);
  const save = useMutation({
    mutationFn: () => api.put<{ settings: PortalSettings }>('/portal-settings', { ...form, successUrl: form?.successUrl || null }),
    onSuccess: (d) => {
      qc.setQueryData(['portal-settings', scope.tenantId], d);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = <K extends keyof PortalSettings>(k: K, v: PortalSettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setText = (k: 'title' | 'welcome' | 'terms', v: string) => setForm((f) => (f ? { ...f, [k]: { ...f[k], [lang]: v } } : f));
  const g = i18n.getFixedT(lang);

  return (
    <>
      <PageHeader
        eyebrow={t('nav.portals')}
        title={t('portalSettings.title')}
        description={t('portalSettings.description')}
        actions={
          <>
            {form && scope.canManage && (
              <Button variant="accent" loading={save.isPending} onClick={() => save.mutate()}>
                {t('common.save')}
              </Button>
            )}
          </>
        }
      />
      {!form ? (
        <Spinner />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            <Section title={t('portalSettings.texts')} description={t('portalSettings.textsHint')}>
              <div className="flex gap-1 rounded-xl bg-sunken p-1" role="tablist">
                {languages.map((l) => (
                  <button
                    key={l.code}
                    role="tab"
                    aria-selected={lang === l.code}
                    onClick={() => setLang(l.code)}
                    className={cx('flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition', lang === l.code ? 'bg-raised shadow-card' : 'text-muted hover:text-ink')}
                  >
                    {l.flag} {l.label}
                    {!form.title[l.code] && !form.welcome[l.code] && <span className="ml-1 text-xs text-muted">· {t('portalSettings.defaultText')}</span>}
                  </button>
                ))}
              </div>
              <Field label={t('portalSettings.pageTitle')} htmlFor="p-title">
                <Input id="p-title" maxLength={120} placeholder={g('portalSettings.guest.defaultTitle')} value={form.title[lang] ?? ''} onChange={(e) => setText('title', e.target.value)} />
              </Field>
              <Field label={t('portalSettings.welcome')} htmlFor="p-welcome">
                <Textarea id="p-welcome" rows={3} className="font-sans text-sm" placeholder={g('portalSettings.guest.defaultWelcome')} value={form.welcome[lang] ?? ''} onChange={(e) => setText('welcome', e.target.value)} />
              </Field>
              <Field label={t('portalSettings.terms')} htmlFor="p-terms" hint={t('portalSettings.termsHint')}>
                <Textarea id="p-terms" rows={6} className="font-sans text-sm" value={form.terms[lang] ?? ''} onChange={(e) => setText('terms', e.target.value)} />
              </Field>
              <Switch checked={form.requireTerms} onChange={(v) => set('requireTerms', v)} label={t('portalSettings.requireTerms')} description={t('portalSettings.requireTermsHint')} />
            </Section>

            <Section title={t('portalSettings.look')}>
              <Field label={t('portalSettings.accent')} htmlFor="p-accent">
                <div className="flex flex-wrap items-center gap-2">
                  {swatches.map((c) => (
                    <button key={c} type="button" onClick={() => set('accentColor', c)} aria-label={c} className={cx('size-8 rounded-full border-2 transition', form.accentColor.toLowerCase() === c.toLowerCase() ? 'scale-110 border-ink' : 'border-transparent')} style={{ background: c }} />
                  ))}
                  <input id="p-accent" type="color" value={form.accentColor} onChange={(e) => set('accentColor', e.target.value)} className="size-8 cursor-pointer rounded-full border border-line bg-transparent" />
                  <code className="font-mono text-xs text-muted">{form.accentColor}</code>
                </div>
              </Field>
              <p className="text-xs text-muted">{t('portalSettings.editorSoon')}</p>
            </Section>

            <Section title={t('portalSettings.access')} description={t('portalSettings.accessHint')}>
              <Field label={t('portalSettings.duration')} htmlFor="p-time">
                <div className="flex flex-wrap gap-2">
                  {durations.map((m) => (
                    <button key={m} type="button" onClick={() => set('timeLimitMinutes', m)} className={cx('rounded-full border px-3 py-1 text-sm transition', form.timeLimitMinutes === m ? 'border-koraal bg-koraal/10 text-accent' : 'border-line hover:border-muted')}>
                      {t(`portalSettings.durations.${m}` as 'portalSettings.durations.60')}
                    </button>
                  ))}
                  <div className="relative w-36">
                    <Clock className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                    <Input id="p-time" type="number" min={5} className="pr-12 pl-9" value={form.timeLimitMinutes} onChange={(e) => set('timeLimitMinutes', Number(e.target.value))} />
                    <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">min</span>
                  </div>
                </div>
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('portalSettings.dataLimit')} htmlFor="p-data">
                  <Limit id="p-data" value={form.dataLimitMb} onChange={(v) => set('dataLimitMb', v)} unit="MB" icon={<HardDrive className="size-4" />} />
                </Field>
                <Field label={t('portalSettings.down')} htmlFor="p-down">
                  <Limit id="p-down" value={form.downKbps} onChange={(v) => set('downKbps', v)} unit="kbps" icon={<Gauge className="size-4" />} />
                </Field>
                <Field label={t('portalSettings.up')} htmlFor="p-up">
                  <Limit id="p-up" value={form.upKbps} onChange={(v) => set('upKbps', v)} unit="kbps" icon={<Gauge className="size-4" />} />
                </Field>
              </div>
              <Field label={t('portalSettings.successUrl')} htmlFor="p-success" hint={t('portalSettings.successUrlHint')}>
                <Input id="p-success" placeholder="https://www.jouwbedrijf.nl" value={form.successUrl ?? ''} onChange={(e) => set('successUrl', e.target.value)} />
              </Field>
            </Section>
          </div>

          <div className="xl:sticky xl:top-6 xl:h-fit">
            <p className="mb-3 text-center text-xs font-semibold tracking-widest text-muted uppercase">{t('portalSettings.preview')}</p>
            <Preview form={form} lang={lang} />
          </div>
        </div>
      )}
    </>
  );
}
