# Development and releases

> 🇳🇱 [Nederlandse versie](../nl/ontwikkelen.md)

## Running locally

Requires Node.js 22 or newer and PostgreSQL.

```bash
sudo -u postgres psql -c "create user captive with password 'captive'" -c "create database captive owner captive"
cp .env.example .env          # change APP_SECRET
npm install
npm run dev                   # API on :8080, Vite on :5173 (proxies to the API)
```

Open http://localhost:5173. The setup wizard starts the first time.

## Project layout

```
server/            Fastify API (TypeScript)
  src/routes/      API endpoints: auth, tenants, users, settings, system
  src/services/    mailer, Entra SSO, settings, updater, tokens
  src/i18n/        server translations (errors, e-mails)
  src/db/          Drizzle schema and migrations (server/drizzle/)
  test/            unit tests (node --test)
web/               React admin interface (Vite, Tailwind, i18next)
  src/locales/     interface translations
  src/pages/       screens
  src/components/  layout, Info dialog, UI building blocks
install/           install.sh (Debian 13), update.sh, LXC install script
ct/                Proxmox LXC script
deploy/systemd/    service and updater units
docs/en, docs/nl   guides in English and Dutch
```

## Translations and new languages

All text lives in translation files; nothing is hard-coded.

| Where | Files |
| --- | --- |
| Web interface | `web/src/locales/nl.ts`, `web/src/locales/en.ts` |
| Server (errors, e-mails) | `server/src/i18n/nl.ts`, `server/src/i18n/en.ts` |

To add a language, for example German:

1. Copy `web/src/locales/en.ts` to `de.ts` and translate it. TypeScript checks that no key is missing.
2. Register the language in `web/src/i18n.ts` (the `languages` list and `resources`).
3. Do the same in `server/src/i18n/` (file plus `locales` in `index.ts`).
4. Add the guides in `docs/de/`.

The interface language follows the user's choice (saved on the account), otherwise the browser. E-mails are sent in the recipient's language.

## Changing the database

1. Edit `server/src/db/schema.ts`.
2. `npm run db:generate -w server` creates a new migration in `server/drizzle/`.
3. Migrations run automatically when the app starts and during updates.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

GitHub Actions runs the same checks on every push and pull request.

## Publishing a release

1. Update `CHANGELOG.md`, `CHANGELOG.nl.md`, `ROADMAP.md` and `ROADMAP.nl.md`.
2. Set the new version in every `package.json` in the pull request:
   ```bash
   npm version 0.3.0 --workspaces --include-workspace-root --no-git-tag-version          # stable channel
   npm version 0.3.0-beta.1 --workspaces --include-workspace-root --no-git-tag-version   # test channel
   ```
3. Merge the pull request into `main`.

The **Release** workflow sees the new version, creates the tag `v<version>` and the GitHub release. A version with a dash (`-beta.1`, `-rc.1`) is marked as a pre-release and only shows up in the **test** channel. Within a few minutes installations offer the update under **Info & updates** (the check is cached for 10 minutes; **Check for updates** refreshes it). Pushing a tag `v<version>` by hand still works.
