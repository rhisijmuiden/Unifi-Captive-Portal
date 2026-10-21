import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowRight, Building2, CheckCircle2, Circle, Globe, KeyRound, Mail, Palette, Router, Server, SlidersHorizontal, UserCheck, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Card, CardHeader, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';

type Dashboard = {
  tenants: number | null;
  users: number;
  consoles: number;
  activeHostnames: number;
  guestsToday: number;
  portalConfigured: boolean | null;
  hostingReady: boolean | null;
  billingSuspended: boolean | null;
  activity: { id: string; action: string; details: Record<string, unknown> | null; createdAt: string; userName: string | null }[];
};



function Stat({ icon, label, value, to }: { icon: ReactNode; label: string; value: ReactNode; to?: string }) {
  const body = (
    <Card className="group p-5 transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-center justify-between">
        <span className="grid size-10 place-items-center rounded-xl bg-koraal/12 text-accent">{icon}</span>
        {to && <ArrowRight className="size-4 text-muted opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />}
      </div>
      <p className="display mt-4 text-3xl">{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { data: auth } = useAuth();
  const user = auth!.user!;
  const isAdmin = user.role === 'superadmin';
  // Resellers see their own customers' figures, like a small platform admin
  const isReseller = user.role === 'reseller_admin';
  const manages = isAdmin || isReseller;
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard') });
  const smtp = useQuery({ queryKey: ['settings', 'smtp'], queryFn: () => api.get<{ enabled: boolean }>('/settings/smtp'), enabled: isAdmin });
  const sso = useQuery({ queryKey: ['settings', 'sso'], queryFn: () => api.get<{ entraEnabled: boolean }>('/settings/sso'), enabled: isAdmin });

  const hour = new Date().getHours();
  const greetingKey = hour < 12 ? 'dashboard.morning' : hour < 18 ? 'dashboard.afternoon' : 'dashboard.evening';

  const steps = isAdmin
    ? [
        { done: Boolean(smtp.data?.enabled), label: t('dashboard.stepSmtp'), hint: t('dashboard.stepSmtpHint'), to: '/settings/smtp', icon: Mail },
        { done: Boolean(sso.data?.entraEnabled), label: t('dashboard.stepSso'), hint: t('dashboard.stepSsoHint'), to: '/settings/sso', icon: KeyRound },
        { done: Boolean(data?.hostingReady), label: t('dashboard.stepHosting'), hint: t('dashboard.stepHostingHint'), to: '/settings/hosting', icon: Server },
        { done: (data?.tenants ?? 0) > 0, label: t('dashboard.stepTenant'), hint: t('dashboard.stepTenantHint'), to: '/tenants', icon: Building2 },
        { done: (data?.users ?? 0) > 1, label: t('dashboard.stepInvite'), hint: t('dashboard.stepInviteHint'), to: '/users', icon: Users },
      ]
    : isReseller
      ? [
          { done: Boolean(auth?.brand?.logoUrl), label: t('dashboard.stepBrand'), hint: t('dashboard.stepBrandHint'), to: '/branding', icon: Palette },
          { done: (data?.tenants ?? 0) > 0, label: t('dashboard.stepTenant'), hint: t('dashboard.stepTenantHint'), to: '/tenants', icon: Building2 },
          { done: (data?.users ?? 0) > 1, label: t('dashboard.stepInvite'), hint: t('dashboard.stepInviteHint'), to: '/users', icon: Users },
        ]
      : [
        { done: (data?.consoles ?? 0) > 0, label: t('dashboard.stepConsoleOwn'), hint: t('dashboard.stepConsoleHint'), to: '/consoles', icon: Router },
        { done: Boolean(data?.portalConfigured), label: t('dashboard.stepPortal'), hint: t('dashboard.stepPortalHint'), to: '/portal-settings', icon: SlidersHorizontal },
        { done: (data?.activeHostnames ?? 0) > 0, label: t('dashboard.stepDomain'), hint: t('dashboard.stepDomainHint'), to: '/hostnames', icon: Globe },
      ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <>
      <PageHeader eyebrow={t('dashboard.eyebrow')} title={t(greetingKey, { name: user.name.split(' ')[0] })} description={isAdmin ? t('dashboard.adminIntro') : isReseller ? t('dashboard.resellerIntro') : t('dashboard.tenantIntro')} />

      {data?.billingSuspended && (
        <Link to={user.role === 'tenant_admin' ? '/invoices' : '#'} className="mb-6 flex gap-3 rounded-2xl border border-offline/30 bg-offline/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-offline" />
          <span>
            <span className="block font-semibold">{t('invoices.suspendedTitle')}</span>
            <span className="text-muted">{user.role === 'tenant_admin' ? t('invoices.suspendedText') : t('invoices.suspendedStaff')}</span>
          </span>
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {manages && <Stat icon={<Building2 className="size-5" />} label={t('dashboard.tenants')} value={isLoading ? <Spinner /> : data?.tenants} to="/tenants" />}
        <Stat icon={<Users className="size-5" />} label={manages ? t('dashboard.users') : t('dashboard.teamMembers')} value={isLoading ? <Spinner /> : data?.users} to={user.role !== 'tenant_user' ? '/users' : undefined} />
        <Stat icon={<UserCheck className="size-5" />} label={t('dashboard.guestsToday')} value={isLoading ? <Spinner /> : data?.guestsToday} to={manages ? undefined : '/guests'} />
        <Stat icon={<Router className="size-5" />} label={t('dashboard.consoles')} value={isLoading ? <Spinner /> : data?.consoles} to={manages ? undefined : '/consoles'} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title={t('dashboard.gettingStarted')} description={t('dashboard.stepsDone', { done: doneCount, total: steps.length })} />
          <div className="px-6 pt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
              <div className="h-full rounded-full bg-koraal transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
            </div>
          </div>
          <ul className="divide-y divide-line p-2">
            {steps.map((s) => {
              const inner = (
                <div className="flex items-center gap-4 rounded-xl px-4 py-3 transition hover:bg-sunken/60">
                  {s.done ? <CheckCircle2 className="size-5 shrink-0 text-online" /> : <Circle className="size-5 shrink-0 text-line" />}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${s.done ? 'text-muted line-through' : ''}`}>{s.label}</p>
                    <p className="text-xs text-muted">{s.hint}</p>
                  </div>
                  <s.icon className="size-4 text-muted" />
                </div>
              );
              return <li key={s.label}>{'to' in s && s.to ? <Link to={s.to}>{inner}</Link> : inner}</li>;
            })}
          </ul>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={t('dashboard.activity')} />
          {isLoading ? (
            <div className="p-6">
              <Spinner />
            </div>
          ) : data?.activity.length ? (
            <ul className="space-y-1 p-3">
              {data.activity.map((a) => (
                <li key={a.id} className="flex gap-3 rounded-xl px-3 py-2.5">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-sunken text-muted">
                    <Activity className="size-3.5" />
                  </span>
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">
                      {t(`dashboard.actions.${a.action}`, { defaultValue: a.action })}
                      {typeof a.details?.name === 'string' && <span className="font-normal text-muted"> · {a.details.name}</span>}
                      {typeof a.details?.email === 'string' && <span className="font-normal text-muted"> · {a.details.email}</span>}
                    </p>
                    <p className="text-xs text-muted">
                      {a.userName ?? t('common.system')} · {timeAgo(a.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-6 text-sm text-muted">{t('dashboard.noActivity')}</p>
          )}
        </Card>
      </div>
    </>
  );
}
