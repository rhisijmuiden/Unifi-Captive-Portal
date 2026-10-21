import { and, eq, gt, isNull } from 'drizzle-orm';
import { baseUrlForUser } from './resellers.js';
import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { DEFAULT_LOCALE, normalizeLocale } from '../i18n/index.js';
import { sendTemplate } from './mailTemplates.js';

type Purpose = 'invite' | 'password_reset';
const TTL: Record<Purpose, number> = { invite: 7 * 24 * 3600 * 1000, password_reset: 3600 * 1000 };

export async function issueToken(userId: string, purpose: Purpose) {
  const token = randomToken();
  await db.insert(schema.userTokens).values({ id: sha256(token), userId, purpose, expiresAt: new Date(Date.now() + TTL[purpose]) });
  return token;
}

/** Marks the token used and returns its user, or null when invalid or expired. */
export async function consumeToken(token: string) {
  const [row] = await db
    .update(schema.userTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.userTokens.id, sha256(token)), isNull(schema.userTokens.usedAt), gt(schema.userTokens.expiresAt, new Date())))
    .returning();
  if (!row) return null;
  return (await db.query.users.findFirst({ where: eq(schema.users.id, row.userId) })) ?? null;
}

export async function sendInvite(user: User) {
  const token = await issueToken(user.id, 'invite');
  const url = `${await baseUrlForUser(user)}/reset-password?token=${token}&invite=1`;
  const locale = normalizeLocale(user.locale) ?? DEFAULT_LOCALE;
  await sendTemplate(user.email, 'invite', locale, null, { vars: { name: user.name, email: user.email, actionUrl: url }, brandOf: user });
}

export async function sendPasswordReset(user: User) {
  const token = await issueToken(user.id, 'password_reset');
  const url = `${await baseUrlForUser(user)}/reset-password?token=${token}`;
  const locale = normalizeLocale(user.locale) ?? DEFAULT_LOCALE;
  await sendTemplate(user.email, 'passwordReset', locale, null, { vars: { name: user.name, email: user.email, actionUrl: url }, brandOf: user });
}
