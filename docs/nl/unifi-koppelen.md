# Een UniFi-console koppelen

[English](../en/unifi-setup.md) · **Nederlands**

Met deze handleiding koppel je een UniFi OS console aan je klantomgeving en stuur je de gasten van een wifi-netwerk naar je captive portal. Het kost ongeveer tien minuten.

## Hoe het werkt

1. Een gast maakt verbinding met je gastenwifi. UniFi houdt het apparaat tegen en stuurt de browser naar de **external portal server**: het adres van dit platform.
2. Het platform herkent je bedrijf aan het access point waarmee de gast verbonden is, en toont **jouw** portal.
3. Klikt de gast op **Verbinden**, dan vraagt het platform je console via de officiële UniFi Network API om het apparaat door te laten, met jouw limieten voor tijd, data en snelheid.

Het platform bereikt je console op een van drie manieren:

| Manier | Wanneer | Nodig |
| --- | --- | --- |
| **UniFi Site Manager** (aanbevolen) | Elke UniFi OS console die aan je UI-account gekoppeld is | UniFi OS 5.0.3 of nieuwer, UniFi Network 9.1 of nieuwer, een Site Manager API-sleutel |
| **Rechtstreeks** | Zelf gehoste UniFi Network-applicatie, of als je geen cloudtoegang wilt | UniFi Network 9.1 of nieuwer, een lokale API-sleutel, en het platform moet de console via HTTPS kunnen bereiken |
| **UniFi Fabric** | Je consoles zijn lid van een [UniFi Fabric](#unifi-fabric) (of één Site Manager-organisatie) | Dezelfde versies als bij Site Manager, en één API-sleutel die in de Fabric of organisatie is aangemaakt |

## Ondersteunde consoles

Alle UniFi OS consoles met UniFi Network 9.1 of nieuwer werken op dezelfde manier:

| Console | Opmerkingen |
| --- | --- |
| Cloud Gateway Ultra / Max (UCG) | Site Manager of rechtstreeks |
| Dream Machine, Dream Machine Pro, Pro Max, SE (UDM) | Site Manager of rechtstreeks |
| Dream Router (UDR, UDR7) | Site Manager of rechtstreeks |
| Cloud Gateway Fiber / Enterprise (UCG-Fiber, EFG) | Site Manager of rechtstreeks |
| Cloud Key Gen2 / Gen2 Plus (UCK-G2) | Site Manager of rechtstreeks |
| UniFi OS Server / zelf gehoste UniFi Network-applicatie | Rechtstreeks (Site Manager alleen als de server aan je UI-account gekoppeld is) |

Je ziet de versies onder **UniFi OS → Instellingen → Control Plane → Updates** en in de Network-applicatie onder **Instellingen → Systeem**. Werk eerst bij als ze ouder zijn.

## Stap 1: Maak een API-sleutel

### Site Manager (aanbevolen)

1. Log in op [unifi.ui.com](https://unifi.ui.com) met het account dat eigenaar is van de console.
2. Open **API** in het menu links (bij sommige accounts onder **Settings → API**).
3. Klik op **Create API Key**, geef hem een naam zoals `Captive Portal` en kopieer de sleutel. Je ziet hem maar één keer.

### Rechtstreeks

1. Open de UniFi Network-applicatie op de console (`https://<adres-console>`).
2. Ga naar **Instellingen → Control Plane → Integraties**.
3. Maak een API-sleutel aan met de naam `Captive Portal` en kopieer hem.
4. Zorg dat het platform `https://<adres-console>` kan bereiken (poort 443). Via internet betekent dat meestal een VPN, of een port forward die alleen het IP-adres van het platform toelaat.

## Stap 2: Koppel de console in het platform

1. Open **UniFi-consoles** en klik op **Console koppelen**.
2. Kies **Via UniFi Site Manager** of **Rechtstreeks** en klik op **Volgende**. Consoles in een UniFi Fabric? Kies **Via een UniFi Fabric** en volg [UniFi Fabric](#unifi-fabric).
3. Plak de API-sleutel.
   - Site Manager: klik op **Consoles zoeken** en kies je console.
   - Rechtstreeks: vul het adres van de console in, bijvoorbeeld `https://192.168.1.1`. Zet **Certificaat controleren** uit zolang de console nog het standaard zelfondertekende certificaat gebruikt.
4. Klik op **Verbinding testen**, kies de site(s) waar je gastennetwerk bij hoort en klik op **Koppelen**.

Het platform haalt nu je access points op. Die lijst wordt elk uur bijgewerkt; heb je access points toegevoegd, klik dan op de verversknop op de kaart van de console.

## UniFi Fabric

Een UniFi Fabric bundelt veel sites en consoles onder één organisatie in Site Manager. Het platform koppelt een Fabric met **één** API-sleutel en bereikt elke console via dezelfde Site Manager-cloudverbinding, dus op de consoles hoeft niets opengezet te worden.

### Maak de sleutel

1. Log in op [unifi.ui.com](https://unifi.ui.com) en open de **organisatie van je Fabric** (linksboven).
2. Ga naar **Settings → API Keys** (of **API** in het menu) en klik op **Create API Key**.
3. Geef de sleutel toegang tot **Site Manager** en **Network**, en tot **alle sites** die het portaal gaan gebruiken. Kopieer de sleutel; je ziet hem maar één keer.

De sleutel moet zijn aangemaakt door de **eigenaar** van de consoles of in de organisatie zelf. Een sleutel van een uitgenodigde beheerder geeft *user is not the owner of this host*, of laat consoles gewoon weg. Het platform laat dan een duidelijke melding zien dat je de sleutel als eigenaar moet aanmaken.

### Koppel de Fabric

1. Open **UniFi-consoles**, klik op **Console koppelen** en kies **Via een UniFi Fabric**.
2. Vul een naam in (bijvoorbeeld de naam van de Fabric), plak de sleutel en klik op **Sleutel controleren**.
3. Vink de consoles aan waarvan de gasten via dit portaal gaan (of **Alles selecteren**) en klik op **Consoles koppelen**. Elke console wordt gekoppeld met al zijn sites; met de potloodknop kun je daarna per console de sites aanpassen.

De Fabric krijgt een eigen kaart op de pagina **UniFi-consoles**:

- **Sleutel één keer vervangen**: bewerk de Fabric en plak de nieuwe sleutel. Die wordt eerst gecontroleerd en daarna gebruikt door alle consoles van de Fabric. Een console van een Fabric heeft geen eigen sleutelveld.
- **Nieuwe consoles**: het platform controleert de Fabric elke 30 minuten. Komt er een console bij die nog niet gekoppeld is, dan toont de kaart *1 console nog niet gekoppeld* met een knop **Consoles koppelen**, krijg je een e-mail (uit te zetten onder **Meldingen → Nieuwe console in een Fabric**) en wordt de webhook-gebeurtenis `fabric.console_found` verstuurd.
- **Ontkoppelen**: verwijder je de Fabric, dan worden ook zijn consoles ontkoppeld.

### Hotspot-instellingen in een Fabric

Een Fabric kan via **Canvas** instellingen afdwingen op zijn sites (bijvoorbeeld hetzelfde wifi-netwerk op elke site). Instellingen die Canvas beheert, kun je niet meer wijzigen in de Network-applicatie van een site.

- Wordt de gastenwifi door Canvas beheerd, zet dan **Hotspot** voor dat netwerk aan in de Fabric.
- Stel het hotspotportaal (*External portal server*, pre-authorization) in zoals bij stap 3 hieronder, op elke site. Gebruik je een **Blueprint** voor nieuwe sites? Stel het dan in op de bronsite van de Blueprint, zodat nieuwe sites het meteen goed hebben.

## Stap 3: Stel het gastennetwerk in UniFi in

De menunamen verschillen per Network-versie een beetje; de stappen zijn hetzelfde.

1. Open in UniFi Network **Instellingen → WiFi** en maak het gastennetwerk aan (of bewerk het).
2. Zet **Hotspot** aan (soms **Guest Hotspot** of **Hotspot Portal**).
3. Open **Hotspot Manager** (of **Insights → Hotspot**) en kies de portalinstellingen:
   - **Authenticatie**: *External Portal Server*.
   - **External portal server**: het adres op de pagina **UniFi-consoles** onder *External portal server* (het publieke IP-adres van het platform).
   - **HTTPS-redirect**: uit. Gasten komen eerst via HTTP binnen; het platform stuurt ze door naar je HTTPS-hostnaam.
4. Voeg onder **Pre-Authorization Allowances** (ook *Authorized access* of *Allowed hosts*) toe:
   - het IP-adres van het platform, en
   - je portal-hostnaam uit **Hostnamen & SSL**, bijvoorbeeld `gast.bedrijf.nl`.
   - Optioneel, voor betalingen of inloggen met Facebook: de hosts uit [Gasttoegang](gasttoegang.md#unifi-pre-autorisatie).
5. Sla op en wacht een minuut tot de instellingen op de access points staan.

## Stap 4: Testen

1. Vergeet het gastennetwerk op je telefoon en maak opnieuw verbinding.
2. Je portal opent. Vink de voorwaarden aan en tik op **Verbinden**.
3. Je bent online, en het bezoek staat onder **Gasten**.

## Problemen oplossen

| Wat je ziet | Oorzaak en oplossing |
| --- | --- |
| *Dit netwerk is nog niet ingericht* | Het access point is onbekend. Controleer of de juiste site gekozen is en klik op de verversknop op de kaart van de console. Nieuwe access points verschijnen na de verversing van elk uur. |
| *Verbinden is niet gelukt* | Open **Gasten**: de foutmelding staat bij het bezoek. *Device not found on the network* betekent dat de console het apparaat nog niet kende; probeer het na een paar seconden opnieuw. *API key rejected* betekent dat de sleutel is verwijderd of bij een ander account hoort. |
| Het portal opent helemaal niet | Controleer of de external portal server het IP-adres van het platform is en of dat IP-adres in de pre-authorization allowances staat. |
| Certificaatwaarschuwing op de telefoon | Je hostnaam heeft nog geen certificaat; zie [Hostnamen en SSL](hostnamen-ssl.md). |
| *UniFi weigert de API-sleutel: die is niet aangemaakt door de eigenaar van de console* | De sleutel hoort bij een uitgenodigde beheerder. Maak hem aan als eigenaar van de console, of in de organisatie van je Fabric (zie [UniFi Fabric](#unifi-fabric)). |
| Een console van de Fabric ontbreekt in de lijst | De sleutel heeft geen toegang tot die site, of de console zit in een andere Fabric. Pas de sitetoegang van de sleutel aan in unifi.ui.com; één sleutel geldt voor één Fabric. |
| Status van de console *Fout* met *Console unreachable* | Rechtstreeks: het platform kan het adres van de console niet bereiken. Site Manager: de console is offline of niet gekoppeld aan het account van de API-sleutel. |

## Privacy

Het platform bewaart per bezoek de MAC-adressen van apparaat en access point, de netwerknaam, de opgevraagde pagina en het tijdstip. Klanten zien alleen de bezoeken van hun eigen bedrijf.
