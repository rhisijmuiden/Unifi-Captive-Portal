# Connecting a UniFi console

**English** · [Nederlands](../nl/unifi-koppelen.md)

This guide connects a UniFi OS console to your customer environment and sends the guests of a Wi-Fi network to your captive portal. It takes about ten minutes.

## How it works

1. A guest joins your guest Wi-Fi. UniFi holds the device back and sends its browser to the **external portal server**: the address of this platform.
2. The platform recognises your company by the access point the guest is connected to, and shows **your** portal.
3. When the guest clicks **Connect**, the platform asks your console, through the official UniFi Network API, to let the device through with your time, data and speed limits.

The platform reaches your console in one of three ways:

| Method | When to use | Needs |
| --- | --- | --- |
| **UniFi Site Manager** (recommended) | Any UniFi OS console that is linked to your UI account | UniFi OS 5.0.3 or newer, UniFi Network 9.1 or newer, a Site Manager API key |
| **Direct** | Self-hosted UniFi Network application, or no cloud access wanted | UniFi Network 9.1 or newer, a local API key, and the platform must be able to reach the console over HTTPS |
| **UniFi Fabric** | Your consoles are members of a [UniFi Fabric](#unifi-fabric) (or one Site Manager organisation) | The same versions as Site Manager, and one API key created in the Fabric or organisation |

## Supported consoles

All UniFi OS consoles that run UniFi Network 9.1 or newer work the same way:

| Console | Notes |
| --- | --- |
| Cloud Gateway Ultra / Max (UCG) | Site Manager or direct |
| Dream Machine, Dream Machine Pro, Pro Max, SE (UDM) | Site Manager or direct |
| Dream Router (UDR, UDR7) | Site Manager or direct |
| Cloud Gateway Fiber / Enterprise (UCG-Fiber, EFG) | Site Manager or direct |
| Cloud Key Gen2 / Gen2 Plus (UCK-G2) | Site Manager or direct |
| UniFi OS Server / self-hosted UniFi Network application | Direct (Site Manager only if the server is linked to your UI account) |

Check the versions under **UniFi OS → Settings → Control Plane → Updates** and in the Network application under **Settings → System**. Update first if they are older.

## Step 1: Create an API key

### Site Manager (recommended)

1. Sign in at [unifi.ui.com](https://unifi.ui.com) with the account that owns the console.
2. Open **API** in the menu on the left (on some accounts under **Settings → API**).
3. Click **Create API Key**, give it a name such as `Captive Portal` and copy the key. You only see it once.

### Direct

1. Open the UniFi Network application on the console (`https://<console-address>`).
2. Go to **Settings → Control Plane → Integrations**.
3. Create an API key, name it `Captive Portal` and copy it.
4. Make sure the platform can reach `https://<console-address>` (port 443). Across the internet that usually means a VPN or a port forward limited to the platform's IP address.

## Step 2: Connect the console in the platform

1. Open **UniFi consoles** and click **Connect console**.
2. Choose **Through UniFi Site Manager** or **Direct** and click **Next**. Consoles in a UniFi Fabric? Choose **Through a UniFi Fabric** and follow [UniFi Fabric](#unifi-fabric).
3. Paste the API key.
   - Site Manager: click **Find consoles** and pick your console.
   - Direct: enter the console address, for example `https://192.168.1.1`. Turn **Verify certificate** off while the console still uses its default self-signed certificate.
4. Click **Test connection**, choose the site(s) your guest network belongs to and click **Connect**.

The platform now fetches your access points. It refreshes this list every hour; after adding access points you can click the refresh button on the console card.

## UniFi Fabric

A UniFi Fabric groups many sites and consoles under one organisation in Site Manager. The platform links a Fabric with **one** API key and reaches every console through the same Site Manager cloud connection, so nothing needs to be opened on the consoles.

### Create the key

1. Sign in at [unifi.ui.com](https://unifi.ui.com) and open the **organisation of your Fabric** (top left).
2. Go to **Settings → API Keys** (or **API** in the menu) and click **Create API Key**.
3. Give the key access to **Site Manager** and **Network**, and to **all sites** that should use the portal. Copy the key; you only see it once.

The key must be created by the **owner** of the consoles or in the organisation itself. A key of an invited admin gives *user is not the owner of this host*, or simply leaves consoles out. The platform then shows a clear message telling you to create the key as the owner.

### Link the Fabric

1. Open **UniFi consoles**, click **Connect console** and choose **Through a UniFi Fabric**.
2. Enter a name (for example the name of the Fabric), paste the key and click **Check key**.
3. Tick the consoles whose guests use this portal (or **Select all**) and click **Link consoles**. Each console is linked with all its sites; you can narrow the sites per console afterwards with the pencil button.

The Fabric gets its own card on the **UniFi consoles** page:

- **Replace the key once**: edit the Fabric and paste the new key. It is checked first and then used by all consoles of the Fabric. A console of a Fabric does not have its own key field.
- **New consoles**: the platform checks the Fabric every 30 minutes. When a console joins that is not linked yet, the card shows *1 console not linked yet* with a **Link consoles** button, you get an e-mail (switch it off under **Notifications → New console in a Fabric**) and the webhook event `fabric.console_found` is sent.
- **Disconnect**: deleting the Fabric also disconnects its consoles.

### Hotspot settings in a Fabric

A Fabric can enforce settings on its sites through **Canvas** (for example the same Wi-Fi network on every site). Settings that Canvas manages can no longer be changed in the Network application of a site.

- If the guest Wi-Fi is managed by Canvas, turn on **Hotspot** for that network in the Fabric.
- Set the hotspot portal (*External portal server*, pre-authorization) as in step 3 below, on each site. Using a **Blueprint** for new sites? Set it up in the source site of the Blueprint, so new sites get it right away.

## Step 3: Set up the guest network in UniFi

The menu names differ slightly between Network versions; the steps are the same.

1. In UniFi Network, open **Settings → WiFi** and create (or edit) the guest network.
2. Turn on **Hotspot** (sometimes called **Guest Hotspot** or **Hotspot Portal**).
3. Open **Hotspot Manager** (or **Insights → Hotspot**) and choose the portal settings:
   - **Authentication**: *External Portal Server*.
   - **External portal server**: the address shown on the **UniFi consoles** page under *External portal server* (the public IP address of the platform).
   - **HTTPS redirection**: off. Guests first arrive over HTTP; the platform sends them on to your HTTPS hostname.
4. Under **Pre-Authorization Allowances** (also called *Authorized access* or *Allowed hosts*) add:
   - the IP address of the platform, and
   - your portal hostname from **Hostnames & SSL**, for example `guest.company.com`.
   - Optional, for payments or Facebook login: the hosts listed in [Guest access](guest-access.md#unifi-pre-authorization).
5. Save, and wait a minute for the settings to reach the access points.

## Step 4: Test

1. Forget the guest network on your phone and connect again.
2. Your portal opens. Tick the terms and tap **Connect**.
3. You are online, and the visit appears under **Guests**.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| *This network is not set up yet* | The access point is unknown. Check that the right site is selected, then click the refresh button on the console card. New access points appear after the hourly refresh. |
| *Connecting did not work* | Open **Guests**: the error is shown next to the visit. *Device not found on the network* means the console did not list the device yet; try again after a few seconds. *API key rejected* means the key was deleted or belongs to another account. |
| The portal does not open at all | Check that the external portal server is the platform IP and that this IP is in the pre-authorization allowances. |
| Certificate warning on the phone | Your hostname does not have its certificate yet; see [Hostnames and SSL](hostnames-ssl.md). |
| *UniFi refused the API key: it was not created by the owner of the console* | The key belongs to an invited admin. Create it as the owner of the console, or in the organisation of your Fabric (see [UniFi Fabric](#unifi-fabric)). |
| A console of the Fabric is missing from the list | The key has no access to that site, or the console is in another Fabric. Edit the key's site access in unifi.ui.com; one key covers one Fabric. |
| Console status *Error* with *Console unreachable* | Direct: the platform cannot reach the console address. Site Manager: the console is offline or not linked to the account of the API key. |

## Privacy

The platform stores, per visit, the device and access point MAC addresses, the network name, the requested page and the time. Customers can see the visits of their own company only.
