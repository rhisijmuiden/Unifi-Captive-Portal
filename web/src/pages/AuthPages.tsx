import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Globe, Palette, ShieldCheck, Wifi } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { DesignedBy } from '../components/DesignedBy';
import { Button, Field, Input } from '../components/ui';
import { api } from '../lib/api';
import { useAuth, useRefreshAuth } from '../lib/auth';

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="signal-bg relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex">
        <img src="/rhis-logo-wit.svg" alt="RHIS" className="h-8 w-auto self-start" />
        <div className="max-w-lg">
          <p className="mb-4 inline-flex rounded-full bg-lucht/15 px-3 py-1 text-xs font-semibold text-lucht">UniFi specialist</p>
          <h1 className="display text-4xl leading-tight xl:text-5xl">Gastwifi die er goed uitziet en gewoon werkt.</h1>
          <p className="mt-5 text-lg text-white/70">Bouw je eigen captive portal, koppel je UniFi-console en laat gasten in een paar tikken online gaan.</p>
          <ul className="mt-10 grid gap-4 text-sm text-white/80 sm:grid-cols-2">
            {[
              [Palette, 'Eigen huisstijl met de editor'],
              [Globe, 'Eigen domein met gratis SSL'],
              [Wifi, 'Alle UniFi OS consoles'],
              [ShieldCheck, 'Veilig met Microsoft SSO'],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof Wifi;
              return (
                <li key={i} className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-xl bg-white/8 text-koraal">
                    <I className="size-[18px]" />
                  </span>
                  {text as string}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="text-xs text-white/40">© {new Date().getFullYear()} RHIS</p>
        <img src="/rhis-antenne.svg" alt="" className="pointer-events-none absolute -right-24 -bottom-24 size-[420px] opacity-[0.07]" />
      </section>

      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <img src="/rhis-logo.svg" alt="RHIS" className="mb-10 h-7 lg:hidden dark:hidden" />
          <img src="/rhis-logo-wit.svg" alt="RHIS" className="mb-10 hidden h-7 dark:block dark:lg:hidden" />
          <h2 className="display text-2xl">{title}</h2>
          <p className="mt-2 mb-8 text-muted">{subtitle}</p>
          {children}
        </div>
      </section>
      <DesignedBy />
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="size-4" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

const ssoErrors: Record<string, string> = {
  sso_unknown: 'Je Microsoft-account is (nog) niet gekoppeld aan een gebruiker. Vraag je beheerder om je toe te voegen.',
  sso_failed: 'Inloggen met Microsoft is mislukt. Probeer het opnieuw.',
  sso_disabled: 'Inloggen met Microsoft staat uit.',
  sso_mismatch: 'Dit e-mailadres is al aan een ander Microsoft-account gekoppeld.',
};

export function LoginPage() {
  const { data } = useAuth();
  const refresh = useRefreshAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api.post('/auth/login', { email, password }),
    onSuccess: async () => {
      await refresh();
      navigate('/');
    },
  });

  if (data?.needsSetup) return <Navigate to="/setup" replace />;
  if (data?.user) return <Navigate to="/" replace />;
  const showLocal = data?.sso.allowLocalLogin || params.get('local') === '1';
  const error = params.get('error');

  return (
    <AuthShell title="Welkom terug" subtitle="Log in om je captive portals te beheren.">
      {error && ssoErrors[error] && <div className="mb-6 rounded-xl border border-offline/30 bg-offline/8 p-3 text-sm text-offline">{ssoErrors[error]}</div>}
      {data?.sso.entraEnabled && (
        <a href="/api/auth/entra/start" className="flex h-11 w-full items-center justify-center gap-3 rounded-[10px] border border-line bg-raised text-sm font-semibold shadow-card transition hover:bg-sunken">
          <MicrosoftLogo /> {data.sso.buttonLabel}
        </a>
      )}
      {data?.sso.entraEnabled && showLocal && (
        <div className="my-6 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" /> of met e-mail <span className="h-px flex-1 bg-line" />
        </div>
      )}
      {showLocal && (
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <Field label="E-mailadres" htmlFor="email">
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Wachtwoord" htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {login.error && <p className="text-sm text-offline">{login.error.message}</p>}
          <Button type="submit" variant="accent" className="h-11 w-full" loading={login.isPending}>
            Inloggen <ArrowRight className="size-4" />
          </Button>
          {data?.passwordResetAvailable && (
            <p className="text-center text-sm">
              <Link to="/forgot-password" className="text-accent hover:underline">
                Wachtwoord vergeten?
              </Link>
            </p>
          )}
        </form>
      )}
    </AuthShell>
  );
}

export function SetupPage() {
  const { data } = useAuth();
  const refresh = useRefreshAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const setup = useMutation({
    mutationFn: () => {
      if (form.password !== form.confirm) throw new Error('De wachtwoorden zijn niet gelijk');
      return api.post('/auth/setup', { name: form.name, email: form.email, password: form.password });
    },
    onSuccess: async () => {
      await refresh();
      toast.success('Installatie voltooid. Welkom!');
      navigate('/');
    },
  });
  if (data && !data.needsSetup) return <Navigate to="/login" replace />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <AuthShell title="Eerste installatie" subtitle="Maak het beheerdersaccount voor dit platform aan.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setup.mutate();
        }}
      >
        <Field label="Naam" htmlFor="name">
          <Input id="name" required value={form.name} onChange={set('name')} />
        </Field>
        <Field label="E-mailadres" htmlFor="email">
          <Input id="email" type="email" autoComplete="username" required value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Wachtwoord" htmlFor="pw" hint="Minimaal 10 tekens.">
          <Input id="pw" type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={set('password')} />
        </Field>
        <Field label="Herhaal wachtwoord" htmlFor="pw2">
          <Input id="pw2" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} />
        </Field>
        {setup.error && <p className="text-sm text-offline">{setup.error.message}</p>}
        <Button type="submit" variant="accent" className="h-11 w-full" loading={setup.isPending}>
          Account aanmaken <ArrowRight className="size-4" />
        </Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const forgot = useMutation({ mutationFn: () => api.post('/auth/forgot', { email }) });
  return (
    <AuthShell title="Wachtwoord vergeten" subtitle="We sturen je een link om een nieuw wachtwoord te kiezen.">
      {forgot.isSuccess ? (
        <div className="rounded-xl border border-online/30 bg-online/8 p-4 text-sm">Als dit adres bij ons bekend is, staat er binnen een paar minuten een e-mail in je inbox.</div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            forgot.mutate();
          }}
        >
          <Field label="E-mailadres" htmlFor="email">
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {forgot.error && <p className="text-sm text-offline">{forgot.error.message}</p>}
          <Button type="submit" variant="accent" className="h-11 w-full" loading={forgot.isPending}>
            Verstuur link
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="text-accent hover:underline">
          Terug naar inloggen
        </Link>
      </p>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const refresh = useRefreshAuth();
  const navigate = useNavigate();
  const invite = params.get('invite') === '1';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const reset = useMutation({
    mutationFn: () => {
      if (password !== confirm) throw new Error('De wachtwoorden zijn niet gelijk');
      return api.post('/auth/reset', { token: params.get('token'), password });
    },
    onSuccess: async () => {
      await refresh();
      navigate('/');
    },
  });
  return (
    <AuthShell title={invite ? 'Welkom!' : 'Nieuw wachtwoord'} subtitle={invite ? 'Kies een wachtwoord om je account te activeren.' : 'Kies een nieuw wachtwoord voor je account.'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          reset.mutate();
        }}
      >
        <Field label="Wachtwoord" htmlFor="pw" hint="Minimaal 10 tekens.">
          <Input id="pw" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Herhaal wachtwoord" htmlFor="pw2">
          <Input id="pw2" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {reset.error && <p className="text-sm text-offline">{reset.error.message}</p>}
        <Button type="submit" variant="accent" className="h-11 w-full" loading={reset.isPending}>
          Opslaan en inloggen
        </Button>
      </form>
    </AuthShell>
  );
}
