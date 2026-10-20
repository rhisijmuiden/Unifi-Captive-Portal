import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit, tenantScope } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { uuidParam } from '../lib/ids.js';
import { createVouchers, formatCode, voucherStatus } from '../services/vouchers.js';

const limit = (max: number, min = 1) => z.coerce.number().int().min(min).max(max).nullable().default(null);

const voucherInput = z.object({
  count: z.coerce.number().int(),
  batch: z.string().trim().max(80).nullable().default(null),
  note: z.string().trim().max(200).nullable().default(null),
  durationMinutes: z.coerce.number().int().min(5).max(525_600),
  maxUses: z.coerce.number().int().min(1).max(10_000).default(1),
  dataLimitMb: limit(1_048_576),
  downKbps: limit(10_000_000, 64),
  upKbps: limit(10_000_000, 64),
  validUntil: z.coerce.date().nullable().default(null),
});

export async function voucherRoutes(app: FastifyInstance) {
  app.get('/api/vouchers', async (req) => {
    const tenantId = tenantScope(req);
    const rows = await db.query.vouchers.findMany({ where: eq(schema.vouchers.tenantId, tenantId), orderBy: desc(schema.vouchers.createdAt), limit: 5000 });
    const batches = await db
      .selectDistinct({ batch: schema.vouchers.batch })
      .from(schema.vouchers)
      .where(and(eq(schema.vouchers.tenantId, tenantId), isNotNull(schema.vouchers.batch)));
    const now = new Date();
    return {
      vouchers: rows.map((v) => ({ ...v, code: formatCode(v.code), status: voucherStatus(v, now) })),
      batches: batches.map((b) => b.batch).filter(Boolean),
    };
  });

  app.post('/api/vouchers', async (req) => {
    const tenantId = tenantScope(req, true);
    const input = voucherInput.parse(req.body);
    if (input.count < 1 || input.count > 500) throw badRequest('errors.voucherCount');
    const created = await createVouchers(tenantId, { ...input, batch: input.batch || null, note: input.note || null });
    await audit(req, 'vouchers.created', { count: created.length, batch: input.batch }, tenantId);
    return { vouchers: created.map((v) => ({ ...v, code: formatCode(v.code), status: voucherStatus(v) })) };
  });

  app.post<{ Params: { id: string } }>('/api/vouchers/:id/revoke', async (req) => {
    const tenantId = tenantScope(req, true);
    const [row] = await db
      .update(schema.vouchers)
      .set({ revokedAt: sql`coalesce(${schema.vouchers.revokedAt}, now())` })
      .where(and(eq(schema.vouchers.id, uuidParam(req.params.id)), eq(schema.vouchers.tenantId, tenantId)))
      .returning();
    if (!row) throw notFound();
    await audit(req, 'voucher.revoked', { code: formatCode(row.code) }, tenantId);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/vouchers/:id', async (req) => {
    const tenantId = tenantScope(req, true);
    const [row] = await db
      .delete(schema.vouchers)
      .where(and(eq(schema.vouchers.id, uuidParam(req.params.id)), eq(schema.vouchers.tenantId, tenantId)))
      .returning();
    if (!row) throw notFound();
    await audit(req, 'voucher.deleted', { code: formatCode(row.code) }, tenantId);
    return { ok: true };
  });

  // Removes a whole batch that was never handed out
  app.delete<{ Querystring: { batch?: string } }>('/api/vouchers', async (req) => {
    const tenantId = tenantScope(req, true);
    const batch = z.string().min(1).max(80).parse(req.query.batch);
    const rows = await db
      .delete(schema.vouchers)
      .where(and(eq(schema.vouchers.tenantId, tenantId), eq(schema.vouchers.batch, batch), eq(schema.vouchers.uses, 0)))
      .returning({ id: schema.vouchers.id });
    await audit(req, 'vouchers.deleted', { batch, count: rows.length }, tenantId);
    return { deleted: rows.length };
  });
}
