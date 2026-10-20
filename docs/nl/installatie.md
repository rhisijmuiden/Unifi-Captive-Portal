# Installatie

> 🇬🇧 [English version](../en/installation.md)

Captive Portal draait op **Debian 13 (Trixie)**, als Proxmox LXC of op een VM of fysieke server. De webinterface luistert op **poort 8080**.

## Systeemeisen

| | Minimaal | Aanbevolen |
| --- | --- | --- |
| CPU | 1 core | 2 cores |
| Geheugen | 1 GB | 2 GB (het bouwen tijdens installatie en updates gebruikt het meest) |
| Schijf | 4 GB | 8 GB of meer, afhankelijk van back-ups |
| Netwerk | Uitgaand HTTPS naar GitHub, NodeSource en Debian | Vast IP-adres |

## Optie 1: Proxmox LXC

Voer dit uit in de shell van je **Proxmox-host**:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/ct/captive-portal.sh)"
```

Het script gebruikt dezelfde engine als het [community-scripts Debian-script](https://github.com/community-scripts/ProxmoxVE/blob/main/ct/debian.sh). Je krijgt dezelfde keuzemenu's (standaard of geavanceerd: ID, opslag, netwerk, VLAN). Standaard maakt het een unprivileged Debian 13 container met 2 cores, 2 GB RAM en 8 GB schijf, en installeert daarin Captive Portal.

Bijwerken van de container kan later door hetzelfde commando opnieuw uit te voeren **in de container**, of via **Info & updates** in de webinterface.

## Optie 2: Debian 13 VM of fysieke server

Installeer een kale Debian 13 (zonder desktop), log in als root (of gebruik `sudo -i`) en voer uit:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/install/install.sh)"
```

De installer:

1. installeert PostgreSQL, Node.js 24 LTS (NodeSource), git en hulpprogramma's;
2. haalt de nieuwste versie op naar `/opt/captive-portal`;
3. maakt een database en een willekeurig wachtwoord en geheime sleutel aan;
4. bouwt de applicatie en voert databasemigraties uit;
5. installeert de systemd-services `captive-portal` en `captive-portal-updater.path`;
6. controleert of de webinterface reageert.

De installer kun je veilig opnieuw draaien; bestaande instellingen en gegevens blijven staan.

### Opties

| Variabele | Betekenis | Standaard |
| --- | --- | --- |
| `CP_REF` | Versie (tag) of branch om te installeren, bijv. `v0.1.0` | nieuwste release, anders `main` |
| `CP_PUBLIC_URL` | Adres waarop de beheeromgeving bereikbaar is | `http://<server-ip>:8080` |
| `CP_NODE_MAJOR` | Node.js-hoofdversie | `24` |

Voorbeeld: `CP_PUBLIC_URL=https://portal.rhis.nl bash -c "$(curl -fsSL …/install/install.sh)"`

## Eerste start

1. Open `http://<ip-van-de-server>:8080`.
2. Maak het eerste **platformbeheerder**-account aan.
3. Stel onder **Systeem → E-mail (SMTP)** je mailserver in, zodat uitnodigingen en wachtwoordherstel werken. Zie [smtp.md](smtp.md).
4. Optioneel: zet onder **Systeem → Single sign-on** Microsoft Entra aan. Zie [entra-sso.md](entra-sso.md).
5. Voeg onder **Klanten** je eerste klant toe en nodig een klantbeheerder uit.

## Bestanden en services

| Pad | Inhoud |
| --- | --- |
| `/opt/captive-portal` | Applicatie (git-checkout van een release) |
| `/etc/captive-portal/captive-portal.env` | Configuratie: database, geheime sleutel, publieke URL |
| `/var/lib/captive-portal` | Gegevens: update-status, back-ups |
| `/var/log/captive-portal-update.log` | Logboek van updates |

```bash
systemctl status captive-portal          # draait de app?
journalctl -u captive-portal -f          # live logboek
systemctl restart captive-portal         # herstarten na wijziging van de configuratie
```

Wijzig je `PUBLIC_URL` (bijvoorbeeld omdat je een domeinnaam met HTTPS gaat gebruiken), pas dan ook de redirect-URI in je Entra-app-registratie aan.

> **Let op:** bewaar `APP_SECRET` uit het configuratiebestand goed. Daarmee worden opgeslagen wachtwoorden (SMTP, SSO) versleuteld; zonder die sleutel kunnen ze na een herstel niet meer worden gelezen.
