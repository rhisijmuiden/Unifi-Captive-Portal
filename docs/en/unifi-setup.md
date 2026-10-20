# Connecting a UniFi console

**English** · [Nederlands](../nl/unifi-koppelen.md)

This guide connects a UniFi OS console to your customer environment and sends the guests of a Wi-Fi network to your captive portal. It takes about ten minutes.

## How it works

1. A guest joins your guest Wi-Fi. UniFi holds the device back and sends its browser to the **external portal server**: the address of this platform.
2. The platform recognises your company by the access point the guest is connected to, and shows **your** portal.
3. When the guest clicks **Connect**, the platform asks your console, through the official UniFi Network API, to let the device through with your time, data and speed limits.

The platform reaches your console in one of two ways:

| Method | When to use | Needs |
| --- | --- | --- |
| **UniFi Site Manager** (recommended) | Any UniFi OS console that is linked to your UI account | UniFi OS 5.0.3 or newer, UniFi Network 9.1 or newer, a Site Manager API key |
| **Direct** | Self-hosted UniFi Network application, or no cloud access wanted | UniFi Network 9.1 or newer, a local API key, and the platform must be able to reach the console over HTTPS |

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
2. Choose **Through UniFi Site Manager** or **Direct** and click **Next**.
3. Paste the API key.
   - Site Manager: click **Find consoles** and pick your console.
   - Direct: enter the console address, for example `https://192.168.1.1`. Turn **Verify certificate** off while the console still uses its default self-signed certificate.
4. Click **Test connection**, choose the site(s) your guest network belongs to and click **Connect**.

The platform now fetches your access points. It refreshes this list every hour; after adding access points you can click the refresh button on the console card.

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
| Console status *Error* with *Console unreachable* | Direct: the platform cannot reach the console address. Site Manager: the console is offline or not linked to the account of the API key. |

## Privacy

The platform stores, per visit, the device and access point MAC addresses, the network name, the requested page and the time. Customers can see the visits of their own company only.
