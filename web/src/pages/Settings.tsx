import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, KeyRound, Lock, Mail, Send, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
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
      toast.success('Instellingen opgeslagen');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = <K extends keyof T>(k: K, v: T[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  return { form, set, save, loading: query.isLoading };
}

function SecretInput({ id, value, isSet, onChange, multiline }: { id: string; value: string; isSet: boolean; onChange: (v: string) => void; multiline?: boolean }) {
  const placeholder = isSet ? '•••••••• (opgeslagen, laat leeg om te behouden)' : '';
  return multiline ? (
    <Textarea id={id} rows={4} placeholder={isSet ? '-----BEGIN PRIVATE KEY----- (opgeslagen)' : '-----BEGIN PRIVATE KEY-----'} value={value} onChange={(e) => onChange(e.target.value)} />
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
  { label: 'Eigen server (TLS 465)', values: { port: 465, security: 'tls' } },
];

export function SmtpSettingsPage() {
  const { form, set, save, loading } = useSettingsForm<Smtp>('smtp');
  const [testTo, setTestTo] = useState('');
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string; response?: string }>('/settings/smtp/test', { ...form, to: testTo }),
  });

  if (loading || !form) return <Spinner />;

  return (
    <>
      <PageHeader
        eyebrow="Systeem"
        title="E-mail (SMTP)"
        description="De mailserver voor uitnodigingen, wachtwoordherstel en later ook meldingen en rapportages."
        actions={
          <Button variant="accent" loading={save.isPending} onClick={() => save.mutate(form)}>
            Opslaan
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Section title="Server" description="Verbinding met je eigen mailserver.">
            <Switch checked={form.enabled} onChange={(v) => set('enabled', v)} label="E-mail versturen" description="Zet aan zodra de instellingen kloppen." />
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-muted">Snel invullen:</span>
              {presets.map((p) => (
                <button key={p.label} type="button" onClick={() => Object.entries(p.values).forEach(([k, v]) => set(k as keyof Smtp, v as never))} className="rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-koraal hover:text-accent">
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <Field label="SMTP-server" htmlFor="host">
                <Input id="host" placeholder="smtp.jouwdomein.nl" value={form.host} onChange={(e) => set('host', e.target.value)} />
              </Field>
              <Field label="Poort" htmlFor="port">
                <Input id="port" type="number" value={form.port} onChange={(e) => set('port', Number(e.target.value))} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Beveiliging" htmlFor="sec" hint={form.security === 'none' ? 'Niet aangeraden: wachtwoorden gaan onversleuteld over het netwerk.' : undefined}>
                <Select id="sec" value={form.security} onChange={(e) => set('security', e.target.value as Smtp['security'])}>
                  <option value="starttls">STARTTLS (verplicht, poort 587)</option>
                  <option value="tls">TLS / SSL (poort 465)</option>
                  <option value="none">Geen versleuteling</option>
                </Select>
              </Field>
              <Field label="Minimale TLS-versie" htmlFor="tls">
                <Select id="tls" value={form.minTlsVersion} onChange={(e) => set('minTlsVersion', e.target.value as Smtp['minTlsVersion'])}>
                  <option value="TLSv1.2">TLS 1.2</option>
                  <option value="TLSv1.3">TLS 1.3</option>
                </Select>
              </Field>
            </div>
            <Switch checked={form.verifyCertificate} onChange={(v) => set('verifyCertificate', v)} label="Certificaat controleren" description="Alleen uitzetten voor een interne server met een eigen certificaat." />
          </Section>

          <Section title="Authenticatie">
            <Field label="Methode" htmlFor="auth">
              <Select id="auth" value={form.authMethod} onChange={(e) => set('authMethod', e.target.value as Smtp['authMethod'])}>
                <option value="password">Gebruikersnaam en wachtwoord</option>
                <option value="oauth2">OAuth 2.0 (Microsoft 365, Google)</option>
                <option value="none">Geen (relay op IP)</option>
              </Select>
            </Field>
            {form.authMethod !== 'none' && (
              <Field label="Gebruikersnaam / mailbox" htmlFor="user">
                <Input id="user" autoComplete="off" value={form.username} onChange={(e) => set('username', e.target.value)} />
              </Field>
            )}
            {form.authMethod === 'password' && (
              <Field label="Wachtwoord" htmlFor="pass">
                <SecretInput id="pass" value={form.password} isSet={form.passwordSet} onChange={(v) => set('password', v)} />
              </Field>
            )}
            {form.authMethod === 'oauth2' && (
              <>
                <Field label="Token-URL" htmlFor="turl" hint="Microsoft 365: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token">
                  <Input id="turl" value={form.oauthTokenUrl} onChange={(e) => set('oauthTokenUrl', e.target.value)} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Client ID" htmlFor="cid">
                    <Input id="cid" value={form.oauthClientId} onChange={(e) => set('oauthClientId', e.target.value)} />
                  </Field>
                  <Field label="Client secret" htmlFor="csec">
                    <SecretInput id="csec" value={form.oauthClientSecret} isSet={form.oauthClientSecretSet} onChange={(v) => set('oauthClientSecret', v)} />
                  </Field>
                </div>
                <Field label="Scope" htmlFor="scope">
                  <Input id="scope" value={form.oauthScope} onChange={(e) => set('oauthScope', e.target.value)} />
                </Field>
              </>
            )}
          </Section>

          <Section title="Afzender">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Naam afzender" htmlFor="fname">
                <Input id="fname" value={form.fromName} onChange={(e) => set('fromName', e.target.value)} />
              </Field>
              <Field label="E-mailadres afzender" htmlFor="fmail">
                <Input id="fmail" type="email" placeholder="noreply@jouwdomein.nl" value={form.fromEmail} onChange={(e) => set('fromEmail', e.target.value)} />
              </Field>
            </div>
            <Field label="Antwoordadres (optioneel)" htmlFor="reply">
              <Input id="reply" type="email" value={form.replyTo} onChange={(e) => set('replyTo', e.target.value)} />
            </Field>
          </Section>

          <Section title="DKIM-ondertekening" description="Optioneel. Alleen nodig als je mailserver zelf niet ondertekent.">
            <Switch checked={form.dkimEnabled} onChange={(v) => set('dkimEnabled', v)} label="Berichten ondertekenen met DKIM" />
            {form.dkimEnabled && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Domein" htmlFor="ddom">
                    <Input id="ddom" value={form.dkimDomain} onChange={(e) => set('dkimDomain', e.target.value)} />
                  </Field>
                  <Field label="Selector" htmlFor="dsel">
                    <Input id="dsel" placeholder="mail" value={form.dkimSelector} onChange={(e) => set('dkimSelector', e.target.value)} />
                  </Field>
                </div>
                <Field label="Private key (PEM)" htmlFor="dkey">
                  <SecretInput id="dkey" multiline value={form.dkimPrivateKey} isSet={form.dkimPrivateKeySet} onChange={(v) => set('dkimPrivateKey', v)} />
                </Field>
              </>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Card className="sticky top-6">
            <CardHeader title="Testbericht" description="Verstuurt een mail met de instellingen zoals ze nu in het formulier staan." />
            <div className="space-y-4 p-6">
              <Field label="Ontvanger" htmlFor="to">
                <Input id="to" type="email" placeholder="jij@jouwbedrijf.nl" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
              </Field>
              <Button className="w-full" icon={<Send className="size-4" />} loading={test.isPending} disabled={!testTo} onClick={() => test.mutate()}>
                Verstuur testmail
              </Button>
              {test.data?.ok && (
                <div className="flex gap-2 rounded-xl bg-online/10 p-3 text-sm text-online">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> Verstuurd. {test.data.response}
                </div>
              )}
              {(test.data && !test.data.ok) || test.error ? (
                <div className="flex gap-2 rounded-xl bg-offline/10 p-3 text-sm break-words text-offline">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {test.data?.error ?? test.error?.message}
                </div>
              ) : null}
              <ul className="space-y-2 border-t border-line pt-4 text-xs text-muted">
                <li className="flex gap-2">
                  <Lock className="size-3.5 shrink-0" /> Wachtwoorden en sleutels worden versleuteld opgeslagen.
                </li>
                <li className="flex gap-2">
                  <ShieldCheck className="size-3.5 shrink-0" /> STARTTLS valt nooit terug op een onversleutelde verbinding.
                </li>
                <li className="flex gap-2">
                  <Mail className="size-3.5 shrink-0" /> Zorg dat SPF en DMARC van je domein de mailserver toestaan.
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
  const { form, set, save, loading } = useSettingsForm<Sso>('sso');
  if (loading || !form) return <Spinner />;
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success('Gekopieerd'));
  const ready = form.entraTenantId && form.entraClientId && (form.entraClientSecret || form.entraClientSecretSet);

  return (
    <>
      <PageHeader
        eyebrow="Systeem"
        title="Single sign-on"
        description="Laat gebruikers inloggen met hun Microsoft-account via Entra ID."
        actions={
          <Button variant="accent" loading={save.isPending} onClick={() => save.mutate(form)}>
            Opslaan
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Section title="Microsoft Entra ID">
            <Switch
              checked={form.entraEnabled}
              onChange={(v) => set('entraEnabled', v)}
              label="Inloggen met Microsoft"
              description={ready ? 'Toont de knop "Inloggen met Microsoft" op het inlogscherm.' : 'Vul eerst tenant ID, client ID en secret in.'}
            />
            <Field label="Directory (tenant) ID" htmlFor="tid">
              <Input id="tid" placeholder="00000000-0000-0000-0000-000000000000" value={form.entraTenantId} onChange={(e) => set('entraTenantId', e.target.value.trim())} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Application (client) ID" htmlFor="cid">
                <Input id="cid" value={form.entraClientId} onChange={(e) => set('entraClientId', e.target.value.trim())} />
              </Field>
              <Field label="Client secret" htmlFor="sec">
                <SecretInput id="sec" value={form.entraClientSecret} isSet={form.entraClientSecretSet} onChange={(v) => set('entraClientSecret', v)} />
              </Field>
            </div>
            <Field label="Tekst op de knop" htmlFor="lbl">
              <Input id="lbl" value={form.buttonLabel} onChange={(e) => set('buttonLabel', e.target.value)} />
            </Field>
            <Switch
              checked={form.allowLocalLogin}
              onChange={(v) => set('allowLocalLogin', v)}
              label="Inloggen met wachtwoord toestaan"
              description="Uit = alleen Microsoft. Platformbeheerders kunnen altijd via /login?local=1 met wachtwoord inloggen, zodat je jezelf niet buitensluit."
            />
          </Section>
        </div>
        <Card>
          <CardHeader title="Zo stel je het in" />
          <ol className="space-y-4 p-6 text-sm">
            {[
              <>
                Ga in het <a className="text-accent hover:underline" href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">Entra-beheercentrum</a> naar <b>App-registraties → Nieuwe registratie</b>.
              </>,
              <>
                Kies <b>Web</b> als platform en vul deze redirect-URI in:
                <span className="mt-2 flex items-center gap-2 rounded-lg bg-sunken p-2 font-mono text-xs break-all">
                  {form.redirectUri}
                  <button onClick={() => copy(form.redirectUri)} className="ml-auto shrink-0 rounded p-1 hover:bg-line" aria-label="Kopiëren">
                    <Copy className="size-3.5" />
                  </button>
                </span>
              </>,
              <>
                Maak onder <b>Certificaten en geheimen</b> een client secret en plak de <b>waarde</b> hiernaast.
              </>,
              <>Kopieer de Directory (tenant) ID en Application (client) ID van de overzichtspagina.</>,
              <>Gebruikers moeten eerst hier bestaan; ze worden op e-mailadres gekoppeld bij hun eerste Microsoft-login.</>,
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
