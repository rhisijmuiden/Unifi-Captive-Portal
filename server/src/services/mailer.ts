import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { getSettings, type SettingsValue } from './settings.js';

type Smtp = SettingsValue<'smtp'>;

async function fetchOAuthToken(s: Smtp): Promise<string> {
  const res = await fetch(s.oauthTokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: s.oauthClientId,
      client_secret: s.oauthClientSecret,
      scope: s.oauthScope,
    }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`OAuth2 token ophalen mislukt: ${body.error_description ?? res.status}`);
  return body.access_token;
}

export async function createTransport(s: Smtp) {
  const options: SMTPTransport.Options = {
    host: s.host,
    port: s.port,
    secure: s.security === 'tls',
    requireTLS: s.security === 'starttls',
    ignoreTLS: s.security === 'none',
    tls: { minVersion: s.minTlsVersion, rejectUnauthorized: s.verifyCertificate, servername: s.host },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  };
  if (s.authMethod === 'password') options.auth = { user: s.username, pass: s.password };
  if (s.authMethod === 'oauth2') options.auth = { type: 'OAuth2', user: s.username, accessToken: await fetchOAuthToken(s) };
  if (s.dkimEnabled && s.dkimPrivateKey) {
    options.dkim = { domainName: s.dkimDomain, keySelector: s.dkimSelector, privateKey: s.dkimPrivateKey };
  }
  return nodemailer.createTransport(options);
}

export function renderEmail(title: string, paragraphs: string[], action?: { label: string; url: string }) {
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;line-height:1.55">${esc(p)}</p>`).join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${esc(action.url)}" style="background:#FF6B57;color:#14213D;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;display:inline-block">${esc(action.label)}</a></p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#F6F7FB;font-family:Archivo,Segoe UI,Arial,sans-serif;color:#14213D">
<div style="max-width:560px;margin:0 auto;padding:32px 16px"><div style="background:#fff;border:1px solid #DCE1EB;border-radius:16px;padding:32px">
<h1 style="font-size:22px;margin:0 0 20px">${esc(title)}</h1>${body}${button}</div>
<p style="font-size:12px;color:#4F5B73;text-align:center;margin-top:20px">Designed by <a href="https://rhis.nl" style="color:#B8392A">RHIS</a></p></div></body></html>`;
  const text = [title, '', ...paragraphs, ...(action ? ['', `${action.label}: ${action.url}`] : [])].join('\n');
  return { html, text };
}

export async function sendMail(to: string, subject: string, content: { html: string; text: string }, override?: Smtp) {
  const s = override ?? (await getSettings('smtp'));
  if (!override && !s.enabled) throw new Error('E-mail is niet ingeschakeld');
  if (!s.host || !s.fromEmail) throw new Error('SMTP-server of afzender ontbreekt');
  const transport = await createTransport(s);
  try {
    return await transport.sendMail({
      from: { name: s.fromName, address: s.fromEmail },
      replyTo: s.replyTo || undefined,
      to,
      subject,
      ...content,
    });
  } finally {
    transport.close();
  }
}
