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

export type Role = 'superadmin' | 'tenant_admin' | 'tenant_user' | 'reseller_admin';

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string | null;
  resellerId: string | null;
  isActive: boolean;
  hasPassword: boolean;
  /** Signed in with a generated password and still has to choose an own one */
  mustChangePassword: boolean;
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
  resellerId: string | null;
  resellerName?: string | null;
};

export type AuthState = {
  needsSetup: boolean;
  user: User | null;
  /** Signed in with a generated password: an own password must be chosen first */
  passwordChangeRequired: boolean;
  /** Signed in, but the policy requires two-factor authentication that is not set up yet */
  twoFactorSetupRequired: boolean;
  /** Password accepted, waiting for the code from the authenticator app */
  twoFactorPending: boolean;
  sso: { entraEnabled: boolean; buttonLabel: string; allowLocalLogin: boolean };
  passwordResetAvailable: boolean;
  version: string;
  /** A reseller's own brand; null = the RHIS brand */
  brand: Brand | null;
};

export type Brand = {
  name: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  accentColor: string | null;
  websiteUrl: string | null;
  supportEmail: string | null;
  showPoweredBy: boolean;
  showDesignedBy: boolean;
};
