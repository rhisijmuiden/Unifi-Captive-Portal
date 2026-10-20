# Back-ups en herstel

> 🇬🇧 [English version](../en/backups.md)

De platformbeheerder maakt onder **Systeem → Back-ups** een back-up van het **hele platform**: de complete database (klanten, gebruikers, consoles, portalen, gasten, betalingen, facturen, instellingen en e-mailtemplates) en de datamap (`/var/lib/captive-portal`). Klanten zien deze pagina niet.

## In het kort

- **Volledige en incrementele back-ups.** Een volledige back-up bevat alles. Een incrementele back-up verstuurt alleen wat sinds de vorige back-up veranderd is: per databasetabel en per bestand. Een incrementele back-up terugzetten geeft altijd de complete stand van dat moment.
- **Locaties**: **SCP** (SSH, aanbevolen), **FTPS** (FTP met TLS 1.2 of nieuwer, expliciet of impliciet), gewone **FTP**, of een **lokale map** op de server als extra kopie.
- **Versleuteld** met AES-256-GCM en je eigen wachtwoord, voordat er iets de server verlaat. De back-upserver ziet nooit leesbare gegevens.
- **Schema per locatie**: een volledige back-up elke dag, week of maand op een vast uur, met tussendoor incrementele back-ups elk uur, elke 6 of 12 uur of elke dag. **Bewaren**: de nieuwste *n* volledige back-ups blijven staan; oudere, met hun incrementele, worden automatisch verwijderd.
- **Herstellen** vanaf de remote locatie, vanuit de webinterface, met een veiligheidskopie en automatische rollback.
- **E-mail bij een fout** naar de platformbeheerders (SMTP nodig). Het template *Back-up mislukt* pas je aan onder E-mailtemplates.

## 1. Wachtwoord instellen

Vul rechts op de pagina Back-ups twee keer een wachtwoord van minimaal 12 tekens in en klik op **Wachtwoord opslaan**.

> ⚠️ **Bewaar het wachtwoord in een wachtwoordmanager.** Zonder dit wachtwoord is geen enkele back-up terug te zetten, ook niet door RHIS. Een nieuw wachtwoord start op elke locatie een nieuwe volledige back-up; oudere back-ups houden hun oude wachtwoord.

## 2. Een locatie toevoegen

Klik op **Locatie toevoegen** en kies het type.

### SCP (SSH), aanbevolen

1. Maak op de back-upserver een gebruiker (bijvoorbeeld `backup`) en een map voor de back-ups.
2. Laat **Aanmelden met** op **SSH-sleutel van deze server** staan. Kopieer de publieke sleutel uit het formulier en zet hem in `~/.ssh/authorized_keys` van die gebruiker:
   ```bash
   sudo -u backup mkdir -p ~backup/.ssh
   echo 'ssh-ed25519 AAAA… captive-portal@server' | sudo -u backup tee -a ~backup/.ssh/authorized_keys
   ```
   Aanmelden met een wachtwoord kan ook.
3. Vul server, poort (22), gebruikersnaam en map in, bijvoorbeeld `/srv/backups/captive-portal`.
4. Klik op **Verbinding testen**. De vingerafdruk van de hostsleutel wordt getoond en onthouden; verandert die ooit, dan stoppen de back-ups met een duidelijke melding tot je in de instellingen van de locatie op **Vergeten** klikt.

De bestanden gaan over het bestandsoverdrachtkanaal van SSH (SFTP-subsysteem), dat elke server met SCP aanbiedt (OpenSSH, Synology, QNAP, TrueNAS, Hetzner Storage Box enzovoort).

### FTPS

Vul server, gebruikersnaam, wachtwoord en map in. **Expliciet** TLS (poort 21, `AUTH TLS`) gebruiken de meeste servers; kies **Impliciet** voor servers op poort 990. Laat **Certificaat controleren** aan, tenzij de server een zelfondertekend certificaat heeft dat je vertrouwt. Minimaal TLS 1.2 is vereist.

### FTP

Alleen voor een vertrouwd netwerk: het wachtwoord gaat onversleuteld over de lijn. De back-ups zelf zijn wel versleuteld.

### Lokale map

Een map binnen `/var/lib/captive-portal/backups/`. Handig als snelle extra kopie of als die map een gekoppelde netwerkschijf is, maar geen vervanging voor een externe back-up.

### Schema en bewaren

Standaard: elke zondag om 02:00 een volledige back-up en elke dag om 02:00 een incrementele, met 4 volledige back-ups bewaard (ongeveer een maand). Tijden zijn in de tijdzone van de server. Een mislukte back-up wordt na een half uur opnieuw geprobeerd. Zet **Automatische back-ups** uit om alleen met de hand te back-uppen met **Nu volledig** of **Nu incrementeel**.

## Wat zit er in een back-up

| Wel | Niet |
| --- | --- |
| De complete PostgreSQL-database | Veiligheidskopieën van updates en herstel (`backups/`) |
| De datamap `/var/lib/captive-portal` | Updatestatus (`update/`) en werkmappen |
| `APP_SECRET` (nodig om opgeslagen wachtwoorden en API-sleutels te lezen) | De applicatie zelf (komt van GitHub) |
| | De certificaten van Caddy (worden vanzelf opnieuw aangevraagd) |

Op de locatie is elke back-up een map zoals `cp-20261020-020000-full` met `info.json` (type, datum en versie, niets geheims), `manifest.bin` (versleutelde inhoudsopgave) en `objects/` (versleutelde, gecomprimeerde inhoud). Een incrementele map bevat alleen de nieuwe inhoud en verwijst voor de rest naar oudere mappen. Verwijder dus nooit losse mappen met de hand: het opruimen verwijdert altijd hele reeksen.

## Herstellen

1. Open **Back-ups & herstel** bij de locatie.
2. Kies het moment waarnaar je terug wilt en klik op **Herstellen**.
3. Lees de waarschuwingen, vink het vakje aan en klik op **Nu herstellen**. Alleen voor een back-up met een ander wachtwoord (bijvoorbeeld van een andere server) vul je dat wachtwoord in.

Wat er gebeurt:

1. Het wachtwoord wordt meteen gecontroleerd. Een back-up van een **nieuwere versie** wordt geweigerd: werk deze server eerst bij.
2. De app downloadt de back-up (en de oudere back-ups waarop hij voortbouwt), ontsleutelt hem en controleert elk deel met zijn SHA-256-checksum.
3. De systeemservice (als root, net als bij updates) stopt Captive Portal en bewaart de huidige stand in `/var/lib/captive-portal/backups/pre-restore-<datum>…` (30 dagen).
4. De database wordt **in één transactie** vervangen: gaat er iets mis, dan blijft de huidige database zoals hij was.
5. De datamap en `APP_SECRET` worden teruggezet en de service start. Databasemigraties werken een back-up van een oudere versie bij.
6. Komt de service niet gezond op, dan wordt de vorige stand automatisch teruggezet.

De pagina toont de voortgang en maakt na de herstart vanzelf weer verbinding. Gebruikers, sessies en wachtwoorden komen uit de back-up, dus misschien moet je opnieuw aanmelden met een account uit de back-up. Log: `/var/log/captive-portal-restore.log`.

### Na een calamiteit op een nieuwe server

1. Installeer Captive Portal op de nieuwe server ([installatie](installatie.md)) en maak een tijdelijk beheerdersaccount.
2. Stel onder **Back-ups** hetzelfde wachtwoord in (of vul het in bij het herstellen) en voeg de locatie met de back-ups toe.
3. Zet de nieuwste back-up terug. Alles komt terug, ook `APP_SECRET`, klanten, hostnamen en instellingen.
4. Laat de DNS-records van het beheerpaneel en de hostnamen van klanten naar de nieuwe server wijzen; Caddy vraagt zelf nieuwe certificaten aan.

## Problemen oplossen

| Melding | Wat te doen |
| --- | --- |
| *Verbinden lukte niet* | Controleer server, poort, firewall en inloggegevens met **Verbinding testen**. |
| *De SSH-hostsleutel … is veranderd* | Verwacht na een herinstallatie van de back-upserver? Klik op **Vergeten** naast de hostsleutel en test opnieuw. Anders eerst uitzoeken waarom. |
| *Het wachtwoord past niet bij deze back-up* | De back-up is met een ander wachtwoord gemaakt; vul dat in bij *Ander wachtwoord*. |
| *Deze back-up is gemaakt met versie x* | Werk deze server eerst bij naar minimaal die versie. |
| *Herstellen vanuit de interface staat niet aan* | Alleen op installaties die met de installer gemaakt zijn (die stelt de updateservice in). |
