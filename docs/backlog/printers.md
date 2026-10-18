# Printers, the print agent and receipts — detail

The open entries are listed in [the backlog](../backlog.md), under "Printers, the print agent and receipts". This file holds
their full text.

## Show a failed automatic invoice copy to staff

Found in A366 slice 7 Part A's two run-it reviews. The plan keeps optional document failures
from undoing a sale. `reserveStagedInvoiceDelivery` returns `undefined` after its failed
reservation is rolled back; `enqueueSaleReceipt` then skips the paper original. The case
“omits a refused staged delivery reservation inside an invoice transaction” in
`apps/server/src/receipt-print.test.ts` exercises a refused email reservation and
asserts one fiscal record/sale, no delivery rows and no print jobs. The branch's complete
receipt-print suite passed this case; it does not exercise a staff-visible warning.

Trace the working-order issuance and bill-payment answers before choosing a till message,
retry or alternate-copy action. Keep the saved delivery choice, original/duplicate rules,
operator permissions and sale facts. Do not silently select paper as a substitute for the
chosen destination.

## What the AppArmor profile (A129, #862; A134, #887) left open

- **What the AppArmor profile (A129, #862; A134, #887) left open:**
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

## Unpair can come back for a short while after a successful unpairing

- **Unpair can come back for a short while after a successful unpairing** (found in C103's review,
  read, not run). The server calls a Bluetooth device paired while the agent's last "paired" report
  is fresh (`isListed(pairedAt)`, `apps/server/src/print-api.ts`: 45 seconds while a discovery
  window is open, 15 otherwise), and a later report that the device is no longer paired keeps the
  old `pairedAt`. So for up to that long after an Unpair a device can read as paired again. Clearing
  `pairedAt` when the agent reports a successful unpair, or reports the device unpaired, would end
  it; the owner was asked (questions.md, C103).

## An agent compares the server's discovery deadline with its own clock

- **An agent compares the server's discovery deadline with its own clock** (found in C102, read, not
  run). `discoveryUntil` is a time on the server's clock, and the agent checks it against
  `host.now()` (`packages/print-agent/src/agent.ts`), where a network probe's deadline is sent as a
  duration because the two clocks can differ. An agent on another machine whose clock is out by
  minutes scans for the wrong span; one on the box shares its clock.

## `runAgentOnce` (`packages/printing/src/runtime.ts`) has no production caller in the tree

- **`runAgentOnce` (`packages/printing/src/runtime.ts`) has no production caller in the tree** (C70, #866). A
  refused report still rolls back its job claim when the caller's transaction rolls back,
  so that job can print again (measured 2026-09-29 with a scratch probe). A process that holds the
  venue database and runs the agent itself, and wants to confine a refused report, should call
  `claimPrintJobs` and then `reportPrintJob` per job, each report in its own transaction, as
  `apps/server/src/print-api.ts` already does, rather than one `runAgentOnce` in one transaction.

## Measure one-job print pulls on the box

A517 uses one job per pull to eliminate unsent leased tails. Every job now repeats the agent's
inventory cycle. Measure a burst on the box before choosing inventory caching or another
lease design; the controlled Hono/transport probe is not a hardware throughput measurement.

## Make an unreported drawer outcome explicit without repeating its pulse

A drawer whose claim or done report was lost stays listed as “printing”, without Resend or an
automatic expiry. Preserve single-attempt delivery while deciding how to show that unknown
outcome. A517's lost-report route case pins the current row and its non-resendable listing.

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

- **Photographs and timings of pictures on paper.** The owner's photographs of a receipt, a kitchen
  ticket, the ruler page, a sample receipt and the test page (C108) on both printers are owed, and
  so are the box's timings (what to time: `docs/developers/testing-guide.md`, "How long a job of
  pictures takes to print on the box is not measured"). Anything the timings or photographs show
  wrong becomes a new item.

## Repeat the 58mm physical receipt after the print-area fix

- **Repeat the 58mm physical receipt after the print-area fix.** The owner's wider printer clipped
  the right edge of a 58mm receipt whose payload centred without an explicit print area; whether the
  printer's own width setting also contributed was not tested. The corrected paper output has not
  yet been printed. Since C107 the print area is the image's width — 360 or 384 dots on 58 mm paper,
  512 or 576 on 80 mm.

## Nobody has yet typed a real printer's address into Check a known address

- **Nobody has yet typed a real printer's address into Check a known address.** The owner's home is
  the case that motivated it: the box sits on 192.168.10.x and the HP LaserJet on 192.168.20.x,
  which the port-9100 sweep cannot reach. The first things to try on the box: add the Epson at
  `192.168.10.81:9100` (the sweep should also list it) and print to it; then type the HP's
  `192.168.20.56:9100`, which should come back as an office printer.

## The setup-page link is unproven on the box

- **The setup-page link is unproven on the box.** The print agent builds it from
  `WAITRON_SETUP_URL` (set on the box as `WAITRON_PRINT_AGENT_SETUP_URL`, which `deploy/compose.yml`
  passes through), or from the first of `WAITRON_BOX_ADDRESSES` (`apps/print-agent/src/config.ts`);
  no review seat ran the deployed compose and nobody has yet followed the link from a dashboard on
  the real box.

## Bluetooth at the box

- **Bluetooth at the box.** A first real pairing, and an Unpair, through the dashboard and the
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

- **Printing over RFCOMM from INSIDE the print-agent container (A140).** A real RFCOMM connection
  and print from inside the container under the shipped profile — CI's runners cannot load
  Bluetooth at all — and whether the printer gets every byte before the connection closes. The
  owner printed on channel 1 from the host only. image-smoke runs the helper directly with its own
  arguments, not through `RfcommTransport`, and only as far as creating the socket; and
  `scripts/deploy-image-env.test.ts` reads the Dockerfile and `package.json` as text, so it does not
  prove the bundle's default helper path resolves inside the image. The helper's 20 + 20 second
  connect and send timeouts and the agent's 5-second grace (`apps/print-agent/src/rfcomm.ts`) were
  not measured on the box.

## The owner's Bluetooth printer was listed only under Show all devices (A137) — the cause on the box is not confirmed

- **The owner's Bluetooth printer was listed only under Show all devices (A137) — the cause on the
  box is not confirmed.** It needs the fixed image on the box first: run
  `docker compose exec print-agent bluetoothctl --timeout 6 scan on`, then
  `docker compose exec print-agent bluetoothctl devices`, and record how many devices are listed
  and where the printer falls among them; then open Add a printer repeatedly, record on which scan
  the printer is first marked, and look for `bluetooth info failed` lines in
  `docker compose logs print-agent`.

## Adding a language to the venue also means adding its printer captions, and a language written outside the Latin letters means widening the font table

- **Adding a language to the venue also means adding its printer captions, and a language written
  outside the Latin letters means widening the font table.** The width ruler's captions are
  exhaustive over the locale list (`CAPTIONS` in `apps/server/src/test-page.ts`), so a new locale
  fails to compile until its captions exist. Printed letters come from a table holding
  U+0020–U+007E, U+00A0–U+017F and the rest of Windows-1252's letters and signs
  (`packages/printing/scripts/build-glyph-table.mjs`); anything else prints as `?` unless dropping
  its accent leaves a letter the table holds (`prepareText`, `packages/printing/src/text.ts`). A
  language needing Cyrillic or Greek needs the table regenerated with a wider range, if the font has
  those letters (not checked).

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

## A404 — adding and calibrating a printer

- **A404 — adding and calibrating a printer (owner, 2026-10-08; open; low priority; not queued — owner 2026-10-08: take it from here when a lane has room):**
  1. **The Add-a-printer scan shows an empty box while it searches.** Say something like "No
     printers found yet" while scanning, and something clearer if the scan ends with nothing found.
  2. **Calibration step 1 (paper width and resolution) is laid out out of order.** Rename "Print
     width ruler" (nobody knows what it means — e.g. "Print width test"); the action button goes on
     the right, on its own row; then a row of the two things the person enters (last number fully
     visible on the ruler, the QR square's size); then a row of the two results (paper width and
     print resolution). Resolution is never shown as a result today, yet the mismatch message
     ("The ruler shows 384 dots, but this paper width and resolution print 360 dots…") talks about
     it. **Open question for the task:** is the QR measurement needed at all, or does the ruler
     alone settle what printing needs? Answer it from the code (does anything need the width in
     millimetres rather than dots?) before redesigning.
  3. **The sample receipt (calibration step 2).** Print it in the venue's default receipt language,
     which follows the province chosen at setup (Catalan for the owner's venue), not always
     Spanish. Drop the "Café, jamón, niño, pingüino · 5 €" line; test the language's accented
     letters as ordered items instead (for Catalan: à è é í ï ò ó ú ü ç and l·l). Add horizontal
     rules so the receipt reads in blocks: after the venue name and NIF, before the first item,
     before the tax lines, and before the total. (The owner's photo showed TOTAL and Cambio printed a
     line below their labels; that was the paper curling — nothing to fix.)
  4. **Rename and move "Carried by one device at a time".** It means a portable printer (a waiter's
     belt printer): one device holds it, and another device choosing it is asked to take it over
     (`device.equipment_held`); off means a fixed printer any number of devices share. Name it
     e.g. "Portable printer", with the explanation as its hint. It sits under calibration step 3's
     heading "Does this printer have a cash drawer?", which is not what it is about — give it its
     own heading or a wider one for the step. The same label shows on the printer details
     (A405), and changes there too.
  5. **The found-printer rows are out of line** (owner, 2026-10-14). In the Add a printer dialog's
     list, each row's buttons sit at the top of the row while its name, connection and address start
     lower down. A long name also wraps far short of its column: "HP Color LaserJet MFP M181fw
     (DE0887)" breaks after "MFP" although the Name column is half the dialog wide. Line the details
     up with the buttons and let the name use its column.
  6. **A paired Bluetooth printer comes and goes from the list** (owner, 2026-10-14). The owner's
     paired "BlueTooth Printer" was missing while a scan ran, listed after it ended, and missing
     again with no scan running. A printer that is already paired stays listed while the dialog is
     open. The 45-second limit in the entry "While a discovery window is open, a device not reported
     within 45 seconds drops off the list" (C102, #953) may be the cause; not checked.
  7. **The name dialog opens with Name filled in** (owner, 2026-10-14): the name discovery found
     ("HP Color LaserJet MFP M181fw (DE0887)"), or the address when that is all it found
     ("192.168.10.81"), ready to overwrite. This applies to Add and to Add as A4 printer. With
     the field filled, Add can be pressed as soon as the dialog opens.
  8. **One line about Bluetooth instead of the paragraph** (owner, 2026-10-14). The two sentences
     under the heading ("To add a Bluetooth printer that is not paired yet, press Pair and add…")
     show every time, even with no Bluetooth printer in the list. Replace them with one line saying
     a Bluetooth printer must be in pairing mode before it is added.

## A405 — printer details and the print queue

- **A405 — printer details and the print queue (owner, 2026-10-08; open; low priority; not queued — owner 2026-10-08: take it from here when a lane has room; after A404).** A modal means the printer page is no longer a sub-page, so the owner
  dropped lane B's A398 redraw of the printer page's heading (2026-10-08).
  1. **Printer details become a modal, viewing and editing both.** Today's page is badly laid out:
     Edit opens the name field off to the right, away from the title it changes; whether the
     printer is active shows three times (a "Status" heading, "Status: Active" and an Active
     toggle); times print raw ("2026-10-08 11:13"). "Calibrate printer" is hidden inside the
     collapsed Calibration section — it is an ordinary action and is always visible with the
     modal's other actions. A modal also fixes the print queue's link: clicking a printer name there
     opens the details with an "All printers" link that goes back to the print queue; a modal
     simply closes back to wherever it was opened.
     **Layout (owner, 2026-10-14):** one line per fact, the label on the left and the value in a
     column beside it — never today's label above value, which makes the page about two screens
     long. The facts are grouped under Status, Connection, Paper and drawer, and Used by (point 5).
     Active shows once, as its switch; times read as "Today 13:09". Delete, Calibrate and Edit sit
     together at the bottom. Edit turns the same modal into a form holding only what can change
     (Name and Address), with Cancel and Save; the Active switch stays on the viewing side, where it
     acts at once.
     [Mockup: viewing](mockups/a405-printer-details/1-details-modal.png),
     [mockup: editing](mockups/a405-printer-details/2-edit-in-the-modal.png)
  2. **The connection line says the opposite of the truth for USB and Bluetooth printers.**
     `printers.connection_roaming` ("Can roam between agents", `printers-screen.ts`) is shown for
     them, but a USB or Bluetooth printer is tied to the one agent it is plugged into or paired
     with; it is a network printer that any venue agent can reach. Say it is connected to one print
     agent and name it (e.g. "Connected through: Waitron", from what "Last seen by" shows); fix the
     Spanish ("Puede cambiar de agente") with it. Check whether anything besides the label treats
     USB or Bluetooth printers as able to move between agents.
  3. **No way to pair a Bluetooth printer again after Unpair.** A succeeded Unpair switches the
     printer off (C109, #960), and the only way back is adding it again as a new printer. Offer
     "Pair again" (or similar) on the same printer record.
  4. **Reprint on the print queue lets the person choose a different printer**, for when the
     original is out of service. Offer active printers, the original chosen by default. Drawer jobs
     stay unresendable (CLAUDE.md §5).
     **Every job is laid out again for the printer chosen (owner, 2026-10-14)** — kitchen tickets
     as much as receipts, since a jammed kitchen printer is when this matters most. Today a job
     stores only its finished ESC/POS bytes, and Reprint copies them to the same printer
     (`resendPrintJob`, `packages/printing/src/outbox.ts`); those bytes come out wrong on a printer
     of another paper width. So every job also keeps the input it was built from, and Reprint
     builds it again for the chosen printer with the same builder: `formatReceipt` for receipts
     and full invoices, `formatKitchenTicket` and `formatCorrectionSlip` (`kitchen-print.ts`),
     `formatPaymentSlip`, and `formatCategorySalesPage` (`report-api.ts`). Rebuilding a kitchen
     ticket from the order instead is not the same thing: `kitchen_print_job_lines` records which
     order lines a ticket carried, by id, not what they said when it printed, so a line changed or
     split since could print differently. Test and calibration pages reprint only on their own
     printer.
     A job printed before the change has bytes alone and is offered only printers of the same
     paper width (no migration: CLAUDE.md §3). Open: receipts and invoices already have an A4 page
     (`apps/server/src/invoice-page.ts`); a kitchen ticket, payment slip or report sent to an A4
     printer needs one too, or the A4 printers are left out for those kinds — settle which and say
     so on the screen.
     **Keeping the stored input cheap to support (owner, 2026-10-14).** A stored input is a format
     that must stay readable for as long as the job is kept (one month: the retention entry under
     "The virtual PDF printer"). Two rules keep that cost small. (a) Every builder produces one
     shared, printer-independent document — a list of text lines, two-column rows, rules, QR codes
     and logos — and only that is stored; receipts already work this way (`buildReceiptDocument`
     in `apps/server/src/receipt-document.ts`, laid out by `formatReceipt`). One small format
     changes far less often than five builders' inputs. (b) The stored document carries a version
     number. A job whose version the running code cannot read falls back to today's behaviour
     (its own printer, or one of the same paper width), so an upgrade never needs conversion code
     and can only narrow the printers offered for older jobs.
  5. **The printer details say where the printer is used, each with a link** (owner, 2026-10-08):
     the device profiles that list it and for what (receipts, payment slips, cash drawer, full
     invoices), the preparation stations that print to it, and the departments those profiles
     belong to. A printer belongs to a location, not a department (`printers.location_id`);
     departments share one through `device_profile_printers` and `station_printers`. A link leaves the modal for another screen.
  6. **One table for every printer** (owner, 2026-10-14). The Printers tab draws A4 printers in a
     second table under "A4 printers", with other columns and its own indentation. They
     are stored apart (`page_printers`, `packages/db/src/schema/page-printers.ts`) and drawn by their
     own panel (`apps/dashboard/src/widgets/page-printers-panel.ts`), but the screen need not follow
     that: one table, told apart by a Paper column ("80 mm roll", "A4"), every row opening the same
     details modal. An A4 printer's details differ (no calibration; a test page; A4 or Letter).
     [Mockup](mockups/a405-printer-details/3-one-printer-table.png)

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

- **The till's on-screen receipt is a second copy of the layout.** The till draws a sale's receipt
  itself (`apps/till/src/screens/till-ticket-view.ts`): `netFacts` prints its own «Precio sin IVA
  … / 1 ud» line, and the item and summary VAT lines print the rate as the sale carries it («21.00%»
  for a filed sale), so A663's rate spelling, its simplified-receipt layout, and its item table, do not reach it. It
  also still prints «4 ud» where paper now prints the bare count «4» (owner, Q8), labels each
  rate's base «Base» (`labels.base`) where paper now prints «Base imponible» (owner, Q11, for one rate; Part 2b's own decision for several), and a full
  invoice's discounts with VAT where paper now prints them before VAT: the till shows each discount
  of a dish under the dish and a whole-bill discount once, where a printed full invoice shows a
  dish's own discount under it and the whole-bill discount once per rate at the end of the table. Bring it
  into line with the printed receipt; A661 (#1745), which changed that file, has landed. It does
  not show the «N comensales · por persona» line either, which paper now prints (A663 Part 3a).

## On an A4 full invoice, a caption and its amount can split across pages

- **On an A4 full invoice, a caption and its amount can split across pages (left open by A663
  Part 2).** The A4 page draws an amount row's caption first, then its amount right-aligned
  (`layoutInvoicePages`, `apps/server/src/invoice-page.ts:266-270`). When the amount does not fit
  beside the caption's last line, it takes a line of its own, and if the page is full there it
  moves to the next page, leaving its caption at the foot of the one before. Keep the two
  together: make room for the caption's lines and the amount's line before drawing either.

## The A4 item table's header can sit alone at a page foot

- **The A4 item table's header can sit alone at a page foot, and later pages repeat no header (left
  open by A663 Part 2).** The A4 page draws the table's header row and each item row as separate
  rows, each checking only its own room (`apps/server/src/invoice-page.ts:248`, `tableRow`). The
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

- **A command queued behind a slow pair can run out of time.** The 120 seconds count from queueing
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

## Left open by C109 (#960)

- **Left open by C109 (#960):** the printer details' Active switch can still switch a paired Bluetooth
  printer off without unpairing it. Leaving the Printers screen mid-calibration asks the server to
  switch the printer off; if that request fails nothing reports it and the printer stays on, and
  closing the browser tab mid-wizard does not switch it off. Leaving the screen while a Save is in
  flight and that save then fails, or in the moment between Enable switching the printer on and
  the wizard opening, also leaves it on. While it is on during calibration, jobs already queued for
  it can be handed out (since A163, jobs a succeeded Unpair ended no longer print; jobs kept in the
  cases the next item lists, and a printer switched off with Disable, can still print after
  Enable). Keeping the printer off until calibration is saved would need a calibration-only
  print path for a switched-off printer, since `enqueuePrintJob` refuses one and `claimPrintJobs`
  claims only switched-on printers' jobs.

## An Unpair outcome that reaches the server after it dropped the command leaves the printer on

- **An Unpair outcome that reaches the server after it dropped the command leaves the printer on**
  (120 seconds, `COMMAND_TTL_MS` in `apps/server/src/printer-bluetooth-commands.ts`); the owner can
  switch it off with Disable, which the row then shows. The printer's waiting jobs are kept in that
  case, after a server restart (the command store is held in memory), and for a printer unpaired
  outside Waitron; Disable keeps them too.

## A Bluetooth printer no agent reports paired still waits with no reason on the job (A139's "not covered")

- **A Bluetooth printer no agent reports paired still waits with no reason on the job (A139's "not
  covered")**, as a USB printer no agent sees does. With two agents, one that cannot print over
  Bluetooth leaves a paired printer's jobs alone while another agent has reported, within the last
  15 seconds (`DISCOVERED_TTL_MS`, `apps/server/src/discovery-listing.ts`), that it can print to that
  printer; that report is held only in the server's memory, so after a server restart, until the
  other agent's first pull, the first agent still ends the job. A140 left this as it is: it needs
  two agents, one of them older than A140.

## Follow-ups A140's review raised, not done (owner's call)

- **Follow-ups A140's review raised, not done (owner's call):**
  - `BluetoothTransport` (`packages/print-agent/src/transport.ts`, with its export and tests) is
    unused in production and still models a device-file path.
  - `liveBtDevicePath`, the `btDevicePath` option and the try/catch in `visibleDevices`
    (`apps/print-agent/src/linux-devices.ts`) can go; the `/dev/rfcomm…` fixtures in
    `apps/print-agent/src/linux-devices.test.ts` model a shape production no longer has, and
    changing them changes existing tests.
  - A139's chain for an agent that cannot print to Bluetooth (`failUnprintableBluetoothJobs`, the
    `bluetoothPrinting` wire field, the error code) has no shipped agent reporting `false` now: keep
    it for an older agent, or delete it before go-live. The jobs list shows "—" in place of the
    attempt count for a job ended with that code.
  - The 10-second paired-listing reuse in `resolve()` (`PAIRED_REUSE_MS`,
    `apps/print-agent/src/linux-devices.ts`) is a chosen window, not a measured one, and a printer
    unpaired outside the agent resolves as attached for up to 10 seconds.

## A print agent cannot be discarded when the join window shuts (A269, owner 2026-10-04) — OPEN

- **A print agent cannot be discarded when the join window shuts (A269, owner 2026-10-04) — OPEN.**
  A268 discards a waiting device's request when the last Add dialog closes. An agent told
  `not_approved` stops and needs resetting on its own setup page (`packages/print-agent/src/agent.ts`,
  the `not_approved` branch), so its request outlives a shut window instead. **Next action:** find a
  path, for example an agent that asks again on its own after a refusal, so agents follow the
  device rule. Spec: [A268 §4](../superpowers/specs/2026-10-04-add-a-device-design.md#4-pairing-on-the-server).

## One "Receipts" settings page, with a live preview (C116, #989; C120, #1000; C121, #996) — still open

- **One "Receipts" settings page, with a live preview (C116, #989; C120, #1000; C121, #996) — still
  open:**
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

## The Receipts preview redraws the whole receipt once per highlighted part

- **The Receipts preview redraws the whole receipt once per highlighted part.** It finds each
  part it highlights (a "mark") by drawing the receipt again without that part and comparing the
  two (`apps/server/src/receipt-preview-api.ts`). W111 took the marks
  from 2 to 6, so one preview can draw the receipt up to 7 times, and the screen asks for a
  preview after each pause in typing. Cheaper: have `formatReceipt`
  (`apps/server/src/receipt-ticket.ts`) record the byte range each part emits, so one draw yields
  every mark. Not measured.

## Left open by #1261's review, not acted on (2026-10-05)

- **Left open by #1261's review:** no database trigger protects the logo image; the app-level
  department receipt usage refuses a library delete. The phone and email length limits (30 and
  254) are copied into `apps/dashboard/src/screens/department-receipt-editor.ts`, separately
  from `packages/layouts/src/validate.ts`.

**2026-10-12, A493:** the venue receipt is no longer a configuration-transfer entry. The
real transfer cases in `apps/server/src/configuration-transfer.test.ts` assert its absence
beside populated department receipts and imported logo rasters. The old follow-up asking
for validation of exported `tenant_receipts` JSON is retired.

The earlier malformed-JSON speculation is retired by the bounded-reader case in
`packages/layouts/src/receipt-store.test.ts`: after inserting `{broken`, `getReceipt` returns
`{}`, `getPrintedReceipt` returns `{ receipt: {}, logo: null }`, and `getStoredLogoRasters`
returns `null`. This checks those readers, not every sale path.

## A change is refused while an open order at the location holds a line

- **A change is refused while an open order at the location holds a line**
  (`receipt.language_orders_open`; narrowed by C124, #1020, 2026-10-02, with core
  `0064_line_locale_triggers_text_only`). The order-line language triggers now check a line's
  names only when an update changes them or moves the line, so the till can still split such a
  line, which copies its old-language names into a new line, or move it to another bill, and the
  database refuses both once the language differs. Measured by the till's own routes
  (`apps/server/src/location-settings-api.orders-open.test.ts`): placed orders, paid bills whose
  party is still seated, a paid order with a dish no station took, and an open bill with no line
  no longer block. After the change, the tests serve a seated party's paid dish, take back a
  serve on one, send a paid sale's unsent dish and collect a placed order. If a language is
  changed underneath an open bill by direct SQL, the bill's next split answers an unmapped 500
  `server.internal`; the same test file pins it.

## Seen while looking at every modal at 1024px, not changed

- **Seen while looking at every modal at 1024px, not changed:** the printers screen's list of
  discovered printers keeps its details column capped (`min(28vw, 24dvh)`), so the details wrap
  while half the row stands empty; and the till's option picker, 1024px wide on a 1280px screen,
  puts each price far from its name (which adds to the "prices are not a column" item in the till
  layout pass, under A4). _2026-10-05 (W70): the picker is now the standard size, 672px wide at 1280._

## A754. The receipt's date and time on a line of their own

**A754 (owner, 2026-10-16) — a mock-up for the owner's approval before building; it changes what
printed invoices look like, so the owner lands it.** Seen on the printer's sample receipt
(`apps/server/src/sample-receipt.ts`) in Catalan: "Mesa 6 · Comanda 41" and "15 de gen. 2026,
12:34" did not fit one row, so the date dropped to a line of its own, right-aligned.

Today the simplified invoice puts the order and the date on one row and lets an overflow wrap
(`buildReceiptDocument`, `apps/server/src/receipt-document.ts:217-221`); the full invoice's
order-and-date row is built the same way (`:223`). The owner first asked for a numeric date so the
row fits, then: "we'll soon run out of space eg if the table name is longer or the order number
gets longer, so we should just make it look good with the date on its own line".

- **The date and time always get their own line**, laid out deliberately, on simplified and full
  invoices. The layout and the date's format are what the mock-up decides.
- **The law asks for the date and sets no format**: RD 1619/2012 art. 7.1.b, «La fecha de su
  expedición», quoted in [verifactu-findings.md](../compliance/verifactu-findings.md). Whether
  Orden HAC/1177/2024 sets a printed date format was not checked; check it before choosing one.
- The sample's Spanish "Mesa 6" and "Café y tostada" on a Catalan receipt are fine: they are
  internal sample values (owner).

## Decisions and deliberate limits

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
  not abandoned (bills kept separate after joining tables, or a split by item), none of those bills
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
  manager holding both `printer.manage` and `cash.drawer`, with no per-till check — left as it
  is (owner, 2026-10-02).

- **A receipt prints in one language; the location's is the default, and staff may choose another
  at the till (C113, owner 2026-09-30, #1014; amended by A497, owner 2026-10-11).** The location's
  receipt language is the first entry of its saved list (`locations.invoice_locales`); **in
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
  2026-10-11).** The till's choice and a copy are both offered in the location's receipt language,
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

The local end-to-end fixture uses two paths on one HTTP listener, the real server routes, agent
loop and IPP sender. It checks each submission's path, printer URI, media and document bytes,
queue-scoped polling when both jobs return the same id, and both delivery results. Its saved-row
control compares the row before and after printing without rediscovery. Neither fixture uses
physical printers or the shipped container.

The discovery caption uses the announced server hostname, with the local suffix removed, when
available. It falls back to the routing address when no server name was announced; it does not
construct a friendly computer name from a printer label. See the
[identity map and plan](../superpowers/plans/2026-10-14-a576-ipp-queue-identity.md).

## A sweep in flight keeps connecting after the discovery window closes

- **A sweep in flight keeps connecting after the discovery window closes** (189 of 253 connects on
  #313 started after expiry). Pass the deadline through `Host.scan`. The office-printer capability
  queries that follow the scan have no deadline either: at most eight at a time, each up to
  1.5 seconds, and the job pull waits for them, so printing is delayed while they run.
- **The office-printer check and the check of addresses typed into the dashboard still run inside
  the poll** — left open by C117 (#955), so the job pull still waits for them. The agent puts no
  limit of its own on a scan pass; read, not run: the whole sweep across several networks and the
  USB reads have no overall limit.

## Printer lists that still read as empty while loading or after a failed read

- **Printer lists that still read as empty while loading or after a failed read** — left open by
  A428, which fixed the reprint dialog, the device profile window's printer section and the
  Printers list's loading line. Still open: the Printers screen's printers, agents and jobs tables
  say "No printers yet.", "No print agents yet." and "No print jobs yet." after a FAILED read,
  beside the screen's refresh-failed message (sibling tables pass `errorMessage`); the devices
  screen's device editor is believed, from reading only, to offer just "Use default (None)" while
  its printer list loads; the device profile window, after its first printer read failed and before
  a later one succeeds, shows no printer section and no loading line, even while the next read is
  under way; after an empty printer list loaded and a later refresh failed, that window shows the
  failure but still says "Add a printer first.", because the shared query code does not say which
  read failed; and Cancel in that window clears the
  screen's message without putting back a read failure that is still standing (read, not run).

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

- **A552. Invoices on the owner's office printer are unchecked with the committed code.** Owed on
  the HP Color LaserJet MFP M181fw: a long full invoice sent as PDF through the product, its QR measured
  with a ruler and scanned with a phone; the same invoice as Apple Raster at 600 dpi; a test page
  from the Printers tab; and what Waitron reports with the tray empty and when the printer is
  switched off mid-job. The owner saw the last two once on 2026-10-12 with a local change, before
  A231q changed how a job the printer is holding is reported. Left open by A231q.

## A wt-dialog holding hinted fields is taller inside than it shows

- **A `wt-dialog` (and so `wt-modal`) holding hinted fields is taller inside than it shows (found
  by A662; predates it).** Each `wt-input`/`wt-textarea` hint (`p.hint`, visually hidden) is
  positioned absolutely, and the dialog's scrolling `.body` is not its positioning parent, so the
  hint counts towards the native `<dialog>`'s scroll height. Measured 2026-10-16 in headless
  Chromium at 1280 × 900: the Edit receipt dialog 1078/864 on main and 1017/850 on the branch; a
  plain dialog of 16 hinted fields 953/864, the same fields without hints none. (2026-10-18: A756
  retired the Edit receipt dialog; its fields are now in the department dialog's Receipts tab,
  which is where to measure again.) A
  `scrollIntoView({ block: "start" })` at 390 wide lifted the footer and left a gap under it; Tab,
  the mouse wheel, End/PageDown and a validation error never did. `.body { position: relative }`
  removed the excess in the probe. Untested: a screen reader's cursor or find-in-page landing on a
  hint.
