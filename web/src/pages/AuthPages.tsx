import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Globe, Palette, ShieldCheck, Wifi } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { DesignedBy } from '../components/DesignedBy';
import { BrandLogo } from '../components/BrandLogo';
import { useBrand } from '../lib/brand';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { CodeInput, TwoFactorSetup } from '../components/TwoFactor';
import { Button, Field, Input } from '../components/ui';
import { api } from '../lib/api';
import { useAuth, useRefreshAuth } from '../lib/auth';

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { t } = useTranslation();
  const brand = useBrand();
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="signal-bg relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex">
        <div className="self-start">
          <BrandLogo brand={brand} onDark />
        </div>
        <div className="max-w-lg">
          <p className="mb-4 inline-flex rounded-full bg-lucht/15 px-3 py-1 text-xs font-semibold text-lucht">{t('auth.tagline')}</p>
          <h1 className="display text-4xl leading-tight xl:text-5xl">{t('auth.heroTitle')}</h1>
          <p className="mt-5 text-lg text-white/70">{t('auth.heroText')}</p>
          <ul className="mt-10 grid gap-4 text-sm text-white/80 sm:grid-cols-2">
            {[
              [Palette, t('auth.featureEditor')],
              [Globe, t('auth.featureDomain')],
              [Wifi, t('auth.featureConsoles')],
              [ShieldCheck, t('auth.featureSso')],
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
        <p className="text-xs text-white/40">
          © {new Date().getFullYear()} {brand?.name ?? 'RHIS'}
          {brand?.supportEmail && (
            <>
              {' · '}
              <a className="hover:text-white/70" href={`mailto:${brand.supportEmail}`}>
                {brand.supportEmail}
              </a>
            </>
          )}
        </p>
        <img src="/rhis-antenne.svg" alt="" className="pointer-events-none absolute -right-24 -bottom-24 size-[420px] opacity-[0.07]" />
      </section>

      <section className="relative flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <BrandLogo brand={brand} />
          </div>
          <h2 className="display text-2xl">{title}</h2>
          <p className="mt-2 mb-8 text-muted">{subtitle}</p>
          {children}
        </div>
      </section>
      {(!brand || brand.showDesignedBy) && <DesignedBy />}
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



const ssoErrorKeys = { sso_unknown: 1, sso_failed: 1, sso_disabled: 1, sso_mismatch: 1, sso_suspended: 1 } as const;

export function LoginPage() {
  const { t } = useTranslation();
  const { data } = useAuth();
  const refresh = useRefreshAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [codeStep, setCodeStep] = useState(false);
  const login = useMutation({
    mutationFn: () => api.post<{ twoFactor?: boolean }>('/auth/login', { email, password }),
    onSuccess: async (res) => {
      if (res.twoFactor) return setCodeStep(true);
      await refresh();
      navigate('/');
    },
  });

  if (data?.needsSetup) return <Navigate to="/setup" replace />;
  if (data?.user) return <Navigate to="/" replace />;
  if (codeStep || data?.twoFactorPending) return <TwoFactorLogin onCancel={() => setCodeStep(false)} />;
  const showLocal = data?.sso.allowLocalLogin || params.get('local') === '1';
  const error = params.get('error');

  return (
    <AuthShell title={t('auth.welcomeBack')} subtitle={t('auth.loginSubtitle')}>
      {error && error in ssoErrorKeys && <div className="mb-6 rounded-xl border border-offline/30 bg-offline/8 p-3 text-sm text-offline">{t(`auth.ssoErrors.${error as keyof typeof ssoErrorKeys}`)}</div>}
      {data?.sso.entraEnabled && (
        <a href="/api/auth/entra/start" className="flex h-11 w-full items-center justify-center gap-3 rounded-[10px] border border-line bg-raised text-sm font-semibold shadow-card transition hover:bg-sunken">
          <MicrosoftLogo /> {data.sso.buttonLabel || t('sso.defaultButton')}
        </a>
      )}
      {data?.sso.entraEnabled && showLocal && (
        <div className="my-6 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" /> {t('auth.orEmail')} <span className="h-px flex-1 bg-line" />
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
          <Field label={t('auth.email')} htmlFor="email">
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t('auth.password')} htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {login.error && <p className="text-sm text-offline">{login.error.message}</p>}
          <Button type="submit" variant="accent" className="h-11 w-full" loading={login.isPending}>
            {t('auth.login')} <ArrowRight className="size-4" />
          </Button>
          {data?.passwordResetAvailable && (
            <p className="text-center text-sm">
              <Link to="/forgot-password" className="text-accent hover:underline">
                {t('auth.forgot')}
              </Link>
            </p>
          )}
        </form>
      )}
    </AuthShell>
  );
}

/** Second step of signing in: the code from the authenticator app, or a recovery code. */
function TwoFactorLogin({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const verify = useMutation({
    mutationFn: () => api.post<{ recoveryCodesLeft: number | null }>('/auth/login/verify', { code }),
    onSuccess: async (res) => {
      if (res.recoveryCodesLeft !== null) toast.warning(t('twoFactor.recoveryUsed', { count: res.recoveryCodesLeft }));
      await refresh();
      navigate('/');
    },
  });
  const cancel = async () => {
    await api.post('/auth/login/cancel').catch(() => undefined);
    await refresh();
    onCancel();
  };
  return (
    <AuthShell title={t('twoFactor.loginTitle')} subtitle={recovery ? t('twoFactor.loginRecovery') : t('twoFactor.loginSubtitle')}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          verify.mutate();
        }}
      >
        <Field label={recovery ? t('twoFactor.recoveryCode') : t('twoFactor.code')} htmlFor="otp">
          <CodeInput value={code} onChange={setCode} recovery={recovery} />
        </Field>
        {verify.error && <p className="text-sm text-offline">{verify.error.message}</p>}
        <Button type="submit" variant="accent" className="h-11 w-full" loading={verify.isPending} disabled={code.length < 6}>
          {t('twoFactor.verify')} <ArrowRight className="size-4" />
        </Button>
      </form>
      <div className="mt-6 flex justify-between text-sm">
        <button type="button" className="text-accent hover:underline" onClick={() => (setRecovery(!recovery), setCode(''))}>
          {recovery ? t('twoFactor.useApp') : t('twoFactor.useRecovery')}
        </button>
        <button type="button" className="text-muted hover:text-ink" onClick={cancel}>
          {t('auth.backToLogin')}
        </button>
      </div>
    </AuthShell>
  );
}

/** Shown after signing in when the policy requires 2FA and the user has not set it up yet. */
export function TwoFactorRequiredPage() {
  const { t } = useTranslation();
  const { data } = useAuth();
  const refresh = useRefreshAuth();
  const navigate = useNavigate();
  if (!data?.user) return <Navigate to="/login" replace />;
  if (!data.twoFactorSetupRequired) return <Navigate to="/" replace />;
  const logout = async () => {
    await api.post('/auth/logout');
    await refresh();
    navigate('/login');
  };
  return (
    <AuthShell title={t('twoFactor.requiredTitle')} subtitle={t('twoFactor.requiredSubtitle')}>
      <TwoFactorSetup
        onDone={async () => {
          await refresh();
          navigate('/');
        }}
      />
      <p className="mt-6 text-center text-sm">
        <button type="button" className="text-muted hover:text-ink" onClick={logout}>
          {t('nav.logout')}
        </button>
      </p>
    </AuthShell>
  );
}

export function SetupPage() {
  const { t } = useTranslation();
  const { data } = useAuth();
  const refresh = useRefreshAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const setup = useMutation({
    mutationFn: () => {
      if (form.password !== form.confirm) throw new Error(t('auth.passwordsDiffer'));
      return api.post('/auth/setup', { name: form.name, email: form.email, password: form.password });
    },
    onSuccess: async () => {
      await refresh();
      toast.success(t('auth.setupDone'));
      navigate('/');
    },
  });
  if (data && !data.needsSetup) return <Navigate to="/login" replace />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <AuthShell title={t('auth.setupTitle')} subtitle={t('auth.setupSubtitle')}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setup.mutate();
        }}
      >
        <Field label={t('auth.name')} htmlFor="name">
          <Input id="name" required value={form.name} onChange={set('name')} />
        </Field>
        <Field label={t('auth.email')} htmlFor="email">
          <Input id="email" type="email" autoComplete="username" required value={form.email} onChange={set('email')} />
        </Field>
        <Field label={t('auth.password')} htmlFor="pw" hint={t('auth.passwordHint')}>
          <Input id="pw" type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={set('password')} />
        </Field>
        <Field label={t('auth.repeatPassword')} htmlFor="pw2">
          <Input id="pw2" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} />
        </Field>
        {setup.error && <p className="text-sm text-offline">{setup.error.message}</p>}
        <Button type="submit" variant="accent" className="h-11 w-full" loading={setup.isPending}>
          {t('auth.createAccount')} <ArrowRight className="size-4" />
        </Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const forgot = useMutation({ mutationFn: () => api.post('/auth/forgot', { email }) });
  return (
    <AuthShell title={t('auth.forgotTitle')} subtitle={t('auth.forgotSubtitle')}>
      {forgot.isSuccess ? (
        <div className="rounded-xl border border-online/30 bg-online/8 p-4 text-sm">{t('auth.forgotSent')}</div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            forgot.mutate();
          }}
        >
          <Field label={t('auth.email')} htmlFor="email">
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {forgot.error && <p className="text-sm text-offline">{forgot.error.message}</p>}
          <Button type="submit" variant="accent" className="h-11 w-full" loading={forgot.isPending}>
            {t('auth.sendLink')}
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="text-accent hover:underline">
          {t('auth.backToLogin')}
        </Link>
      </p>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const refresh = useRefreshAuth();
  const navigate = useNavigate();
  const invite = params.get('invite') === '1';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const reset = useMutation({
    mutationFn: () => {
      if (password !== confirm) throw new Error(t('auth.passwordsDiffer'));
      return api.post<{ twoFactor?: boolean }>('/auth/reset', { token: params.get('token'), password });
    },
    onSuccess: async (res) => {
      await refresh();
      navigate(res.twoFactor ? '/login' : '/');
    },
  });
  return (
    <AuthShell title={invite ? t('auth.inviteTitle') : t('auth.resetTitle')} subtitle={invite ? t('auth.inviteSubtitle') : t('auth.resetSubtitle')}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          reset.mutate();
        }}
      >
        <Field label={t('auth.password')} htmlFor="pw" hint={t('auth.passwordHint')}>
          <Input id="pw" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={t('auth.repeatPassword')} htmlFor="pw2">
          <Input id="pw2" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {reset.error && <p className="text-sm text-offline">{reset.error.message}</p>}
        <Button type="submit" variant="accent" className="h-11 w-full" loading={reset.isPending}>
          {t('auth.saveAndLogin')}
        </Button>
      </form>
    </AuthShell>
  );
}
