# Printers, the print agent and receipts — detail

The open entries are listed in [the backlog](../backlog.md), under "Printers, the print agent and receipts". This file holds
their full text.

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

## `runAgentOnce` (`packages/printing/src/runtime.ts`) has no caller in the tree outside its own package's tests

- **`runAgentOnce` (`packages/printing/src/runtime.ts`) has no caller in the tree outside its own
  package's tests** (C70, #866). A
  refused report still rolls back every job of its batch when the caller's transaction rolls back,
  so all of them print again (measured 2026-09-29 with a scratch probe). A process that holds the
  venue database and runs the agent itself, and wants to confine a refused report, should call
  `claimPrintJobs` and then `reportPrintJob` per job, each report in its own transaction, as
  `apps/server/src/print-api.ts` already does, rather than one `runAgentOnce` in one transaction.

## An aged batch can print twice

- `packages/printing`, found by #572 and not changed (code, not comments): an aged batch can
  print twice. When a large batch to a slow printer outlives the one-minute lease, another agent
  in the venue can re-claim the jobs not yet sent while the first agent still sends every job it
  pulled; the lease comment in `runtime.ts` now says so. Read from the agent's send loop, not
  run. In `printers.test.ts`, the case named "a driver error that is NEITHER the UNIQUE NOR the
  CHECK propagates UNCHANGED" uses a value SQLite refuses by the `printers_transport_ck` CHECK.
  `escpos.ts`'s `qr()` is not what the receipt uses (it is built with `qrRaster`); the legal
  reason for error-correction level M is stated in `apps/server/src/qr-matrix.ts`.

## Waitron carries two QR encoders; consolidate on `qrcode-generator`

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

## Building the QR raster runs inside the sale-recording transaction

- **Building the QR raster runs inside the sale-recording transaction** (via `formatReceipt` in
  `enqueueSaleReceipt`). The JavaScript QR encoder can throw on an oversized link, which would roll
  the sale back — but every link `validate.ts` accepts is within QR capacity
  (`qr-link-range.test.ts`), so this is unreachable for a real sale. If we ever want belt-and-braces
  against §5, wrap the raster in a `try/catch` that falls back to the printer's built-in QR command
  — at the cost of a QR whose size we no longer control. Left as an owner decision, not applied.

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
  Deleting a print job also deletes its `kitchen_print_jobs` link rows (the key is
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

## Printing A4 invoices on an office printer

- **Printing A4 invoices on an office printer** (owner, 2026-09-14): foundation landed in #1399; transport and screens remain in A231q.
  It reverses the 2026-09-09 provisioning design's "raw ESC/POS only" decision. Remaining work
  discovers and registers invoice printers, selects them by location and sends the rendered PDF
  or raster through IPP, with the delivery and send-again screens listed under A231d.
  _2026-10-08: A231p part 1 landed (#1399), including the shared document, PDF/raster renderers and page-printer schema. Discovery, registration and IPP delivery remain open in A231q; office printing is not yet complete._

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
     original is out of service. Offer active printers, the original chosen by default; check
     whether a job laid out for one paper width needs laying out again for another. Drawer jobs
     stay unresendable (CLAUDE.md §5).
  5. **The printer details say where the printer is used, each with a link** (owner, 2026-10-08):
     the device profiles that list it and for what (receipts, payment slips, cash drawer), the
     preparation stations that print to it, and the departments those profiles belong to. A printer
     belongs to a location, not a department (`printers.location_id`); departments share one through
     `device_profile_printers` and `station_printers`. A link leaves the modal for another screen.

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
  15 seconds (`DISCOVERED_TTL_MS`, `apps/server/src/print-api.ts`), that it can print to that
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

## Decisions and deliberate limits

- **A calibration drawer opening records who asked and when, not that the drawer opened.** There is
  no drawer sensor; the audit row is the request.

- **Printer details follow the dashboard's own language, not the venue's** (ruling I) — a
  recorded departure from the spec, which asked for the venue language.

- **One failed office-printer query can flip a marked printer back to addable** until the next query
  30 seconds later, because the server keeps only each agent's latest report — unless another agent
  reporting the same address has marked it. Accepted as the fail-open cost.

- **Two review suggestions on #335 were deliberately not taken** and would be relitigated otherwise:
  renaming the error code `printer.probe_busy` (kept under the domain-naming rule, per #335's
  commit message), and deduplicating targets in the agent host (the issuing server already
  normalises and deduplicates its bounded list of eight).

- The dashboard's "Test open drawer" calibration
  (`POST /management-api/printers/:id/test-drawer`) opens any active printer's drawer for a
  manager holding both `printer.manage` and `cash.drawer`, with no per-till check — left as it
  is (owner, 2026-10-02).
