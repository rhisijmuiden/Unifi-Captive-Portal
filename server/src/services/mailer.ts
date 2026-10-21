import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { badRequest } from '../lib/errors.js';
import { heloName } from './mailDns.js';
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
  if (!res.ok || !body.access_token) throw badRequest('errors.oauthFailed', { reason: body.error_description ?? res.status });
  return body.access_token;
}

export async function createTransport(s: Smtp) {
  const options: SMTPTransport.Options = {
    host: s.host,
    port: s.port,
    name: (await heloName(s)).name ?? undefined,
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

export type MailAttachment = { filename: string; content: Buffer; contentType: string };

export async function sendMail(to: string, subject: string, content: { html: string; text: string; attachments?: MailAttachment[] }, override?: Smtp) {
  const s = override ?? (await getSettings('smtp'));
  if (!override && !s.enabled) throw badRequest('errors.mailDisabled');
  if (!s.host || !s.fromEmail) throw badRequest('errors.mailIncomplete');
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
