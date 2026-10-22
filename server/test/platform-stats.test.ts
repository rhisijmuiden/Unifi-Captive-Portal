import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { addDays, daysBetween, pickGranularity, previousPeriod } = await import('../src/services/platformStats.js');
const { parseFilter } = await import('../src/routes/platformStats.js');
const { renderStatsPdf, statsCsv } = await import('../src/services/platformReport.js');
const { findOperation, requiredScope } = await import('../src/api/catalog.js');
type Stats = Parameters<typeof statsCsv>[0];

test('periods: day arithmetic, previous period and bar size', () => {
  assert.equal(addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(daysBetween('2026-10-01', '2026-10-31'), 31);
  assert.deepEqual(previousPeriod('2026-10-01', '2026-10-31'), { from: '2026-08-31', to: '2026-09-30' });
  assert.equal(pickGranularity(30), 'day');
  assert.equal(pickGranularity(90), 'week');
  assert.equal(pickGranularity(365), 'month');
});

test('filter: defaults to the last 30 days and rejects bad input', () => {
  const f = parseFilter({}, new Date('2026-10-22T10:00:00Z'));
  assert.deepEqual(f, { from: '2026-09-23', to: '2026-10-22', resellerId: null, tenantId: null, granularity: null });
  assert.equal(parseFilter({ reseller: 'direct', granularity: 'week' }).resellerId, 'direct');
  // Anything that is not a UUID is ignored instead of reaching the database
  assert.equal(parseFilter({ reseller: "x' or 1=1", tenant: 'nope' }).resellerId, null);
  assert.throws(() => parseFilter({ from: '2026-13-01', to: '2026-10-01' }), /dayFormat/);
  assert.throws(() => parseFilter({ from: '2026-10-02', to: '2026-10-01' }), /periodOrder/);
  assert.throws(() => parseFilter({ from: '2020-01-01', to: '2026-10-01' }), /periodTooLong/);
});

const sample: Stats = {
  from: '2026-10-01',
  to: '2026-10-07',
  days: 7,
  granularity: 'day',
  previous: { from: '2026-09-24', to: '2026-09-30', guests: 8, uniqueDevices: 6, registrations: 1, activeTenants: 2, vouchersUsed: 0, paidSessions: 0 },
  totals: { guests: 10, uniqueDevices: 7, registrations: 2, activeTenants: 2, vouchersUsed: 1, paidSessions: 1, newDevices: 4, returningDevices: 3, marketingOptIns: 1, tenants: 3, newTenants: 1, resellers: 1, activeAdmins: 2, onlineNow: 1, guestPayments: 1, guestRevenue: [{ currency: 'EUR', cents: 250 }] },
  series: Array.from({ length: 7 }, (_, i) => ({ bucket: `2026-10-0${i + 1}`, guests: i, devices: i, tenants: 1 })),
  previousSeries: [1, 1, 1, 1, 1, 1, 2],
  heatmap: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (h === 9 ? d : 0))),
  byMethod: { free: 6, email: 4 } as Stats['byMethod'],
  byReseller: [{ id: null, name: '', tenants: 1, activeTenants: 1, guests: 4, devices: 3, previousGuests: 2 }],
  byTenant: [{ id: 'a', name: '=HYPERLINK("x"); Café', status: 'active', resellerId: null, resellerName: null, guests: 4, devices: 3, registrations: 1, previousGuests: 2, lastGuestAt: null }],
  peak: { weekday: 6, hour: 9, count: 6 },
  busiestDay: { bucket: '2026-10-07', count: 6 },
};

test('CSV: semicolons for Dutch, commas for English, formulas defused', () => {
  const nl = statsCsv(sample, { locale: 'nl', scopeLabel: 'Alle klanten' });
  assert.ok(nl.startsWith('﻿Platformstatistieken'));
  assert.match(nl, /Gastaanmeldingen;10;8/);
  assert.match(nl, /zondag;0;0;0;0;0;0;0;0;0;6/);
  assert.match(nl, /"'=HYPERLINK\(""x""\); Café";Direct/);
  const en = statsCsv(sample, { locale: 'en', scopeLabel: 'All customers' });
  assert.match(en, /Guest sign-ins,10,8/);
  assert.match(en, /Guest payments \(EUR\),2\.50/);
});

test('PDF report renders', async () => {
  const pdf = await renderStatsPdf(sample, { locale: 'en', scopeLabel: 'All customers' });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});

test('statistics are a platform-only API operation', () => {
  const op = findOperation('GET', '/api/platform/stats')!;
  assert.equal(requiredScope(op, 'platform'), 'statistics:read');
  assert.equal(requiredScope(op, 'tenant'), null);
});
