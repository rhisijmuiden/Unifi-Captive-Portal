# Klanten factureren

[English](../en/billing.md) · **Nederlands**

Als platformbeheerder factureer je je klanten (tenants) voor hun gastportaal via **Facturatie** in het hoofdbeheerpaneel. Dit staat los van *betaalde gasttoegang*: of gasten voor wifi betalen, zet elke klant zelf aan in zijn eigen omgeving (zie [Gasttoegang](gasttoegang.md)).

## 1. Je bedrijfsgegevens instellen

**Facturatie → Instellingen**

| Instelling | Wat het doet |
| --- | --- |
| Bedrijfsgegevens | Naam, adres, e-mail, btw- en KvK-nummer, IBAN/BIC en logo (PNG, JPG of SVG). Staan op elke factuur. Facturen uitgeven kan pas als de bedrijfsnaam is ingevuld. |
| Valuta, standaard btw-tarief | Standaard 21%. Per klant kun je een eigen tarief kiezen (9%, 0%) of **btw verlegd** voor zakelijke klanten in een ander EU-land. |
| Betaaltermijn | Vervaldatum = factuurdatum + dit aantal dagen (standaard 14). |
| Factuurnummer | Voorvoegsel plus een volgnummer zonder gaten. `{year}` wordt het jaartal, dus `{year}-` met 4 cijfers geeft `2026-0001`, `2026-0002`, … en begint in 2027 opnieuw. |
| Voettekst | Kleine tekst op elke pagina, bijvoorbeeld je voorwaarden. |
| Abonnementsfacturen automatisch versturen | Aan: nieuwe facturen worden direct uitgegeven en gemaild. Uit: ze wachten als concept tot jij ze controleert en verstuurt. |
| Herinneringen | Herinneringen per e-mail een aantal dagen na de vervaldatum, bijvoorbeeld `7, 14`. |
| Portalen automatisch pauzeren | Staat een factuur langer open dan het aantal dagen dat je instelt, dan kunnen gasten van die klant niet meer verbinden. De klant kan nog wel inloggen en betalen; het portaal gaat vanzelf weer aan zodra er niets meer te laat is. |
| Online betalen | Je eigen Mollie- of Stripe-account (niet dat van de klant). |

Facturen en herinneringen gaan via de SMTP-server van het platform, dus stel eerst **E-mail (SMTP)** in.

### Online betalen met Mollie of Stripe

- **Mollie**: vul de API-sleutel in (`test_…` om te proberen, `live_…` voor echte betalingen). Mollie meldt betalingen automatisch op `https://<beheer-hostnaam>/billing/webhooks/mollie`.
- **Stripe**: vul de geheime sleutel in en maak in het Stripe-dashboard (Developers → Webhooks) een webhook voor `https://<beheer-hostnaam>/billing/webhooks/stripe` met de events `checkout.session.completed` en `checkout.session.expired`; plak daarna het signing secret (`whsec_…`).

Met **Verbinding testen** controleer je de sleutel. Webhooks bereiken alleen een publiek adres, geef het beheerpaneel dus een eigen hostnaam bij **Hosting & SSL**. Zonder webhooks controleert het platform openstaande betalingen nog steeds elke minuut.

## 2. Plannen

Bij **Facturatie → Plannen** staan de prijzen die je aanbiedt, bijvoorbeeld *Basis* € 19,95 per maand en *Pro* € 49,95 per maand (excl. btw). Een plan is een startpunt: kies je het bij een klant, dan worden naam, prijs en periode ingevuld, en die kun je per klant nog aanpassen. Een plan later wijzigen verandert bestaande abonnementen niet.

## 3. Abonnementen per klant

**Facturatie → Abonnementen → ✏️** (of de knop 🧾 naast een klant bij **Klanten**)

- **Factuurgegevens**: bedrijfsnaam, adres, e-mailadres voor facturen (leeg = het contactadres van de klant, daarna de beheerders), btw-nummer, hun referentie (bijvoorbeeld een inkoopordernummer), taal van facturen en e-mails (Nederlands of Engels), btw-tarief of btw verlegd.
- **Abonnement**: plan, naam op de factuur, prijs excl. btw, periode (maandelijks, per kwartaal, jaarlijks) en startdatum.

Facturen worden **vooraf** gemaakt: de eerste factuur gaat over de periode vanaf de startdatum, de volgende begint de dag erna. Een startdatum in het verleden factureert ook de periodes sindsdien. Na de eerste factuur kun je **Volgende factuur** verschuiven om een periode over te slaan of te herhalen. Zet je een abonnement uit en later weer aan, dan wordt de tussenliggende tijd nooit gefactureerd.

De facturatie draait elk uur (en kort na een herstart). Datums volgen de tijdzone Europe/Amsterdam (`TZ`).

## 4. Facturen

**Facturatie → Facturen** toont het openstaande bedrag, wat te laat is, wat deze maand is ontvangen en de terugkerende omzet per maand.

| Actie | Wanneer |
| --- | --- |
| **Nieuwe factuur** | Eenmalige bedragen, bijvoorbeeld installatie. Opslaan als concept, of direct uitgeven en versturen. |
| ✏️ / 🗑 | Alleen concepten. |
| **Uitgeven en versturen** | Geeft het concept het volgende nummer en de factuur- en vervaldatum, legt je bedrijfs- en klantgegevens erop vast en mailt hem met de PDF als bijlage. |
| **Opnieuw versturen / Herinnering sturen** | Mailt de factuur (of een herinnering als hij te laat is) opnieuw. |
| **Betaallink kopiëren** | De link uit de e-mail, bijvoorbeeld om via een ander kanaal te sturen. |
| **Markeren als betaald** | Voor een overboeking; stuurt desgewenst een betaalbevestiging. |
| **Factuur annuleren** | Een uitgegeven factuur kun je niet wijzigen of verwijderen (hij moet in je administratie blijven); annuleer hem en maak een nieuwe. Het nummer blijft gebruikt. |

Facturen blijven bewaard als een klant wordt verwijderd.

### Wat de klant ziet

- De e-mail met de factuur als PDF en een knop **Nu online betalen**. De betaallink opent een pagina met het bedrag, een betaalknop en de PDF; na betalen wordt de factuur automatisch op betaald gezet en krijgt de klant een bevestiging.
- In de eigen omgeving bij **Facturen** (alleen klantbeheerders): wat er openstaat, het abonnement, alle facturen met PDF en een knop **Betalen**, en een melding als het portaal gepauzeerd is.

De opmaak van de e-mails *Factuur*, *Betalingsherinnering* en *Betaling ontvangen* pas je aan bij **E-mailtemplates**.
