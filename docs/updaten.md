# Updaten en releasekanalen

## Releasekanalen

| Kanaal | Wat je krijgt | Voor wie |
| --- | --- | --- |
| **Stable** | Alleen geteste releases, zoals `1.2.0` | Productie, klantomgevingen |
| **Test** | Ook testversies, zoals `1.3.0-beta.1`, zodat je nieuwe functies eerder ziet | Testserver of demo-omgeving |

Het testkanaal ziet ook alle stable-releases, dus je loopt nooit achter. Je kiest het kanaal in **Info & updates** (onderaan het menu links). Alleen platformbeheerders zien deze opties.

## Updaten vanuit de webinterface

1. Klik linksonder op **Info & updates**.
2. Kies het kanaal en klik op **Controleren op updates**.
3. Laat **Volledige installatie bijwerken** aan staan om ook Debian, PostgreSQL en Node.js bij te werken (apt). Zet het uit om alleen de applicatie te updaten.
4. Klik op **Updaten naar x.y.z**. Is er geen nieuwe versie, dan kun je met **Systeempakketten bijwerken** alleen Debian bijwerken.

Tijdens de update zie je de voortgang en de laatste regels van het logboek. De applicatie herstart aan het einde; de pagina werkt daarna gewoon verder.

### Wat er gebeurt

1. Er wordt een **back-up van de database** gemaakt in `/var/lib/captive-portal/backups/pre-update-<versie>-<datum>.sql.gz` (30 dagen bewaard).
2. Optioneel: `apt full-upgrade` van het systeem.
3. De nieuwe versie wordt opgehaald, gebouwd en de databasemigraties worden uitgevoerd.
4. De service herstart en er wordt gecontroleerd of hij reageert.
5. **Mislukt dat**, dan worden de vorige versie en de database-back-up automatisch teruggezet.

De webapplicatie zelf draait nooit als root. Hij schrijft alleen een update-aanvraag naar `/var/lib/captive-portal/update/request.json`; de systemd-unit `captive-portal-updater.path` ziet die en start de updater als root. De updater leest uit dat bestand alleen een versienummer en een ja/nee voor systeempakketten.

## Updaten vanuit de terminal

```bash
captive-portal-update                    # nieuwste stable-versie
captive-portal-update --channel test     # nieuwste versie inclusief testversies
captive-portal-update 0.2.0              # specifieke versie
captive-portal-update --system           # ook Debian-pakketten bijwerken
```

Het logboek staat in `/var/log/captive-portal-update.log`.

## Handmatig terugzetten

```bash
cd /opt/captive-portal
git checkout v0.1.0                       # gewenste versie
captive-portal-update 0.1.0
# database terugzetten uit een back-up:
sudo -u postgres psql -d captive -c 'DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public AUTHORIZATION captive;'
set -a; . /etc/captive-portal/captive-portal.env; set +a
gunzip -c /var/lib/captive-portal/backups/pre-update-….sql.gz | psql "$DATABASE_URL"
systemctl restart captive-portal
```
