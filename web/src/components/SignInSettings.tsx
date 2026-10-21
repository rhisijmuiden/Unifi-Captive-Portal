import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, MessageSquareText, PlugZap, Send } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { Copyable, Segmented, Slider } from './controls';
import { Badge, Button, Card, CardHeader, Field, Input, Spinner, Textarea } from './ui';

export function Section({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} action={action} />
      <div className="space-y-5 p-6">{children}</div>
    </Card>
  );
}

export const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
    <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z" />
    <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z" />
    <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
    <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
  </svg>
);
export const AppleIcon = () => (
  <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
    <path d="M16.4 12.7c0-2.6 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2c-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9a5 5 0 0 0-4.2 2.6c-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.6-1-2.6-4.1zM13.9 5.1c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3-1.5z" />
  </svg>
);
export const MicrosoftIcon = () => (
  <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
    <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
    <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
    <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
    <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
  </svg>
);

type Provider = 'facebook' | 'google' | 'apple' | 'microsoft';
type SocialData = { settings: Record<string, string | number | boolean>; redirectUris: Record<Provider, string>; walledGarden: Record<Provider, string[]> };

const useSocial = () => useQuery({ queryKey: ['social-settings'], queryFn: () => api.get<SocialData>('/social-settings') });

type FieldDef = { key: string; secret?: boolean; multiline?: boolean; placeholder?: string };
const providerFields: Record<Exclude<Provider, 'facebook'>, FieldDef[]> = {
  google: [{ key: 'googleClientId', placeholder: '1234567890-abc.apps.googleusercontent.com' }, { key: 'googleClientSecret', secret: true }],
  microsoft: [{ key: 'microsoftClientId', placeholder: '00000000-0000-0000-0000-000000000000' }, { key: 'microsoftClientSecret', secret: true }, { key: 'microsoftTenant', placeholder: 'common' }],
  apple: [
    { key: 'appleServiceId', placeholder: 'com.example.wifi' },
    { key: 'appleTeamId', placeholder: 'ABCDE12345' },
    { key: 'appleKeyId', placeholder: 'ABC123DEFG' },
    { key: 'applePrivateKey', secret: true, multiline: true, placeholder: '-----BEGIN PRIVATE KEY-----' },
  ],
};

/** Google, Microsoft or Apple sign-in with the customer's own app: steps, redirect address, credentials and a test. */
export function ProviderSettings({ provider, canManage }: { provider: Exclude<Provider, 'facebook'>; canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useSocial();
  const fields = providerFields[provider];
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    if (data) setForm(Object.fromEntries(fields.map((f) => [f.key, f.secret ? '' : String(data.settings[f.key] ?? '')])));
  }, [data, provider]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = () => Object.fromEntries(Object.entries(form).filter(([k, v]) => !fields.find((f) => f.key === k)?.secret || v));
  const save = useMutation({
    mutationFn: () => api.put('/social-settings', body()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social-settings'] });
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: () => api.post('/social-settings/test', { provider, ...body() }),
    onSuccess: () => toast.success(t('signIn.testOk')),
    onError: (e: Error) => toast.error(e.message),
  });
  if (!data) return <Spinner />;
  const ready = fields.every((f) => (f.secret ? data.settings[`${f.key}Set`] : data.settings[f.key]));
  const k = `signIn.${provider}` as const;
  return (
    <Section
      title={t(`${k}.title`)}
      description={t(`${k}.description`)}
      action={
        canManage && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={<PlugZap className="size-4" />} loading={test.isPending} onClick={() => test.mutate()}>
              {t('signIn.test')}
            </Button>
            <Button variant="accent" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
              {t('common.save')}
            </Button>
          </div>
        )
      }
    >
      {!ready && <p className="rounded-lg bg-warning/12 px-3 py-2 text-xs text-warning">{t('signIn.notReady')}</p>}
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>{t(`${k}.step1`)}</li>
        <li>{t(`${k}.step2`)}</li>
        <li>{t(`${k}.step3`)}</li>
      </ol>
      <Field label={t('signIn.redirectUri')} hint={t(provider === 'apple' ? 'signIn.apple.redirectHint' : 'signIn.redirectUriHint')}>
        <Copyable value={data.redirectUris[provider]} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          const id = `sp-${f.key}`;
          const props = {
            id,
            autoComplete: 'off',
            value: form[f.key] ?? '',
            disabled: !canManage,
            placeholder: f.secret && data.settings[`${f.key}Set`] ? `•••••• (${t('payments.keySet')})` : f.placeholder,
          };
          return (
            <div key={f.key} className={f.multiline ? 'sm:col-span-2' : undefined}>
              <Field label={t(`signIn.fields.${f.key}` as 'signIn.fields.googleClientId')} htmlFor={id}>
                {f.multiline ? (
                  <Textarea {...props} rows={4} className="font-mono text-xs" onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                ) : (
                  <Input {...props} type={f.secret ? 'password' : 'text'} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                )}
              </Field>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** What all social sign-ins share: the short access before login, and the walled garden. */
export function SocialCommon({ providers, canManage }: { providers: Provider[]; canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useSocial();
  const [grace, setGrace] = useState<number | null>(null);
  useEffect(() => {
    if (data) setGrace(Number(data.settings.facebookGraceMinutes));
  }, [data]);
  const save = useMutation({
    mutationFn: () => api.put('/social-settings', { facebookGraceMinutes: grace }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social-settings'] });
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!data || grace === null) return <Spinner />;
  const domains = [...new Set(providers.flatMap((p) => data.walledGarden[p] ?? []))];
  return (
    <Section
      title={t('signIn.common.title')}
      description={t('signIn.common.description')}
      action={
        canManage && (
          <Button variant="accent" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        )
      }
    >
      <div>
        <Slider label={t('signIn.common.grace')} value={grace} min={0} max={15} unit=" min" onChange={setGrace} />
        <p className="mt-1 text-xs text-muted">{t('signIn.common.graceHint')}</p>
      </div>
      <div className="rounded-xl bg-sunken p-4 text-xs text-muted">
        <p className="font-semibold text-ink">{t('signIn.common.walledGarden')}</p>
        <p className="mt-1">{t('signIn.common.walledGardenHint')}</p>
        <code className="mt-2 block font-mono leading-relaxed break-words">{domains.join(', ')}</code>
      </div>
    </Section>
  );
}

type SmsForm = {
  provider: 'none' | 'twilio' | 'messagebird';
  twilioAccountSid: string;
  twilioFrom: string;
  messagebirdOriginator: string;
  defaultCountry: string;
  dailyLimit: number;
};
type SmsData = { settings: SmsForm & { twilioAuthTokenSet: boolean; messagebirdApiKeySet: boolean }; ready: boolean; usage: { month: number; last24h: number } };

/** Text-message login with the customer's own Twilio or MessageBird account. */
export function SmsSettings({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['sms-settings'], queryFn: () => api.get<SmsData>('/sms-settings') });
  const [form, setForm] = useState<SmsForm | null>(null);
  const [secret, setSecret] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);
  const secretKey = form?.provider === 'messagebird' ? 'messagebirdApiKey' : 'twilioAuthToken';
  const body = () => ({ ...form, ...(secret && form?.provider !== 'none' ? { [secretKey]: secret } : {}) });
  const save = useMutation({
    mutationFn: () => api.put('/sms-settings', body()),
    onSuccess: () => {
      setSecret('');
      qc.invalidateQueries({ queryKey: ['sms-settings'] });
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ phone: string }>('/sms-settings/test', { ...body(), to }),
    onSuccess: (d) => toast.success(t('signIn.sms.testSent', { phone: d.phone })),
    onError: (e: Error) => toast.error(e.message),
  });
  if (!form || !data) return <Spinner />;
  const set = <K extends keyof SmsForm>(k: K, v: SmsForm[K]) => setForm({ ...form, [k]: v });
  const secretSet = form.provider === 'messagebird' ? data.settings.messagebirdApiKeySet : data.settings.twilioAuthTokenSet;
  return (
    <Section
      title={t('signIn.sms.title')}
      description={t('signIn.sms.description')}
      action={
        canManage && (
          <Button variant="accent" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        )
      }
    >
      {!data.ready && <p className="rounded-lg bg-warning/12 px-3 py-2 text-xs text-warning">{t('signIn.sms.notReady')}</p>}
      <Field label={t('signIn.sms.provider')}>
        <Segmented
          value={form.provider}
          onChange={(v) => set('provider', v)}
          options={[
            { value: 'none', label: t('signIn.sms.none') },
            { value: 'twilio', label: 'Twilio' },
            { value: 'messagebird', label: 'MessageBird (Bird)' },
          ]}
        />
      </Field>
      {form.provider === 'twilio' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account SID" htmlFor="sms-sid">
            <Input id="sms-sid" autoComplete="off" placeholder="AC…" value={form.twilioAccountSid} onChange={(e) => set('twilioAccountSid', e.target.value.trim())} disabled={!canManage} />
          </Field>
          <Field label="Auth token" htmlFor="sms-token">
            <Input id="sms-token" type="password" autoComplete="off" placeholder={secretSet ? `•••••• (${t('payments.keySet')})` : ''} value={secret} onChange={(e) => setSecret(e.target.value)} disabled={!canManage} />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('signIn.sms.from')} htmlFor="sms-from" hint={t('signIn.sms.fromHintTwilio')}>
              <Input id="sms-from" autoComplete="off" placeholder="+3197010…" value={form.twilioFrom} onChange={(e) => set('twilioFrom', e.target.value)} disabled={!canManage} />
            </Field>
          </div>
        </div>
      )}
      {form.provider === 'messagebird' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('signIn.sms.apiKey')} htmlFor="sms-key">
            <Input id="sms-key" type="password" autoComplete="off" placeholder={secretSet ? `•••••• (${t('payments.keySet')})` : ''} value={secret} onChange={(e) => setSecret(e.target.value)} disabled={!canManage} />
          </Field>
          <Field label={t('signIn.sms.from')} htmlFor="sms-orig" hint={t('signIn.sms.fromHint')}>
            <Input id="sms-orig" autoComplete="off" maxLength={17} placeholder="HotelZeezicht" value={form.messagebirdOriginator} onChange={(e) => set('messagebirdOriginator', e.target.value)} disabled={!canManage} />
          </Field>
        </div>
      )}
      {form.provider !== 'none' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('signIn.sms.country')} htmlFor="sms-cc" hint={t('signIn.sms.countryHint')}>
              <div className="relative">
                <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">+</span>
                <Input id="sms-cc" inputMode="numeric" className="pl-6" value={form.defaultCountry} onChange={(e) => set('defaultCountry', e.target.value.replace(/\D/g, ''))} disabled={!canManage} />
              </div>
            </Field>
            <Field label={t('signIn.sms.dailyLimit')} htmlFor="sms-limit" hint={t('signIn.sms.dailyLimitHint')}>
              <Input id="sms-limit" type="number" min={1} value={form.dailyLimit} onChange={(e) => set('dailyLimit', Number(e.target.value))} disabled={!canManage} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-sunken p-4 text-sm">
            <MessageSquareText className="size-5 text-accent" />
            <span className="flex-1 text-muted">{t('signIn.sms.usage', { month: data.usage.month, day: data.usage.last24h })}</span>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <Field label={t('signIn.sms.testTo')} htmlFor="sms-to">
                  <Input id="sms-to" type="tel" placeholder="06 12345678" value={to} onChange={(e) => setTo(e.target.value)} />
                </Field>
              </div>
              <Button variant="secondary" icon={<Send className="size-4" />} loading={test.isPending} disabled={to.trim().length < 6} onClick={() => test.mutate()}>
                {t('signIn.sms.sendTest')}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted">{t('signIn.sms.limits')}</p>
        </>
      )}
    </Section>
  );
}

/** Room login: points to the Hotel page where stays and the PMS are managed. */
export function RoomLoginCard() {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['hotel-stays', 'current'], queryFn: () => api.get<{ stays: unknown[] }>('/hotel/stays?scope=current') });
  const settings = useQuery({ queryKey: ['hotel-settings'], queryFn: () => api.get<{ settings: { source: string } }>('/hotel-settings') });
  return (
    <Section title={t('signIn.room.title')} description={t('signIn.room.description')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-koraal/12 text-accent">
          <BedDouble className="size-5" />
        </span>
        <div className="flex-1 text-sm">
          <p className="font-semibold">{t('signIn.room.inHouse', { count: data?.stays.length ?? 0 })}</p>
          <p className="text-muted">{settings.data && t(`hotel.sources.${settings.data.settings.source as 'manual'}`)}</p>
        </div>
        {data && !data.stays.length && <Badge tone="warning">{t('signIn.room.empty')}</Badge>}
        <Link to="/hotel" className="text-sm font-semibold text-accent hover:underline">
          {t('signIn.room.manage')} →
        </Link>
      </div>
    </Section>
  );
}
