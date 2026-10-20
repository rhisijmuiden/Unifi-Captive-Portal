import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeLocale, t } from '../src/i18n/index.js';

test('translates with parameters in every language', () => {
  assert.equal(t('nl', 'mail.inviteTitle', { name: 'Reinder' }), 'Welkom, Reinder');
  assert.equal(t('en', 'mail.inviteTitle', { name: 'Reinder' }), 'Welcome, Reinder');
});

test('normalizes browser language codes', () => {
  assert.equal(normalizeLocale('nl-NL'), 'nl');
  assert.equal(normalizeLocale('en_GB'), 'en');
  assert.equal(normalizeLocale('fr'), null);
  assert.equal(normalizeLocale(undefined), null);
});
