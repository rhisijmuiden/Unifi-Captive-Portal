import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, KeyRound, Lock, Mail, Send, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import i18n from '../i18n';
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Spinner, Switch, Textarea } from '../components/ui';
import { api } from '../lib/api';

type Smtp = {
  enabled: boolean;
  host: string;
  port: number;
  security: 'starttls' | 'tls' | 'none';
  minTlsVersion: 'TLSv1.2' | 'TLSv1.3';
  verifyCertificate: boolean;
  authMethod: 'none' | 'password' | 'oauth2';
  username: string;
  password: string;
  passwordSet: boolean;
  oauthTokenUrl: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthClientSecretSet: boolean;
  oauthScope: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  dkimEnabled: boolean;
  dkimDomain: string;
  dkimSelector: string;
  dkimPrivateKey: string;
  dkimPrivateKeySet: boolean;
};

type Sso = {
  entraEnabled: boolean;
  entraTenantId: string;
  entraClientId: string;
  entraClientSecret: string;
  entraClientSecretSet: boolean;
  allowLocalLogin: boolean;
  buttonLabel: string;
  redirectUri: string;
};

function useSettingsForm<T>(key: string) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['settings', key], queryFn: () => api.get<T>(`/settings/${key}`) });
  const [form, setForm] = useState<T | null>(null);
  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);
  const save = useMutation({
    mutationFn: (value: T) => api.put<T>(`/settings/${key}`, value),
    onSuccess: (data) => {
      qc.setQueryData(['settings', key], data);
      qc.invalidateQueries({ queryKey: ['auth'] });
      toast.success(i18n.t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = <K extends keyof T>(k: K, v: T[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  return { form, set, save, loading: query.isLoading };
}

function SecretInput({ id, value, isSet, onChange, multiline }: { id: string; value: string; isSet: boolean; onChange: (v: string) => void; multiline?: boolean }) {
  const { t } = useTranslation();
  const placeholder = isSet ? t('smtp.secretStored') : '';
  return multiline ? (
    <Textarea id={id} rows={4} placeholder={isSet ? t('smtp.keyStored') : '-----BEGIN PRIVATE KEY-----'} value={value} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <Input id={id} type="password" autoComplete="new-password" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="space-y-5 p-6">{children}</div>
    </Card>
  );
}

const presets: { label: string; values: Partial<Smtp> }[] = [
  { label: 'Microsoft 365', values: { host: 'smtp.office365.com', port: 587, security: 'starttls' } },
  { label: 'Google Workspace', values: { host: 'smtp.gmail.com', port: 587, security: 'starttls' } },
  { label: 'smtp.presetOwn', values: { port: 465, security: 'tls' } },
];

export function SmtpSettingsPage() {
  const { t } = useTranslation();
  const { form, set, save, loading } = useSettingsForm<Smtp>('smtp');
  const [testTo, setTestTo] = useState('');
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string; response?: string }>('/settings/smtp/test', { ...form, to: testTo }),
  });

  if (loading || !form) return <Spinner />;

  return (
    <>
      <PageHeader
        eyebrow={t('common.system')}
        title={t('smtp.title')}
        description={t('smtp.description')}
        actions={
          <Button variant="accent" loading={save.isPending} onClick={() => save.mutate(form)}>
            {t('common.save')}
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Section title={t('smtp.server')} description={t('smtp.serverHint')}>
            <Switch checked={form.enabled} onChange={(v) => set('enabled', v)} label={t('smtp.enabled')} description={t('smtp.enabledHint')} />
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-muted">{t('smtp.presets')}</span>
              {presets.map((p) => (
                <button key={p.label} type="button" onClick={() => Object.entries(p.values).forEach(([k, v]) => set(k as keyof Smtp, v as never))} className="rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-koraal hover:text-accent">
                  {p.label.startsWith('smtp.') ? t(p.label as 'smtp.presetOwn') : p.label}
                </button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <Field label={t('smtp.host')} htmlFor="host">
                <Input id="host" placeholder="smtp.example.com" value={form.host} onChange={(e) => set('host', e.target.value)} />
              </Field>
              <Field label={t('smtp.port')} htmlFor="port">
                <Input id="port" type="number" value={form.port} onChange={(e) => set('port', Number(e.target.value))} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('smtp.security')} htmlFor="sec" hint={form.security === 'none' ? t('smtp.securityNoneWarning') : undefined}>
                <Select id="sec" value={form.security} onChange={(e) => set('security', e.target.value as Smtp['security'])}>
                  <option value="starttls">{t('smtp.starttls')}</option>
                  <option value="tls">{t('smtp.tls')}</option>
                  <option value="none">{t('smtp.none')}</option>
                </Select>
              </Field>
              <Field label={t('smtp.minTls')} htmlFor="tls">
                <Select id="tls" value={form.minTlsVersion} onChange={(e) => set('minTlsVersion', e.target.value as Smtp['minTlsVersion'])}>
                  <option value="TLSv1.2">TLS 1.2</option>
                  <option value="TLSv1.3">TLS 1.3</option>
                </Select>
              </Field>
            </div>
            <Switch checked={form.verifyCertificate} onChange={(v) => set('verifyCertificate', v)} label={t('smtp.verifyCert')} description={t('smtp.verifyCertHint')} />
          </Section>

          <Section title={t('smtp.authentication')}>
            <Field label={t('smtp.method')} htmlFor="auth">
              <Select id="auth" value={form.authMethod} onChange={(e) => set('authMethod', e.target.value as Smtp['authMethod'])}>
                <option value="password">{t('smtp.methodPassword')}</option>
                <option value="oauth2">{t('smtp.methodOauth')}</option>
                <option value="none">{t('smtp.methodNone')}</option>
              </Select>
            </Field>
            {form.authMethod !== 'none' && (
              <Field label={t('smtp.username')} htmlFor="user">
                <Input id="user" autoComplete="off" value={form.username} onChange={(e) => set('username', e.target.value)} />
              </Field>
            )}
            {form.authMethod === 'password' && (
              <Field label={t('smtp.password')} htmlFor="pass">
                <SecretInput id="pass" value={form.password} isSet={form.passwordSet} onChange={(v) => set('password', v)} />
              </Field>
            )}
            {form.authMethod === 'oauth2' && (
              <>
                <Field label={t('smtp.tokenUrl')} htmlFor="turl" hint={t('smtp.tokenUrlHint')}>
                  <Input id="turl" value={form.oauthTokenUrl} onChange={(e) => set('oauthTokenUrl', e.target.value)} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('smtp.clientId')} htmlFor="cid">
                    <Input id="cid" value={form.oauthClientId} onChange={(e) => set('oauthClientId', e.target.value)} />
                  </Field>
                  <Field label={t('smtp.clientSecret')} htmlFor="csec">
                    <SecretInput id="csec" value={form.oauthClientSecret} isSet={form.oauthClientSecretSet} onChange={(v) => set('oauthClientSecret', v)} />
                  </Field>
                </div>
                <Field label={t('smtp.scope')} htmlFor="scope">
                  <Input id="scope" value={form.oauthScope} onChange={(e) => set('oauthScope', e.target.value)} />
                </Field>
              </>
            )}
          </Section>

          <Section title={t('smtp.sender')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('smtp.fromName')} htmlFor="fname">
                <Input id="fname" value={form.fromName} onChange={(e) => set('fromName', e.target.value)} />
              </Field>
              <Field label={t('smtp.fromEmail')} htmlFor="fmail">
                <Input id="fmail" type="email" placeholder="noreply@example.com" value={form.fromEmail} onChange={(e) => set('fromEmail', e.target.value)} />
              </Field>
            </div>
            <Field label={t('smtp.replyTo')} htmlFor="reply">
              <Input id="reply" type="email" value={form.replyTo} onChange={(e) => set('replyTo', e.target.value)} />
            </Field>
          </Section>

          <Section title={t('smtp.dkim')} description={t('smtp.dkimHint')}>
            <Switch checked={form.dkimEnabled} onChange={(v) => set('dkimEnabled', v)} label={t('smtp.dkimEnabled')} />
            {form.dkimEnabled && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('smtp.dkimDomain')} htmlFor="ddom">
                    <Input id="ddom" value={form.dkimDomain} onChange={(e) => set('dkimDomain', e.target.value)} />
                  </Field>
                  <Field label={t('smtp.dkimSelector')} htmlFor="dsel">
                    <Input id="dsel" placeholder="mail" value={form.dkimSelector} onChange={(e) => set('dkimSelector', e.target.value)} />
                  </Field>
                </div>
                <Field label={t('smtp.dkimKey')} htmlFor="dkey">
                  <SecretInput id="dkey" multiline value={form.dkimPrivateKey} isSet={form.dkimPrivateKeySet} onChange={(v) => set('dkimPrivateKey', v)} />
                </Field>
              </>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Card className="sticky top-6">
            <CardHeader title={t('smtp.test')} description={t('smtp.testHint')} />
            <div className="space-y-4 p-6">
              <Field label={t('smtp.recipient')} htmlFor="to">
                <Input id="to" type="email" placeholder="you@example.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
              </Field>
              <Button className="w-full" icon={<Send className="size-4" />} loading={test.isPending} disabled={!testTo} onClick={() => test.mutate()}>
                {t('smtp.sendTest')}
              </Button>
              {test.data?.ok && (
                <div className="flex gap-2 rounded-xl bg-online/10 p-3 text-sm text-online">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> {t('smtp.testSent')} {test.data.response}
                </div>
              )}
              {(test.data && !test.data.ok) || test.error ? (
                <div className="flex gap-2 rounded-xl bg-offline/10 p-3 text-sm break-words text-offline">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {test.data?.error ?? test.error?.message}
                </div>
              ) : null}
              <ul className="space-y-2 border-t border-line pt-4 text-xs text-muted">
                <li className="flex gap-2">
                  <Lock className="size-3.5 shrink-0" /> {t('smtp.tipEncrypted')}
                </li>
                <li className="flex gap-2">
                  <ShieldCheck className="size-3.5 shrink-0" /> {t('smtp.tipStarttls')}
                </li>
                <li className="flex gap-2">
                  <Mail className="size-3.5 shrink-0" /> {t('smtp.tipSpf')}
                </li>
              </ul>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

export function SsoSettingsPage() {
  const { t } = useTranslation();
  const { form, set, save, loading } = useSettingsForm<Sso>('sso');
  if (loading || !form) return <Spinner />;
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success(t('common.copied')));
  const ready = form.entraTenantId && form.entraClientId && (form.entraClientSecret || form.entraClientSecretSet);

  return (
    <>
      <PageHeader
        eyebrow={t('common.system')}
        title={t('sso.title')}
        description={t('sso.description')}
        actions={
          <Button variant="accent" loading={save.isPending} onClick={() => save.mutate(form)}>
            {t('common.save')}
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Section title="Microsoft Entra ID">
            <Switch
              checked={form.entraEnabled}
              onChange={(v) => set('entraEnabled', v)}
              label={t('sso.enabled')}
              description={ready ? t('sso.enabledHint') : t('sso.enabledMissing')}
            />
            <Field label={t('sso.tenantId')} htmlFor="tid">
              <Input id="tid" placeholder="00000000-0000-0000-0000-000000000000" value={form.entraTenantId} onChange={(e) => set('entraTenantId', e.target.value.trim())} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('sso.clientId')} htmlFor="cid">
                <Input id="cid" value={form.entraClientId} onChange={(e) => set('entraClientId', e.target.value.trim())} />
              </Field>
              <Field label={t('sso.clientSecret')} htmlFor="sec">
                <SecretInput id="sec" value={form.entraClientSecret} isSet={form.entraClientSecretSet} onChange={(v) => set('entraClientSecret', v)} />
              </Field>
            </div>
            <Field label={t('sso.buttonLabel')} htmlFor="lbl" hint={t('sso.buttonLabelHint')}>
              <Input id="lbl" placeholder={t('sso.defaultButton')} value={form.buttonLabel} onChange={(e) => set('buttonLabel', e.target.value)} />
            </Field>
            <Switch
              checked={form.allowLocalLogin}
              onChange={(v) => set('allowLocalLogin', v)}
              label={t('sso.allowLocal')}
              description={t('sso.allowLocalHint')}
            />
          </Section>
        </div>
        <Card>
          <CardHeader title={t('sso.howTo')} />
          <ol className="space-y-4 p-6 text-sm">
            {[
              <Trans
                i18nKey="sso.step1"
                components={{ link: <a className="text-accent hover:underline" href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener" />, b: <b /> }}
              />,
              <>
                <Trans i18nKey="sso.step2" components={{ b: <b /> }} />
                <span className="mt-2 flex items-center gap-2 rounded-lg bg-sunken p-2 font-mono text-xs break-all">
                  {form.redirectUri}
                  <button onClick={() => copy(form.redirectUri)} className="ml-auto shrink-0 rounded p-1 hover:bg-line" aria-label={t('common.copy')}>
                    <Copy className="size-3.5" />
                  </button>
                </span>
              </>,
              <Trans i18nKey="sso.step3" components={{ b: <b /> }} />,
              <>{t('sso.step4')}</>,
              <>{t('sso.step5')}</>,
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-koraal/15 text-xs font-bold text-accent">{i + 1}</span>
                <span className="min-w-0 text-muted">{step}</span>
              </li>
            ))}
          </ol>
          <div className="border-t border-line px-6 py-4 text-xs text-muted">
            <Badge tone="info">
              <KeyRound className="size-3" /> OpenID Connect + PKCE
            </Badge>
          </div>
        </Card>
      </div>
    </>
  );
}
