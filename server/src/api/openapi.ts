import { z } from 'zod';
import { config } from '../config.js';
import type { Locale } from '../i18n/index.js';
import { webhookEvents } from '../services/webhooks.js';
import { accessOf, operations, publicPath, requiredScope, scopes, type Audience, type Operation } from './catalog.js';

const intro: Record<Audience, Record<Locale, string>> = {
  tenant: {
    en: 'The REST API of your own environment: consoles, hostnames, portals, guests, vouchers, payments, reports and your team. Create a key under **API** in the menu and send it as `Authorization: Bearer <key>`.',
    nl: 'De REST API van je eigen omgeving: consoles, hostnames, portals, gasten, vouchers, betalingen, rapporten en je team. Maak een sleutel aan onder **API** in het menu en stuur hem mee als `Authorization: Bearer <sleutel>`.',
  },
  platform: {
    en: 'The platform API of the main admin panel: customers, users, server settings, billing, backups and updates. Create a key under **API** in the menu and send it as `Authorization: Bearer <key>`.',
    nl: 'De platform-API van het hoofdbeheer: klanten, gebruikers, serverinstellingen, facturatie, back-ups en updates. Maak een sleutel aan onder **API** in het menu en stuur hem mee als `Authorization: Bearer <sleutel>`.',
  },
};

const general: Record<Locale, string> = {
  en: [
    '',
    '**Scopes.** Each key has scopes per resource, e.g. `vouchers:read` or `vouchers:write` (write includes read).',
    '**Rate limit.** Per key per minute; every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`. Over the limit you get `429`.',
    '**Language.** Error messages follow `Accept-Language` or `X-Locale` (`en`, `nl`).',
    '**Errors.** `{ "error": "message" }` with status 400 (input), 401 (key), 403 (scope), 404 or 429.',
    '**Webhooks.** Events are sent as a signed POST: `X-Webhook-Signature: v1=HMAC-SHA256(secret, "<X-Webhook-Timestamp>.<body>")` in hex.',
  ].join('\n\n'),
  nl: [
    '',
    '**Scopes.** Elke sleutel heeft scopes per onderdeel, bv. `vouchers:read` of `vouchers:write` (schrijven omvat lezen).',
    '**Rate limit.** Per sleutel per minuut; elk antwoord bevat `X-RateLimit-Limit`, `X-RateLimit-Remaining` en `X-RateLimit-Reset`. Boven de limiet krijg je `429`.',
    '**Taal.** Foutmeldingen volgen `Accept-Language` of `X-Locale` (`en`, `nl`).',
    '**Fouten.** `{ "error": "melding" }` met status 400 (invoer), 401 (sleutel), 403 (scope), 404 of 429.',
    '**Webhooks.** Gebeurtenissen komen als ondertekende POST: `X-Webhook-Signature: v1=HMAC-SHA256(geheim, "<X-Webhook-Timestamp>.<body>")` in hex.',
  ].join('\n\n'),
};

/** JSON Schema of a request body; transforms and refinements are described by their input. */
function bodySchema(op: Operation) {
  if (!op.body) return undefined;
  try {
    const { $schema: _s, ...rest } = z.toJSONSchema(op.body, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    return rest;
  } catch {
    return { type: 'object' };
  }
}

const tagOf = (op: Operation, audience: Audience) => op[audience]!;

export const operationsFor = (audience: Audience) => operations.filter((op) => op[audience]);

export function buildOpenApi(audience: Audience, locale: Locale, serverUrl = config.publicUrl) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of operationsFor(audience)) {
    const path = publicPath(op.route);
    const scope = requiredScope(op, audience)!;
    const responses: Record<string, unknown> = {
      '200': op.produces
        ? { description: 'OK', content: { [op.produces]: { schema: { type: 'string', format: 'binary' } } } }
        : { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } },
      '400': { $ref: '#/components/responses/Error' },
      '401': { $ref: '#/components/responses/Error' },
      '403': { $ref: '#/components/responses/Error' },
      '429': { $ref: '#/components/responses/Error' },
    };
    const body = bodySchema(op);
    paths[path] ??= {};
    paths[path][op.method.toLowerCase()] = {
      operationId: `${op.method.toLowerCase()}${path.replace(/\/api\/v1/, '').replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ''))}`,
      tags: [tagOf(op, audience)],
      summary: op.summary[locale],
      description: [op.description?.[locale], `Scope: \`${scope}\``].filter(Boolean).join('\n\n'),
      'x-scope': scope,
      'x-access': accessOf(op),
      parameters: (op.params ?? []).map((p) => ({
        name: p.name,
        in: p.in,
        required: p.in === 'path' ? true : Boolean(p.required),
        description: p.text[locale],
        schema: { type: p.type ?? 'string', ...(p.enum ? { enum: p.enum } : {}) },
      })),
      ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: body } } } } : {}),
      responses,
    };
  }
  const events = webhookEvents[audience];
  return {
    openapi: '3.1.0',
    info: {
      title: audience === 'tenant' ? 'Captive Portal API' : 'Captive Portal Platform API',
      version: config.version,
      description: intro[audience][locale] + general[locale],
      contact: { name: 'RHIS', url: 'https://rhis.nl' },
    },
    servers: [{ url: serverUrl }],
    security: [{ apiKey: [] }],
    tags: Object.entries(scopes[audience]).map(([name, text]) => ({ name, description: text[locale] })),
    paths,
    webhooks: Object.fromEntries(
      Object.entries(events).map(([name, text]) => [
        name,
        {
          post: {
            summary: text[locale],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { id: { type: 'string' }, event: { const: name }, createdAt: { type: 'string', format: 'date-time' }, tenantId: { type: ['string', 'null'] }, data: { type: 'object' } },
                  },
                },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      ]),
    ),
    components: {
      securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'cpk_…' } },
      responses: {
        Error: { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] } } } },
      },
    },
  };
}
