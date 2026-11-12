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

**Brainstorm started 2026-10-29; paused until the owner is back on 3 November**, when the device
test below runs.

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
  `Network.bindSocket`/`openConnection`). A web page has no such choice. The test below would
  settle it.
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

- The device test: "it would be interesting to try regardless". It stays queued.
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

**The device test, queued for 3 November (owner, 2026-10-29: "Perhaps queue it instead").** A
throwaway Android app, then a run at the owner's home:

- An Android tablet or phone with a SIM and mobile data, on a Wi-Fi in `192.168.10.x` whose internet
  is cut (block the device's internet in UniFi, or unplug the gateway's fibre).
- The app shows whether Android believes that Wi-Fi has internet. If it says yes, the run proves
  nothing and the cut has to be fixed first.
- It prints to the Epson TM-T88III at `192.168.10.81:9100` over Wi-Fi a ticket carrying the public
  address it fetched over mobile data at the same moment. That ticket is the proof.
- Controls: the same fetch tied to the Wi-Fi must fail, and a printer connection tied to no network
  may fail (the owner's concern, shown).
- It keeps both connections for some minutes, since Android may drop a Wi-Fi that has no internet.

Nothing is built or installed for it yet. Installing Java 21 (`openjdk@21`) and Google's
command-line Android tools (`android-commandlinetools`) through Homebrew on 2026-10-29 hung for
about 30 minutes, every Homebrew process idle at its sandboxed unpacking step, and was stopped;
the cause was not found.

## A790: document and printer routing plan

A790 remains open for dashboard routing and its separate browser preference, and subsequent
integration checks. The [order-linked till slice](../superpowers/plans/2026-11-09-a790-till-document-printer.md)
releases A739’s prerequisite for sales with an order (watcher approval, 9 November 2026 at23:14).
A739 owns its payment window and final-entry changes, including the separate handheld paid view;
A840/A842/A848 follow as one change.

From Transactions, an orderless historical F1 uses its device’s Invoice printer for an original
or copy on A4 or receipt paper. Receipt offers a compact copy after an original completes.
F2 A4 remains unavailable; A739 supplies order-linked Receipt Email. F2-to-F1 replacement remains separate fiscal work.

The payment-time mixed-printer choice remains in A790: a printed full invoice should offer the
profile's Invoice list, including receipt-paper printers, using the device's saved choice and then
the profile default. Do not mistake #2640's ticket-view chooser for that payment change. Also retain
the queued Devices-table A4 marker follow-up for its Invoice printer value. Keep the Printers tab's A4
printers wording and A661's separate print-queue Resend policy question.

G4, the recovery-origin file, browser operation journal and two-stage prepare/accept exchange are
dropped entirely for remaining A790; nothing here or in A739/A840–A848 waits on A947. Do not plan a
new table, ledger, all-writer revision or duplicate-print protection. Already landed foundations
are not cleanup authority. The historical design and plans carry dated supersession pointers;
their old machinery and release gates do not govern the remaining slices.

## Show a failed automatic invoice copy to staff

`reserveStagedInvoiceDelivery` returns `undefined` after its failed reservation is rolled back;
`enqueueSaleReceipt` then skips the paper original.

Trace the working-order issuance and bill-payment answers before choosing a till message,
retry or alternate-copy action. Keep the saved delivery choice, original/duplicate rules,
operator permissions and sale facts. Do not silently select paper as a substitute for the
chosen destination.

## What the AppArmor profile (A129, #862; A134, #887) left open

- **`trust` is still refused.** A property write (`trust`) and `Disconnect` were measured still
  refused against the stand-in BlueZ; BlueZ's `Agent1.Release` is not allowed either; the stand-in
  never sends it, and whether a real BlueZ does is still open.
- **Box check owed:** after `sudo bash waitron.sh install`, switch off the kernel's rate limit on
  its log first (`sudo sysctl -w kernel.printk_ratelimit=0`), which can drop refusal lines —
  image-smoke switches it off for that reason. Then `scan on` / `scan off` and a pairing from
  `docker compose exec -it print-agent bluetoothctl`, then
  `sudo journalctl -k --since '-5 min' | grep 'apparmor="DENIED"'` should print nothing for
  `waitron-print-agent`.
- **The setup page's HTML says nothing about Bluetooth availability** — only `/status.json` and the
  log do. The page is English-only, with no language switch to carry a Spanish line.
- **A bus policy that refused BlueZ's own calls would read as `no_controller`**: measured
  2026-09-29 on a CI runner against the stand-in BlueZ, with a profile that allowed the bus
  daemon's own messages but no message to BlueZ: `bluetoothctl --timeout 3 devices Paired` printed
  "No default controller available" and exited 0.
- **`bluetooth scan failed` is logged on every pass** (left by A131, #915), where the agent's other
  Bluetooth failure lines are logged once while the same failure repeats, so a box with no adapter
  logs one line per pass while a discovery window is open.
- **On the LAN the Bluetooth report is visible only before joining or while out of touch.** Once
  the agent has joined and is not out of touch, `/status.json` answers only loopback callers
  (`networkRefused`, `apps/print-agent/src/setup-page.ts`).

## A device unpaired outside Waitron still reads as paired for a short while

- **A device unpaired outside Waitron still reads as paired for a short while** (found in C103's
  review, narrowed in A405's, read, not run). The server calls a Bluetooth device paired while the agent's last
  "paired" report is fresh (`isListed(pairedAt)`, `apps/server/src/print-api.ts`: 45 seconds while
  a discovery window is open, 15 otherwise). A successful Unpair sent from Waitron now clears that
  report; a device unpaired some other way, such as on the printer itself, keeps it, so Pair again
  can find it still paired and switch it on without pairing it. Clearing `pairedAt` when an
  agent's paired list leaves the device out would end it, but the pull handler does not yet tell
  an empty list from an absent one.

## An agent compares the server's discovery deadline with its own clock

- **An agent compares the server's discovery deadline with its own clock** (found in C102, read, not
  run). `discoveryUntil` is a time on the server's clock, and the agent checks it against
  `host.now()` (`packages/print-agent/src/agent.ts`), where a network probe's deadline is sent as a
  duration because the two clocks can differ. An agent on another machine whose clock is out by
  minutes scans for the wrong span; one on the box shares its clock.

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

The owner's photographs of a receipt, a kitchen
ticket, the ruler page, a sample receipt and the test page (C108) on both printers are owed, and
so are the box's timings (what to time: `docs/developers/testing-guide.md`, "How long a job of
pictures takes to print on the box is not measured"). Anything the timings or photographs show
wrong becomes a new item.

## Repeat the 58mm physical receipt after the print-area fix

The owner's wider printer clipped
the right edge of a 58mm receipt whose payload centred without an explicit print area; whether the
printer's own width setting also contributed was not tested. The corrected paper output has not
yet been printed. Since C107 the print area is the image's width — 360 or 384 dots on 58 mm paper,
512 or 576 on 80 mm.

## Nobody has yet typed a real printer's address into Check a known address

The owner's home is
the case that motivated it: the box sits on 192.168.10.x and the HP LaserJet on 192.168.20.x,
which the port-9100 sweep cannot reach. The first things to try on the box: add the Epson at
`192.168.10.81:9100` (the sweep should also list it) and print to it; then type the HP's
`192.168.20.56:9100`, which should come back as an office printer.

## The setup-page link is unproven on the box

The print agent builds it from
`WAITRON_SETUP_URL` (set on the box as `WAITRON_PRINT_AGENT_SETUP_URL`, which `deploy/compose.yml`
passes through), or from the first of `WAITRON_BOX_ADDRESSES` (`apps/print-agent/src/config.ts`);
no review seat ran the deployed compose and nobody has yet followed the link from a dashboard on
the real box.

## Bluetooth at the box

A first real pairing, and an Unpair, through the dashboard and the
agent, under the shipped AppArmor profile with bluetoothd's `autopair` plugin off — nobody has
yet paired or unpaired a real printer through the dashboard. `waitron.sh install` switches
`autopair` off with a systemd drop-in where it can (`deploy/README.md` says when it leaves
Bluetooth alone), and the operator then types the PIN, 0000 for a 0000 printer; that drop-in was
tried on a GitHub runner, where the Bluetooth service itself never ran, and has not run on the
owner's box. Also owed: whether a real Bluetooth service sends `Agent1.Release`, which the
profile does not allow and the CI stand-in never sends; what the box's real adapter reports as
paired; time a pairing through the dashboard (whether scanning while pairing slows a real pairing
is not measured — the agent keeps scanning through a pairing because skipping the scan would drop
every unpaired device from the list).

## Printing over RFCOMM from INSIDE the print-agent container (A140)

A real RFCOMM connection
and print from inside the container under the shipped profile — CI's runners cannot load
Bluetooth at all — and whether the printer gets every byte before the connection closes. The
owner printed on channel 1 from the host only. image-smoke runs the helper directly with its own
arguments, not through `RfcommTransport`, and only as far as creating the socket; and
`scripts/deploy-image-env.test.ts` reads the Dockerfile and `package.json` as text, so it does not
prove the bundle's default helper path resolves inside the image. The helper's 20 + 20 second
connect and send timeouts and the agent's 5-second grace (`apps/print-agent/src/rfcomm.ts`) were
not measured on the box.

## The owner's Bluetooth printer was listed only under Show all devices (A137) — the cause on the box is not confirmed

It needs the fixed image on the box first: run
`docker compose exec print-agent bluetoothctl --timeout 6 scan on`, then
`docker compose exec print-agent bluetoothctl devices`, and record how many devices are listed
and where the printer falls among them; then unpair the printer with Waitron's Unpair, which also
switches it off, since Add a printer lists a paired Bluetooth device unless its agent's `info`
reading says it is not a printer, and a switched-on printer's device, whether or not a scan marked
it (A404); restart the print agent (`docker compose restart print-agent`) and wait a minute, so neither
the agent nor the server holds an earlier reading of the printer; open Add a printer repeatedly, record on which scan it is first listed
without Show all devices, and look for `bluetooth info failed` lines in
`docker compose logs print-agent`.

A404 (2026-11-05) found that each plain report from the agent dropped the printer mark an earlier
scan had set, which hid a paired printer between scans; that may also explain this entry (not
checked on the box).

## Still counted by the printer's `printer.jobs_waiting` alert after A167 (#975)

- **Still counted by the printer's `printer.jobs_waiting` alert after A167 (#975)**, measured with
  throwaway cases and not pinned: (1) when every dish a failed ticket carried for a station moves to
  another bill, that bill's printed Reprint clears the table's problem, but the ticket's link to the
  bill it was fired on is never covered, so the printer's alert keeps counting it. The table also
  drops a problem once a Reprint would print nothing there (`readReprintTargets`), which the alert
  does not. (2) A Printers-screen resend of a kitchen ticket carries no kitchen links, so when that
  resend runs out of attempts, a later printed till Reprint does not clear it from the printer's
  alert (the table clears).

## The virtual PDF printer

- **The virtual PDF printer**, and a `print_jobs` retention sweep — nothing deletes a job today.
  **Finished jobs are kept for one month** (owner, 2026-10-14); a reprint from the print queue is
  for something that just failed or went missing, and the Orders screen rebuilds a receipt or
  invoice from its sale at any age. Receipt copies wait until the `receipt_reprints` question
  below is settled. Venue-wide retention is A664. Deleting a print job also deletes its `kitchen_print_jobs` link rows (the key is
  `ON DELETE CASCADE`). Deleting a failed job's links clears its printing problem, and deleting a
  printed reprint's links brings back the failures it cleared, so a sweep must remove a bill's
  kitchen print jobs all together or not at all. It must also keep or remove a resend chain
  together: deleting a printed resend brings back the "in trouble" state of the job it copied (for
  a resend of a till Reprint, also the original kitchen ticket's alert and the table's problem that
  it cleared), and deleting a chain's first job while a resend still names it is refused by the
  `resend_of` key (read, not run). A receipt copy now adds an append-only `receipt_reprints` row
  with a required `print_job_id` key using `ON DELETE RESTRICT`
  (`packages/db/src/schema/receipt-reprints.ts`); include that audit link when designing retention.
  Whether a future replication drain can carry the audit row to a node without its print job is
  unverified and needs a test when that drain is built.

## Reprint kitchen tickets and other printouts laid out again for any printer

- **Reprint kitchen tickets and other printouts laid out again for any printer (left open by A405
  point 4, #2678).** Receipts and full invoices are laid out again from the sale. Every other job keeps
  only its finished bytes, so Reprint copies them: kitchen tickets and refund receipts to an
  active receipt printer at least as wide, centred; everything else to its own printer only.
  Laying them out again needs each job to keep the printer-independent document it was built from,
  with a version number, in a new `print_jobs` column, and each builder (`formatKitchenTicket`,
  `formatCorrectionSlip`, `formatPaymentSlip`, `formatCategorySalesPage`,
  `formatTenderRefundAcknowledgment`) to draw from it; a job whose version the running code cannot
  read falls back to today's rule. Also open: whether kitchen tickets, payment slips and reports
  need an A4 page, or A4 printers stay out for them.

## A Used by link to a prep station opens the Stations tab, not the station

- **A Used by link to a prep station opens the Stations tab, not the station (left open by A405).**
  The prep stations screen writes its `station` address word back to null
  (`packages/venue-service/src/dashboard/prep-stations-screen.ts:199`).

## Find a bill's pay offers no guests field

- **Find a bill's pay offers no guests field (left open by A663 Part 3b).** A bill collected from
  Find a bill (`apps/till/src/widgets/find-bill-dialog.ts`) sends no guests count. A bill with no
  invoice yet is recorded then, and stores the count that would print by default at that moment;
  one already invoiced by an unpaid departure keeps the count stored at the departure
  (`issueUnpaidInvoice`, `apps/server/src/working-order.ts`), because collecting it records no new
  sale (`runCollectOrder`, `apps/server/src/till-sale.ts`). Either way the waiter cannot choose
  another number, or leave the line out, there. The owner's decision
  of 2026-10-16 put the «Comensales» field on the payment screen only; this records the gap
  without deciding whether Find a bill should ask too.

## The till's on-screen receipt is a second copy of the layout

The till draws a sale's receipt
itself (`apps/till/src/screens/till-ticket-view.ts`): `netFacts` prints its own «Precio sin IVA
… / 1 ud» line, and the item and summary VAT lines print the rate as the sale carries it («21.00%»
for a filed sale), so A663's rate spelling, its simplified-receipt layout, and its item table, do not reach it. It
also still prints «4 ud» where paper now prints the bare count «4» (owner, Q8), labels each
rate's base «Base» (`labels.base`) where paper now prints «Base imponible» (owner, Q11, for one rate; Part 2b's own decision for several), and a full
invoice's discounts with VAT where paper now prints them before VAT: the till shows each discount
of a dish under the dish and a whole-bill discount once, where a printed full invoice shows a
dish's own discount under it and the whole-bill discount once per rate at the end of the table. Bring it
into line with the printed receipt; A661 (#1745), which changed that file, has landed. It does
not show the «N comensales · por persona» line either, which paper now prints (A663 Part 3a), nor
paper's header rows (A754): on every sale it shows captioned invoice-number and date rows, the
date in words, with the table and order on a line beneath them; it does pad the hour to two
digits as paper does.

## On an A4 full invoice, a caption and its amount can split across pages

- **On an A4 full invoice, a caption and its amount can split across pages (left open by A663
  Part 2).** The A4 page draws an amount row's caption first, then its amount right-aligned
  (`layoutInvoicePages`, `apps/server/src/invoice-page.ts:277-281`). When the amount does not fit
  beside the caption's last line, it takes a line of its own, and if the page is full there it
  moves to the next page, leaving its caption at the foot of the one before. Keep the two
  together: make room for the caption's lines and the amount's line before drawing either.

## The A4 item table's header can sit alone at a page foot

- **The A4 item table's header can sit alone at a page foot, and later pages repeat no header (left
  open by A663 Part 2).** The A4 page draws the table's header row and each item row as separate
  rows, each checking only its own room (`apps/server/src/invoice-page.ts:259`, `tableRow`). The
  header can therefore end a page with the items starting on the next, and a table that runs onto
  a further page shows no header there. Keep the header with the first row, and repeat it at the
  top of each continuation page.

## Quantities print with "." whatever the receipt language

- **Quantities print with "." whatever the receipt language** («0.35 kg» on a Spanish receipt).
  `buildReceiptDocument` (`apps/server/src/receipt-document.ts`) writes quantities into the
  receipt as their digits: an item's quantity in its line or in the full invoice's table, and an
  option's quantity in its caption. Print the language's decimal mark there
  («0,35 kg»). A663 keeps today's form. The till has the same gap: "Quantity-display follow-ups
  found while tracing A313" in
  [backlog.md → Users, sign-in and the dashboard shell](../backlog.md#users-sign-in-and-the-dashboard-shell).

## A command queued behind a slow pair can run out of time

The 120 seconds count from queueing
(`enqueue` in `apps/server/src/printer-bluetooth-commands.ts`), the agent runs commands one at a
time (the background worker in `packages/print-agent/src/agent.ts`), and one pair can take the
agent up to about 90 seconds (`REGISTER_TIMEOUT_MS`, `PAIR_TIMEOUT_MS` and `EXIT_GRACE_MS`,
10, 75 and 5 seconds, in `apps/print-agent/src/bluetooth-command.ts`). A second command
waiting behind that pair can therefore expire on the server before it runs; its outcome is
then ignored and the screen says "No answer from the print agent — try again" whatever
actually happened.

## A failed Pair or Unpair shows the agent's reason as the agent wrote it, in English on both languages' screens

- **A failed Pair or Unpair shows the agent's reason as the agent wrote it, in English on both
  languages' screens** (a wrong PIN would read "No se pudo emparejar: wrong PIN"). Most of what the
  agent reports for a pair is a fixed phrase (`apps/print-agent/src/bluetooth-command.ts`). A
  follow-up could translate the known phrases into dashboard wording in both languages and keep the
  raw text as a detail; nothing here says what a given BlueZ error always means on a real printer.

## An Unpair outcome that reaches the server after it dropped the command leaves the printer on

- **An Unpair outcome that reaches the server after it dropped the command leaves the printer on**
  (120 seconds, `COMMAND_TTL_MS` in `apps/server/src/printer-bluetooth-commands.ts`); the owner can
  delete the printer to stop it and end its waiting jobs. The printer's waiting jobs otherwise stay
  in that case, after a server restart (the command store is held in memory), and for a printer
  unpaired outside Waitron.

## A print agent cannot be discarded when the join window shuts (A269, owner 2026-10-04) — OPEN

A268 discards a waiting device's request when the last Add dialog closes. An agent told
`not_approved` stops and needs resetting on its own setup page (`packages/print-agent/src/agent.ts`,
the `not_approved` branch), so its request outlives a shut window instead. **Next action:** find a
path, for example an agent that asks again on its own after a refusal, so agents follow the
device rule. Spec: [A268 §4](../superpowers/specs/2026-10-04-add-a-device-design.md#4-pairing-on-the-server).

## One "Receipts" settings page, with a live preview (C116, #989; C120, #1000; C121, #996) — still open

- No test pins what the two removed addresses, `/manage/receipt` and `/manage/location-settings`,
  open now; a reading of the router says the overview page, which nobody has run — #993 added
  that test for `/manage/sections`.
- The paper-width dropdown names widths only, not printers, so two printers of one width at
  different resolutions cannot be told apart (owner's call).
- Re-check whether printer and device changes refresh the offered widths while the page stays
  open. The 2026-10-01 probe found no refresh after `printers` or `tills` invalidation, with
  `tenant_receipts` as its positive control. That receipt describes the earlier page: A238
  retired `tills`, W111 added location-address refreshes, and A366 slice 7 replaces the editor
  and its preview triggers. The printer/device case has not been re-probed on that branch.

## Left open by #1261's review, not acted on (2026-10-05)

- **Left open by #1261's review:** no database trigger protects the logo image; the app-level
  department receipt usage refuses a library delete. The phone and email length limits (30 and
  254) are copied into `apps/dashboard/src/screens/department-receipt-editor.ts`, separately
  from `packages/layouts/src/validate.ts`.

Since A841 slice 7, a theme's logo (`theme_logo` in `listImageUsages`) is a second logo use that
only the app keeps from deletion; no trigger protects it either.

## Loose ends left by #367

- Follow-up (ruling C): the preview no longer shows the QR link as text for a raster receipt. A
  possible fix is to carry the link alongside the print job so the preview can still show it as
  text.
- Deferred (ruling H): decide whether to warn when no legal QR dot size exists. Re-check the
  valid-link range with `apps/server/src/qr-link-range.test.ts` before changing the fallback.

## Loose ends left by A663 Part 3b (#1827)

- The default guests count is worked out twice, kept equal by hand: on the till to fill the
  field (`defaultReceiptGuests`, `apps/till/src/state/receipt-guests.ts`) and on the server when
  no count is sent (`storableDefault` and `readReceiptGuests`, `apps/server/src/receipt-guests.ts`).
  A change to one that misses the other shows the waiter one number and stores another.
- Leaving the payment screen after changing the count asks nothing, while a typed tip or cash
  amount does ask. The plan chose this; the owner has not said whether leaving should ask.
- Some code names holding the guest count still say `guests` after A988 (#2163), which renamed
  only the wire fields and the drizzle property: `readBillGuests` and `guestsOfParty`
  (`apps/server/src/receipt-guests.ts`, `apps/till/src/state/receipt-guests.ts`),
  `setPartyGuests` (server `parties.ts`, `till-api.ts`; till `api/client.ts`, `till-app.ts`), and
  `#savedGuests` (`apps/till/src/screens/till-table-order-screen.ts`). Renaming
  them to `…GuestCount` is free before go-live; no behaviour changes.
- On the bill-paid-in-parts dialog, a count marked wrong stays marked after Back
  (`guestsAttempted` is cleared only on a new payment, `#startAgain`,
  `apps/till/src/widgets/bill-pay-dialog.ts`), and a server refusal naming `guestCount` shows only at
  the bottom: `refusalField` has no `guestCount` case.
- `#onConfirmPayment` and `#onPayTab` (`apps/till/src/till-app.ts`) pick one of several call
  shapes only so older tests that pin the exact argument count keep passing; one call per path
  sends the same request.

## Loose ends left by A661 (#1745)

- The print queue's Reprint, on its own printer or another (A405, #2678), does not follow the
  till's rule for a full invoice's printer. A till refuses to resend an original a print request
  sent, when that printer is not the till's invoice printer (`receiptPrinterWithdrawn`,
  `apps/server/src/invoice-delivery-status.ts`). The dashboard's
  `POST /management-api/print-jobs/:id/resend` (`apps/server/src/print-api.ts`) does not apply that
  rule, and since A405 it can send a full invoice's original that never printed (out of delivery
  attempts, or still waiting on a disabled or unseen printer) to any other active receipt printer.
  Decide whether a manager's reprint should.

## Loose ends left by A663 Parts 1a, 1b and 2 (#1748, #1756, #1768)

- [The till's on-screen receipt is a second copy of the layout](#the-tills-on-screen-receipt-is-a-second-copy-of-the-layout).
- [On an A4 full invoice, a caption and its amount can split across pages](#on-an-a4-full-invoice-a-caption-and-its-amount-can-split-across-pages).
- [The A4 item table's header can sit alone at a page foot](#the-a4-item-tables-header-can-sit-alone-at-a-page-foot).
- [Quantities print with "." whatever the receipt language](#quantities-print-with--whatever-the-receipt-language).
- Equipment labels draw their double-size heading by hand (Part 1a).
  `apps/server/src/equipment-label.ts` scales a `drawTextBand` picture itself; `@waitron/printing`
  now draws double-size lines (`line(…, { double: true })`). Move the heading onto it and check
  its layout, which uses a different grid.
- Receipt test tidy-ups (Part 1b). Six receipt test sites repeat the same filter that skips dashed
  rule lines; give them one shared helper beside `printedLines`
  (`apps/server/src/testing/decode-ticket.ts`). `receipt-preview-api.test.ts`'s `legal()` and
  `nif()` can be plain constants.

## A960. On an 80 mm roll in Basque, a full invoice with more than one VAT rate prints a full comp's «Deskontua 100%» with «100%» on its own line under the figures (left open by A758-4).

The receipt table (`apps/server/src/receipt-table.ts`) wraps item text longer than the item
column — 14 characters on that bill, narrowed by the VAT-rate column, less a 2-character indent
for a row under a dish — just as a 100% percentage discount or a long dish name already wraps
there. Decide whether a short label should be kept whole. The wrapped text is pinned in
`apps/server/src/receipt-ticket.test.ts`, in the case "prints F1 reductions before VAT, at their
rate, on '80mm' in 'eu-ES'".

## A961. On a full invoice, a dish's discount row that no single comp names prints «Descuento 100%» whenever every line at its rate was filed at zero (left open by A758-4).

`named` is null
when no one adjustment names the row, for instance a dish with two or more comps of its own
(`GroupDiscount`, `apps/server/src/receipt-figures.ts`), and the row then falls back to the
zero-base flag. A finish-branch probe on 2026-10-21 rendered two €6.00 amounts that took a €12.00
dish to zero as one «Descuento 100%» row, where the ticket prints them as two steps, «Descuento
50%» and «Descuento 100%» (A803 slice 1's decision, [till.md](till.md#decisions-and-deliberate-limits)).
And a dish taken to zero by two comps of its own plus a bill comp prints «Descuento 100%» beside
only its own part (the A758-4 plan's owner point 3). Owner to confirm.

## A department's receipt logo save re-checks only the image's revision, not its id

- **A department's receipt logo save re-checks only the image's revision, not its id** — found in
  A841 slice 7's review, read, not run. The theme logo save compares both, because an image deleted
  and uploaded again under the same name during a save is a different image
  (`apps/server/src/theme-logo.ts`, `recheckThemeLogo`); `apps/server/src/department-receipt-api.ts`
  compares `revision` alone.

## A copied department receipt that names `logo` twice, or once more as `"logo\u0000"`, may split its two readers

- **A copied department receipt that names `logo` twice, or once more as `"logo\u0000"`, may split
  its two readers** — believed from A841 slice 7's review, not run through a receipt.
  `packages/media/src/images.ts` reads a department's logo with SQLite's `json_extract`, which takes
  the first of two equal keys, while JavaScript takes the last, and reads a key spelled `logo` plus
  a NUL character as `$.logo` (measured: SQLite 3.54.0, `{"logo\u0000":"fake","logo":"real"}` gives
  `fake` there and `real` in JavaScript), and `validateReceiptFields` (`packages/venue-service/src/configuration-transfer.ts`) does
  not look at the logo. A copied theme with a repeated key is refused
  (`packages/layouts/src/theme-configuration.ts`); a receipt is not.

## Bundle: One session at the real box: printers, paper, tax QR, the drawer

Hardware and inbox checks to complete in the owner session.

- **A739 physical payment and delivery qualification.** On the real till, printer and reader,
  check the payment window and final Receipt / Full invoice / None choice; original and copy
  paper output; requested card slips after a confirmed capture and Print a copy before full
  payment; and Receipt Email arriving in the intended inbox. No physical printer, reader or
  inbox qualification was performed by the software cuts. The watcher moved these remaining
  checks here on 11 November 2026 at 17:20; they add no prerequisite to A840/A842/A848.
- **The spare file's size is measured on HFS+ and Linux tmpfs only** — not ext4, copy-on-write
  filesystems, or a `logs` volume on another disk. Left open by A1127.
  [Detail](setup.md#the-spare-files-size-is-measured-on-hfs-and-linux-tmpfs-only)
- **Measure the backup room note's `venue.db` identity on the box's filesystem** (likely ext4, inside Docker),
  including whether the birth time is reported. Left open by A1167.
- **A773 physical-till trial: dragging.** Try long-press movement of New order lines and held
  headings on a physical till. Keep drag only if it works reliably; Move to… and the held heading's
  Move earlier/later actions remain available. Browser gesture checks do not settle this choice.
  [Spec §11](../superpowers/specs/2026-10-16-a773-courses-and-groups-design.md#11-left-for-later-backlog)
- **A773 physical-till trial: serving part of a line.** Try marking part of a line served through
  the dish window during service. Decide whether it is practical before changing that workflow.
  [Spec §11](../superpowers/specs/2026-10-16-a773-courses-and-groups-design.md#11-left-for-later-backlog)
- **What the AppArmor profile (A129, #862; A134, #887) left open:** **`trust` is still refused.** **The setup page's HTML says nothing about Bluetooth availability** — only `/status.json` and the log do. [Detail](printers.md#what-the-apparmor-profile-a129-862-a134-887-left-open)
- **Loose ends left by C107 (#974).**
  [Detail](printers.md#loose-ends-left-by-c107-974)
- **Loose ends left by #367.**
  [Detail](printers.md#loose-ends-left-by-367)
- **Shared office-printer queues need physical qualification after A576.** From the shipped
  print-agent container, discover two queues on one computer, add both and print distinguishable
  pages to each. [Detail](printers.md#shared-office-printer-queues)
- **Office-printer detection is proven on one office printer only.** The owner's HP Color LaserJet
  MFP M181fw's real reply is a test fixture, and the live query marked it from a Mac on the owner's
  network. It has not run from the box's container, and no receipt printer that answers IPP has
  been captured, so "A4 or letter means office printer" is a heuristic with one data point.
- **A552. Invoices on the owner's office printer are unchecked with the committed code.** Check
  the HP Color LaserJet MFP M181fw with a long PDF invoice, measuring and scanning its QR, and
  check what Waitron reports with an empty tray and when power is lost mid-job. Left open by A231q.
  [Detail](printers.md#a552-invoices-on-the-owners-office-printer-are-unchecked-with-the-committed-code)
- **A553. How long the box takes to draw one A4 raster page, and its peak memory, at 300 and
  600 dpi, are not measured.** The server draws each page (`renderInvoicePage`,
  `apps/server/src/page-print-api.ts`); it has not been timed on the box, in the built image. Left
  open by A231q.
- **A printer reported by its `.local` name may stay addable.** From a Mac, resolving the HP's
  `.local` name took 5 seconds, past the 1.5-second limit, so it was left unmarked. Not tried from
  the box's container, where the lookup may fail outright; either way the printer stays addable.
- **Photographs and timings of pictures on paper.**
  [Detail](printers.md#photographs-and-timings-of-pictures-on-paper)
- **Nothing physical has been verified since #327:** discovery, paper output, whether a device knock
  reaches the box while the Add agent dialog is open, the five-line feed before the cut, Bluetooth
  discovery, and the receipt preview against printed paper. #324's slips, duplicates and drawer pulse
  have never produced paper either.
- **On-paper verification is still owed on the TM-T88III** (spec "Verification on paper" steps 1-6):
  whether the printer's built-in QR command prints anything at all, and whether the mandated 30-40mm
  QR size is meant to count the code's blank border or only its dark squares.
- **Repeat the 58mm physical receipt after the print-area fix.** The corrected paper output has not
  yet been printed.
  [Detail](printers.md#repeat-the-58mm-physical-receipt-after-the-print-area-fix)
- **Nobody has yet typed a real printer's address into Check a known address.** The first things to
  try on the box: add the Epson at `192.168.10.81:9100` (the sweep should also list it) and print to
  it; then type the HP's `192.168.20.56:9100`, which should come back as an office printer.
  [Detail](printers.md#nobody-has-yet-typed-a-real-printers-address-into-check-a-known-address)
- **The setup-page link is unproven on the box.**
  [Detail](printers.md#the-setup-page-link-is-unproven-on-the-box)
- **Bluetooth at the box.** A first real pairing, and an Unpair, through the dashboard and the
  agent, under the shipped AppArmor profile with bluetoothd's `autopair` plugin off — nobody has yet
  paired or unpaired a real printer through the dashboard.
  [Detail](printers.md#bluetooth-at-the-box)
- **Printing over RFCOMM from INSIDE the print-agent container (A140).**
  [Detail](printers.md#printing-over-rfcomm-from-inside-the-print-agent-container-a140)
- **The owner's Bluetooth printer was listed only under Show all devices (A137) — the cause on the
  box is not confirmed.** It needs the fixed image on the box first.
  [Detail](printers.md#the-owners-bluetooth-printer-was-listed-only-under-show-all-devices-a137--the-cause-on-the-box-is-not-confirmed)
- **timesyncd's clock file after a backward set has not been watched across a reboot.**
  [Detail](box.md#timesyncds-clock-file-after-a-backward-set-has-not-been-watched-across-a-reboot)
- **The clock watch's suspend-aware clock has not been run across a real suspend on Linux.** It
  reads `/proc/uptime` so that a box waking from sleep is not taken for a clock jumping forward.
  Slice 9b's measurement M3 set the wall clock on a Linux runner and `/proc/uptime` did not move
  with it; nobody has suspended a Linux box and watched it (`docs/developers/conventions-data.md`,
  "A jump"). Left open by A798-B slice 9 (#2025).

## Bundle: Printing does not wait for discovery

5 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A sweep in flight keeps connecting after the discovery window closes.** Pass the deadline
  through `Host.scan`. The office-printer check and the check of addresses typed into the dashboard
  still run inside the poll, so the job pull waits for them (C117, #955).
  [Detail](printers.md#a-sweep-in-flight-keeps-connecting-after-the-discovery-window-closes)
- **An agent compares the server's discovery deadline with its own clock** — found in C102, read, not run. An agent on another machine whose clock is out by minutes scans for the wrong span; one on the box shares its clock. [Detail](printers.md#an-agent-compares-the-servers-discovery-deadline-with-its-own-clock)
- **Measure one-job print pulls on the box** — A517 repeats the agent's inventory cycle per job.
  A1372 covers delivered-history claim cost in a local database; physical throughput,
  authentication and large retained queues remain unmeasured, including exhausted failures
  and uncertain drawer claims. [Detail](printers.md#measure-one-job-print-pulls-on-the-box)
- **A typed address receives one HTTP request on port 631** after its connection check succeeds.
  The 2026-09-12 address-check design allowed any unicast address (public, loopback, link-local)
  because the check sent nothing; that reasoning no longer covers the follow-up query.
- **While a discovery window is open, a device not reported within 45 seconds drops off the list**
  until its next report; 45 seconds does not cover every scan pass (C102, #953).

## Bundle: Bluetooth pairing commands

5 entries, size M.

- **A device unpaired outside Waitron still reads as paired for a short while** — found in C103's review, narrowed in A405's, read, not run. A successful Unpair from Waitron now clears the paired report; one done elsewhere keeps it for up to 45 seconds. [Detail](printers.md#a-device-unpaired-outside-waitron-still-reads-as-paired-for-a-short-while)
- **A command queued behind a slow pair can run out of time.** A second command waiting behind that
  pair can therefore expire on the server before it runs; its outcome is then ignored and the screen
  says "No answer from the print agent — try again" whatever actually happened.
  [Detail](printers.md#a-command-queued-behind-a-slow-pair-can-run-out-of-time)
- **A failed Pair or Unpair shows the agent's reason as the agent wrote it, in English on both
  languages' screens** (a wrong PIN would read "No se pudo emparejar: wrong PIN").
  [Detail](printers.md#a-failed-pair-or-unpair-shows-the-agents-reason-as-the-agent-wrote-it-in-english-on-both-languages-screens)
- **An Unpair outcome that reaches the server after it dropped the command leaves the printer on**
  (120 seconds, `COMMAND_TTL_MS` in `apps/server/src/printer-bluetooth-commands.ts`); the owner can
  delete the printer to stop it and end its waiting jobs.
  [Detail](printers.md#an-unpair-outcome-that-reaches-the-server-after-it-dropped-the-command-leaves-the-printer-on)
- **RFCOMM always uses channel 1.** Nothing looks up a printer's channel, so a printer whose serial
  port is on another channel fails each job with the connection error.

## Bundle: Receipt layout pass

4 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Loose ends left by A663 Parts 1a, 1b and 2 (#1748, #1756, #1768).**
  [Detail](printers.md#loose-ends-left-by-a663-parts-1a-1b-and-2-1748-1756-1768)
- **A960. On an 80 mm roll in Basque, a full invoice with more than one VAT rate prints a full
  comp's «Deskontua 100%» with «100%» on its own line under the figures (left open by A758-4).**
  [Detail](printers.md#a960-on-an-80-mm-roll-in-basque-a-full-invoice-with-more-than-one-vat-rate-prints-a-full-comps-deskontua-100-with-100-on-its-own-line-under-the-figures-left-open-by-a758-4)
- **A961. On a full invoice, a dish's discount row that no single comp names prints «Descuento
  100%» whenever every line at its rate was filed at zero (left open by A758-4).**
  [Detail](printers.md#a961-on-a-full-invoice-a-dishs-discount-row-that-no-single-comp-names-prints-descuento-100-whenever-every-line-at-its-rate-was-filed-at-zero-left-open-by-a758-4)
- **A1201. Owner question: a receipt's extra prints no count beside a grouped dish (seen in A803
  slice 1's LOOK).** Two Pollo asado with Padrón peppers print "2 Pollo asado con patatas 19.00"
  then "Pimientos de Padrón 4.00", at 58 and 80 mm. What a line of two printed before slice 1 was not
  checked. Decide whether the extra's row shows its count.

## Bundle: Receipt language loose ends

5 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- The refusal's count of blocking orders is not shown on Venue settings' Defaults card: `codeMessage` fills
  in no values.
- The provisioning command (`waitron-provision`) can still store two languages, or one no pack
  offers; the first entry is the default receipt language. It does not hold Catalonia to Catalan:
  only the Receipts route and setup do.
- `cfg.invoiceLocales` (`apps/server/src/till-config.ts`) is no longer read outside tests (by
  grep) and can be retired.
- The till reads its fallback receipt language only when it
  starts (again after a server switch or an enrolment), so a change reaches those after a
  reload. The on-screen ticket follows each sale's own language.
- The dev and demo seed's English mode stores `en-GB`; Venue settings' Defaults card shows it as
  the saved language although it is not offered.

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
  Cloud**, and possibly more (owner, 2026-10-28). Brainstorm started 2026-10-29; it waits for a
  device test on 3 November: can one Android device reach the printers over the venue's Wi-Fi and
  Cloud over mobile data at once? [Detail](printers.md#a1175-an-android-app-for-venues-run-from-waitron-cloud)
- **A print agent cannot be discarded when the join window shuts (A269, owner 2026-10-04) — OPEN.**
  [Detail](printers.md#a-print-agent-cannot-be-discarded-when-the-join-window-shuts-a269-owner-2026-10-04--open)

## Bundle: The printer's stuck alert counts what the table counts

3 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Still counted by the printer's `printer.jobs_waiting` alert after A167 (#975)**, measured with
  throwaway cases and not pinned.
  [Detail](printers.md#still-counted-by-the-printers-printerjobs_waiting-alert-after-a167-975)
- _2026-10-01 (3c-3): a dish moved to another station leaves its ticket at the old station's
  printer counted by that printer's stuck alert in the same way, because nothing reprints there._
- **A printer that prints some documents and fails others loses its till notice.** The notice goes
  once any later document on the printer prints (slice 10 decision 18), while the bell keeps
  naming the printer until the failed ticket is reprinted or resent. Left open by A798-B slice 10.

## Bundle: Department receipt preview

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A department's Receipts preview shows the theme's logo, for a readable department whose draft names
  no logo, with no words saying it is the venue's** (A841 slice 9, D7 of
  [the plan](../superpowers/plans/2026-10-25-a841-9-logo-receipts.md)).
- **A department's Receipts preview does not redraw when the theme in use changes while it is open**
  (A841 slice 9, [the plan](../superpowers/plans/2026-10-25-a841-9-logo-receipts.md)).

## Bundle: Guest count

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Find a bill's pay offers no guests field** (left open by A663 Part 3b). Not decided.
  [Detail](printers.md#find-a-bills-pay-offers-no-guests-field)
- **Loose ends left by A663 Part 3b (#1827).**
  [Detail](printers.md#loose-ends-left-by-a663-part-3b-1827)

## Decisions and deliberate limits

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

- **The guest count is `guestCount` (A988, 2026-10-27).** A party's or a receipt's number of
  guests is `guestCount` in every till request and in the `sale_receipt_guests` drizzle
  property, and Split a table's two counts are `guestCounts.staying` and
  `guestCounts.leaving`. The `sale_receipt_guests` column is `guest_count` too (A1164, owner
  2026-10-28); the frozen Madrid export still says `guests`, so
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` maps that one renamed column
  (`RENAMED_COLUMNS`) on the export's side before comparing, and refuses an entry it does not
  use. Route paths
  (`PUT /api/parties/:id/guests`), file and table names, the printed receipt's guests line
  (`ReceiptDocument.guests`), and many function, property and event names (for example
  `readReceiptGuests`, `setPartyGuests`) keep the word.

- **Sample wording (owner, 2026-10-28, A965).** The table and product names follow the sample receipt language. English uses “Outside 6” and “Coffee and toast”; Spanish uses “Terraza 6” and “Café y tostada”. The table name does not repeat the table caption. The synthetic number remains.

- **A receipt's header rows (owner, 2026-10-19, A754).** The first row is the table on the left and
  «Pedido N» on the right (the order alone on the right when there is no table). Then:
  - **A simplified receipt** puts its number on the left and the date and time on the right, with
    no captions: the date in words on 80 mm paper and on an A4 page (`18 ago 2026, 11:21`), in
    numbers on 58 mm paper (`18/08/2026 11:21`).
  - **A full invoice**, on every paper, prints «FACTURA» and its number on one row and «Fecha» and
    the date in words on the next, never merged.
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

- **A ruled line between TOTAL and the VAT lines on every simplified receipt (owner, 2026-11-05,
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
  default at that moment, stored once per sale (`sale_receipt_guests`, read by `readPrintedGuests`,
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
  C1b removed consent from the staged choice, the delivery rows and their retries
  ([plan](../superpowers/plans/2026-10-12-a231q-invoice-delivery-part-2.md)). This is a product
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
  chosen** (`packages/catalogue/src/default-language-text.ts`); no translated dish names (owner,
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

- **No database check that a device sets at most one of its two invoice printer columns
  (2026-10-15, A661).** `devices.invoice_printer_id` names a receipt printer and
  `devices.invoice_page_printer_id` an A4 printer. A CHECK would make drizzle-kit rebuild `devices`,
  and that rebuild deletes the rows of every table cascading from it. `selectDevicePrinter`
  (`packages/layouts/src/device-equipment.ts`), the one path that stores a choice, sets one column
  and clears the other.

## Shared office-printer queues

After A576, check two IPP queues on one real print server from the shipped print-agent container.
Add Kitchen A4 and Reception A4 separately and print distinguishable pages to both. Record the
announced server name, each queue path and where the paper emerges. Repeat with one queue
unavailable and an already saved single-queue printer. These physical checks remain open.

The discovery caption uses the announced server hostname, with the local suffix removed, when
available. It falls back to the routing address when no server name was announced; it does not
construct a friendly computer name from a printer label. See the
[identity map and plan](../superpowers/plans/2026-10-14-a576-ipp-queue-identity.md).

## A sweep in flight keeps connecting after the discovery window closes

- **A sweep in flight keeps connecting after the discovery window closes**. Pass the deadline through `Host.scan`. The office-printer capability
  queries that follow the scan have no deadline either: at most eight at a time, each up to
  1.5 seconds, and the job pull waits for them, so printing is delayed while they run.
- **The office-printer check and the check of addresses typed into the dashboard still run inside
  the poll** — left open by C117 (#955), so the job pull still waits for them. The agent puts no
  limit of its own on a scan pass; read, not run: the whole sweep across several networks and the
  USB reads have no overall limit.

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

## A552. Invoices on the owner's office printer are unchecked with the committed code

Owed on
the HP Color LaserJet MFP M181fw: a long full invoice sent as PDF through the product, its QR measured
with a ruler and scanned with a phone; the same invoice as Apple Raster at 600 dpi; a test page
from the Printers tab; and what Waitron reports with the tray empty and when the printer is
switched off mid-job. The owner saw the last two once on 2026-10-12 with a local change, before
A231q changed how a job the printer is holding is reported. Left open by A231q.
