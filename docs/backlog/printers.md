# Printers, the print agent and receipts — detail

The open entries are listed in [the backlog](../backlog.md), under "Printers, the print agent and receipts". This file holds
their full text.

## A1175: an Android app for venues run from Waitron Cloud

Owner, 2026-10-28: "We also need to start thinking about building an android app to provide a
local print server when Waitron is running in cloud. And to think about what else the android app
would provide." The owner moved it up with the Cloud-reached features (online booking, the
table's QR code, online ordering) and asked to brainstorm it later.

Why it is needed: the print agent is the one piece that must stay on the venue's premises when
the primary is in the cloud (cloud-compatibility rule 5 in [the backlog](../backlog.md)). A venue
with no box needs something else on its premises to run it.

Owner, 2026-10-29: the app is the device agent — "it is the android app really, which runs
locally and hosts the print agent (et al)". It is the Waitron-owned outbound agent the hosted
design asks for (printers, cash drawers and card readers stay local), so it is what lets a venue
started in the cloud after its box dies (A1188) print, open the drawer and take card payments.

**Brainstorm started 2026-10-29; to be resumed with the open questions below.**

The owner's answers (2026-10-29):

- The app is needed for the print agent, "but not for card readers (over the internet) not for
  cash drawers (connected to printers)". "The server speaks to the card reader over the internet.
  This means that if we use an on prem server and the internet goes down then we can't talk to the
  card readers and instead have to use standalone card readers or payment apps installed on the
  mobile phone." The [A1188 design](../superpowers/specs/2026-10-29-a1188-cloud-emergency-start-design.md)
  was corrected the same day to match.
- When a cloud-run venue's internet fails: "We should keep selling using mobile internet to talk to
  the cloud server." No local server holds sales while the line is down.
- The owner's concern with that: "If the mobile is using mobile internet, then it isn't connected to
  the LAN. If it is connected to the LAN then it won't be able to reach the internet."
- Who owns the devices, and what that means for an outage: "the devices are likely to belong to the
  venue, not the waiter, and they're likely to not have a SIM card. Either the handheld device or
  the router needs a SIM device to keep functioning. The router would be the simpler solution."

What follows from that answer: a device with no SIM has no mobile internet of its own, so during an
outage every device, handhelds included, reaches Cloud only through the venue's Wi-Fi. The way a
cloud-run venue keeps selling is therefore a router with a mobile-data backup (its own SIM): every
device stays on Wi-Fi, the router switches to mobile data when the line fails, and the owner's
concern above does not arise, because the Wi-Fi still reaches the internet. It needs no app work;
its cost is equipment the venue buys and sets up.

Proposed in the brainstorm, not agreed:

- The print agent needs only the venue's Wi-Fi: it reaches the printers and, through the backup
  router, Cloud. Handhelds never talk to printers directly; every print goes through the server to
  the print agent (cloud-compatibility rule 5).
- Holding Wi-Fi and mobile data at once on one device now matters only to a venue with no backup
  router whose print-agent tablet has its own SIM, and even then its SIM-less handhelds stop
  selling. As read from Android's documentation and developer write-ups, NOT run: an installed app
  can ask for the Wi-Fi network without requiring internet from it, ask for mobile data as well,
  and tie each connection to one of them (`ConnectivityManager.requestNetwork`,
  `Network.bindSocket`/`openConnection`). A web page has no such choice. The test below
  settled it for one phone.
- The print agent runs on a device that stays in the venue (the counter tablet), never a waiter's
  phone, which leaves at the end of a shift.
- The same app shows Waitron's screens. On fixed tablets it locks the tablet to Waitron (kiosk
  mode), perhaps replacing the planned Fully Kiosk resale. Android's lock that staff cannot escape
  needs the tablet set up from a factory reset; screen pinning needs none but can be undone.
- On phones it runs the handheld, adding what a browser cannot: taking cards on the phone itself
  (Tap to Pay, offered by Stripe and SumUp to native apps only, as understood, not checked) and
  alerts while the phone is in a pocket.
- A venue with a box already has its print agent there; for it the app is optional.

Owner, 2026-10-29, on the questions the router answer raised:

- The device test: "it would be interesting to try regardless". It ran on 25 November 2026 (below).
- Whether Waitron recommends or resells a backup router: "Quite possibly".
- Whether staff are told when the venue is on the router's mobile data: "How would we know?" Ways
  proposed, not agreed and none tried: read the router's own status, which works only for routers
  Waitron knows (so it pairs with recommending one); or notice that the venue's public address, as
  Cloud sees it, has changed to one belonging to a mobile network, a hint rather than proof, since
  an operator may serve fibre and mobile from the same address blocks. Owner, 2026-10-29, after
  hearing both: "It'd be a nice to have." Proposed with it, not agreed: the notice may matter more
  to a manager (turn off guest Wi-Fi, streaming) than to staff, since Waitron's own data use is
  thought small but not measured.

Still to ask: whether kiosk mode
replaces the Fully Kiosk resale; whether a second device takes over
printing automatically when the print-agent tablet is off; which printer connections it must reach
(network, USB, Bluetooth); and how it compares with printers that fetch jobs from the cloud
themselves ([Star CloudPRNT](../superpowers/specs/2026-08-17-printing-cloud-poll-transport-design.md),
[Epson Server Direct Print](../superpowers/specs/2026-08-17-printing-epson-server-direct-print-design.md)).

**Owner decision, 25 November 2026, after the device test below:** "i've realised that handhelds are
unlikely to have sim cards and contract, which cost money. so the better solution would be a router
with a sim card". So a venue run from Cloud keeps selling through a router with its own SIM: every device stays on
the venue's Wi-Fi, and the app needs Wi-Fi only. The app does not hold two networks; the test stays
as the record that it could. Whether Waitron recommends or resells such a router stays open.

**The device test ran on 25 November 2026: one Android device can do both.** On the owner's Oppo
(CPH2913, Android 17), with its internet blocked in UniFi but the local network open, and a throwaway app
asking for both networks (`ConnectivityManager.requestNetwork`, one request tied to each):

- Control, internet on: the app fetched two different public addresses over the two networks and
  refused to print, because Android said the Wi-Fi had internet.
- Internet blocked: Android marked the Wi-Fi unvalidated; a fetch tied to the Wi-Fi timed out and a fetch tied to mobile
  worked. The Epson at `192.168.10.81:9100` printed, over the Wi-Fi, a ticket carrying the address fetched over mobile in the same second.
- The Wi-Fi without internet was the phone's default network, so an ordinary web page there would
  have lost Cloud (the owner's concern); a printer connection tied to no network reached the printer, through the Wi-Fi.
- Held for five minutes, 20 of 20 rounds of both worked.

Not tried: the app in the background or the screen off, which a print agent would have to survive, and
a device that is not this one. The app's source and tools are in `~/workspace/spikes/a1175-dual-network` on the owner's Mac.

## What the AppArmor profile (A129, #862; A134, #887) left open

- **`trust` is still refused.** A property write (`trust`) and `Disconnect` were measured still
  refused against the stand-in BlueZ; BlueZ's `Agent1.Release` is not allowed either, and the
  stand-in never sends it.
- **The box check ran on 25 November 2026 and found no refusals**, without a positive control: on the
  spare, with the kernel's log rate limit off, a scan from inside the agent's container, a delete that
  unpaired the owner's printer and a pairing through the dashboard left no `apparmor="DENIED"` line in
  `journalctl -k`. No refused `Agent1.Release` appeared.
- **A bus policy that refused BlueZ's own calls would read as `no_controller`**: measured
  2026-09-29 on a CI runner against the stand-in BlueZ, with a profile that allowed the bus
  daemon's own messages but no message to BlueZ: `bluetoothctl --timeout 3 devices Paired` printed
  "No default controller available" and exited 0.

## Measure one-job print pulls on the box

A517 uses one job per pull to eliminate unsent leased tails. Every job now repeats the agent's
inventory cycle. Measure a burst on the box before choosing inventory caching or another
lease design; the controlled Hono/transport probe is not a hardware throughput measurement.

A1372 checks the claim against delivered history using the existing printer/status index.
Its local synthetic database measurement excludes authentication, discovery and physical output.
Measure those costs on the box, and measure large retained queues separately. The status ranges
still include failed jobs with no attempts left and drawer claims awaiting a result, as well as
live document leases. The review measured higher claim cost with both queued work and exhausted
failures present; it did not isolate which part of the statement caused that increase.

## Waitron carries two QR encoders; consolidate on `qrcode-generator`

When consolidating, check the receipt's `qrRaster` path separately from `EscBuilder.qr`, and
retain the error-correction choice documented in `apps/server/src/qr-matrix.ts`. These are the
two QR audit pointers carried forward from the old aged-batch detail; A517 changes neither.

**Waitron carries two QR encoders; consolidate on `qrcode-generator` — Small.** `apps/server` imports
`qrcode` (in `qr-matrix.ts`, `print-job-preview.ts`, `discovery-api.ts`) while `apps/till` uses
`qrcode-generator` (`qr.ts`). The server's three call sites use only `.create()` (the module matrix)
and `.toString({ type: "svg" })` — no PNG — so `qrcode`'s `pngjs` is never exercised and its `yargs`
(pulled only because `qrcode` ships a CLI bin) is dead weight. `qrcode-generator` is isomorphic,
**zero-dependency**, and covers both the matrix (`getModuleCount()`/`isDark()`) and the SVG case.
Switch the three server sites over and drop `qrcode`; hoist the receipt's hand-ported
money/date/label formatters into `packages/shared` too (the paper receipt already drifts from the
screen by an NBSP normalisation). **The gate before landing:** `print-job-preview.ts` reconstructs a
QR from stored raw `latin1` bytes through `qrcode`'s byte-mode segment API; `qrcode-generator` has a
`'Byte'` mode, but this path must produce a byte-identical, still-scannable QR — these are fiscal
receipt QRs AEAT's own app must verify — so it needs a render→decode check and a real scan, not
just a green typecheck.

## Photographs and timings of pictures on paper

Still owed: photographs of a kitchen ticket and the ruler page, and the two jobs
`docs/developers/testing-guide.md` ("How long a job of pictures takes to print on the box") names, timed to
the printer's own answer. On 25 November the owner photographed receipts, slips and an A4 invoice, and
View printout matched the paper; the timings taken then are in that section. Anything the rest shows
wrong becomes a new item.

## Printing over RFCOMM from INSIDE the print-agent container (A140)

On 25 November 2026 a 108 KB job sent from the spare's container printed whole, to its last line,
both when the connection was closed at once and five seconds later. The connection itself is fast or slow for as
long as the printer stays switched on: 0.2–1.4 s, sometimes about 2 s, after some switch-ons and 2.7–4.3 s after others, with no
known cause, and a Bluetooth scan just before did not cure it. The helper's 20-second connect and
send timeouts and the agent's five-second grace have not been tried at their limits.
[A1578 plan](../superpowers/plans/2026-11-25-a1578-bluetooth-printing.md).

## The virtual PDF printer

- **The virtual PDF printer.** The virtual PDF output remains to be built. Print-payload retention is handled by the daily housekeeping job.

**Print payload measurement (A1308 dv11 M1, 2026-11-18).** Santet contained zero print jobs.
The 366-day synthetic venue held 452,520 jobs with 9,179,818,278 payload bytes before
housekeeping, averaging 20,286 bytes per job. Its 422,874 document jobs held 9,179,670,048
bytes (21,708 bytes each on average) and its 29,646 drawer jobs held 148,230 bytes (5 bytes
each). The [A1544 bench](https://github.com/clintongormley/waitron/blob/28f9998ef84db3fb671b1e59a7a5916b0d317da4/docs/superpowers/plans/2026-11-16-a1544-memory-measurement.md) built this
venue at commit `30c1c1c564` with 250 bills a day and seed 1.

## Reprint kitchen tickets and other printouts laid out again for any printer

- **Reprint kitchen tickets and other printouts laid out again for any printer (left open by A405
  point 4, #2678).** Receipts and full invoices are laid out again from the sale. For other printouts,
  Reprint copies the stored bytes while they remain available: kitchen tickets and refund receipts to an
  active receipt printer at least as wide, centred; everything else to its own printer only.
  Laying them out again needs each job to keep the printer-independent document it was built from,
  with a version number, in a new `print_jobs` column, and each builder (`formatKitchenTicket`,
  `formatCorrectionSlip`, `formatPaymentSlip`, `formatCategorySalesPage`,
  `formatTenderRefundAcknowledgment`) to draw from it; a job whose version the running code cannot
  read falls back to today's rule. Also open: whether kitchen tickets, payment slips and reports
  need an A4 page, or A4 printers stay out for them.

## Share printed logo dots per library photo (A1308 dv16 M3)

- Keep the cached dots when printing. On the Intel Core i5-6400T test box, drawing both paper sizes
  from a synthetic 1,600 × 1,600 library photo took a median of 1,065 ms (95th percentile 1,091 ms).
  Reading one paper's cached dots took a median of 0.65 ms (95th percentile 1.41 ms), over 50 runs
  per path. Move the printed dots to the photo library so themes using the same image share a copy.

## Loose ends left by #367

- Follow-up (ruling C): the preview no longer shows the QR link as text for a raster receipt. A
  possible fix is to carry the link alongside the print job so the preview can still show it as
  text.

## Bundle: One session at the real box: printers, paper, tax QR, the drawer

Hardware checks to complete with the owner. The owner walked most of the list on 20 and 25 November 2026;
what is left is below. The 25 November session queued A1578 (slow Bluetooth prints), A1579 (Add a printer after an office printer), A1581
(looks around A4 printing), A1582 (print an invoice again from the till), A1583 (View printout and
Reprint for A4 rows), A1584 (a shorter Delete printer window), A1585 (dragging by touch) and A1587
(the invoice email's attachment and message).

- Verify live Google address completion during Cloud-connected Prepare setup on the owner's real box with Google lookup configured.
- **A739, two looks at paper.** The payment slip's new lines (#4337) after the box's next update, and, for a new
  reader payment whose first receipt has no card details, a receipt copy after the background lookup
  fills them in.
- **A773 physical-till trial: dragging, after A1585.** On 25 November holding a line on the Pixel Tablet opened
  the browser's menu every time, so nothing could be dragged; the owner asked for it to be fixed, not removed. Try it again on
  the tablet once A1585 is on the box.
  [Spec §11](../superpowers/specs/2026-10-16-a773-courses-and-groups-design.md#11-left-for-later-backlog)
- **What the AppArmor profile (A129, #862; A134, #887) left open:** **`trust` is still refused.** [Detail](printers.md#what-the-apparmor-profile-a129-862-a134-887-left-open)
- **Loose ends left by C107 (#974).**
  [Detail](printers.md#loose-ends-left-by-c107-974)
- **Loose ends left by #367.**
  [Detail](printers.md#loose-ends-left-by-367)
- **Shared office-printer queues need physical qualification after A576.** From the shipped
  print-agent container, discover two queues on one computer, add both and print distinguishable
  pages to each. [Detail](printers.md#shared-office-printer-queues)
- **Office-printer detection is proven on one office printer only.** Both boxes list the owner's HP
  Color LaserJet MFP M181fw as an office printer. No receipt printer that answers IPP has
  been captured, so "A4 or letter means office printer" is a heuristic with one data point.
- **A552. Invoices on the owner's office printer: a multi-page invoice.**
  [Detail](printers.md#a552-invoices-on-the-owners-office-printer-a-multi-page-invoice-and-power-loss)
- **A printer reported by its `.local` name may stay addable.** From a Mac, resolving the HP's
  `.local` name took 5 seconds, past the 1.5-second limit, so it was left unmarked. The system lookup inside the
  main box's agent container does not resolve `waitron.local` or `waitron-spare.local` (`ENOTFOUND`
  within 5 ms, 25 November); the HP's own name was not tried there, nor the agent's own lookup. Either way the printer stays addable.
- **The print agent's setup-page link has never been followed on a box.** On the owner's main box
  `WAITRON_PRINT_AGENT_SETUP_URL` and `WAITRON_BOX_ADDRESSES` are both empty, so its agent offers no
  link (`apps/print-agent/src/config.ts`).
- **Photographs and timings of pictures on paper.**
  [Detail](printers.md#photographs-and-timings-of-pictures-on-paper)
- **Whether the 30–40 mm band for the tax QR counts the code's blank border is undecided.** The drawn
  QR's dark squares measured 40 mm on the Epson's 80 mm paper, the top of the band, and it scanned to AEAT's
  pre-production check page. The TM-T88III also prints a QR with its own command (seen 25 November).
- **Printing over RFCOMM from INSIDE the print-agent container (A140).**
  [Detail](printers.md#printing-over-rfcomm-from-inside-the-print-agent-container-a140)
- **A TP-Link UB500 Bluetooth stick does not come up on a box.** Debian's kernel asks for
  `rtl_bt/rtl8761bu_fw.bin`, which the install does not have, so the adapter stays down; the owner's spare
  prints through its built-in Intel radio. Install `firmware-realtek` from `waitron.sh`, and have
  Add a printer say so where a stick still does not come up (seen 25 November 2026).

## Bundle: A print agent somewhere other than the box

4 entries, size L. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1203: install a box as a till, with its own print agent (owner, 2026-10-29).** A venue
  that needs a till with a USB or Bluetooth printer or a cash drawer beyond the main box and the
  spare uses a small Linux box; the print agent already runs on Linux and only dials out, and the
  2026-08-26 printing decision puts agents "on local servers and tills". What is missing is a way
  to install a box as a till only (believed not offered by the USB installer, B3; check first). A
  till whose printer is on the network needs no agent of its own: the main box's agent reaches it.
- **A1204: tills on Windows, macOS and iOS (owner, 2026-10-29).** "Later we may need also to use a
  windows or osx or iOS machine as a till." The till runs in a browser, so the till itself is
  expected to work; a printer or drawer attached to such a machine needs a print agent for that
  platform (a packaged agent, or an app as A1175 is for Android). Not started; network printers
  need none.
- **A1175: an Android app that runs the local print server when the venue runs from Waitron
  Cloud**, and possibly more (owner, 2026-10-28). Brainstorm started 2026-10-29, to be
  resumed with the owner. On 25 November 2026 one Android phone reached a printer over a Wi-Fi without internet and
  the internet over mobile data at once. [Detail](printers.md#a1175-an-android-app-for-venues-run-from-waitron-cloud)

## A1580. Edit printer holds the settings calibration hides

Owner, 2026-11-25: "i can't edit a printer to make it portable, i have to calibrate it. also the cash
register setting. maybe also expose the width and resolution (without the calibration)", then "Build
it" of a picture (`mock-edit-printer.png` in `.impeccable/shots/` on the owner's Mac, not in the
repository). Edit holds, top to bottom: the name (and a network printer's address, as today), Paper
width and Print resolution side by side, "Calibrate printer if you are not sure of these." with the
first two words a link, Cash drawer attached, Portable printer with its hint, and "When picked up" only
while Portable is on. Calibration stays for measuring paper, and the drawer test it holds must stay
reachable. An A4 printer's Edit is unchanged. It follows #4336 and #4342, which change the same screen;
an unfinished start is on the local branch `fix/edit-printer-settings`.

## Decisions and deliberate limits

- **The print agent's setup page has no TLS certificate, on purpose (owner, 2026-09-27).** It asks
  for no password, its matching number is useful only to the manager typing it into the dashboard,
  and once joined the page answers only its own machine. Revisit only if the page ever asks for a
  password.
- **Bluetooth command limits (watcher, 2026-11-16 03:02).** One pending operation per agent;
  exact retries keep their ID and deadline. The server remembers only the last eight expired unpair
  command IDs across all agents, until accepted or evicted. A late result can clear the discovery
  pairing report while that command is remembered.
  **Delete** ends waiting jobs immediately. If a printer was unpaired outside Waitron, delete
  it to end its waiting jobs.
  [Plan](https://github.com/clintongormley/waitron/blob/28f9998ef84db3fb671b1e59a7a5916b0d317da4/docs/superpowers/plans/2026-11-16-bluetooth-pairing-commands.md).

- **Bluetooth print channels (A1578, 2026-11-25).** The agent gives channel discovery five seconds
  and remembers the channel after a successful send, including channel 1 after a failed lookup.
  Success means the kernel accepted the bytes. If paper never comes out, the agent still keeps the
  channel until a send fails or the agent restarts.
  [Plan](../superpowers/plans/2026-11-25-a1578-bluetooth-printing.md).

- **Print jobs keep their rows; finished or abandoned jobs release their bytes after one week**
  (owner, 2026-11-14 17:02, “a week is fine”; watcher cleared all printouts at 17:37 and the
  plan at 17:49; [A1532 plan](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-14-a1532-print-payload-retention.md)).
  The owner’s 2026-10-14 distinction stays: the print queue is for something just lost or failed;
  Reprint makes a marked copy of a finished thermal original while its queue job still has data.
  Orders rebuilds sale receipts and invoices at any age. Expired queue reprints refuse consistently,
  including another printer. Kitchen tickets, refund receipts, payment slips and reports lose their
  queue reprint. Keeping rows preserves receipt-copy audits, invoice delivery and kitchen/resend links;
  failed documents still waiting for a decision keep their bytes. This replaces the one-month period.

- **Document/printer routing scope (A790).** The owner dropped G4/A947, the recovery-origin
  file, browser journal, prepare/accept and duplicate-print protection on 9 November 2026 at
  20:34. Landed foundations grant no cleanup authority. Keep the Printers tab’s A4-printers
  wording; F2 replacement stays separate work; the print queue's Reprint keeps its own printer choice (A661,
  kept by the watcher 2026-11-24, not asked). See the
  [closeout and implementation receipts](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-13-a790-payment-invoice-printer.md).

- **Add a printer lists a Bluetooth device its agent reports paired unless the agent says it is
  not a printer; one whose kind it cannot tell is listed (A404, 2026-11-05).** The owner asked that
  a paired printer stay listed and that a paired non-printer, such as headphones on another
  computer's agent, not be. The paired listing (`bluetoothctl devices Paired`) carries only an
  address and a name, so the agent asks `bluetoothctl info` of each paired device it holds no
  reading for and reads it as a scan does (`parseBluetoothctlInfo` in
  `apps/print-agent/src/bluetooth.ts`: printer icon, imaging class with the printer bit, or the
  Serial Port profile). A device whose `info` failed, did not answer within the paired report's
  deadline, or answered with no icon, class or profile to judge by, or whose agent is older than
  this change, is listed: a hidden paired printer is the fault the owner reported, while a listed
  non-printer only adds a row. Show all devices still lists every device.

- **The guest count is `guestCount` (A988, 2026-10-27).** Till requests use `guestCount` and Split a
  table uses `guestCounts.staying` and `guestCounts.leaving`. An issued sale stores its receipt count
  in `sales.receipt_guest_count`. The route `PUT /api/parties/:id/guests` and the printed document
  field `ReceiptDocument.guests` keep their names.

- **Sample wording (owner, 2026-10-28, A965).** The table and product names follow the sample receipt language. English uses “Outside 6” and “Coffee and toast”; Spanish uses “Terraza 6” and “Café y tostada”. The table name does not repeat the table caption. The synthetic number remains.

- **A receipt's header rows (owner, 2026-10-19, A754).** The first row is the table on the left and
  «Pedido N» on the right (the order alone on the right when there is no table); a printed
  document with no table and order number 0 has no such row (A790). Then:
  - **A simplified receipt** puts its number on the left and the date and time on the right, with
    no captions: the date in words on 80 mm paper and on an A4 page (`18 ago 2026, 11:21`), in
    numbers on 58 mm paper (`18/08/2026 11:21`).
  - **A full invoice**, on every paper, prints «FACTURA» and its number on one row and «Fecha» and
    the date in words on the next, never merged.
  - Since A1566 these rows describe the till rolls only: the A4 page prints its title beside, or
    under it when the title is long, a band in which the date and the order number carry captions,
    whether the invoice is simplified or full
    ([design](../superpowers/specs/2026-11-22-a4-invoice-layout-design.md)).
  - **A long invoice number on 58 mm paper (owner, 2026-10-19, left as built).** A number longer
    than 12 characters (a restored series such as `T-S123456/123`) puts the date on its own line
    under the number; an emergency-length number (31 characters) wraps inside itself with the date
    beside its last digits. The owner was shown that this wrap can read as two numbers and kept it.
  - **Every printed receipt date has a two-digit hour** (`00:34`, never `0:34`), in every receipt
    language, in words and in numbers.
  - When the right-hand value does not fit beside the end of the left-hand text, it drops to a
    right-aligned line of its own, as before (`labelAmountLines`, `packages/printing/src/layout.ts`).
    The printer's sample receipt (`apps/server/src/sample-receipt.ts`) keeps its Spanish «Mesa 6»
    and «Café y tostada» on a receipt in another language: they are internal sample values (owner).
    **2026-10-28:** the owner superseded this sample-name ruling with A965’s translated names above.

  The law asks for the date and sets no format (checked 2026-10-19): a full invoice and a simplified
  one each need «La fecha de su expedición», and Orden HAC/1177/2024 sets no format for a printed
  invoice's date. Neither RD 1619/2012 art. 6 nor art. 7 asks for the time of day (the one «hora» in
  them is a vehicle's hours of navigation or flight). Downloaded 2026-10-19; every «» quote was found
  word for word, by script, in the downloaded text, and two control phrases («formato de la fecha de
  expedición», «la fecha se expresará en formato») were not:

  | Source | Says |
  | --- | --- |
  | RD 1619/2012 art. 6.1.b (full invoice), [BOE-A-2012-14696](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696), last update 31/03/2026 | «b) La fecha de su expedición.» |
  | RD 1619/2012 art. 7.1.b (simplified invoice), same page | «b) La fecha de su expedición.» |
  | Orden HAC/1177/2024, [BOE-A-2024-22138](https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138), last update 28/10/2024 | Every «fecha» in it was read: they concern the records, their generation time, the chain, the QR's contents and the system's declaration. The one date format it states, «La fecha ha de ser completa, es decir, deberá indicar día, mes y año, en ese orden», is art. 15.1.l, the date the producer signs the declaración responsable, not an invoice's. Art. 21 leaves the QR's date encoding to AEAT's technical document («la codificación y formato de la información requerida se especificarán en el correspondiente documento técnico»); that date sits inside the QR, not in the printed text. |

- **A card taken on a connected card machine never opens the drawer, even when the machine prints a
  paper merchant slip (owner, 2026-10-17).** B30's drawer covers only a machine Waitron does not
  talk to; the rare signed slip goes in the drawer through the manual open.

- **A department without a tax-agency description takes the fiscal module's default when the
  description is read, never by writing one at creation (A662 plan, 2026-10-16).** Existing
  departments get it with no data migration. A stored description `parseReceipt`
  (`packages/venue-service/src/department-receipts.ts`) cannot use — blank, over 500 characters,
  or holding a character below U+0020 other than a tab, carriage return or line feed — counts as
  none, so a sale files the default rather than being refused; the dialog, the Departments warning and the printed receipt already read it as absent.

- **TOTAL is printed double size with no asesor question (owner, 2026-10-14).** Orden HAC/1177/2024
  art. 20.1.b asks for the VERI\*FACTU phrase in «un tipo de letra y tamaño bien visibles, similares
  a los del resto de datos de la factura» (quoted from the BOE in
  `docs/compliance/regional-language-rules.md`); with only the TOTAL enlarged, the rest of the data
  keeps the caption's size. The same call as the till screen's larger TOTAL on 2026-10-01 (C115,
  `docs/compliance/verifactu-findings.md`). The VERI\*FACTU line may be printed in bold for margin.

- **The A4 invoice's title and the venue's name are printed larger than the VERI\*FACTU caption
  (owner, 2026-11-22, approving the A4 invoice layout).** It extends the TOTAL entry above to these
  two lines.
  [Design](../superpowers/specs/2026-11-22-a4-invoice-layout-design.md).

- **A ruled line between TOTAL and the tax table on every simplified receipt (owner, 2026-11-05,
  A404).** It reverses A663's "TOTAL, then the rates, nothing between them" for that one line; the
  sample receipt matches (`buildReceiptDocument`, `apps/server/src/receipt-document.ts`).

- **Receipts carry no drink and food subtotals (owner, 2026-10-15).** The owner dropped them from
  A663.

- **After a dish's own discount and a whole-bill discount, a part moved by a split that is not an
  adjustment's prints its own discount in the end row (A663 Part 2c).** A full invoice finds a dish's
  family through the link an adjustment's split leaves; any other split leaves none, so the moved
  part's own discount is counted with the whole-bill one in the end row at its rate. The table still
  comes to the filed bases.

- **The guests line is read when the receipt is built, not when the sale is recorded (A663 Part
  3a), except on a simplified receipt since Part 3b.** Since Part 3b the count a simplified receipt
  prints is fixed when the sale is recorded: the number chosen on the payment screen, or the
  default at that moment, stored once per sale (`sales.receipt_guest_count`, read by `readPrintedGuests`,
  `apps/server/src/receipt-guests.ts`). Every later copy of that receipt prints the same number;
  the owner, 2026-10-16: «it should remain the same otherwise it isn't a true duplicate». The rule
  below now holds only for a full invoice and for a sale recorded before Part 3b. There, a later
  copy reads the party as it is then: a count changed after payment, or a new bill
  the party opens after paying, changes or removes the line on that copy, while the order label
  stays as recorded. While a party, with any party joined into it, holds more than one bill that is
  not abandoned (the bills of joined tables, or a split by item), none of those bills
  prints the line, and nor does a bill of a party joined into another (`readReceiptGuests`,
  `apps/server/src/receipt-guests.ts`).

- **Optional receipt formatting (A366 slice 7).** The `receipt-print.test.ts` case that throws
  from `formatReceipt` retains one sale, tender, header and drawer, then replays without another
  fiscal record or drawer. Explicit copy failure remains a refusal. This retires the earlier
  proposal to contain automatic QR-formatting failures; no native-QR fallback was added.

- **Emailed invoices have no consent step (owner, 2026-10-09).** "We don't need customer consent
  to send them an email; just giving us the email address is sufficient." A231q's tasks C1a and
  C1b removed consent from the staged choice, the delivery rows and their retries.
  This is a product
  decision, not a legal conclusion: A448 stays open.

- **A calibration drawer opening records who asked and when, not that the drawer opened.** There is
  no drawer sensor; the audit row is the request.

- **Printer details follow the dashboard's own language, not the venue's** (ruling I) — a
  recorded departure from the spec, which asked for the venue language.

- **A raw device can become addable after its office-printer query fails.** The server keeps each
  agent's latest report; another agent's fresh office mark at the same raw address keeps the raw
  row classified. Capability reports are lent only between agents reporting the same known IPP
  queue. IPP-only rows remain office rows when their query is unanswered. This fail-open cost for
  an unknown raw device is accepted.

- **Two review suggestions on #335 were deliberately not taken** and would be relitigated otherwise:
  renaming the error code `printer.probe_busy` (kept under the domain-naming rule, per #335's
  commit message), and deduplicating targets in the agent host (the issuing server already
  normalises and deduplicates its bounded list of eight).

- The dashboard's "Test open drawer" calibration
  (`POST /management-api/printers/:id/test-drawer`) opens any active printer's drawer for a
  manager holding both `hardware.manage` and `cash.drawer`, with no per-till check — left as it
  is (owner, 2026-10-02).

- **A receipt prints in one language; the venue's is the default, and staff may choose another
  at the till (C113, owner 2026-09-30, #1014; amended by A497, owner 2026-10-11).** The venue's
  receipt language is the first entry of its saved list (`settings.venue.invoiceLocales`); **in
  Catalonia it is fixed to Catalan**
  ([regional-language-rules.md](../compliance/regional-language-rules.md), Catalonia). A choice
  made at the till is saved on the order (`working_orders.receipt_locale`) and read by every path
  that files the order's sale (`saleLanguageFor`, `apps/server/src/venue-locale.ts`). The chosen
  language sets the receipt's fixed words, its dates and amounts, and the department's subtitle and
  footer. **Dish names, variant names, units and option answers are stored once, in the venue's
  default content language, when a line is added, and print in it whatever receipt language is
  chosen** (`packages/menu/src/default-language-text.ts`); no translated dish names (owner,
  2026-10-11). Until A497, no choice was offered when the original printed.

- **A copy can be printed in another receipt language (C114, #1022; narrowed by A497, owner
  2026-10-11).** The till's choice and a copy are both offered in the venue's receipt language,
  then in each of the pack's receipt languages (Spanish, Catalan, Galician and Basque today) that is
  one of the venue's content languages (`readOfferedReceiptLanguages`,
  `apps/server/src/venue-locale.ts`); a copy is also offered in the sale's own language. No English
  receipts (owner, 2026-10-11). Spanish stays offered in Catalonia, where it is a required content
  language (`packages/country-es/src/spain.ts`), as the customer's right there on request (Spain's
  Constitutional Court, ruling 88/2017;
  [regional-language-rules.md](../compliance/regional-language-rules.md), Catalonia). Until A497 a
  copy was offered in every receipt language the pack has.

- **A Valencian venue is not offered Catalan receipts (owner, 2026-10-11).** Content and receipt
  languages match by exact code, so a `ca-ES-valencia` content language does not offer `ca-ES`
  (`offeredReceiptLanguages`, `apps/server/src/venue-locale.ts`).
- **Stored print data is not compressed (watcher, 2026-11-15 23:01, database growth work).** The one-off saving measured, 156,401,664 bytes, did not justify about 430 lines of code and making every later reader unpack it.
- **Staff are not shown a message for a chosen invoice copy (email or office printer) that was never queued (watcher agreed, 2026-11-18 07:09; not the owner's).** Tracing found no venue event that leaves one unqueued: a removed contact, printer or invoice-printer listing each leaves a delivery row the till already shows. The plan's words: "The recommendation (DEFAULT 1) is not to build it. The tracing below found no event at a venue that leaves a chosen copy unqueued".

## Shared office-printer queues

Receipt and office printers share the `printers` table ([A1308 dv4](https://github.com/clintongormley/waitron/blob/0a049fa0ff84a09bb0eb863af66338c63ebeb087/docs/superpowers/plans/2026-11-08-a1308-dv4-a4-printers.md)).

After A576, check two IPP queues on one real print server from the shipped print-agent container.
Add Kitchen A4 and Reception A4 separately and print distinguishable pages to both. Record the
announced server name, each queue path and where the paper emerges. Repeat with one queue
unavailable and an already saved single-queue printer. These physical checks remain open.

The discovery caption uses the announced server hostname, with the local suffix removed, when
available. It falls back to the routing address when no server name was announced; it does not
construct a friendly computer name from a printer label.

## Loose ends left by C107 (#974)

- **Whether a job of pictures still needs the print area (`GS L`/`GS W`) that receipts, category
  pages and the test page send is not measured.** The calibration ruler page sends a print area of
  576 dots whatever the printer. Left open by C107 (#974).

- **At 203 dpi a line could hold 32 columns on 58 mm paper (384 ÷ 12) and 48 on 80 mm (576 ÷ 12); it
  keeps 30 and 42.** Left open by C107 (#974).

- **The 28-dot line cuts letters: by the generator's own report, 67 of its characters lose at least
  one dot that was half inside the letter, most of them accented capitals losing the top of the
  accent.** Measured 2026-10-01 with a copy of the generator: a 30-dot line with the baseline 24
  dots down leaves 3 (ď, ĥ, ŉ), and 31 or 32 dots still leave those 3. Left open by C107 (#974).

- **The preview reads at most 4 MiB of a job and shows at most 2,048 blocks (one per printed line,
  feed, cut or QR code, among others), so a job of more than about 2,040 lines is cut short at any
  width.** The deep-tree case in `apps/server/src/category-sales-page.test.ts` printed about 14,500
  lines on 58mm paper once rows carried their whole path (W73). Left open by C107 (#974).

- **What a printer narrower than 576 dots does with the part of the ruler beyond its head is not
  measured.** The preview shrinks a picture wider than the job's line instead of cutting it, so on
  the ruler page, whose captions are 360 dots wide, the 576-dot ruler is shrunk on every printer.
  Left open by C107 (#974).

## A552. Invoices on the owner's office printer: a multi-page invoice and power loss

Owed on
the HP Color LaserJet MFP M181fw: a multi-page full invoice through the product, on a build with
A1566's layout (#4163), and the same invoice as Apple Raster at 600 dpi.

On 2026-11-25 (build `c8feeb29c9`) a test page printed. With no paper, the till, the alert and Print Queue said so within
about 20 seconds and the invoice printed by itself once paper was back. With the power cut mid-print, the
delivery became `unknown` after two minutes and nothing was sent again; the printer printed nothing when it came back, and Orders printed the
invoice unmarked, as the original. What the till lacks there is A1582.

How long the box takes to draw a page (A553, measured 2026-11-20 on the Lenovo M710q, i7-7700T):
the server's `renderInvoicePage` from main `58508d7fe8`, bundled as the server is and run on the
Node and sharp of the box's image `eca67e9dcd`, in a separate container with no network and
nothing sent to a printer. The one-page sample invoice drew as PWG raster in 520–538 ms the first
time and 334–350 ms after, at 300 dpi, and in 1,417–1,422 ms then 1,178–1,229 ms at 600 dpi; Apple
Raster took the same within 30 ms. The process's peak memory rose from about 117 MiB before drawing
to about 211 MiB after one page at 300 dpi and 279 MiB at 600 dpi, and to 251 MiB and 357 MiB
after three pages in a row. A multi-page invoice was not drawn.
