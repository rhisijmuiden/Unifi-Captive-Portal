import { useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CreditCard,
  DatabaseBackup,
  Globe,
  Info,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Moon,
  Palette,
  Router,
  Sun,
  UserCheck,
  UserCircle,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api, roleLabel, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DesignedBy } from './DesignedBy';
import { InfoDialog } from './InfoDialog';
import { cx } from './ui';

type Item = { to: string; label: string; icon: LucideIcon; soon?: boolean; end?: boolean };
type Section = { title?: string; items: Item[] };

function navFor(user: User): Section[] {
  const portal: Section = {
    title: 'Captive portals',
    items: [
      { to: '/portals', label: 'Portal-editor', icon: Palette, soon: true },
      { to: '/hostnames', label: 'Hostnames & SSL', icon: Globe, soon: true },
      { to: '/consoles', label: 'UniFi-consoles', icon: Router, soon: true },
      { to: '/guests', label: 'Gasten', icon: UserCheck, soon: true },
      { to: '/payments', label: 'Betalingen', icon: CreditCard, soon: true },
    ],
  };
  if (user.role === 'superadmin') {
    return [
      {
        items: [
          { to: '/', label: 'Overzicht', icon: LayoutDashboard, end: true },
          { to: '/tenants', label: 'Klanten', icon: Building2 },
          { to: '/users', label: 'Gebruikers', icon: Users },
        ],
      },
      portal,
      {
        title: 'Systeem',
        items: [
          { to: '/settings/smtp', label: 'E-mail (SMTP)', icon: Mail },
          { to: '/settings/sso', label: 'Single sign-on', icon: KeyRound },
          { to: '/backups', label: 'Backups', icon: DatabaseBackup, soon: true },
        ],
      },
    ];
  }
  const base: Item[] = [{ to: '/', label: 'Overzicht', icon: LayoutDashboard, end: true }];
  if (user.role === 'tenant_admin') base.push({ to: '/users', label: 'Team', icon: Users });
  return [{ items: base }, portal];
}

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(() => {
    try {
      return (localStorage.getItem('theme') as 'light' | 'dark' | null) ?? null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try {
      if (theme) localStorage.setItem('theme', theme);
      else localStorage.removeItem('theme');
    } catch {
      /* storage blocked: theme just isn't remembered */
    }
  }, [theme]);
  const isDark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  return { isDark, toggle: () => setTheme(isDark ? 'light' : 'dark') };
}

export function Layout() {
  const { data } = useAuth();
  const user = data!.user!;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isDark, toggle } = useTheme();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const logout = async () => {
    await api.post('/auth/logout');
    qc.clear();
    navigate('/login');
  };

  const sidebar = (
    <aside className="flex h-full w-[272px] flex-col bg-nacht text-white">
      <div className="flex items-center justify-between px-6 pt-6 pb-5">
        <div>
          <img src="/rhis-logo-wit.svg" alt="RHIS" className="h-7 w-auto" />
          <p className="mt-2 text-[11px] font-semibold tracking-[0.18em] text-lucht/80 uppercase">Captive Portal</p>
        </div>
        <button className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Menu sluiten">
          <X className="size-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {navFor(user).map((section, i) => (
          <div key={i}>
            {section.title && <p className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-white/40 uppercase">{section.title}</p>}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.to}>
                  {item.soon ? (
                    <span className="flex cursor-default items-center gap-3 rounded-[10px] px-3 py-2 text-sm text-white/35">
                      <item.icon className="size-[18px]" />
                      <span className="flex-1">{item.label}</span>
                      <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold text-white/45">Binnenkort</span>
                    </span>
                  ) : (
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        cx(
                          'group relative flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium transition',
                          isActive ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="absolute top-1.5 bottom-1.5 -left-3 w-1 rounded-r-full bg-koraal" />}
                          <item.icon className={cx('size-[18px]', isActive ? 'text-koraal' : 'text-white/55 group-hover:text-white/80')} />
                          {item.label}
                        </>
                      )}
                    </NavLink>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-1 border-t border-white/10 p-3">
        <button onClick={() => setInfoOpen(true)} className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white">
          <Info className="size-[18px] text-white/55" />
          <span className="flex-1 text-left">Info & updates</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-lucht">v{data!.version}</span>
        </button>
        <a
          href="https://rhis.nl"
          target="_blank"
          rel="noopener"
          className="mx-1 flex items-center gap-3 rounded-[10px] border border-white/10 bg-white/[0.03] px-3 py-2.5 transition hover:border-koraal/40 hover:bg-white/5"
        >
          <img src="/rhis-logo-wit.svg" alt="RHIS" className="h-4 w-auto" />
          <span className="text-[11px] text-white/50">
            Powered by <span className="font-semibold text-white/80">RHIS</span>
          </span>
        </a>
        <div className="flex items-center gap-3 rounded-[10px] px-3 py-2.5">
          <NavLink to="/account" className="flex min-w-0 flex-1 items-center gap-3" title="Mijn account">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-koraal to-[#ff9a7a] text-sm font-bold text-nacht">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block truncate text-xs text-white/50">{roleLabel[user.role]}</span>
            </span>
          </NavLink>
          <button onClick={toggle} className="rounded-lg p-1.5 text-white/55 hover:bg-white/10 hover:text-white" aria-label="Thema wisselen" title="Licht of donker">
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <button onClick={logout} className="rounded-lg p-1.5 text-white/55 hover:bg-white/10 hover:text-white" aria-label="Uitloggen" title="Uitloggen">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen">
      <div className="fixed inset-y-0 left-0 z-30 hidden lg:block">{sidebar}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-nacht/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full">{sidebar}</div>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-raised/80 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 hover:bg-sunken" aria-label="Menu openen">
          <Menu className="size-5" />
        </button>
        <img src="/rhis-logo.svg" alt="RHIS" className="h-5 dark:hidden" />
        <img src="/rhis-logo-wit.svg" alt="RHIS" className="hidden h-5 dark:block" />
        <NavLink to="/account" className="ml-auto rounded-lg p-2 hover:bg-sunken" aria-label="Mijn account">
          <UserCircle className="size-5" />
        </NavLink>
      </header>

      <main className="lg:pl-[272px]">
        <div className="mx-auto max-w-6xl px-4 py-8 pb-24 sm:px-8 lg:py-10">
          <Outlet />
        </div>
      </main>

      <DesignedBy />
      <InfoDialog open={infoOpen} onClose={() => setInfoOpen(false)} />
    </div>
  );
}
