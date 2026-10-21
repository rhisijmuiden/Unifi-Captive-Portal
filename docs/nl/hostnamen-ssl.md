# Hostnamen en SSL

[English](../en/hostnames-ssl.md) · **Nederlands**

Elke klant kan zijn gastportal op een eigen hostnaam laten draaien, zoals `gast.bedrijf.nl`, en de platformbeheerder kan het beheerpaneel op een eigen hostnaam zetten, zoals `portal.jouwbedrijf.nl`. Beide krijgen automatisch een gratis Let's Encrypt-certificaat.

## Hoe het werkt

- **Caddy** draait op poort 80 en 443 van de server en stuurt alles door naar de applicatie op poort 8080. De installer richt dit in.
- Caddy vraagt het eerst aan de applicatie voordat hij een certificaat aanvraagt. De applicatie zegt alleen ja voor hostnamen die hier geregistreerd zijn **en** waarvan het DNS-record naar deze server wijst. Niemand kan de server dus certificaten laten aanvragen voor willekeurige namen.
- Certificaten worden automatisch vernieuwd, ruim voordat ze verlopen.

## Voor de platformbeheerder: eerste inrichting

1. Zorg dat poort **80 en 443** van de server bereikbaar zijn vanaf internet (port forward of firewallregel naar de server of LXC).
2. Open in het beheerpaneel **Systeem → Hosting & SSL**.
3. Vul het **publieke IPv4-adres** in (of klik op **Automatisch detecteren**). Vul IPv6 alleen in als de server echt via IPv6 bereikbaar is: Let's Encrypt kiest IPv6 zodra er een AAAA-record is.
4. Optioneel: vul een **hostnaam voor het beheerpaneel** in, maak het A-record aan en klik op **Opslaan en controleren**. Staat de status op *Actief met SSL*, open het paneel dan via `https://<hostnaam>`. Met **Altijd HTTPS gebruiken** aan worden bezoekers op `http://` doorgestuurd.
5. Gebruik je Microsoft SSO? Zet de nieuwe redirect-URL (`https://<hostnaam>/api/auth/entra/callback`, te zien onder **Single sign-on**) ook in de app-registratie in Entra.

Links in e-mails (uitnodigingen, wachtwoordherstel) en de SSO-redirect gebruiken de hostnaam van het beheerpaneel zodra die is ingesteld.

Wil je meldingen van Let's Encrypt over verlopende certificaten ontvangen, stel dan één keer een e-mailadres in:

```bash
CP_ACME_EMAIL=jij@bedrijf.nl bash /opt/captive-portal/install/caddy.sh
```

## Voor klanten: je eigen hostnaam

1. Open **Hostnamen & SSL** en voeg de hostnaam toe, bijvoorbeeld `gast.bedrijf.nl`.
2. Maak bij je domeinbeheerder het record aan dat op de pagina staat:

   | Type | Naam | Waarde |
   | --- | --- | --- |
   | A | gast.bedrijf.nl | het IP-adres van het platform |

   Gebruik geen proxy (zoals de oranje wolk van Cloudflare): het record moet rechtstreeks naar het platform wijzen.
3. Het platform controleert het record elke vijf minuten, of meteen als je op **Nu controleren** klikt. Klopt het, dan wordt het certificaat aangevraagd en wordt de status **Actief met SSL**, meestal binnen een paar minuten.
4. Zet de hostnaam in de **Pre-Authorization Allowances** in UniFi (zie [Een UniFi-console koppelen](unifi-koppelen.md)).

Vanaf dan worden gasten naar `https://gast.bedrijf.nl` gestuurd. Zonder actieve hostnaam werkt het portal via het IP-adres van het platform, zonder slotje.

## Statussen en meldingen

| Status | Betekenis |
| --- | --- |
| Wacht op controle | Net toegevoegd; de eerste controle volgt binnen enkele seconden |
| DNS klopt, certificaat wordt aangevraagd | Het record is goed; Caddy haalt het certificaat op |
| Actief met SSL | Klaar |
| Actie nodig | Zie de melding onder de hostnaam |

| Melding | Wat te doen |
| --- | --- |
| Er is nog geen A- of AAAA-record gevonden | Maak het record aan. Een nieuw record kan tot een paar uur nodig hebben om zichtbaar te worden. |
| Het record wijst naar … in plaats van naar deze server | Pas de waarde aan, of verwijder een oud AAAA-record. |
| Het certificaat is nog niet uitgegeven | Meestal tijdelijk (bijvoorbeeld limieten van Let's Encrypt). Het platform probeert het automatisch opnieuw. Controleer of poort 80 en 443 open staan. |
| De SSL-dienst (Caddy) reageert niet | Platformbeheerder: zie [Als Caddy niet reageert](#als-caddy-niet-reageert). |

## Als Caddy niet reageert

De kaart **SSL-dienst (Caddy)** onder **Hosting & SSL** laat zien of Caddy op poort 443 en 80 luistert en of het de configuratie van deze app gebruikt. Staat er iets op rood, voer dan als root op de server uit:

```bash
systemctl status caddy --no-pager        # draait Caddy?
journalctl -u caddy -n 50 --no-pager     # waarom is het gestopt?
ss -ltnp | grep -E ':(80|443) '          # wie luistert op 80/443?
bash /opt/captive-portal/install/caddy.sh  # Caddy installeren of herstellen
```

Het herstelscript installeert Caddy als het ontbreekt, schrijft de configuratie, weigert te starten als een andere webserver (zoals Apache of nginx) poort 80 of 443 bezet, en toont het log van Caddy als het niet opstart. Bij een LXC-container moeten poort 80 en 443 ook naar de container worden doorgestuurd.

## Eigen reverse proxy in plaats van Caddy

Installeer met `CP_CADDY=0` en stuur poort 80 en 443 zelf door naar `127.0.0.1:8080`. Geef de headers `X-Forwarded-For`, `X-Forwarded-Proto` en `Host` door, en alleen vanaf dezelfde machine (de app vertrouwt proxyheaders alleen van `127.0.0.1`). Je beheert de certificaten dan zelf; de hostnaamcontrole meldt *De SSL-dienst reageert niet* tenzij je proxy op poort 443 van dezelfde machine luistert.
