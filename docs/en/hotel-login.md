# Hotel login: room number and surname

**English** · [Nederlands](../nl/hotellogin.md)

Hotel guests sign in with their **room number** and **surname** and stay online until **departure**. Switch on **Room number and surname** under **Captive portals → Access & sign-in**, then manage the stays on the new **Hotel** page.

## How guests sign in

- The room number is matched without spaces and leading zeros (`012` = `12`).
- The surname is matched without capitals, accents, spaces or punctuation, and the last part is enough: `Berg` finds *van den Berg*, `Muller` and `Mueller` find *Müller*.
- Guests can sign in from midnight on the arrival day until the departure time; access then ends at departure.
- **Devices per room** (default 5) limits how many devices may be online at once on one stay.
- After **5 wrong surnames** for a room, that room is locked for 15 minutes, so surnames cannot be guessed.

## Where the stays come from

**By hand**: **Add stay** with room, surname, arrival and departure (date and time; the default is the **check-out time**, 12:00).

**CSV import**: export the in-house list from your PMS and import it under **Import CSV** (or paste it). Columns: room, surname, arrival, departure. With a header row (for example `Room;Surname;Arrival;Departure` or `Kamer;Achternaam;Aankomst;Vertrek`) the order may differ. Separator `;`, `,` or tab; dates as `2026-10-21`, `21-10-2026` or with a time. **Replace the existing list** first removes all manual and imported stays.

**API**: `POST /api/v1/hotel/stays` for one stay, or `POST /api/v1/hotel/stays/import` with `{"stays":[…], "replace": false}`. Stays with an `externalId` are updated when sent again. The key needs the scope `hotel:write`.

**PMS connection** (synced every 10 minutes, and right away when a guest's room is not found):

- **Apaleo**: create a custom app with *client credentials* and the scope `reservations.read` in Apaleo, and fill in the client ID, secret and **property ID** (e.g. `AMS`). Reservations that are confirmed or in house and have a room assigned are fetched.
- **Mews**: ask Mews for a **Connector API** integration and fill in the client token and access token (and the platform address for the demo environment). Started and confirmed reservations with an assigned room are fetched, with the room name and the customer's last name.

Stays from the PMS cannot be changed on the platform; change them in the PMS. **Test connection** fetches the reservations without saving them, **Sync now** fetches and saves.

Deleting a stay does not disconnect devices that are already online. Stays are removed automatically a week after departure.

Note: the Apaleo and Mews connections are built on the public API documentation; try them with a test property before using them live.

Designed by [RHIS](https://rhis.nl).
