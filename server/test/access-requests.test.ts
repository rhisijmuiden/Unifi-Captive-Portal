import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { cleanApprovers, gateFor, isExpiredRequest, requestMailData, viewStatus, REQUEST_HOURS } = await import('../src/services/accessRequests.js');
const { renderLoginBlock } = await import('../src/shared/portalDesign.js');
const { portalInput } = await import('../src/routes/portal.js');
const { defaultMailTemplate } = await import('../src/services/mailTemplates.js');
const { mailKinds, renderMail } = await import('../src/shared/mailDesign.js');
const { renderDetails } = await import('../src/views/portal.js');
type AccessRequest = import('../src/db/schema.js').AccessRequest;
type LoginContext = import('../src/shared/portalDesign.js').LoginContext;

const HOUR = 3600_000;
const now = Date.UTC(2026, 10, 4, 12);
const request = (over: Partial<AccessRequest> = {}): AccessRequest => ({
  id: 'r1',
  tenantId: 't1',
  guestSessionId: 'visit-1',
  clientMac: 'a4:83:e7:12:34:56',
  ssid: 'Guest',
  name: 'Sam',
  email: null,
  message: null,
  locale: 'en',
  status: 'pending',
  decidedBy: null,
  decidedAt: null,
  createdAt: new Date(now - HOUR),
  ...over,
});
const visit = (id: string) => ({ id });

test('an undecided request expires after its time; decided ones never do', () => {
  assert.equal(viewStatus(request(), now), 'pending');
  assert.ok(!isExpiredRequest(request({ createdAt: new Date(now - (REQUEST_HOURS - 1) * HOUR) }), now));
  assert.ok(isExpiredRequest(request({ createdAt: new Date(now - (REQUEST_HOURS + 1) * HOUR) }), now));
  assert.equal(viewStatus(request({ createdAt: new Date(now - 30 * HOUR) }), now), 'expired');
  assert.equal(viewStatus(request({ status: 'approved', createdAt: new Date(now - 300 * HOUR) }), now), 'approved');
  assert.equal(viewStatus(request({ status: 'rejected', createdAt: new Date(now - 300 * HOUR) }), now), 'rejected');
});

test('a device without requests may use any way of connecting', () => {
  assert.deepEqual(gateFor(null, visit('visit-1'), true, now), { kind: 'open' });
});

test('a rejected device is blocked on every visit until it is unblocked', () => {
  assert.equal(gateFor(request({ status: 'rejected' }), visit('visit-1'), true, now).kind, 'blocked');
  assert.equal(gateFor(request({ status: 'rejected' }), visit('visit-9'), false, now).kind, 'blocked');
  assert.equal(gateFor(request({ status: 'unblocked' }), visit('visit-9'), true, now).kind, 'open');
});

test('an open request sends the device to its waiting page; an expired one lets it ask again', () => {
  assert.equal(gateFor(request(), visit('visit-1'), true, now).kind, 'waiting');
  assert.equal(gateFor(request(), visit('visit-2'), false, now).kind, 'waiting');
  assert.equal(gateFor(request({ createdAt: new Date(now - 25 * HOUR) }), visit('visit-1'), true, now).kind, 'open');
});

test('an approval connects the visit it was asked on, and later visits only when remembered', () => {
  const approved = request({ status: 'approved' });
  assert.equal(gateFor(approved, visit('visit-1'), false, now).kind, 'approved');
  assert.equal(gateFor(approved, visit('visit-2'), false, now).kind, 'open');
  assert.equal(gateFor(approved, visit('visit-2'), true, now).kind, 'approved');
  assert.equal(gateFor(request({ status: 'revoked' }), visit('visit-1'), true, now).kind, 'open');
});

test('approver addresses are trimmed, lower case, without duplicates and capped', () => {
  assert.deepEqual(cleanApprovers([' Reception@Example.com ', 'reception@example.com', '', 'boss@example.com']), ['reception@example.com', 'boss@example.com']);
  assert.equal(cleanApprovers(Array.from({ length: 30 }, (_, i) => `a${i}@example.com`)).length, 20);
});

test('portal settings from older API clients get the approval defaults', () => {
  const base = {
    title: {},
    welcome: {},
    terms: {},
    accentColor: '#FF6B57',
    requireTerms: true,
    timeLimitMinutes: 480,
    dataLimitMb: null,
    downKbps: null,
    upKbps: null,
    successUrl: null,
    languages: ['en'],
  };
  const auth = { methods: ['free'], emailName: 'optional', emailPhone: 'off', marketingOptIn: false, welcomeMail: false, paymentEmail: 'required' };
  const old = portalInput.parse({ ...base, auth });
  assert.deepEqual(old.auth.approvers, []);
  assert.equal(old.auth.approvalRemember, true);
  const set = portalInput.parse({ ...base, auth: { ...auth, methods: ['approval'], approvers: [' Desk@Example.com '], approvalRemember: false } });
  assert.deepEqual(set.auth.approvers, ['desk@example.com']);
  assert.equal(set.auth.approvalRemember, false);
  assert.throws(() => portalInput.parse({ ...base, auth: { ...auth, approvers: ['not an address'] } }));
});

test('the guest page offers "Ask for access" with name, e-mail and message, escaped', () => {
  const login: LoginContext = {
    methods: ['free', 'approval'],
    requireTerms: true,
    terms: '',
    emailFields: { name: 'optional', phone: 'off', marketing: false },
    paymentEmail: 'off',
    packages: [],
    action: '/portal/tok/connect',
    active: 'approval',
    error: 'Name needed',
    values: { name: '<b>Sam</b>', message: 'Hi </textarea><script>' },
  };
  const html = renderLoginBlock({ locale: 'en', fallbackLocale: 'en', login, languages: [] });
  assert.match(html, /id="cp-m-approval"/);
  assert.match(html, /value="approval"/);
  assert.match(html, /Ask for access/);
  assert.match(html, /name="name"[^>]*required/);
  assert.match(html, /<textarea class="cp-input" name="message" maxlength="500">Hi &lt;\/textarea&gt;&lt;script&gt;<\/textarea>/);
  assert.match(html, /value="&lt;b&gt;Sam&lt;\/b&gt;"/);
  assert.match(html, /Name needed/);
  assert.doesNotMatch(html, /<script>/);
});

test('request details stack each label above its value, so long labels fit a phone', () => {
  const html = renderDetails([
    ['Message for the administrator', 'Visiting <sales>\nuntil 17:00'],
    ['E-mail', null],
    ['Requested', '4 Nov 2026, 15:32'],
  ]);
  assert.match(html, /^<dl/);
  assert.equal((html.match(/<dt/g) ?? []).length, 2, 'empty values are left out');
  assert.doesNotMatch(html, /nowrap|<table/);
  assert.match(html, /<dd[^>]*>Visiting &lt;sales&gt;\nuntil 17:00<\/dd>/);
});

test('the approver e-mail carries the request details and the review link', () => {
  assert.equal(mailKinds.accessRequest.tenant, true);
  const r = request({ email: 'sam@example.com', message: 'Visiting <sales>' });
  const data = requestMailData('en', r, 'Hotel Zeezicht', 'https://guest.example.com/portal/approval/abc');
  for (const v of mailKinds.accessRequest.vars) assert.ok(v in data.vars, `missing ${v}`);
  const mail = renderMail(defaultMailTemplate('accessRequest', 'en'), { ...data, baseUrl: 'https://admin.example.com', locale: 'en', designedBy: true });
  assert.equal(mail.subject, 'Sam asks for access to the Wi-Fi of Hotel Zeezicht');
  assert.match(mail.html, /href="https:\/\/guest\.example\.com\/portal\/approval\/abc"/);
  assert.match(mail.html, /Visiting &lt;sales&gt;/);
  assert.match(mail.html, /a4:83:e7:12:34:56/);
  assert.match(mail.text, /sam@example\.com/);
  const nl = renderMail(defaultMailTemplate('accessRequest', 'nl'), { ...requestMailData('nl', r, 'Hotel Zeezicht', 'https://x/portal/approval/abc'), baseUrl: 'https://x', locale: 'nl', designedBy: true });
  assert.equal(nl.subject, 'Sam vraagt toegang tot de wifi van Hotel Zeezicht');
});
