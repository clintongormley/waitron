# Handheld and till hardware — decisions and findings

**Date:** 2026-09-18
**Status:** owner decisions from a hardware conversation, recorded (docs-only). **Nothing here is
committed to build.** It records five owner decisions and the findings behind them, so neither is
re-researched or re-argued.

**Supersedes two earlier decisions:** the "most waiters will use their own phones" decision in
[2026-09-08-handheld-app-store-and-kiosk-findings.md](2026-09-08-handheld-app-store-and-kiosk-findings.md)
§4, and this document's §5 revises the "keep the SIF box separate from any till" lean in
[2026-08-15-distribution-and-client-topology-design.md](2026-08-15-distribution-and-client-topology-design.md)
§8. Companion to the buying doc,
[2026-07-30-deli-hardware-design.md](2026-07-30-deli-hardware-design.md), whose buy-list rows this
changes (§7).

External claims carry their provenance in §8. Prices are split the way the buying doc splits them:
**sourced** was read from a named page on 2026-09-18; **estimate** is general knowledge and must be
replaced with a real quote before anyone buys anything.

---

## 1. The five owner decisions

| #   | Decision                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | **The venue buys and owns the handhelds.** Staff do not use their own phones. If a member of staff drops and breaks their own phone during service, the venue is liable to replace it, and a cheap phone the venue owns costs less than that risk |
| O2  | **The bill can be settled at the table.** The waiter carries a card reader to the table, pairs it to the handheld, starts the charge from the handheld, and hands the reader to the customer to pay |
| O3  | **Three ways to pair the handheld to a reader**, and choosing the reader from a **dropdown is the fallback that always exists**: an NFC sticker, a printed QR sticker, or the dropdown |
| O4  | **Readers are shared between waiters**, not assigned one per person for a shift. The handheld should remember the last reader used, but only as a convenience |
| O5  | **A counter position may run on the box itself**, with the box placed in a cupboard under the counter and only the touchscreen exposed |

O1 reverses the 2026-09-08 decision. O2 is not new — the handheld design's §0 already carries the
owner's same-day reversal of "order-only" — but it is restated here because the superseded sentence
above that correction keeps being read as current.

## 2. Why the dropdown is the baseline, and what the tap and the scan are actually for

The dropdown is the only one of the three pairing paths with nothing underneath it that can fail: no
experimental browser interface, no camera, no sticker that can peel off or sit on an awkward piece of
plastic. It works on every device, in every browser, in bad light and with a damaged tag.

**It also means no capability is a hard requirement of the handheld**, which is what sets the device
floor in §6.

O4 is what gives the tap and the scan their value, and the value is **not speed**. With readers
shared, the reader a handheld remembers is a guess that goes stale between bills — it may at that
moment be in another waiter's hand, and choosing it from a list would show a payment prompt to
somebody else's customer. Tapping or scanning the device you are holding proves which one it is. That
is a correctness argument, so the scan is worth building soon after the dropdown rather than being
left as an optimisation.

Consequences for whoever designs the pairing link (backlog A6):

- A remembered reader may be offered first in the list but must never be selected silently.
- Two waiters choosing the same reader at once is ordinary, not a corner case. Decide whether the
  second charge queues or is refused, and show in the list that a reader is already busy.
- Name the readers (the dashboard already configures and adopts them), label the physical readers
  with the same names in text readable at a table, and show the reader's reachability in the list —
  the dashboard already alerts on a reader's low battery.
- **A sticker is untrusted input.** It is a physical token in a public room and can be peeled off and
  swapped. The server validates that the identifier names a reader this venue owns and has adopted.

## 3. What the browser can actually do — QR and NFC

### Reading a QR code from the till web app: yes, but not with the browser's own decoder

Opening the camera is universal and needs a secure context, which the box's certificate already
provides. The **decoding** is the trap. MDN's `browser-compat-data` for `BarcodeDetector`, read
2026-09-18: Chrome for Android 83; desktop Chrome 88 marked `partial_implementation` with the note
_"Supported on ChromeOS and macOS only."_; Safari 17 only behind a preference named
_"Shape Detection API"_, with `safari_ios: "mirror"`; Firefox `version_added: false`. The whole entry
is marked `experimental`.

So decode in JavaScript or WebAssembly and treat the built-in decoder as an optimisation where it
exists. That path works on every device in §6, iPhones included.

### Web NFC: Chrome for Android only, and it arms once

`browser-compat-data` for `NDEFReader`, read 2026-09-18: `chrome_android: 89`, and
`version_added: false` for desktop Chrome, Safari and Firefox, with `safari_ios: "mirror"`. Marked
`experimental`. **An iPhone cannot do the tap path from a web page at all.**

How it arms, which decides the interaction design. Chrome's own documentation: _"Origins must first
request the 'nfc' permission while handling a user gesture (e.g a button click)"_, and `scan()`
resolves only if _"It was only called in response to a user gesture such as a touch gesture or mouse
click."_ **After that the permission is remembered for the origin**, and Chrome's cookbook shows the
shape — query the permission, and if it is already granted start scanning with no user interaction,
showing a button only when it is not.

So: a button once, then never again. While the page is open and in front, every tap raises a
`reading` event with no per-tap arming, and the browser buzzes the device to confirm. Because the
venue owns the devices (O1), that one permission grant happens during provisioning and no member of
staff ever sees the prompt.

It stops when the page is not in front. Chrome: _"All NFC operations are automatically suspended when
document is hidden"_. The Web NFC specification's normative rule: _"Web NFC functionality is allowed
only for the Document of the top-level browsing context, where its Document/visibilityState is
`visible`. This also means that UAs should block access to the NFC radio if the display is off or the
device is locked. For backgrounded web pages, receiving and writing NFC content must be suspended."_
That is fine for this flow — the waiter is looking at the bill.

### The stickers

O3's tags and codes are stickers the venue buys and sticks onto the reader. **Nothing here depends on
what a SumUp Solo can broadcast**, which retires that question.

- **Metal interferes.** The Web NFC specification, in its own words: _"Metal interferes with the
  magnetic field and makes tags not readable."_ A Solo is plastic over a battery and electronics, so
  test a plain sticker on the real device before buying a roll; on-metal tags with a ferrite backing
  are the fix if it reads poorly.
- **Do not put a web address on the tag.** A URL record tapped while the app is not open invites the
  operating system to open that address. A text or custom external record avoids it. **Unverified —
  confirm by trying it**, it is a statement about Android's behaviour, not about the API.
- **Lock the tags once written.** `makeReadOnly()` is Chrome for Android 100 and later. An unlocked
  tag can be rewritten by anyone who walks past it.

## 4. Reusing hardware a venue already owns — the Square Stand case

Asked of a Square Stand, and the answer generalises, which is why it is recorded here. The buying
doc's stated goal is that other users reuse hardware they already own.

**The general rule: a venue can bring any screen with a browser; it cannot bring a card reader unless
that reader is one the `PaymentProvider` seam already drives.**

Applied to Square:

- **The stand and the iPad: reusable.** The stand is a dock — it holds the iPad, swivels it and keeps
  it charged, none of which needs Square's software. Safari runs the till page like any tablet. Check
  which iPad generation the stand fits; the hub's USB ports are Square's and driven by Square's app,
  which does not matter because the box drives the printer and the drawer, so a till needs no ports.
  The §6 battery problem applies and is worse on an iPad, which has no hard charge cap.
- **The built-in reader: not reusable**, twice over. Square's Mobile Payments SDK can drive it — _"The
  Mobile Payments SDK can be used to take payments with any version of Square Reader or Square
  Stand"_ — but it is a native iOS/Android SDK, so a browser cannot reach it, and Square states it is
  _"currently available for accounts based in the United States, Canada, the United Kingdom, and
  Australia."_ Spain is not on that list. Wanting it would also mean Square as acquirer, undoing the
  buying doc §4 calculation that picked SumUp for a deli's ticket size.
- **A Square Register or Square Terminal: not reusable at all.** Locked appliances running Square's
  own software, which is what D1 exists to exclude.
- The fallback that needs no integration is the standalone shape the device model already names: take
  the payment on Square's own app and record it in Waitron as a manual card tender. Two systems to
  reconcile by hand, and Square's rates.

## 5. The counter till, and putting one on the box (O5)

The topology design §8 leaned "above one position, keep the SIF box separate from any till", on the
grounds that if till = server then a till failure is a server failure. **That lean is revised, and the
reason it does not survive is worth stating** because it is easy to re-derive.

With **one** box, a till kept separate gains nothing when the box dies — the till has no server to
talk to either way. Separation only ever protected against the **counter environment** killing the
**server**: spills, knocks, somebody wanting the socket. That is a placement problem, not an
architecture one.

**So: the box goes in a cupboard under the counter, with a short cable up to the touchscreen on top.**
The machine holding the fiscal chain is then no more exposed than it was in the back room, and a spill
costs a monitor — the same outcome as two separate machines. The deli's second counter position takes
its own cheap machine or a tablet, which can be the thoroughly disposable option, because nothing but
a screen is lost when it dies.

Two things this does not change:

- **A dead box is now also a dead till.** The standby is warm, in the cloud, and promotion is
  human-driven by design, so recovery is someone noticing, deciding, promoting, and the devices
  re-routing — and it needs the line to be up. That is the case `CLAUDE.md` §5 already accepts. This
  arrangement does not make it worse, **provided the box is under the counter rather than on it**.
- **The box has to be specified for both jobs**, since it now runs the server, the database and a
  browser. Lighter than it would have been: the storage switch means a server process and a SQLite
  file, not a PostgreSQL server.

If the venue ever runs a second box this gets better, not worse: one in the back room, one under the
counter, and failover stops needing the internet.

### Booting a till machine straight into the app

A Linux machine can boot into the till with no login, which is what "Chromium `--kiosk`" means in the
2026-09-08 kiosk table. Automatic login on the console (a systemd override on `tty1`, no display
manager), then one full-screen browser — `cage`, a Wayland compositor that runs a single application
full screen, is the lean way — as a service set to restart always.

**No operating-system login is the right answer here, not a compromise:** the security boundary is the
till's own operator PIN, and an OS password would be a second secret on a machine bolted under a
counter, and one more thing to go wrong at opening time.

Four things that will bite, none verified on a real machine — **establish each when the image is
built**:

- **The "restore pages?" bubble** after a power cut leaves the till behind a dialog nobody at the
  counter can dismiss. There is a flag for it, and it is the most common way a kiosk bricks itself.
- **The certificate.** Chromium on Linux uses its own certificate database rather than the system
  store, so installing the box's root certificate is a separate step from installing it system-wide.
  This connects to the certificate-trust onboarding work.
- **Screen blanking and sleep** must be turned off explicitly.
- **BIOS power-loss behaviour** set to power on when mains returns, so the machine comes back with no
  keyboard attached.

None of this is built. The backlog lists Chromium `--kiosk` in the box image among later options,
none built, so today it is a manual build per machine — an afternoon for the first, then clone the
disk. Folding it into the box image is what turns a till image into something produced rather than
hand-assembled, which matters for venues that are not the deli.

## 6. What to buy

### The handheld

**A cheap Android phone, roughly €70–100, with an autofocus rear camera.** NFC optional.

- Nothing is a hard requirement, because of the dropdown (§2) — so the floor is set by comfort, not
  capability.
- **Autofocus matters** because QR is the accelerator that works on every device, so it is the one
  most likely to be built. The cheapest phones ship fixed-focus rear cameras, which are poor at
  close-up codes in bad light. Check the specific model.
- **NFC costs about €50 more** and only ever works on Android (§3). Worth it when a venue runs enough
  readers that picking from a list is a real risk; not at the deli's three.
- **Buy one more than you need.** A spare is the point of owning them and costs less than one broken
  screen.
- Sourced 2026-09-18: Spanish sites list six models between roughly €48 and €94 (ZTE Blade L9, Xiaomi
  Redmi A5, Motorola Moto G05, POCO C85, Realme Note 70T among them), and NFC has become normal below
  €150 with €100–120 the band where it becomes easy to find.

### The counter till

**Position one: the box, in a cupboard under the counter, driving a touchscreen on top** (§5).

**Position two: a small fanless x86 machine plus a 15" touchscreen, or a tablet.** Estimate €300–450
for the former, €200–250 for the latter; no Spanish quote was obtained for either.

- "Mini PC" means a small fanless x86 computer, roughly paperback-sized, no moving parts, 10–15 W: an
  Intel N100/N150-class chip, 128–256 GB SSD, HDMI or DisplayPort, USB, gigabit Ethernet. New around
  €120–200 (estimate). **Refurbished corporate micro desktops** — Lenovo ThinkCentre Tiny, Dell
  OptiPlex Micro, HP EliteDesk Mini — are usually better value and normally have a fan.
- **Memory: 4 GB is enough for a machine that only renders the till page**; a single-tab Chromium on a
  Linux with no desktop is on the order of a gigabyte in use. **Reasoning, not a measurement** — check
  it on the first machine. In practice it is moot, because 8 GB is the floor these machines are sold
  at and the 4 GB versions save €0–20. **Where it is not moot is the box**, which under O5 runs the
  server, the database and a browser and wants the headroom. A Raspberry Pi is the case where the
  choice is real, and there 4 GB is the pick.
- **A Raspberry Pi 5** (€60–80 plus case, supply and storage, estimate) works for a machine that only
  renders a page, with two catches: it is ARM while CI builds the box image for `linux/amd64` only, so
  it can never double as a spare box; and its browser is weaker. **Staying on x86 means a till machine
  and a spare box are the same object** — one spare on a shelf instead of two.
- **The tablet catch: it is plugged in all day.** A tablet held at 100% degrades, and a swollen battery
  in a year or two is the usual ending. Buy for it — look for a charge limit by name (Samsung calls it
  "Protect battery") and confirm the model has it. The battery is also a free power-cut ride-through,
  which is worth less than it sounds, because the box and the access point go down with the power
  unless they are all on the UPS.
- **A till needs no ports.** The box drives the printer and the drawer, which is what makes any of
  these work. **Wire the tills to the switch** — they do not move.
- **Put the tills on the UPS, not just the box.** A till dead in a power cut is the same outage as a
  dead box. Size it deliberately.
- A customer-facing display is already a device kind (a second enrolled screen, since only a native
  app can drive the second screen of a dual-screen Android). Not needed at launch.

## 7. What this changes in the buy list

[2026-07-30-deli-hardware-design.md](2026-07-30-deli-hardware-design.md) §3 is unchanged as a record of
what was decided on that date. Against it:

| Row                                | Was            | Now                                                                          |
| ---------------------------------- | -------------- | ---------------------------------------------------------------------------- |
| Handheld — phone or 8" tablet      | 1 × ~€180      | 1 × ~€70–100, **plus a spare**, venue-owned (O1)                             |
| Counter till — tablet + stand      | 2 × ~€250      | One position folds onto the box (O5); the other ~€200–450 depending on §6    |
| — | — | **New:** NFC or QR stickers for each reader, and labels naming them (§2) — pennies |

Every figure is an estimate. The deli's three Solos are unchanged, and so is the €79 sourced price.

## 8. Provenance — external claims (read 2026-09-18)

| Claim                                                                                             | Source                                                                                                |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `BarcodeDetector` support: Chrome Android 83; desktop ChromeOS/macOS only; Safari 17 flagged; Firefox none | <https://github.com/mdn/browser-compat-data/blob/main/api/BarcodeDetector.json>                       |
| `NDEFReader` support: Chrome for Android 89 only                                                  | <https://github.com/mdn/browser-compat-data/blob/main/api/NDEFReader.json>                            |
| Web NFC needs a user gesture for the first permission, then scans without interaction; suspended when the document is hidden | <https://developer.chrome.com/docs/capabilities/nfc>                                                  |
| Web NFC normative rules: secure context, visible top-level document, radio blocked when locked; metal interferes with tags | <https://w3c-cg.github.io/web-nfc/>                                                                   |
| Square Mobile Payments SDK drives any Square Reader or Square Stand; native iOS/Android only; accounts in US, Canada, UK, Australia | <https://developer.squareup.com/docs/mobile-payments-sdk>                                             |
| Square Stand has an embedded reader needing no pairing                                            | <https://developer.squareup.com/docs/mobile-payments-sdk/ios/pair-manage-readers>                     |
| Six Spanish models roughly €48–94; NFC normal below €150, easy to find at €100–120                | <https://blog.masmovil.es/moviles-menos-100-euros/>, <https://blog.masmovil.es/moviles-baratos-nfc/>, <https://www.rincondego.com/moviles/top6-moviles-baratos-2026.html> |

Unsourced and labelled as such above: that a URL record on a tag invites the operating system to open
it; that 4 GB suffices for a till (reasoning, not measured); every price marked estimate; the four
kiosk traps in §5, none of which has been run on a real machine.
