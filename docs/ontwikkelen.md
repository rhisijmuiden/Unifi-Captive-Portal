# Ontwikkelen en releasen

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
  src/routes/      API-endpoints: auth, tenants, users, settings, system
  src/services/    mailer, Entra SSO, instellingen, updater, tokens
  src/db/          Drizzle-schema en migraties (server/drizzle/)
  test/            unit tests (node --test)
web/               React-beheeromgeving (Vite, Tailwind)
  src/pages/       schermen
  src/components/  layout, Info-dialoog, UI-bouwstenen
install/           install.sh (Debian 13), update.sh, LXC-installscript
ct/                Proxmox LXC-script
deploy/systemd/    service- en updater-units
docs/              handleidingen
```

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

1. Werk `CHANGELOG.md` en `ROADMAP.md` bij.
2. Zet het versienummer in alle `package.json`-bestanden:
   ```bash
   npm version 0.2.0 --workspaces --include-workspace-root --no-git-tag-version
   git commit -am "Release 0.2.0"
   ```
3. Tag en push:
   ```bash
   git tag v0.2.0 && git push origin main v0.2.0           # stable-kanaal
   git tag v0.3.0-beta.1 && git push origin v0.3.0-beta.1  # testkanaal
   ```

De workflow **Release** maakt de GitHub-release aan. Een tag met een streepje (`-beta.1`, `-rc.1`) wordt als pre-release gemarkeerd en verschijnt alleen in het **test**-kanaal.
