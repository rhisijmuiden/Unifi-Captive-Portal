import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, CreditCard, Gauge, HardDrive, Mail, MousePointerClick, Palette, PlugZap, Ticket } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Copyable, Segmented, Slider } from '../components/controls';
import { Button, Card, CardHeader, Field, Input, PageHeader, Spinner, Switch, Textarea, cx } from '../components/ui';
import i18n, { languages, type Locale } from '../i18n';
import { api } from '../lib/api';
import { useTenantScope } from '../lib/tenant';

type Texts = Record<string, string>;
type FieldMode = 'off' | 'optional' | 'required';
type Method = 'free' | 'email' | 'voucher' | 'payment' | 'facebook';
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
  auth: { methods: Method[]; emailName: FieldMode; emailPhone: FieldMode; marketingOptIn: boolean; welcomeMail: boolean; paymentEmail: FieldMode };
  languages: string[];
};

const durations = [60, 240, 480, 1440, 10080];
const methodIcons: Record<Method, ReactNode> = {
  free: <MousePointerClick className="size-5" />,
  email: <Mail className="size-5" />,
  voucher: <Ticket className="size-5" />,
  payment: <CreditCard className="size-5" />,
  facebook: (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
      <path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12Z" />
    </svg>
  ),
};

type Social = { facebookAppId: string; facebookAppSecretSet: boolean; facebookGraceMinutes: number };

/** The customer's own Facebook app for "Continue with Facebook". Saved separately from the portal settings. */
function FacebookSettings({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['social-settings'], queryFn: () => api.get<{ settings: Social; facebookRedirectUri: string }>('/social-settings') });
  const [form, setForm] = useState<Social | null>(null);
  const [secret, setSecret] = useState('');
  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);
  const save = useMutation({
    mutationFn: () => api.put('/social-settings', { facebookAppId: form!.facebookAppId, facebookGraceMinutes: form!.facebookGraceMinutes, facebookAppSecret: secret }),
    onSuccess: () => {
      setSecret('');
      qc.invalidateQueries({ queryKey: ['social-settings'] });
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: () => api.post('/social-settings/test', { facebookAppId: form!.facebookAppId, facebookAppSecret: secret }),
    onSuccess: () => toast.success(t('portalSettings.facebook.testOk')),
    onError: (e: Error) => toast.error(e.message),
  });
  if (!form || !data) return <Spinner />;
  const ready = Boolean(data.settings.facebookAppId && data.settings.facebookAppSecretSet);
  return (
    <Section
      title={t('portalSettings.facebook.title')}
      description={t('portalSettings.facebook.description')}
      action={
        canManage && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={<PlugZap className="size-4" />} loading={test.isPending} onClick={() => test.mutate()}>
              {t('portalSettings.facebook.test')}
            </Button>
            <Button variant="accent" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
              {t('common.save')}
            </Button>
          </div>
        )
      }
    >
      {!ready && <p className="rounded-lg bg-warning/12 px-3 py-2 text-xs text-warning">{t('portalSettings.facebook.notReady')}</p>}
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>{t('portalSettings.facebook.step1')}</li>
        <li>{t('portalSettings.facebook.step2')}</li>
        <li>{t('portalSettings.facebook.step3')}</li>
      </ol>
      <Field label={t('portalSettings.facebook.redirectUri')} hint={t('portalSettings.facebook.redirectUriHint')}>
        <Copyable value={data.facebookRedirectUri} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('portalSettings.facebook.appId')} htmlFor="fb-id">
          <Input id="fb-id" inputMode="numeric" autoComplete="off" placeholder="1234567890123456" value={form.facebookAppId} onChange={(e) => setForm({ ...form, facebookAppId: e.target.value.trim() })} disabled={!canManage} />
        </Field>
        <Field label={t('portalSettings.facebook.appSecret')} htmlFor="fb-secret">
          <Input id="fb-secret" type="password" autoComplete="off" placeholder={data.settings.facebookAppSecretSet ? `•••••• (${t('payments.keySet')})` : ''} value={secret} onChange={(e) => setSecret(e.target.value)} disabled={!canManage} />
        </Field>
      </div>
      <div>
        <Slider label={t('portalSettings.facebook.grace')} value={form.facebookGraceMinutes} min={0} max={15} unit=" min" onChange={(v) => setForm({ ...form, facebookGraceMinutes: v })} />
        <p className="mt-1 text-xs text-muted">{t('portalSettings.facebook.graceHint')}</p>
      </div>
      <div className="rounded-xl bg-sunken p-4 text-xs text-muted">
        <p className="font-semibold text-ink">{t('portalSettings.facebook.walledGarden')}</p>
        <p className="mt-1">{t('portalSettings.facebook.walledGardenHint')}</p>
        <code className="mt-2 block font-mono">facebook.com, *.facebook.com, *.fbcdn.net, *.facebook.net</code>
      </div>
    </Section>
  );
}

function Section({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} action={action} />
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

export function PortalSettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const scope = useTenantScope();
  const [lang, setLang] = useState<Locale>((i18n.resolvedLanguage as Locale) ?? 'en');
  const [form, setForm] = useState<PortalSettings | null>(null);
  const query = useQuery({ queryKey: ['portal-settings'], queryFn: () => api.get<{ settings: PortalSettings }>('/portal-settings') });
  const payments = useQuery({ queryKey: ['payment-settings'], queryFn: () => api.get<{ settings: { provider: string; graceMinutes: number } }>('/payment-settings') });
  const packages = useQuery({ queryKey: ['payment-packages'], queryFn: () => api.get<{ packages: { active: boolean }[] }>('/payment-packages') });
  useEffect(() => {
    if (query.data) setForm(query.data.settings);
  }, [query.data]);
  const save = useMutation({
    mutationFn: () => api.put<{ settings: PortalSettings }>('/portal-settings', { ...form, successUrl: form?.successUrl || null }),
    onSuccess: (d) => {
      qc.setQueryData(['portal-settings'], d);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['portal-design'] });
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = <K extends keyof PortalSettings>(k: K, v: PortalSettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setAuth = <K extends keyof PortalSettings['auth']>(k: K, v: PortalSettings['auth'][K]) => setForm((f) => (f ? { ...f, auth: { ...f.auth, [k]: v } } : f));
  const toggleMethod = (m: Method, on: boolean) => form && setAuth('methods', on ? [...form.auth.methods.filter((x) => x !== m), m] : form.auth.methods.filter((x) => x !== m));
  const paymentReady = payments.data?.settings.provider !== 'none' && (packages.data?.packages ?? []).some((p) => p.active);
  const modes = (['off', 'optional', 'required'] as const).map((v) => ({ value: v, label: t(`portalSettings.fieldModes.${v}`) }));

  return (
    <>
      <PageHeader
        eyebrow={t('nav.portals')}
        title={t('portalSettings.title')}
        description={t('portalSettings.description')}
        actions={
          form &&
          scope.canManage && (
            <Button variant="accent" loading={save.isPending} onClick={() => save.mutate()}>
              {t('common.save')}
            </Button>
          )
        }
      />
      {!form ? (
        <Spinner />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            <Section title={t('portalSettings.methods')} description={t('portalSettings.methodsHint')}>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['free', 'email', 'voucher', 'payment', 'facebook'] as const).map((m) => {
                  const on = form.auth.methods.includes(m);
                  return (
                    <div key={m} className={cx('rounded-2xl border p-4 transition', on ? 'border-koraal bg-koraal/5' : 'border-line')}>
                      <div className="flex items-start gap-3">
                        <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', on ? 'bg-koraal text-nacht' : 'bg-sunken text-muted')}>{methodIcons[m]}</span>
                        <div className="min-w-0 flex-1">
                          <Switch checked={on} onChange={(v) => toggleMethod(m, v)} label={t(`portalSettings.method.${m}`)} description={t(`portalSettings.methodHint.${m}`)} />
                        </div>
                      </div>
                      {m === 'payment' && on && !paymentReady && (
                        <p className="mt-3 rounded-lg bg-warning/12 px-3 py-2 text-xs text-warning">
                          {t('portalSettings.paymentMissing')}{' '}
                          <Link to="/payments" className="font-semibold underline">
                            {t('portalSettings.setUp')}
                          </Link>
                        </p>
                      )}
                      {m === 'payment' && on && paymentReady && (
                        <p className="mt-3 flex items-center gap-2 rounded-lg bg-sunken px-3 py-2 text-xs text-muted">
                          <Clock className="size-3.5" />
                          {t('payments.grace')}: {payments.data?.settings.graceMinutes} {t('payments.minutes')} ·{' '}
                          <Link to="/payments?tab=settings" className="font-semibold text-accent">
                            {t('common.edit')}
                          </Link>
                        </p>
                      )}
                      {m === 'voucher' && on && (
                        <Link to="/vouchers" className="mt-3 inline-block text-xs font-semibold text-accent">
                          {t('nav.vouchers')} →
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>

            {form.auth.methods.includes('email') && (
              <Section title={t('portalSettings.emailOptions')}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('portalSettings.fieldName')}>
                    <Segmented value={form.auth.emailName} onChange={(v) => setAuth('emailName', v)} options={modes} />
                  </Field>
                  <Field label={t('portalSettings.fieldPhone')}>
                    <Segmented value={form.auth.emailPhone} onChange={(v) => setAuth('emailPhone', v)} options={modes} />
                  </Field>
                </div>
                <Switch checked={form.auth.marketingOptIn} onChange={(v) => setAuth('marketingOptIn', v)} label={t('portalSettings.marketing')} description={t('portalSettings.marketingHint')} />
                <Switch checked={form.auth.welcomeMail} onChange={(v) => setAuth('welcomeMail', v)} label={t('portalSettings.welcomeMail')} description={t('portalSettings.welcomeMailHint')} />
              </Section>
            )}

            {form.auth.methods.includes('facebook') && <FacebookSettings canManage={scope.canManage} />}

            {form.auth.methods.includes('payment') && (
              <Section title={t('portalSettings.paymentOptions')}>
                <Field label={t('portalSettings.paymentEmail')}>
                  <Segmented value={form.auth.paymentEmail} onChange={(v) => setAuth('paymentEmail', v)} options={modes} />
                </Field>
              </Section>
            )}

            <Section title={t('portalSettings.terms')} description={t('portalSettings.textsHint')}>
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
                  </button>
                ))}
              </div>
              <Field label={t('portalSettings.terms')} htmlFor="p-terms" hint={t('portalSettings.termsHint')}>
                <Textarea id="p-terms" rows={6} className="font-sans text-sm" value={form.terms[lang] ?? ''} onChange={(e) => set('terms', { ...form.terms, [lang]: e.target.value })} />
              </Field>
              <Switch checked={form.requireTerms} onChange={(v) => set('requireTerms', v)} label={t('portalSettings.requireTerms')} description={t('portalSettings.requireTermsHint')} />
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
                <Input id="p-success" placeholder="https://www.yourcompany.com" value={form.successUrl ?? ''} onChange={(e) => set('successUrl', e.target.value)} />
              </Field>
            </Section>
          </div>

          <div className="space-y-6 xl:sticky xl:top-6 xl:h-fit">
            <Section title={t('portalSettings.languages')} description={t('portalSettings.languagesHint')}>
              <div className="space-y-2">
                {languages.map((l) => {
                  const on = form.languages.includes(l.code);
                  return (
                    <label key={l.code} className={cx('flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm', on ? 'border-koraal/60' : 'border-line')}>
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--koraal)]"
                        checked={on}
                        disabled={on && form.languages.length === 1}
                        onChange={(e) => set('languages', e.target.checked ? [...form.languages, l.code] : form.languages.filter((x) => x !== l.code))}
                      />
                      <span className="flex-1">
                        {l.flag} {l.label}
                      </span>
                      {form.languages[0] === l.code && <span className="text-xs font-semibold text-accent">{t('portalSettings.defaultLanguage')}</span>}
                      {on && form.languages[0] !== l.code && (
                        <button type="button" className="text-xs text-muted hover:text-ink" onClick={(e) => (e.preventDefault(), set('languages', [l.code, ...form.languages.filter((x) => x !== l.code)]))}>
                          {t('portalSettings.defaultLanguage')}?
                        </button>
                      )}
                    </label>
                  );
                })}
              </div>
            </Section>
            <Card className="p-6">
              <span className="grid size-10 place-items-center rounded-xl bg-koraal/12 text-accent">
                <Palette className="size-5" />
              </span>
              <p className="mt-3 text-sm text-muted">{t('portalSettings.designHint')}</p>
              <Link to="/portal-editor" className="mt-3 inline-flex text-sm font-semibold text-accent hover:underline">
                {t('portalSettings.openEditor')} →
              </Link>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
