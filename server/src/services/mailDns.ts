import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { promises as dns } from 'node:dns';
import net from 'node:net';
import os from 'node:os';
import { config } from '../config.js';
import { isValidHostname, normalizeHostname } from '../lib/hostname.js';
import { getSettings, type SettingsValue } from './settings.js';

/**
 * Deliverability of outgoing mail: the EHLO name the app greets the mail server with,
 * DKIM keys the app can sign with, and a DNS check of SPF, DKIM and DMARC for the sender domain.
 */

type Smtp = SettingsValue<'smtp'>;

const isFqdn = (h: string) => isValidHostname(normalizeHostname(h)) && !net.isIP(h);

/**
 * Name sent with EHLO. Without one, nodemailer falls back to "[127.0.0.1]" whenever the
 * machine's hostname has no dot (typical for an LXC container), which spam filters punish
 * (SpamAssassin HELO_MISC_IP). Order: the setting, the admin hostname, the system FQDN, PUBLIC_URL.
 */
export async function heloName(s: Pick<Smtp, 'heloName'>): Promise<{ name: string | null; source: 'setting' | 'adminHostname' | 'system' | 'publicUrl' | 'none' }> {
  if (s.heloName) return { name: normalizeHostname(s.heloName), source: 'setting' };
  const { adminHostname } = await getSettings('hosting');
  if (adminHostname) return { name: adminHostname, source: 'adminHostname' };
  const system = os.hostname();
  if (isFqdn(system)) return { name: normalizeHostname(system), source: 'system' };
  const fromUrl = new URL(config.publicUrl).hostname;
  if (isFqdn(fromUrl)) return { name: normalizeHostname(fromUrl), source: 'publicUrl' };
  return { name: null, source: 'none' };
}

/** A fresh 2048-bit RSA key: the size every receiver accepts and most DNS providers can store. */
export function generateDkimKey() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

/** Base64 public key for the p= tag, or null when the stored key cannot be read. */
export function dkimPublicKey(privatePem: string): string | null {
  try {
    return createPublicKey(privatePem).export({ type: 'spki', format: 'der' }).toString('base64');
  } catch {
    return null;
  }
}

export const dkimRecordValue = (publicKey: string) => `v=DKIM1; k=rsa; p=${publicKey}`;

export const domainOf = (email: string) => normalizeHostname(email.split('@')[1] ?? '');

/** DMARC relaxed alignment: same organisational domain, approximated by "equal or a parent". */
export const aligned = (fromDomain: string, signingDomain: string) =>
  Boolean(fromDomain && signingDomain) && (fromDomain === signingDomain || fromDomain.endsWith(`.${signingDomain}`));

async function txt(name: string): Promise<string[] | null> {
  try {
    return (await dns.resolveTxt(name)).map((chunks) => chunks.join(''));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENODATA' || code === 'ENOTFOUND') return [];
    return null;
  }
}

export type CheckStatus = 'ok' | 'warning' | 'error' | 'info';
export type MailCheck = {
  id: 'helo' | 'spf' | 'dkim' | 'dmarc';
  status: CheckStatus;
  // Translation key under smtp.checks, with params
  message: string;
  params?: Record<string, string>;
  found?: string | null;
  // The DNS record we advise, when there is something to change
  suggest?: { type: 'TXT'; name: string; value: string } | null;
};

/** Parses "k=v; k=v" tag lists used by DKIM and DMARC. */
export function tags(record: string) {
  return Object.fromEntries(
    record
      .split(';')
      .map((p) => p.trim().split('='))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k.trim().toLowerCase(), v.join('=').trim()]),
  );
}

export function evaluateSpf(records: string[] | null, domain: string, publicIpv4: string): MailCheck {
  const base = `v=spf1 mx${publicIpv4 ? ` ip4:${publicIpv4}` : ''} ~all`;
  if (records === null) return { id: 'spf', status: 'warning', message: 'dnsFailed', params: { name: domain } };
  const spf = records.filter((r) => /^v=spf1(\s|$)/i.test(r));
  if (spf.length === 0) return { id: 'spf', status: 'error', message: 'spfMissing', params: { domain }, suggest: { type: 'TXT', name: domain, value: base } };
  if (spf.length > 1) return { id: 'spf', status: 'error', message: 'spfMultiple', params: { domain }, found: spf.join('\n') };
  const record = spf[0];
  if (/\s\+?all\b/i.test(` ${record}`) && !/[-~?]all\b/i.test(record)) return { id: 'spf', status: 'error', message: 'spfPassAll', found: record };
  if (publicIpv4 && !record.includes(publicIpv4)) {
    // The IP may still be covered by mx, a or include:, which we cannot evaluate reliably here
    const value = record.replace(/\s+([-~?+]?all|redirect=\S+)\s*$/i, ` ip4:${publicIpv4} $1`);
    return { id: 'spf', status: 'warning', message: 'spfIpNotListed', params: { ip: publicIpv4 }, found: record, suggest: { type: 'TXT', name: domain, value } };
  }
  return { id: 'spf', status: 'ok', message: 'spfOk', found: record };
}

export function evaluateDmarc(records: string[] | null, domain: string): MailCheck {
  const name = `_dmarc.${domain}`;
  const suggest = { type: 'TXT' as const, name, value: `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc@${domain}` };
  if (records === null) return { id: 'dmarc', status: 'warning', message: 'dnsFailed', params: { name } };
  const record = records.find((r) => /^v=DMARC1/i.test(r));
  if (!record) return { id: 'dmarc', status: 'warning', message: 'dmarcMissing', params: { domain }, suggest };
  const policy = tags(record).p ?? 'none';
  return { id: 'dmarc', status: 'ok', message: 'dmarcOk', params: { policy }, found: record };
}

export function evaluateDkim(s: Smtp, records: string[] | null, fromDomain: string): MailCheck {
  if (!s.dkimEnabled) return { id: 'dkim', status: 'info', message: 'dkimOff' };
  const publicKey = s.dkimPrivateKey ? dkimPublicKey(s.dkimPrivateKey) : null;
  if (!s.dkimDomain || !s.dkimSelector || !publicKey) return { id: 'dkim', status: 'error', message: 'dkimIncomplete' };
  const name = `${s.dkimSelector}._domainkey.${s.dkimDomain}`;
  const suggest = { type: 'TXT' as const, name, value: dkimRecordValue(publicKey) };
  if (!aligned(fromDomain, normalizeHostname(s.dkimDomain))) {
    return { id: 'dkim', status: 'error', message: 'dkimNotAligned', params: { domain: s.dkimDomain, from: fromDomain }, suggest };
  }
  if (records === null) return { id: 'dkim', status: 'warning', message: 'dnsFailed', params: { name }, suggest };
  const record = records.find((r) => /p=/i.test(r));
  if (!record) return { id: 'dkim', status: 'error', message: 'dkimMissing', params: { name }, suggest };
  const published = (tags(record).p ?? '').replace(/\s+/g, '');
  if (published !== publicKey) return { id: 'dkim', status: 'error', message: 'dkimMismatch', params: { name }, found: record, suggest };
  return { id: 'dkim', status: 'ok', message: 'dkimOk', params: { name } };
}

export async function checkMailDns(s: Smtp) {
  const helo = await heloName(s);
  const fromDomain = domainOf(s.fromEmail);
  const checks: MailCheck[] = [
    helo.name
      ? { id: 'helo', status: 'ok', message: `helo_${helo.source}`, params: { name: helo.name } }
      : { id: 'helo', status: 'warning', message: 'heloMissing' },
  ];
  if (!fromDomain) return { fromDomain, helo: helo.name, checks };
  const { publicIpv4 } = await getSettings('hosting');
  const dkimName = s.dkimSelector && s.dkimDomain ? `${s.dkimSelector}._domainkey.${s.dkimDomain}` : null;
  const [spf, dmarc, dkim] = await Promise.all([txt(fromDomain), txt(`_dmarc.${fromDomain}`), dkimName ? txt(dkimName) : Promise.resolve([])]);
  checks.push(evaluateSpf(spf, fromDomain, publicIpv4), evaluateDkim(s, dkim, fromDomain), evaluateDmarc(dmarc, fromDomain));
  return { fromDomain, helo: helo.name, checks };
}
