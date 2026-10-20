import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, Building2, CheckCircle2, Circle, Globe, KeyRound, Mail, Palette, Router, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Card, CardHeader, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';

type Dashboard = {
  tenants: number | null;
  users: number;
  activity: { id: string; action: string; details: Record<string, unknown> | null; createdAt: string; userName: string | null }[];
};

const actionLabels: Record<string, string> = {
  'setup.completed': 'Platform geïnstalleerd',
  'auth.login': 'Ingelogd',
  'auth.password_changed': 'Wachtwoord gewijzigd',
  'auth.password_reset': 'Wachtwoord opnieuw ingesteld',
  'tenant.created': 'Klant aangemaakt',
  'tenant.updated': 'Klant bijgewerkt',
  'tenant.deleted': 'Klant verwijderd',
  'user.created': 'Gebruiker toegevoegd',
  'user.updated': 'Gebruiker bijgewerkt',
  'user.deleted': 'Gebruiker verwijderd',
  'user.invited': 'Uitnodiging verstuurd',
  'settings.updated': 'Instellingen gewijzigd',
  'system.update_requested': 'Update gestart',
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
  const { data: auth } = useAuth();
  const user = auth!.user!;
  const isAdmin = user.role === 'superadmin';
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard') });
  const smtp = useQuery({ queryKey: ['settings', 'smtp'], queryFn: () => api.get<{ enabled: boolean }>('/settings/smtp'), enabled: isAdmin });
  const sso = useQuery({ queryKey: ['settings', 'sso'], queryFn: () => api.get<{ entraEnabled: boolean }>('/settings/sso'), enabled: isAdmin });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Goedemorgen' : hour < 18 ? 'Goedemiddag' : 'Goedenavond';

  const steps = isAdmin
    ? [
        { done: Boolean(smtp.data?.enabled), label: 'Stel de mailserver in', hint: 'Voor uitnodigingen en wachtwoordherstel', to: '/settings/smtp', icon: Mail },
        { done: Boolean(sso.data?.entraEnabled), label: 'Zet Microsoft SSO aan', hint: 'Optioneel, voor inloggen met Entra ID', to: '/settings/sso', icon: KeyRound },
        { done: (data?.tenants ?? 0) > 0, label: 'Voeg je eerste klant toe', hint: 'Elke klant krijgt een eigen omgeving', to: '/tenants', icon: Building2 },
        { done: false, label: 'Koppel een UniFi-console', hint: 'Komt in de volgende versie', icon: Router },
      ]
    : [
        { done: false, label: 'Koppel je UniFi-console', hint: 'Komt in de volgende versie', icon: Router },
        { done: false, label: 'Ontwerp je portal', hint: 'Komt in een volgende versie', icon: Palette },
        { done: false, label: 'Stel je eigen domein in', hint: 'Bijvoorbeeld gast.jouwbedrijf.nl', icon: Globe },
      ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <>
      <PageHeader eyebrow="Overzicht" title={`${greeting}, ${user.name.split(' ')[0]}`} description={isAdmin ? 'Zo staat het platform er nu voor.' : 'Welkom in je beheeromgeving voor gastwifi.'} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isAdmin && <Stat icon={<Building2 className="size-5" />} label="Klanten" value={isLoading ? <Spinner /> : data?.tenants} to="/tenants" />}
        <Stat icon={<Users className="size-5" />} label={isAdmin ? 'Gebruikers' : 'Teamleden'} value={isLoading ? <Spinner /> : data?.users} to={user.role !== 'tenant_user' ? '/users' : undefined} />
        <Stat icon={<Palette className="size-5" />} label="Actieve portals" value="0" />
        <Stat icon={<Router className="size-5" />} label="Gekoppelde consoles" value="0" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Aan de slag" description={`${doneCount} van ${steps.length} stappen afgerond`} />
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
          <CardHeader title="Recente activiteit" />
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
                      {actionLabels[a.action] ?? a.action}
                      {typeof a.details?.name === 'string' && <span className="font-normal text-muted"> · {a.details.name}</span>}
                      {typeof a.details?.email === 'string' && <span className="font-normal text-muted"> · {a.details.email}</span>}
                    </p>
                    <p className="text-xs text-muted">
                      {a.userName ?? 'Systeem'} · {timeAgo(a.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-6 text-sm text-muted">Nog geen activiteit.</p>
          )}
        </Card>
      </div>
    </>
  );
}
