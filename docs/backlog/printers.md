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

## A662 — tidy the Edit receipt dialog, and a default tax-agency description

- **A662 — tidy the Edit receipt dialog, and a default tax-agency description (owner, 2026-10-14;
  open).** The dialog is the department's receipt settings
  (`apps/dashboard/src/screens/department-receipt-dialog.ts`).
  1. **A department with no description uses the default.** The Veri\*Factu module already defines
     "Venta en establecimiento" (`venueFields.defaults.operationDescription`,
     `packages/fiscal-verifactu/src/slot.ts`), but only the setup wizard offers it
     (`/setup-api/venue-defaults`, `apps/server/src/setup-api.ts`). A department without one is
     flagged "Set up the tax-agency description" on the Departments screen
     (`venue.readiness.department_description`,
     `packages/venue-service/src/dashboard/departments-list.ts`), and its sales are refused with
     `department.operation_description_required` (`apps/server/src/sale-operation-description.ts`).
     Use the fiscal module's default whenever a department has none of its own: the dialog shows it
     filled in and editable, the warning goes, and no sale is refused for a missing description.
     Find first why the owner's Santet Deli Co department had none — the Santet data import, or does
     "+ Add department" leave it empty too.
  2. **Open at full width.** The dialog opens narrow and jumps wide when the receipt preview loads;
     hold the preview's space from the start. In the owner's screenshot with a logo set, the dialog
     was wider still, so the full-size logo (point 4) may widen it as well; not checked.
  3. **Drop the grey copy of the venue's address** under "Print the venue's address"; the preview
     shows it.
  4. **The logo.** No "Logo" label. A small preview at about its printed size, clicking it opens the
     image library to choose another, and Remove beside it (it only takes the logo off the receipt;
     the image stays in the library). Without a logo, a dashed box "+ Add a logo". Today the logo is
     stretched across the form under Choose image and Remove image.
     [Mockup](mockups/a662-edit-receipt/1-logo.png)
  5. **Delete the stray line "Available at the till."** under the description field.

## A663 — receipts and full invoices that are easier to read

- **A663 — receipts and full invoices that are easier to read (owner, 2026-10-14; open).** The
  owner compared ours with a restaurant receipt from Rome: ruled-off sections, a large total, one
  line per item. Both layouts below are approved. A printed receipt or invoice is a legal document:
  re-check the result against RD 1619/2012 arts. 6 and 7 on the BOE before landing.
  [Mockup: simplified receipt](mockups/a663-receipt-layout/1-simplified-receipt.png),
  [mockup: full invoice](mockups/a663-receipt-layout/2-full-invoice.png) — each beside today's
  receipt, rendered from the code on 2026-10-14.
  Plan: [2026-10-15-a663-receipt-layout.md](../superpowers/plans/2026-10-15-a663-receipt-layout.md)
  — Part 1a landed; Part 1b buildable now (A661 landed, #1745); Part 2 after Part 1b; Part 3 after
  Parts 1a and 1b.
  1. **The simplified receipt.**
     - The QR code, «QR tributario:» and VERI\*FACTU stay first. AEAT's QR specification v0.5.0, §3,
       requires the QR at the start of the invoice (quoted in
       `docs/compliance/verifactu-findings.md`).
     - A ruled line between every section.
     - The business block one fact per line, with the trading name in bold.
     - Table, order and time on one line, and the number labelled "Factura simplificada".
     - TOTAL drawn double size straight after the items, then the VAT, then the payment. No asesor
       question needed (owner, 2026-10-14): Orden HAC/1177/2024 art. 20.1.b asks for the
       VERI\*FACTU phrase in «un tipo de letra y tamaño bien visibles, similares a los del resto de
       datos de la factura» (quoted from the BOE in
       `docs/compliance/regional-language-rules.md`), and with only the TOTAL enlarged the rest of
       the data keeps the caption's size. The same call as the till screen's larger TOTAL on
       2026-10-01 (`docs/compliance/verifactu-findings.md`, C115). The VERI\*FACTU line may be
       printed in bold for margin.
       TOTAL is drawn double size (Part 1a's pull request); its place after the items is still open.
     - With one VAT rate, one line «IVA 10% incluido». Art. 7.1.f asks for the rate only, and for the
       base of each rate only when there are several, which keep their Base lines.
  2. **The full invoice.**
     - "FACTURA" and its number head it, not "Factura completa" sitting left above the centred
       header.
     - One row per item under a header row: units, item, price before VAT, amount before VAT. Today
       each item prints three more lines (price, base and VAT). With more than one VAT rate, a rate
       column is added; art. 6.2.c then also requires each item's base, which the amount column
       already is.
     - A discount not in the unit price gets its own line (art. 6.1.f).
     - The base and VAT for each rate (art. 6.1.g, h).
     - "Fecha de operación" only when it differs from the issue date (art. 6.1.i).
     - Checked 2026-10-14 against the BOE consolidated text of art. 6.
     - The A4 page is drawn from the same document (`apps/server/src/invoice-page.ts`), so it changes
       with it.
  3. **The address on a full invoice** (owner, 2026-10-14). `buildReceiptDocument`
     (`apps/server/src/receipt-document.ts`) prints the venue's address and then, on a full invoice,
     the registered address (`issuer.domicile`), both unlabelled — the same text twice when they
     match. Print it once when they are the same. When they differ, print both, the registered one
     labelled «Domicilio fiscal:»: art. 6.1.e requires the issuer's «Domicilio». Printing both is
     deliberate — the venue's address follows the receipt's address switch and the registered
     address always prints (2026-10-10, A366 slice 7, the note atop
     [fiscal.md](fiscal.md)); this point changes only the repetition and the label.
  4. **"17,50 € × 2", not "17,50 € / 2"**, wherever a unit price is printed with its quantity.
  6. **Guests and the amount per person** when the table's guests were entered.
     Joined tables' counts are added together when they join (or when guests move onto a seated
     table), so the party's own count holds the sum, or no count when either table's was left blank
     or the sum is over 999; a bill split by item prints no guests line (A713, owner 2026-10-15, in
     [till.md](till.md#decisions-and-deliberate-limits)).

## The till's on-screen receipt is a second copy of the layout

- **The till's on-screen receipt is a second copy of the layout.** The till draws a sale's receipt
  itself (`apps/till/src/screens/till-ticket-view.ts`): `netFacts` prints its own «Precio sin IVA
  … / 1 ud» line, and the item and summary VAT lines print the rate as the sale carries it («21.00%»
  for a filed sale), so A663's rate spelling, and later its item table, do not reach it. Bring it
  into line with the printed receipt; A661 (#1745), which changed that file, has landed.

## Quantities print with "." whatever the receipt language

- **Quantities print with "." whatever the receipt language** («0.35 kg» on a Spanish receipt).
  `buildReceiptDocument` (`apps/server/src/receipt-document.ts`) writes quantities into the
  receipt as their digits: an item's quantity in its line, an option's quantity in its caption,
  and the quantity in `netFacts`' unit-price line. Print the language's decimal mark there
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
  254) are copied into `apps/dashboard/src/screens/department-receipt-dialog.ts`, separately
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

## Decisions and deliberate limits

- **Receipts carry no drink and food subtotals (owner, 2026-10-15).** The owner dropped them from
  A663.

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
