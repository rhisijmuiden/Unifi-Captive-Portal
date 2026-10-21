import { currentLocale } from '../i18n';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'x-requested-with': 'captive-portal',
      'x-locale': currentLocale(),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  // The two-factor policy changed while signed in: set it up before doing anything else
  if (res.status === 403 && data?.code === 'two_factor_setup' && location.pathname !== '/two-factor') location.assign('/two-factor');
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export type Role = 'superadmin' | 'tenant_admin' | 'tenant_user';

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string | null;
  isActive: boolean;
  hasPassword: boolean;
  ssoLinked: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  locale: string | null;
};

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  contactEmail: string | null;
  status: 'active' | 'suspended';
  notes: string | null;
  createdAt: string;
  userCount?: number;
};

export type AuthState = {
  needsSetup: boolean;
  user: User | null;
  /** Signed in, but the policy requires two-factor authentication that is not set up yet */
  twoFactorSetupRequired: boolean;
  /** Password accepted, waiting for the code from the authenticator app */
  twoFactorPending: boolean;
  sso: { entraEnabled: boolean; buttonLabel: string; allowLocalLogin: boolean };
  passwordResetAvailable: boolean;
  version: string;
};
