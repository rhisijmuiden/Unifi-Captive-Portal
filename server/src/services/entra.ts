import * as oidc from 'openid-client';
import { config } from '../config.js';
import { getSettings } from './settings.js';

export const entraRedirectUri = () => `${config.publicUrl}/api/auth/entra/callback`;

let cached: { key: string; cfg: oidc.Configuration } | null = null;

export async function entraConfig() {
  const s = await getSettings('sso');
  if (!s.entraEnabled || !s.entraTenantId || !s.entraClientId || !s.entraClientSecret) return null;
  const key = `${s.entraTenantId}|${s.entraClientId}|${s.entraClientSecret}`;
  if (cached?.key !== key) {
    const issuer = new URL(`https://login.microsoftonline.com/${encodeURIComponent(s.entraTenantId)}/v2.0`);
    cached = { key, cfg: await oidc.discovery(issuer, s.entraClientId, s.entraClientSecret) };
  }
  return cached.cfg;
}

export async function buildEntraLogin(cfg: oidc.Configuration) {
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const url = oidc.buildAuthorizationUrl(cfg, {
    redirect_uri: entraRedirectUri(),
    scope: 'openid profile email',
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    response_mode: 'query',
    state,
    nonce,
  });
  return { url: url.href, flow: { verifier, state, nonce } };
}

export async function completeEntraLogin(cfg: oidc.Configuration, callbackUrl: URL, flow: { verifier: string; state: string; nonce: string }) {
  const tokens = await oidc.authorizationCodeGrant(cfg, callbackUrl, {
    pkceCodeVerifier: flow.verifier,
    expectedState: flow.state,
    expectedNonce: flow.nonce,
  });
  const claims = tokens.claims();
  if (!claims) throw new Error('Geen ID-token ontvangen');
  const email = String(claims.email ?? claims.preferred_username ?? '').toLowerCase();
  return { oid: String(claims.oid ?? claims.sub), email, name: String(claims.name ?? email) };
}
