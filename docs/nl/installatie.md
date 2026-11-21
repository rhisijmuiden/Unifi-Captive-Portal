# Installatie

> 🇬🇧 [English version](../en/installation.md)

Captive Portal draait op **Debian 13 (Trixie)**: als Proxmox-container (LXC), op een VM of op een fysieke server. Er zijn drie manieren om te installeren; alle drie eindigen hetzelfde. De console toont **alleen het webadres, de gebruikersnaam en een gegenereerd wachtwoord**, en al het andere stel je in de webinterface in.

```
------------------------------------------------------------
  Captive Portal 1.0.1 (RHIS)
------------------------------------------------------------

  Web interface : http://192.168.1.50:8080
  Username      : admin
  Password      : aYvjk-CaYUv-m7Cd3-jFn7Q

  Sign in and choose your own password; all further
  configuration happens in the web interface.
------------------------------------------------------------
```

## Systeemeisen

| | Minimaal | Aanbevolen |
| --- | --- | --- |
| CPU | 1 core | 2 cores |
| Geheugen | 1 GB | 2 GB (het bouwen tijdens installatie en updates gebruikt het meest) |
| Schijf | 4 GB | 8 GB of meer, afhankelijk van back-ups |
| Netwerk | Uitgaand HTTPS naar GitHub, NodeSource en Debian | Vast IP-adres |

## Optie 1: Proxmox CT-template (aanbevolen voor Proxmox)

Bij elke release hoort een kant-en-klaar **CT-template**: Debian 13 met Captive Portal al geïnstalleerd. Je downloadt het in Proxmox zelf en maakt er een container van; je hoeft niets in een shell te typen.

**1. Template downloaden**

1. Open in de Proxmox-webinterface je opslag voor templates (meestal **local**) en ga naar **CT Templates**.
2. Klik op **Download from URL** en plak:

   | Versie | URL |
   | --- | --- |
   | Nieuwste **stabiele** versie | `https://github.com/rhisijmuiden/Unifi-Captive-Portal/releases/latest/download/captive-portal-debian-13-amd64.tar.zst` |
   | Een bepaalde (bijv. **test**)versie | `https://github.com/rhisijmuiden/Unifi-Captive-Portal/releases/download/v1.0.1-beta.5/captive-portal-debian-13-amd64.tar.zst` (versie aanpassen) |

3. Klik op **Query URL**. Je mag de bestandsnaam aanpassen, bijvoorbeeld naar `captive-portal-1.0.1-debian-13-amd64.tar.zst`, zodat je versies later uit elkaar houdt.
4. Optioneel maar aangeraden: kies hash-algoritme **SHA-256** en plak de checksum uit het `.sha256`-bestand naast het template op de [releasepagina](https://github.com/rhisijmuiden/Unifi-Captive-Portal/releases).
5. Klik op **Download**.

**2. Container aanmaken**

1. Klik rechtsboven op **Create CT**.
2. **General**: hostnaam (bijv. `captive-portal`), een root-wachtwoord, laat **Unprivileged container** en **Nesting** aan staan.
3. **Template**: kies het Captive Portal-template dat je hebt gedownload.
4. **Disk** 8 GB, **CPU** 2 cores, **Memory** 2048 MB.
5. **Network**: DHCP of een vast IP-adres (aangeraden, want UniFi-consoles en DNS-records wijzen ernaar).
6. Vink **Start after created** aan en klik op **Finish**.

**3. Console openen**

Bij de eerste start richt de container zichzelf in: eigen geheime sleutels en databasewachtwoord, de database, HTTPS (Caddy) en de hoofdbeheerder. Dat duurt ongeveer een minuut en heeft geen internet nodig. Daarna toont de **Console** van de container het webadres, de gebruikersnaam en het wachtwoord zoals hierboven. Staat er nog dat de installatie bezig is, druk dan op Enter om te verversen.

Liever de opdrachtregel op de Proxmox-host? Dit doet hetzelfde:

```bash
pvesh create /nodes/$(hostname)/storage/local/download-url --content vztmpl \
  --filename captive-portal-debian-13-amd64.tar.zst \
  --url https://github.com/rhisijmuiden/Unifi-Captive-Portal/releases/latest/download/captive-portal-debian-13-amd64.tar.zst
pct create 120 local:vztmpl/captive-portal-debian-13-amd64.tar.zst --hostname captive-portal \
  --cores 2 --memory 2048 --rootfs local-lvm:8 --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 --features nesting=1 --start 1
pct exec 120 -- captive-portal-admin     # webadres en inloggegevens
```

> **Waarom "Download from URL" en niet de lijst onder Templates?** De knop **Templates** in Proxmox toont alleen de templates van Proxmox en TurnKey Linux; daar kun je geen eigen bron aan toevoegen. **Download from URL** in hetzelfde scherm CT Templates is de ondersteunde manier voor elk ander template.

## Optie 2: Proxmox-hulpscript

Voer dit uit in de shell van je **Proxmox-host**:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/ct/captive-portal.sh)"
```

Het script gebruikt dezelfde engine als het [community-scripts Debian-script](https://github.com/community-scripts/ProxmoxVE/blob/main/ct/debian.sh), met dezelfde keuzemenu's (standaard of geavanceerd: ID, opslag, netwerk, VLAN). Het maakt een unprivileged Debian 13 container met 2 cores, 2 GB RAM en 8 GB schijf, installeert daarin Captive Portal en eindigt met het webadres en de inloggegevens.

## Optie 3: kale Debian 13 (fysieke server, VM of container)

Installeer een minimale Debian 13 (zonder desktop; kies in de installer alleen *SSH server* en *standaard systeemhulpmiddelen*), log in als root en voer uit:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/install/install.sh)"
```

Een minimale Debian heeft geen `curl`; gebruik dan `wget`:

```bash
bash -c "$(wget -qO- https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/install/install.sh)"
```

Dit werkt net zo in een LXC-container (Proxmox, Incus/LXD) of systemd-nspawn. De machine heeft **systemd** nodig, dus gewone Docker-containers worden niet ondersteund; daarvoor is er een Dockerfile, zie [Ontwikkelen](ontwikkelen.md).

De installer toont één regel per stap en bewaart de details in `/var/log/captive-portal-install.log`:

1. installeert PostgreSQL, Node.js 24 LTS (NodeSource), git en hulpprogramma's;
2. haalt de nieuwste stabiele versie op naar `/opt/captive-portal` en bouwt die;
3. maakt een database met een willekeurig wachtwoord en een geheime sleutel aan;
4. installeert en start de services;
5. installeert **Caddy** op poort 80 en 443 voor HTTPS met automatische Let's Encrypt-certificaten (zie [hostnamen-ssl.md](hostnamen-ssl.md));
6. maakt de hoofdbeheerder aan met een gegenereerd wachtwoord;
7. maakt het scherm leeg en toont alleen het webadres en de inloggegevens.

Je kunt de installer gerust opnieuw uitvoeren; bestaande instellingen, gegevens en accounts blijven behouden.

In een container zonder *nesting* kan systemd de service niet afschermen. De installer merkt dat en start hem zonder die extra bescherming (`/etc/systemd/system/captive-portal.service.d/50-container.conf`); zet nesting aan en verwijder dat bestand om hem terug te krijgen.

### Opties

| Variabele | Betekenis | Standaard |
| --- | --- | --- |
| `CP_REF` | Versie (tag) of branch om te installeren, bijv. `v1.0.1` | nieuwste stabiele release, anders `main` |
| `CP_CHANNEL` | `test` = nieuwste versie inclusief testversies (zonder `CP_REF`) | `stable` |
| `CP_REPO_URL` | Git-repository om van te installeren: een fork, of een lokale git-bundel (zie [Ontwikkelen](ontwikkelen.md#een-niet-gepubliceerde-versie-testen)) | dit project op GitHub |
| `CP_PUBLIC_URL` | Adres waarop de beheerinterface bereikbaar is | `http://<server-ip>:8080` |
| `CP_NODE_MAJOR` | Node.js hoofdversie | `24` |
| `CP_ACME_EMAIL` | E-mailadres voor verloopmeldingen van Let's Encrypt | leeg |
| `CP_CADDY` | `0` = Caddy niet installeren (als je een eigen reverse proxy gebruikt) | `1` |
| `CP_KEEP_SCREEN` | `1` = scherm niet leegmaken voor de inloggegevens | `0` |

Voorbeeld: `CP_CHANNEL=test bash -c "$(curl -fsSL …/install/install.sh)"`

## Eerste keer inloggen

1. Open het webadres van de console en log in met gebruikersnaam `admin` en het getoonde wachtwoord.
2. Vul je **naam** en **e-mailadres** in en kies je eigen wachtwoord. Daarna log je in met dat e-mailadres en toont de console het wachtwoord niet meer.
3. De lijst **Aan de slag** op het overzicht leidt je door de rest:
   - **Systeem → E-mail (SMTP)**: je mailserver, zodat uitnodigingen en wachtwoordherstel werken. Zie [smtp.md](smtp.md).
   - **Systeem → Single sign-on**: optioneel Microsoft Entra. Zie [entra-sso.md](entra-sso.md).
   - **Systeem → Hosting & SSL**: het publieke IP-adres en eventueel een HTTPS-hostnaam voor het beheerpaneel. Zie [hostnamen-ssl.md](hostnamen-ssl.md).
   - **Klanten**: je eerste klant met een klantbeheerder (uitnodigen per e-mail of inloggegevens genereren, zie [beveiliging.md](beveiliging.md#inloggegevens-voor-nieuwe-gebruikers)). De klant koppelt zijn console zoals beschreven in [unifi-koppelen.md](unifi-koppelen.md).

Poorten: **8080** (beheerpaneel, ook rechtstreeks), **80** en **443** (Caddy: gastportalen en HTTPS). Stuur 80 en 443 vanaf internet door naar de server.

De interface volgt de taal van de browser; iedere gebruiker kan die onderaan het menu of onder **Mijn account** wijzigen.

### Wachtwoord van de beheerder kwijt?

Log op de console van de server (of via SSH) in als root en voer uit:

```bash
captive-portal-admin                          # webadres, plus de inloggegevens zolang het gegenereerde wachtwoord niet is gewijzigd
captive-portal-admin reset-password           # nieuw gegenereerd wachtwoord voor de eerste hoofdbeheerder
captive-portal-admin reset-password jij@voorbeeld.nl
```

Het nieuwe wachtwoord verschijnt op de console en moet bij de volgende keer inloggen worden gewijzigd.

## Bestanden en services

| Pad | Inhoud |
| --- | --- |
| `/opt/captive-portal` | Applicatie (git-checkout van een release) |
| `/etc/captive-portal/captive-portal.env` | Configuratie: database, geheime sleutel, publieke URL |
| `/var/lib/captive-portal` | Gegevens: update-status, back-ups, consolebanner |
| `/var/log/captive-portal-install.log` | Logboek van de installer |
| `/var/log/captive-portal-update.log` | Logboek van updates |
| `/etc/caddy/Caddyfile` | Configuratie van Caddy (beheerd door de installer) |
| `/etc/captive-portal/caddy.env` | E-mailadres voor Let's Encrypt |

```bash
systemctl status captive-portal          # draait de app?
journalctl -u captive-portal -f          # live logboek
systemctl restart captive-portal         # herstarten na wijziging van de configuratie
journalctl -u captive-portal-firstboot   # eerste start van een container uit het template
```

Wijzig je `PUBLIC_URL` (bijvoorbeeld omdat je een domeinnaam met HTTPS gaat gebruiken), pas dan ook de redirect-URI in je Entra-app-registratie aan.

> **Let op:** bewaar `APP_SECRET` uit het configuratiebestand goed. Daarmee worden opgeslagen wachtwoorden (SMTP, SSO) versleuteld; zonder die sleutel kunnen ze na een herstel niet meer worden gelezen.

## Hoe het template gemaakt wordt

De release-workflow bouwt het template op GitHub bij elke nieuwe versie (`ct/build-template.sh`): het begint met Proxmox' eigen `debian-13-standard`-template (gecontroleerd met de SHA-512 van Proxmox), voert de installer uit in bouwmodus (alleen software, geen geheimen) en pakt het resultaat in. Een container die ervan gemaakt is draait eenmalig `captive-portal-firstboot.service`, die dezelfde installer in configuratiemodus uitvoert. Updates gaan daarna via **Info & updates**, net als bij elke andere installatie.

Zelf een template maken voor een bestaande release: **Actions → Release → Run workflow** met de tag, of op een willekeurige Linux-machine met root: `sudo ct/build-template.sh --ref v1.0.1`.
