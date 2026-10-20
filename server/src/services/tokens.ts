import { and, eq, gt, isNull } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { renderEmail, sendMail } from './mailer.js';

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
  const url = `${config.publicUrl}/reset-password?token=${token}&invite=1`;
  await sendMail(
    user.email,
    'Je account voor het Captive Portal',
    renderEmail(`Welkom, ${user.name}`, ['Er is een account voor je aangemaakt. Kies via de knop een wachtwoord om in te loggen. De link is 7 dagen geldig.'], {
      label: 'Wachtwoord instellen',
      url,
    }),
  );
}

export async function sendPasswordReset(user: User) {
  const token = await issueToken(user.id, 'password_reset');
  const url = `${config.publicUrl}/reset-password?token=${token}`;
  await sendMail(
    user.email,
    'Wachtwoord opnieuw instellen',
    renderEmail('Nieuw wachtwoord', ['Je hebt gevraagd je wachtwoord opnieuw in te stellen. De link is 1 uur geldig. Heb je dit niet gevraagd, dan kun je deze e-mail negeren.'], {
      label: 'Nieuw wachtwoord kiezen',
      url,
    }),
  );
}
