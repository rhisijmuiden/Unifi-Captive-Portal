import { createPrivateKey, sign } from 'node:crypto';
import { AppError, badRequest } from '../lib/errors.js';
import { tenantPortalOrigin } from './hostnames.js';
import { adminBaseUrl } from './settings.js';
import { getTenantSettings, type TenantSettingsValue } from './tenantSettings.js';

/**
 * "Continue with Google / Apple / Microsoft" on the guest portal, each with the customer's
 * own app. OpenID Connect code flow: the guest's name and e-mail come from the ID token,
 * which we receive straight from the provider's token endpoint over TLS (OIDC Core 3.1.3.7),
 * so its signature does not need a separate check.
 */

type Social = TenantSettingsValue<'social'>;
export type OidcProvider = 'google' | 'microsoft' | 'apple';
export const oidcProviders: OidcProvider[] = ['google', 'microsoft', 'apple'];

const MS = process.env.MICROSOFT_LOGIN_URL ?? 'https://login.microsoftonline.com';
const endpoints = {
  google: { authorize: process.env.GOOGLE_AUTH_URL ?? 'https://accounts.google.com/o/oauth2/v2/auth', token: process.env.GOOGLE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token' },
  apple: { authorize: process.env.APPLE_AUTH_URL ?? 'https://appleid.apple.com/auth/authorize', token: process.env.APPLE_TOKEN_URL ?? 'https://appleid.apple.com/auth/token' },
};

/** Addresses guests must reach before they are online; added to the walled garden on the console. */
export const walledGarden: Record<OidcProvider | 'facebook', string[]> = {
  facebook: ['facebook.com', '*.facebook.com', '*.fbcdn.net', '*.facebook.net'],
  google: ['accounts.google.com', '*.gstatic.com', 'fonts.googleapis.com', 'oauth2.googleapis.com', 'ssl.gstatic.com', 'accounts.youtube.com'],
  apple: ['appleid.apple.com', 'idmsa.apple.com', '*.apple.com', '*.cdn-apple.com'],
  microsoft: ['login.microsoftonline.com', 'login.live.com', 'aadcdn.msftauth.net', 'aadcdn.msauth.net', 'logincdn.msauth.net', '*.msauth.net', '*.msftauth.net', 'account.live.com'],
};

export function oidcConfigured(s: Social, p: OidcProvider) {
  if (p === 'google') return Boolean(s.googleClientId && s.googleClientSecret);
  if (p === 'microsoft') return Boolean(s.microsoftClientId && s.microsoftClientSecret);
  return Boolean(s.appleServiceId && s.appleTeamId && s.appleKeyId && s.applePrivateKey);
}

/** The fixed address each provider sends guests back to; it must be registered in the customer's app. */
export async function redirectUri(tenantId: string, p: OidcProvider | 'facebook') {
  return `${(await tenantPortalOrigin(tenantId)) ?? (await adminBaseUrl())}/portal/oauth/${p}`;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/**
 * Apple wants a JWT as client secret, signed (ES256) with the key from the developer
 * account. Valid for at most six months; we make a fresh one for every request.
 */
export function appleClientSecret(s: Pick<Social, 'appleServiceId' | 'appleTeamId' | 'appleKeyId' | 'applePrivateKey'>, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: s.appleKeyId, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: s.appleTeamId, iat, exp: iat + 600, aud: 'https://appleid.apple.com', sub: s.appleServiceId }));
  let key;
  try {
    key = createPrivateKey(s.applePrivateKey.trim());
  } catch {
    throw badRequest('errors.appleKey');
  }
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(signature)}`;
}

function client(s: Social, p: OidcProvider) {
  if (p === 'google') return { id: s.googleClientId, secret: s.googleClientSecret, ...endpoints.google };
  if (p === 'apple') return { id: s.appleServiceId, secret: appleClientSecret(s), ...endpoints.apple };
  const base = `${MS}/${encodeURIComponent(s.microsoftTenant || 'common')}/oauth2/v2.0`;
  return { id: s.microsoftClientId, secret: s.microsoftClientSecret, authorize: `${base}/authorize`, token: `${base}/token` };
}

export async function oidcLoginUrl(tenantId: string, p: OidcProvider, state: string, locale: string) {
  const s = await getTenantSettings(tenantId, 'social');
  if (!oidcConfigured(s, p)) throw badRequest('errors.socialSetup');
  const c = client(s, p);
  const params: Record<string, string> = { client_id: c.id, redirect_uri: await redirectUri(tenantId, p), response_type: 'code', state };
  if (p === 'apple') {
    // Apple only shares name and e-mail with a form post back to us
    Object.assign(params, { scope: 'name email', response_mode: 'form_post', locale: locale === 'nl' ? 'nl_NL' : 'en_US' });
  } else {
    Object.assign(params, { scope: 'openid email profile', prompt: 'select_account', ui_locales: locale });
  }
  return { url: `${c.authorize}?${new URLSearchParams(params)}`, graceMinutes: s.facebookGraceMinutes };
}

/** The claims we use from an ID token; decoded only (see above). */
export function decodeIdToken(token: string) {
  const part = token.split('.')[1];
  if (!part) throw new Error('No ID token');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { sub?: string; email?: string; email_verified?: boolean | string; name?: string; given_name?: string; family_name?: string; preferred_username?: string };
}

async function tokenRequest(s: Social, p: OidcProvider, tenantId: string, code: string) {
  const c = client(s, p);
  const res = await fetch(c.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: await redirectUri(tenantId, p), client_id: c.id, client_secret: c.secret }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  return { ok: res.ok && Boolean(body.id_token), body };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Exchanges the code for the guest's name and e-mail. Apple sends the name only on the
 * very first sign-in, in a separate `user` form field.
 */
export async function oidcProfile(tenantId: string, p: OidcProvider, code: string, appleUser?: string) {
  const s = await getTenantSettings(tenantId, 'social');
  if (!oidcConfigured(s, p)) throw badRequest('errors.socialSetup');
  const { ok, body } = await tokenRequest(s, p, tenantId, code);
  if (!ok) throw new Error(body.error_description ?? body.error ?? 'Token request failed');
  const claims = decodeIdToken(body.id_token!);
  let name = claims.name ?? [claims.given_name, claims.family_name].filter(Boolean).join(' ');
  if (p === 'apple' && appleUser) {
    try {
      const u = JSON.parse(appleUser) as { name?: { firstName?: string; lastName?: string } };
      name ||= [u.name?.firstName, u.name?.lastName].filter(Boolean).join(' ');
    } catch {
      /* the name is optional */
    }
  }
  // Microsoft personal accounts may only have preferred_username, which is then the address
  const email = claims.email ?? (p === 'microsoft' && claims.preferred_username && EMAIL.test(claims.preferred_username) ? claims.preferred_username : undefined);
  const verified = claims.email_verified === undefined || claims.email_verified === true || claims.email_verified === 'true';
  return { id: claims.sub ?? '', name: name || undefined, email: email && verified ? email : undefined };
}

/**
 * Checks the client credentials without a guest: a made-up code gives "invalid_grant"
 * when the client is right and "invalid_client" (or similar) when it is not.
 */
export async function testOidc(tenantId: string, s: Social, p: OidcProvider) {
  if (!oidcConfigured(s, p)) throw badRequest('errors.socialSetup');
  try {
    const { body } = await tokenRequest(s, p, tenantId, 'connection-test');
    if (body.error === 'invalid_grant') return { ok: true };
    throw new Error(body.error_description ?? body.error ?? 'Unexpected answer');
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw badRequest('errors.socialApi', { reason: (err as Error).message });
  }
}
