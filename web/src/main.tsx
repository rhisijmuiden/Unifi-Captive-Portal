import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { ApiError } from './lib/api';
import { useAuth } from './lib/auth';
import { AccountPage } from './pages/Account';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SetupPage } from './pages/AuthPages';
import { DashboardPage } from './pages/Dashboard';
import { SmtpSettingsPage, SsoSettingsPage } from './pages/Settings';
import { TenantsPage } from './pages/Tenants';
import { UsersPage } from './pages/Users';
import './i18n';
import './styles.css';

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
  return children;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/setup', element: <SetupPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
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
      { path: 'users', element: <RequireAuth roles={['superadmin', 'tenant_admin']}><UsersPage /></RequireAuth> },
      { path: 'settings/smtp', element: <RequireAuth roles={['superadmin']}><SmtpSettingsPage /></RequireAuth> },
      { path: 'settings/sso', element: <RequireAuth roles={['superadmin']}><SsoSettingsPage /></RequireAuth> },
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
