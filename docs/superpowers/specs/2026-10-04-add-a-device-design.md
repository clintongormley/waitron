# Adding and editing devices

**Status:** agreed with the owner in conversation on 2026-10-04; written spec awaiting the owner's
review. No plan or product change accompanies it. Behaviour described as "today" was read from the
code on 2026-10-04 at main `501842559`; everything else is the target design.

**Related work:** A238 ([a till is a device](2026-10-03-till-is-a-device-design.md), landed #1164)
and the [devices, menus and service zones](2026-10-04-devices-menus-and-service-zones-design.md)
spec, whose "Device" row (approved profiles, active profile, current equipment, station or watcher)
sets what the Edit dialog below grows into. Backlog: A268 (this spec), A269 to A272 (the follow-ups
in §9).

## 1. What changes

A device joins the way a printer is added: a manager opens **Add a device**, devices may ask to join
only while that dialog is open, and the ones that ask appear in a list in it. The manager presses
**Pair**, taps the number the device shows, then fills in the device's name, profile and, for a
kitchen screen, what it shows. Afterwards every device can be renamed and edited from the dashboard,
and the Devices list shows each device's battery.

Today, for comparison: an "Allow new devices" card opens a 15-minute window with Extend and Close
buttons (`apps/server/src/pairing-mode.ts`); waiting requests are listed under it with "Let in" and
"Deny"; the accept dialog asks for the profile first and the number tap sends the approval
(`apps/dashboard/src/screens/devices-screen.ts`); the device's name is whatever was typed on the
device and cannot be changed.

## 2. The join window is held open by open dialogs

- Opening an Add dialog (Add a device, or the Printers screen's Add an agent) takes a **hold** on the
  window. The server answers with the hold's id. A hold lasts **3 minutes**; the dialog renews it
  every **60 seconds** and releases it when it closes. These are the printer-discovery timings
  (`DISCOVERY_WINDOW_MS`, `apps/server/src/print-api.ts`; `DISCOVERY_RENEW_MS`,
  `apps/dashboard/src/screens/printers-screen.ts`).
- The window is open while **any** hold is live. Closing one dialog no longer shuts the window for a
  dialog open elsewhere, as `DELETE /management-api/pairing-mode` does today. A tab that dies stops
  renewing, so its hold lapses within 3 minutes.
- Renewal is passive: it does not count as activity on the manager's login, as the printers screen's
  renewal already does (`withPassiveManagementRead`). When the login times out, renewals are refused
  and the hold lapses, so an unattended dialog cannot keep the window open.
- Holds live in memory, as the window does today, so a restart or a promotion forgets them and the
  window is shut. Renewing a hold the server does not know is refused with a new
  `device.pairing_hold_lapsed`; the dialog then says "No longer accepting devices" and offers a
  button that takes a new hold. It never takes one on its own.
- Removed: the fixed 15-minute window and its Extend and Close buttons; the "N tried to join in the
  last 10 minutes" count on both screens, with `noteRefused`, `refusedRecently` and
  `REFUSED_WINDOW_MS`. Removing the count also retires A5's unbuilt "pairing consumer", the alert
  that devices tried to join while the window was shut (owner, 2026-10-04: devices that knock while
  it is shut are no longer reported).

## 3. The Add a device dialog

- **The Devices page** shows an **Add a device** button, also offered on the empty list. The "Allow
  new devices" card and the waiting list leave the page.
- **The dialog** shows:
  - a QR code for the till app's address and the hint "Scan this with the device's camera, or open
    *{address}* in its browser, then choose Ask to join". The address is the one the server
    advertises to the venue's devices, sent by the server, never the dashboard tab's own address,
    which can be a remote one. On a box the till app is served at the root of that address
    (`mountSpa` with `basePath: ""`, `apps/server/src/boot.ts`). The code carries no secret; the
    number step still decides the pairing. A development stack's address is not reachable from a
    phone, and this design does not change that;
  - a table of the devices asking to join, each with its name and a **Pair** button. There is no
    Deny: a device can only ask while the dialog is open, so there is nothing to silence. With
    nothing waiting it shows "Waiting for devices…" with a spinner;
  - Close, in the footer.
- **Pair** opens a second dialog with two steps:
  1. **"Tap the number showing on the device"**, with three large numbers. The server checks the tap
     at once. A wrong tap discards the request, and the first dialog says "That number did not
     match, so the request was refused — the device has to ask again", as today
     (`device.join_mismatch`).
  2. **Settings:** Name (filled in with the name the device sent), Profile, and Shows (a station or
     watcher) when the profile is a kitchen screen. Then Cancel and Pair. Errors follow the forms
     contract in [design-system.md](../../developers/design-system.md): a clash
     (`device.name_taken`) under Name, a missing station (`device.station_required`) under Shows,
     anything else as one message above the buttons. On success the second dialog closes and the
     first shows "Added {name}", ready for the next device.
- **Cancel at either step discards the request.** The device shows "This device was not approved"
  with Try again, which asks again and shows a new number.
- **While a manager pairs a device, it is theirs.** A right tap claims the request for that
  manager's login and hold. Other managers see the row as "Being paired by {name}" with no Pair
  button. The claim ends with the hold: if the manager's tab dies, the request is discarded within
  3 minutes.

## 4. Pairing on the server

- **Check the number:** a new route takes the request, the tapped number and the hold's id. On a
  match it records the claim (this login, this hold); on a mismatch it deletes the request before
  answering, as `acceptDeviceJoinRequest` does today (`apps/server/src/join-requests.ts`), so
  retries cannot guess. Checking a request another login has claimed is refused with a new
  `join_request.claimed`.
- **Approve:** the accept route loses the number and gains the name. It is refused with a new
  `join_request.unclaimed` unless this login holds a live claim on the request. It keeps today's
  single transaction: the request is deleted and the device row created with the request's id and
  token hash, so the device's cookie becomes its credential.
- **Claims live in memory, beside the holds.** A restart forgets them, and the manager taps the
  number again. No table changes for pairing.
- **A device's request lives only while the window is open.** When the window shuts (the last hold
  released or lapsed, or a restart), waiting device requests are discarded, and the device's next
  status check answers `not_approved`. The 15-minute expiry (`JOIN_TTL_MS`) stays as an outer
  limit.
- **Print agents keep today's behaviour.** An agent told `not_approved` stops and has to be reset on
  its own setup page (`packages/print-agent/src/agent.ts`, the `not_approved` branch), so discarding
  its request when the window shuts would strand it. Its request survives a shut window, as now.
  Finding a way to apply the device rule to agents is A269.
- **Dev mode is unchanged:** a knock is still accepted at once with the first `till` profile,
  without the window (`apps/server/src/device-api.ts`). `apps/server/scripts/dev-setup.ts` seeds its
  devices through `enrolDeviceForTest` (`apps/server/src/testing/enrol.ts`), which calls
  `acceptDeviceJoinRequest` directly, not the route; it follows that function's new signature.
- **Permissions are unchanged:** taking a hold, checking, approving and editing need
  `device.manage`.

## 5. The Devices list and the Edit dialog

**The list** becomes a `wt-data-table`, like the printers list: Name, Profile, Shows (kitchen
screens), Battery (§6), Status and Last seen. Its row-menu column is keyed `actions` and pinned to
the end, so it stays on a phone's screen. An active device's menu offers **Edit** and **Remove**
(two presses, as today), and clicking an active device's row opens Edit. A removed device stays
listed, with no Edit and a row that does not open.

**The Edit dialog** holds what exists on a device today, laid out so the planned fields slot in:

| Field | Now | When the devices, menus and service zones spec's profile work lands |
| --- | --- | --- |
| Name | Required; unique among active devices at the venue; a removed device's name is free (`devices_location_label_active_key`) | Same |
| Profile | Required, one profile | Approved profiles, and which is active |
| Shows | Station or watcher, kitchen screens only | Chosen from the profile's permitted list |
| Receipt printer, payment slip printer | Chosen from the profile's lists; changing the profile reloads both and selects the first of each | Adds drawer and card terminal, each with "Use default" |
| Made here | The stations, as today | Unchanged until A270 decides where it lives |
| Default card reader | Shown only to someone holding `payments.manage`, as today | Same |

- Everything except the card reader is saved by **one request in one transaction**. It replaces
  `POST /management-api/devices/:id/assign-device-profile` and `PUT
  /management-api/devices/:id/made-here`. Staff choosing printers on the device keep
  `PUT /api/device/printers`. (2026-10-07: W100 replaced that route with
  `GET/PUT /api/device/equipment`.)
- The server checks a printer against the device's (new) profile, refusing one not listed with
  `device.binding_invalid` as the device route does today.
- The card reader belongs to the payments module and its own permission, so it is saved second,
  through its existing route. If that save fails, the dialog stays open with the error under the
  card reader field, and the device's other changes are already saved. This split is a commented
  decision at its site.
- Profile is required, which removes today's "no profile" choice: it sends `null`, which the server
  refuses (`apps/dashboard/src/screens/devices-screen.ts`, the reassign dropdown).
- Pairing's settings step uses the same name, profile and Shows fields, and the server applies the
  same name and station checks on both paths. (2026-10-05, W105d: editing a device accepts the
  station or watcher it already shows, sent back unchanged, even once the station is switched off
  or the watcher removed; pairing and Enable still refuse either.)
- Renaming changes how the device's past sales and cash-ups are displayed, because records store the
  device's id and screens show its current name. Nothing recorded changes. When a device that is
  running shows its new name is for the plan to establish from the till's code; showing it at once
  is not required.

## 6. Battery

- **Which devices can report it.** Chromium-based browsers let a page read the battery level and
  whether it is charging, over HTTPS only; Safari, on iPhone and iPad as on the Mac, never has, and
  Firefox removed it (provenance in §10). The handhelds are venue-owned Android phones running the
  installed web app ([hardware decisions](2026-09-18-handheld-and-till-hardware-decisions.md),
  O1), so no Android app is needed. An iPhone or iPad would need a native app; that is not in scope.
- **A device with no battery reads as full and charging.** The standard says such a browser reports
  a level of 1.0 and charging true, "which emulate a fully charged and plugged in battery". A till's
  touchscreen therefore shows "100%, plugged in", the same as a full handheld on its charger. The
  screen does not try to tell them apart.
- **Reporting.** Where `navigator.getBattery` exists, the till app sends the level (a whole
  percentage) and the charging state when it starts as a paired device and whenever either changes,
  through a new device route. The server stores a report when the charging state changed or at least
  a minute has passed since the last stored one, the same limit as the last-seen time
  (`SIGHTING_INTERVAL_MS`, `apps/server/src/device-session.ts`), and refuses a level outside 0 to
  100. (2026-10-05: the shipped reporter also re-sends its reading every five minutes, one send at a
  time, so a steady battery is stored again before it greys; the server stores when more than a
  minute has passed, not at least a minute. See the plan's Task 10 note.)
- **Storage.** Three new nullable columns on `devices`: the level, the charging state and the time of
  the report. Storing them on the device row means the Devices list updates live through the change
  feed. The migration must generate as three plain column additions with no CHECK: a new CHECK makes
  drizzle-kit rebuild the table (CLAUDE.md §3), and `devices` is referenced by records throughout
  the database. The level's range is held by the route.
- **Display.** The Battery column shows "82%" with a charging mark, or "Not reported" for a device
  that has never reported. A report more than 10 minutes old is shown greyed, with "as of {time}".
  (2026-10-06, W106a: now "updated 11 minutes ago", with the exact time on hover or tap.)
- No low-battery alert in this work (A272).

## 7. The device's own screen

- With the window shut, the join screen's message becomes "New devices aren't being accepted right
  now. Ask a manager to open Add a device in the dashboard." (`device.pairing_closed`,
  `apps/till/src/i18n/codes.ts`), in English and Spanish.
- A discarded request shows the existing "This device was not approved" with Try again.
- Scanning the QR code opens the till app at the root of the venue's address, which shows the join
  screen to a device that is not paired, as today.

## 8. Acceptance evidence

The plan writes each of these as a failing test first:

- **Holds:** two holds, one released, the window still open; a hold not renewed lapsing; renewing an
  unknown hold refused with `device.pairing_hold_lapsed`; a fresh holder after a restart finding the
  window shut; renewal not extending the manager's login.
- **Pairing:** a wrong number discarding the request; a right number claiming it; approval without a
  claim, from another login, or after the claim's hold lapsed, refused; another login checking a
  claimed request refused; Cancel discarding; device requests discarded when the window shuts while
  an agent's request survives; dev mode still auto-accepting.
- **Names and editing:** a clash at pairing and at editing; a removed device's name reused; a profile
  change moving the printers in the same transaction; a printer not on the profile refused; staff
  without `device.manage` refused; the card reader's separate save failing with the device's
  changes kept.
- **Battery:** a report stored, a second within the minute dropped, a charging change within the
  minute stored, a level outside 0 to 100 refused, a device with no battery API sending nothing.
- **Dashboard browser tests:** the dialog taking a hold on open, renewing it, releasing it on close
  and on leaving the screen; the lost-hold message and its button; the QR code carrying the server's
  address; both Pair steps, Cancel, a wrong number and a "Being paired by" row; the list's row click
  and menu; the Edit dialog's field errors; the battery column's three states.
- **Accessibility:** an axe test for each new dialog state, in both themes.
- **Till:** the new shut-window message.
- **By eye:** the Devices page, both dialogs and the Edit dialog opened and checked in both themes
  and at phone width.

## 9. Not in this work

- **A269:** apply "discarded when the window shuts" to print agents without stranding them.
- **A270:** whether "made here" belongs on the device or on its profile. It stays on the device
  (owner, 2026-10-04).
- **A271:** each browser tab as its own device, in Demo as well as dev mode, with its own device
  secret and sign-in. Today only dev mode has it, and it identifies a tab's device by id alone
  (`x-waitron-dev-device`, `apps/server/src/device-session.ts`). The owner chose to do it after this
  work (2026-10-04).
- **A272:** a low-battery alert.

## 10. Provenance

| Claim | Source, read 2026-10-04 |
| --- | --- |
| `navigator.getBattery` is supported from Chrome 38, with Edge, Opera, Samsung Internet, Chrome for Android and the Android web view mirroring Chrome; Safari and Safari on iOS `version_added: false`; Firefox added 43, removed 52 | MDN browser-compat-data, `api/Navigator.json`, `getBattery` (raw file from the `mdn/browser-compat-data` repository) |
| Secure contexts only | MDN, Battery Status API page: `{{securecontext_header}}`; W3C Battery Status API: `[SecureContext]` on `getBattery` |
| "If the user agent is unable to report the battery status information, the BatteryManager's internal slots will remain with their default values, which emulate a fully charged and plugged in battery." Level "1.0 if the battery is full, the implementation is unable to report the battery's level, or there is no battery attached to the system"; charging `true` if "charging, the implementation is unable to report the state, or there is no battery attached to the system" | W3C Battery Status API, `w3c/battery` repository, `index.html` |
