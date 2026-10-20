# Ontwikkelen en releasen

> 🇬🇧 [English version](../en/development.md)

## Lokaal draaien

Vereist: Node.js 22 of nieuwer en PostgreSQL.

```bash
sudo -u postgres psql -c "create user captive with password 'captive'" -c "create database captive owner captive"
cp .env.example .env          # pas APP_SECRET aan
npm install
npm run dev                   # API op :8080, Vite op :5173 (proxy naar de API)
```

Open http://localhost:5173. Bij de eerste keer start de installatiewizard.

## Projectstructuur

```
server/            Fastify API (TypeScript)
  src/routes/      API-endpoints: auth, tenants, users, settings, system, consoles, portals, betalingen, facturatie (/api/billing, betaalpagina's onder /billing)
  src/services/    mailer, Entra SSO, instellingen, updater, tokens, UniFi, betalingen, facturatie en factuur-pdf's, API-sleutels, webhooks
  src/api/         publieke REST API: catalogus van bewerkingen en scopes (catalog.ts), sleutelcontrole en rate limit (gate.ts), OpenAPI (openapi.ts)
  src/i18n/        vertalingen van de server (foutmeldingen, e-mails)
  src/db/          Drizzle-schema en migraties (server/drizzle/)
  src/shared/      opmaak van gastpagina en e-mails, gedeeld met de editors in de web-app (import via @shared)
  test/            unit tests (node --test)
web/               React-beheeromgeving (Vite, Tailwind, i18next)
  src/locales/     vertalingen van de interface
  src/pages/       schermen
  src/components/  layout, Info-dialoog, UI-bouwstenen
install/           install.sh (Debian 13), update.sh, LXC-installscript
ct/                Proxmox LXC-script
deploy/systemd/    service- en updater-units
docs/en, docs/nl   handleidingen in het Engels en Nederlands
```

## Vertalingen en nieuwe talen

Alle teksten staan in vertaalbestanden; er staat geen tekst vast in de code.

| Waar | Bestanden |
| --- | --- |
| Webinterface | `web/src/locales/nl.ts`, `web/src/locales/en.ts` |
| Server (foutmeldingen, e-mails) | `server/src/i18n/nl.ts`, `server/src/i18n/en.ts` |
| Gastportaal | `server/src/shared/guestStrings.ts` |

Een taal toevoegen, bijvoorbeeld Duits:

1. Kopieer `web/src/locales/en.ts` naar `de.ts` en vertaal de teksten. TypeScript controleert dat er geen sleutel ontbreekt.
2. Registreer de taal in `web/src/i18n.ts` (lijst `languages` en `resources`).
3. Doe hetzelfde voor `server/src/i18n/` (bestand plus `locales` in `index.ts`).
4. Voeg de gastteksten toe aan `server/src/shared/guestStrings.ts`.
5. Voeg de handleidingen toe in `docs/de/`.

De taal van de interface volgt de keuze van de gebruiker (opgeslagen op het account), anders de browser. E-mails gaan in de taal van de ontvanger.

## Database wijzigen

1. Pas `server/src/db/schema.ts` aan.
2. `npm run db:generate -w server` maakt een nieuwe migratie in `server/drizzle/`.
3. Migraties draaien automatisch bij het starten van de app en tijdens updates.

## Controles

```bash
npm run typecheck
npm test
npm run build
```

GitHub Actions draait dezelfde controles bij elke push en pull request.

## Een release publiceren

1. Werk `CHANGELOG.md`, `CHANGELOG.nl.md`, `ROADMAP.md` en `ROADMAP.nl.md` bij.
2. Zet in de pull request de nieuwe versie in elke `package.json`:
   ```bash
   npm version 0.3.0 --workspaces --include-workspace-root --no-git-tag-version          # stable-kanaal
   npm version 0.3.0-beta.1 --workspaces --include-workspace-root --no-git-tag-version   # test-kanaal
   ```
3. Merge de pull request naar `main`.

De workflow **Release** ziet de nieuwe versie en maakt de tag `v<versie>` en de GitHub-release aan. Een versie met een streepje (`-beta.1`, `-rc.1`) wordt als pre-release gemarkeerd en verschijnt alleen in het **test**-kanaal. Binnen een paar minuten bieden installaties de update aan onder **Info & updates** (de controle wordt 10 minuten onthouden; **Controleren op updates** ververst hem). Zelf een tag `v<versie>` pushen werkt ook nog.

## Een route toevoegen aan de publieke API

De REST API op `/api/v1` hergebruikt de routes van de interface: `/api/v1/x` wordt herschreven naar `/api/x` en draait met een gebruiker die voor de sleutel staat. Een route is alleen met een sleutel bereikbaar als hij in `server/src/api/catalog.ts` staat, met een scope voor klanten (`tenant`), het platform (`platform`) of beide, een samenvatting in het Engels en Nederlands, en eventueel het zod-schema van de body voor de OpenAPI-beschrijving. De test `test/api.test.ts` controleert dat elke bewerking in de lijst bestaat.
