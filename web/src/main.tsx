import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { ApiError } from './lib/api';
import { useAuth } from './lib/auth';
import { AccountPage } from './pages/Account';
import { BackupsPage } from './pages/Backups';
import { BillingPage } from './pages/Billing';
import { InvoicesPage } from './pages/Invoices';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SetupPage } from './pages/AuthPages';
import { DashboardPage } from './pages/Dashboard';
import { ConsolesPage } from './pages/Consoles';
import { GuestsPage } from './pages/Guests';
import { HostnamesPage } from './pages/Hostnames';
import { NotificationsPage } from './pages/Notifications';
import { PaymentsPage } from './pages/Payments';
import { PortalSettingsPage } from './pages/PortalSettings';
import { ReportsPage } from './pages/Reports';
import { VoucherPrintPage, VouchersPage } from './pages/Vouchers';
import { HostingSettingsPage, SmtpSettingsPage, SsoSettingsPage } from './pages/Settings';
import { TenantsPage } from './pages/Tenants';
import { UsersPage } from './pages/Users';
import './i18n';
import './styles.css';

// The editors carry CodeMirror and dnd-kit; load them only when opened
const PortalEditorPage = lazy(() => import('./pages/PortalEditor').then((m) => ({ default: m.PortalEditorPage })));
const MailTemplatesPage = lazy(() => import('./pages/MailTemplates').then((m) => ({ default: m.MailTemplatesPage })));
const ApiPage = lazy(() => import('./pages/Api').then((m) => ({ default: m.ApiPage })));
const MailTemplateEditorPage = lazy(() => import('./pages/MailTemplates').then((m) => ({ default: m.MailTemplateEditorPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2, refetchOnWindowFocus: false },
  },
});

function RequireAuth({ children, roles }: { children: ReactNode; roles?: string[] }) {
  const { data, isLoading } = useAuth();
  if (isLoading)
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner />
      </div>
    );
  if (data?.needsSetup) return <Navigate to="/setup" replace />;
  if (!data?.user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(data.user.role)) return <Navigate to="/" replace />;
  return <Suspense fallback={<Spinner />}>{children}</Suspense>;
}

// Portal pages belong to a customer's own environment
const TENANT = ['tenant_admin', 'tenant_user'];

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/setup', element: <SetupPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/vouchers/print', element: <RequireAuth roles={TENANT}><VoucherPrintPage /></RequireAuth> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'tenants', element: <RequireAuth roles={['superadmin']}><TenantsPage /></RequireAuth> },
      { path: 'billing', element: <RequireAuth roles={['superadmin']}><BillingPage /></RequireAuth> },
      { path: 'invoices', element: <RequireAuth roles={['tenant_admin']}><InvoicesPage /></RequireAuth> },
      { path: 'users', element: <RequireAuth roles={['superadmin', 'tenant_admin']}><UsersPage /></RequireAuth> },
      { path: 'settings/smtp', element: <RequireAuth roles={['superadmin']}><SmtpSettingsPage /></RequireAuth> },
      { path: 'settings/sso', element: <RequireAuth roles={['superadmin']}><SsoSettingsPage /></RequireAuth> },
      { path: 'api', element: <RequireAuth roles={['superadmin', 'tenant_admin']}><ApiPage /></RequireAuth> },
      { path: 'backups', element: <RequireAuth roles={['superadmin']}><BackupsPage /></RequireAuth> },
      { path: 'settings/hosting', element: <RequireAuth roles={['superadmin']}><HostingSettingsPage /></RequireAuth> },
      { path: 'consoles', element: <RequireAuth roles={TENANT}><ConsolesPage /></RequireAuth> },
      { path: 'portal-settings', element: <RequireAuth roles={TENANT}><PortalSettingsPage /></RequireAuth> },
      { path: 'hostnames', element: <RequireAuth roles={TENANT}><HostnamesPage /></RequireAuth> },
      { path: 'guests', element: <RequireAuth roles={TENANT}><GuestsPage /></RequireAuth> },
      { path: 'portal-editor', element: <RequireAuth roles={TENANT}><PortalEditorPage /></RequireAuth> },
      { path: 'vouchers', element: <RequireAuth roles={TENANT}><VouchersPage /></RequireAuth> },
      { path: 'payments', element: <RequireAuth roles={TENANT}><PaymentsPage /></RequireAuth> },
      { path: 'reports', element: <RequireAuth roles={TENANT}><ReportsPage /></RequireAuth> },
      { path: 'notifications', element: <RequireAuth roles={TENANT}><NotificationsPage /></RequireAuth> },
      { path: 'mail-templates', element: <RequireAuth roles={['superadmin', 'tenant_admin']}><MailTemplatesPage /></RequireAuth> },
      { path: 'mail-templates/:kind', element: <RequireAuth roles={['superadmin', 'tenant_admin']}><MailTemplateEditorPage /></RequireAuth> },
      { path: 'account', element: <AccountPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  </StrictMode>,
);
