import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { addDays, addMonths, billingPeriod, daysBetween, invoiceTotals, numberPrefix, isOverdue } = await import('../src/services/billing.js');
const { renderInvoicePage } = await import('../src/views/billing.js');
const { billingSchema } = await import('../src/services/settings.js');

test('months are added without drifting away from the start day', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-02-28', 1, 31), '2026-03-31');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(addMonths('2026-12-01', 12), '2027-12-01');
});

test('billing periods run from the start date to the day before the next one', () => {
  assert.deepEqual(billingPeriod('2026-08-15', 'month', '2026-08-15'), { start: '2026-08-15', end: '2026-09-14', next: '2026-09-15' });
  assert.deepEqual(billingPeriod('2026-02-28', 'month', '2026-01-31'), { start: '2026-02-28', end: '2026-03-30', next: '2026-03-31' });
  assert.deepEqual(billingPeriod('2026-01-01', 'quarter', '2026-01-01'), { start: '2026-01-01', end: '2026-03-31', next: '2026-04-01' });
  assert.deepEqual(billingPeriod('2026-01-01', 'year', '2026-01-01'), { start: '2026-01-01', end: '2026-12-31', next: '2027-01-01' });
});

test('day arithmetic crosses months and years', () => {
  assert.equal(addDays('2026-12-25', 14), '2027-01-08');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-10-01', '2026-10-31'), 30);
});

test('totals round per line and apply VAT unless it is reverse-charged', () => {
  const lines = [
    { description: 'Pro', quantity: 1, unitCents: 2995 },
    { description: 'Extra', quantity: 1.5, unitCents: 333 },
  ];
  assert.deepEqual(invoiceTotals(lines, 2100, false), { subtotalCents: 3495, vatCents: 734, totalCents: 4229 });
  assert.deepEqual(invoiceTotals(lines, 2100, true), { subtotalCents: 3495, vatCents: 0, totalCents: 3495 });
  assert.deepEqual(invoiceTotals(lines, 900, false), { subtotalCents: 3495, vatCents: 315, totalCents: 3810 });
});

test('invoice numbers restart with the year in the prefix', () => {
  assert.equal(numberPrefix('{year}-', '2026-10-21'), '2026-');
  assert.equal(numberPrefix('INV/{year}/', '2027-01-02'), 'INV/2027/');
  assert.equal(numberPrefix('F', '2027-01-02'), 'F');
  assert.throws(() => billingSchema.parse({ numberPrefix: '<script>' }));
});

test('only open invoices past their due date are overdue', () => {
  assert.equal(isOverdue({ status: 'open', dueDate: '2026-10-01' }, '2026-10-02'), true);
  assert.equal(isOverdue({ status: 'open', dueDate: '2026-10-02' }, '2026-10-02'), false);
  assert.equal(isOverdue({ status: 'paid', dueDate: '2026-01-01' }, '2026-10-02'), false);
});

test('the public invoice page escapes customer details and offers payment only when possible', () => {
  const invoice = {
    id: 'x', tenantId: null, number: '2026-0001', status: 'open', source: 'manual', locale: 'nl', currency: 'EUR',
    issueDate: '2026-10-01', dueDate: '2026-10-15', periodStart: null, periodEnd: null,
    seller: { name: 'RHIS', address: '', email: '', vatNumber: '' }, customer: { name: '<b>Evil</b>', address: '', email: '', vatNumber: '' },
    lines: [], vatRateBp: 2100, reverseCharge: false, subtotalCents: 1000, vatCents: 210, totalCents: 1210, notes: '',
    payToken: 'tok', sentAt: null, remindersSent: 0, lastReminderAt: null, paidAt: null, paidVia: null, createdAt: new Date(),
  } as const;
  const page = renderInvoicePage('nl', { ...invoice, lines: [] }, { logo: null, canPay: true, overdue: true, base: 'https://p.example' });
  assert.ok(!page.includes('<b>Evil</b>'));
  assert.ok(page.includes('action="https://p.example/billing/pay/tok"'));
  assert.ok(page.includes('Te laat'));
  const noPay = renderInvoicePage('en', { ...invoice, lines: [] }, { logo: null, canPay: false, overdue: false, base: 'https://p.example' });
  assert.ok(!noPay.includes('<form'));
  assert.ok(noPay.includes('not possible right now'));
});
