import { badRequest } from '../lib/errors.js';
import { tenantPortalOrigin } from './hostnames.js';
import { adminBaseUrl } from './settings.js';
import { getTenantSettings, type TenantSettingsValue } from './tenantSettings.js';

/**
 * "Continue with Facebook" on the guest portal, with the customer's own Facebook app.
 * Standard OAuth 2.0 code flow; we only ask for the public profile and e-mail address.
 */

const GRAPH = process.env.FACEBOOK_GRAPH_URL ?? 'https://graph.facebook.com/v21.0';
const DIALOG = process.env.FACEBOOK_DIALOG_URL ?? 'https://www.facebook.com/v21.0/dialog/oauth';

type Social = TenantSettingsValue<'social'>;

export const facebookConfigured = (s: Social) => Boolean(s.facebookAppId && s.facebookAppSecret);

/** The fixed address Facebook sends guests back to; it must be listed in the Facebook app. */
export async function facebookRedirectUri(tenantId: string) {
  return `${(await tenantPortalOrigin(tenantId)) ?? (await adminBaseUrl())}/portal/oauth/facebook`;
}

export async function facebookLoginUrl(tenantId: string, state: string, locale: string) {
  const s = await getTenantSettings(tenantId, 'social');
  if (!facebookConfigured(s)) throw badRequest('errors.facebookSetup');
  const url = new URL(DIALOG);
  url.search = new URLSearchParams({
    client_id: s.facebookAppId,
    redirect_uri: await facebookRedirectUri(tenantId),
    state,
    scope: 'public_profile,email',
    response_type: 'code',
    locale: locale === 'nl' ? 'nl_NL' : 'en_US',
  }).toString();
  return { url: url.toString(), graceMinutes: s.facebookGraceMinutes };
}

async function graph<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${GRAPH}${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok || body.error) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body;
}

/** Exchanges the code for the guest's name and e-mail address. */
export async function facebookProfile(tenantId: string, code: string) {
  const s = await getTenantSettings(tenantId, 'social');
  if (!facebookConfigured(s)) throw badRequest('errors.facebookSetup');
  const token = await graph<{ access_token: string }>('/oauth/access_token', {
    client_id: s.facebookAppId,
    client_secret: s.facebookAppSecret,
    redirect_uri: await facebookRedirectUri(tenantId),
    code,
  });
  return graph<{ id: string; name?: string; email?: string }>('/me', { fields: 'id,name,email', access_token: token.access_token });
}

/** Checks the App ID and secret by asking Facebook for an app token. */
export async function testFacebook(s: Social) {
  if (!facebookConfigured(s)) throw badRequest('errors.facebookSetup');
  try {
    await graph('/oauth/access_token', { client_id: s.facebookAppId, client_secret: s.facebookAppSecret, grant_type: 'client_credentials' });
    return { ok: true };
  } catch (err) {
    throw badRequest('errors.facebookApi', { reason: (err as Error).message });
  }
}
