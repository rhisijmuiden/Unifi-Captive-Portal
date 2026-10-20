import { randomInt } from 'node:crypto';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Voucher } from '../db/schema.js';

// No 0/O, 1/I/L: codes are typed over from paper
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, '');
export const formatCode = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-');

export function generateCode(length = 8) {
  let code = '';
  for (let i = 0; i < length; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export type VoucherInput = {
  count: number;
  batch: string | null;
  note: string | null;
  durationMinutes: number;
  maxUses: number;
  dataLimitMb: number | null;
  downKbps: number | null;
  upKbps: number | null;
  validUntil: Date | null;
};

/** Creates a batch of vouchers with unique codes for the customer. */
export async function createVouchers(tenantId: string, input: VoucherInput) {
  const { count, ...values } = input;
  const created: Voucher[] = [];
  while (created.length < count) {
    const want = count - created.length;
    const codes = [...new Set(Array.from({ length: want }, () => generateCode()))];
    const rows = await db
      .insert(schema.vouchers)
      .values(codes.map((code) => ({ tenantId, code, ...values })))
      .onConflictDoNothing()
      .returning();
    created.push(...rows);
  }
  return created;
}

export type VoucherCheck = { ok: true; voucher: Voucher } | { ok: false; reason: 'voucherInvalid' | 'voucherUsed' | 'voucherExpired' };

/** Claims one use of a voucher; the use is only counted when one is still available. */
export async function claimVoucher(tenantId: string, rawCode: string): Promise<VoucherCheck> {
  const code = normalizeCode(rawCode);
  if (code.length < 4) return { ok: false, reason: 'voucherInvalid' };
  const voucher = await db.query.vouchers.findFirst({ where: and(eq(schema.vouchers.tenantId, tenantId), eq(schema.vouchers.code, code)) });
  if (!voucher || voucher.revokedAt) return { ok: false, reason: 'voucherInvalid' };
  if (voucher.validUntil && voucher.validUntil < new Date()) return { ok: false, reason: 'voucherExpired' };
  const [claimed] = await db
    .update(schema.vouchers)
    .set({ uses: sql`${schema.vouchers.uses} + 1`, firstUsedAt: sql`coalesce(${schema.vouchers.firstUsedAt}, now())` })
    .where(and(eq(schema.vouchers.id, voucher.id), lt(schema.vouchers.uses, schema.vouchers.maxUses), isNull(schema.vouchers.revokedAt)))
    .returning();
  return claimed ? { ok: true, voucher: claimed } : { ok: false, reason: 'voucherUsed' };
}

/** Gives the use back when connecting failed after the voucher was claimed. */
export const releaseVoucher = (id: string) =>
  db
    .update(schema.vouchers)
    .set({ uses: sql`greatest(${schema.vouchers.uses} - 1, 0)` })
    .where(eq(schema.vouchers.id, id));

export function voucherStatus(v: Voucher, now = new Date()) {
  if (v.revokedAt) return 'revoked' as const;
  if (v.uses >= v.maxUses) return 'used' as const;
  if (v.validUntil && v.validUntil < now) return 'expired' as const;
  return v.uses > 0 ? ('partly' as const) : ('unused' as const);
}
