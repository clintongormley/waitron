# A405 — printer details and the print queue: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Dispatch every implementer as
> `subagent_type: "implementer"`.

**Goal:** A printer's details open in a window over whichever tab they were opened from, read as
one fact per line, say truthfully how a USB or Bluetooth printer is connected, show where the
printer is used, cover A4 printers from the same table, let a Bluetooth printer be paired again
after Unpair, and let a reprint from the print queue go to another suitable printer — the six
points of the owner's A405 list, as far as they go without a schema change.

**Architecture:** Almost all of it is the dashboard's Printers screen
(`apps/dashboard/src/screens/printers-screen.ts`, 4,451 lines), the A4 printers panel
(`apps/dashboard/src/widgets/page-printers-panel.ts`, which goes away in PR 3) and the words
(`apps/dashboard/src/i18n/strings.ts`, English and Spanish). Server changes: the profiles read the
details already use (`GET /management-api/printer-profiles`, `apps/server/src/print-api.ts:1597-1614`)
gains roles, departments and A4 printers, through one new read on the venue-service seat
(`VenueServiceContribution`, `packages/module/src/module.ts:740`); a new venue-wide station-names
read; and the resend route (`print-api.ts:1538-1549` on `b58e87c79f`) takes an optional target printer: a
receipt or full invoice is laid out again for it from the sale, a kitchen ticket or refund receipt
is copied and centred (point 4). One new shared date helper in the
dashboard. The `printers` guide page (landed with A404) gains sections in English and Spanish.

**Tech stack:** Lit web components, Vitest 4 (browser mode, real headless Chromium, for
`@waitron/dashboard`; Node for `@waitron/server`, `@waitron/printing`, `@waitron/venue-service`),
Hono, Drizzle over SQLite.

**Spec:** `docs/backlog/printers.md`, section "A405 — printer details and the print queue"
(points 1–6). Plan shape follows `docs/superpowers/plans/2026-11-05-a404-add-calibrate-printer.md`.

Line numbers below were measured on `c3a4f8a56a`; PR 4's (points 3 and 4, Tasks 15–20 and the
sections they rely on) were remeasured on `b58e87c79f`.

## Global constraints

- **A1308 hold (owner, 2026-11-04):** no new or changed table, column, index, trigger, migration or
  schema file. Reading and writing existing tables is fine. If a step seems to need a schema
  change, stop and report rather than work around it. What the hold cuts is listed below under
  "Held for A1308, and other cuts".
- No location concept anywhere.
- General code is English. Spanish words go only in the dashboard's Spanish catalogue
  (`strings.ts`), the error-code table (`apps/dashboard/src/i18n/codes.ts`) and the Spanish guide.
- The words in "Words for the owner" are the words to use, exactly. Product text is as short as the
  meaning allows. Hints are placeholders or a muted line, never a "?" button.
- Forms follow `docs/developers/design-system.md` → Forms: required fields marked, inline errors,
  one bottom message through `wt-form-actions .error`, Save quiet and disabled until the draft
  changes (`saveActionState` on a `draftScopeFor` scope, and the same early return at the top of the
  save handler), a request refusal never disables Save, a field refusal sits under its field.
- A destructive action in an action row goes in `wt-form-actions`' `cancel` slot after Cancel:
  `[Cancel] [Delete] … [Save]` (`design-system.md:3181-3184`).
- A screen draws no `<select>`, `<textarea>` or text `<input>` of its own: `wt-input`,
  `wt-combobox`, `wt-switch` only (guard: `scripts/native-form-fields.test.ts`).
- Every colour, spacing, radius and font reads a `--wt-*` token. Styling into a `wt-data-table` cell
  goes through `part=` / `::part()`. A row-menu column is keyed `actions` and `pinned: "end"`.
- A refusal says what happened and names a next step the person can take themselves.
- A help bubble is a `wt-help-tooltip mode="help-mode"` with
  `aria-label=${fill("help.badge_label", { part })}`, `guide-href` from
  `apps/dashboard/src/help-guide.ts` and `guide-label=${t("help.guide_link")}`, as the calibration
  dialog's does (`printers-screen.ts:3482-3491`).
- TDD: the failing test first, run it, watch it fail for the stated reason, then the code.
- An existing assertion may change only where the spec changes what it checks; each such change is
  listed under "Existing tests whose assertions change" and named in the PR description. A test of
  removed behaviour is deleted only where listed.
- Dashboard tests run real headless Chromium: check `memory_pressure | grep free` first and run
  beside another browser run only well above 15% free. Read each run's `Tests` count; a run that
  shows none proves nothing.
- Every commit `git commit -s`, message in plain English.
- Keep the ledger `docs/handoffs/2026-11-05-a405-printer-details.md` (gitignored; create it at the
  start of Task 1) and update it at the end of every task.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing (or
  cleanly red) point, commits, and returns a handover: done, left, files, each check's state.

## What the code says, point by point

### Point 1 — details today

- The details are a page, not a modal: `render()` draws either `#renderPrinterStatus()` or the tabs
  (`printers-screen.ts:4398-4422`), chosen by `selectedPrinterId`, which the URL's `printer` word
  sets (`UrlStateController`, `:546-575`; `navigation.ts:33` declares `printers: { view, printer }`).
  The queue's printer-name button and the Printers table's name button both call
  `#showPrinterStatus` (`:3236-3241`, `:3063-3068`), which writes `{ view, printer }` (`:2563-2567`).
- The page draws a breadcrumb "All printers › name" (`:2752-2773`), the name with an Edit button
  that opens the name field beside the heading (`:2788-2856`), then three `wt-disclosure`s:
  Status (summary, a "Status" fact, the Active switch and Delete, `:2858-2903`), Connection
  (`:2904-3005`, its own Edit for host and port on network printers) and Calibration, closed by
  default, holding "Calibrate printer" (`:3006-3040`). Active shows three times: the "Status"
  heading, the "Status: Active" fact (`:2869`) and the switch (`:2875-2884`).
- Times print raw through `#timestamp` → `formatIsoMinute` ("2026-10-08 11:13";
  `:2047-2050`; `packages/dashboard-kit/src/date-format.ts:3-9`).
- **No shared "Today 13:09" formatter exists.** Grepped on 2026-11-05: `relativeTime`
  (`apps/dashboard/src/widgets/relative-time.ts:11-24`) and `wt-relative-time`
  (`packages/ui/src/components/wt-relative-time.ts`) say "3 minutes ago"; `formatAlertTime`
  (`apps/dashboard/src/widgets/alert-format.ts:79-85`) gives Intl's short date and time;
  `formatChangeoverMoment` (`date-format.ts:43-57`) needs a time zone and prints a weekday. No
  string in `strings.ts` holds "Today {time}" or "Hoy". Task 1 adds one helper.
- A label-beside-value layout exists: `settingsRows` and `settingsCardStyles`
  (`apps/dashboard/src/widgets/settings-card.ts:29-50`, `:88-99`), muted label, value beside it,
  stacked below 48rem; `design-system.md:4189-4191` names it as the approved pattern. Reuse it.
- Two separate draft scopes edit the details today, `#detailNameScope` and
  `#detailConnectionScope` (`:2586-2624`), each with its own Save (`#saveDetailName` `:2698-2725`,
  `#saveDetailConnection` `:2647-2683`); both PATCH `/management-api/printers/:id`
  (`print-api.ts:1165-1219`, under `printer.manage`). The row menu's Edit opens the details and the
  name field (`:2494-2504`). `design-system.md:4193-4197` describes today's page and must be
  rewritten in PR 1, as must the "printer page still names the printer…" sentence at `:5277-5279`.
- Modals stack today: the Pair dialog opens over the Add a printer dialog (`#openPair`,
  `:1798-1813`, its scope's `parent` the address scope). So Calibrate, Delete and the equipment
  label can open over the details modal.

### Point 2 — the connection line

- `printers.connection_roaming` ("Can roam between agents" / "Puede cambiar de agente",
  `strings.ts:749`, `:4516`) is drawn for every transport that is neither `cloud_poll` nor
  `network_tcp` — so for USB and Bluetooth — in the Connection summary and fact
  (`printers-screen.ts:2911`, `:2918`). It is used nowhere else (`git grep connection_roaming`).
- **What else treats USB and Bluetooth printers as movable:** the job claim. A USB or Bluetooth
  job is claimable by whichever agent currently reports the printer's `local_key` among its
  visible devices (`packages/printing/src/runtime.ts:82-84`, `:104-106`), and the printers table's
  comment says so (`packages/db/src/schema/printers.ts:31-34`). That is correct behaviour, not a
  label bug: a USB printer plugged into another computer's agent prints from there without being
  added again. No other code was found treating them as roaming. So the label changes to name the
  agent the printer is connected through now, taken from what "Last seen by" already shows
  (`#printerObservation`, `:2552-2561`), and nothing else changes.

### Point 3 — Pair again

Line numbers in this point are measured on `b58e87c79f`.

- A succeeded Unpair switches the printer off (C109, #960; the comment in the row menu,
  `printers-screen.ts:2630`). The Add a printer dialog can already bring a switched-off
  registration back **under its existing id**: `#disabledPrinter` (`:1501-1505`) and the disabled
  branch of `#registerDiscovered` (`:1634-1640`) call `updatePrinter(id, { active: true, … })`. So
  the spec's "the only way back is adding it again as a new printer" is how it looks, not what
  happens — but it means scanning, Pair and add, the name form and calibration again, from a dialog
  that does not say it is the same printer.
- **No new server route is needed.** Pairing is `POST /management-api/print-agents/:id/bluetooth/pair`
  (`print-api.ts:872-891`), which refuses `printer.bluetooth_not_discovered` unless that agent
  reported the address from a scan recently (`:884-886`). So the dashboard must run a discovery scan
  first (`startPrinterDiscovery` / renew / `listDiscoveredPrinters`, as `#scan` does, `:1415-1455`),
  find the agent that reports the printer, then pair through it, then switch the printer on with
  the existing PATCH.
- The scan and the command tracking only run while the Add dialog is open: `#loadDiscovered`
  (`:1352`), `#scan` (`:1429`, `:1433`) and `#pair` (`if (this.addingPrinter) this.#trackCommand(…)`
  at `:1949`, inside `:1934-1965`) all test `this.addingPrinter`. A succeeded pair goes to
  `#addPaired` (`:1826-1834`, called from `#absorbCommands` at `:1799`), which opens the name form.
  Task 15 loosens the first; Task 16 adds the Pair again branch.

### Point 4 — Reprint to another printer

Line numbers in this point are measured on `b58e87c79f`. **The owner's rule (2026-11-09, open
questions 1 and 2):** receipts and full invoices on a receipt printer are laid out again for
whichever active receipt printer is chosen, any width and resolution; kitchen tickets and refund
receipts are copied byte for byte to any active receipt printer whose line holds at least as many
dots as the job, centred; everything else reprints only on its own printer. Every Reprint opens a
small dialog with the original printer chosen.

- **Reprint today.** The queue's Reprint (`printers-screen.ts:3797-3804`) calls `#resendJob`
  (`:3840-3848`) → `resendPrintJob(id)` (`apps/dashboard/src/api/client.ts:4087-4089`) → route
  `POST /management-api/print-jobs/:id/resend` (`print-api.ts:1538-1549`), gated by
  `hardware.manage` (`PRINTER_MANAGE_PERMISSION`, `:118`; the old `print.resend` was folded into it
  by A1002 cut 1, #2578) → `resendInvoicePrintJob` (`apps/server/src/invoice-print.ts:24-57`) →
  `resendPrintJob` (`packages/printing/src/outbox.ts:95-128`), which copies the stored bytes to the
  **same** printer, keeping `sale_id` and `receipt_copy` and naming the chain's first job in
  `resend_of` (`:123-127`). `canResendPrintJob` (`:75-88`) refuses drawer jobs and a completed
  original receipt, which needs a marked copy (`:85`); the job list computes `canResend`
  (`print-api.ts:1527-1530`). Two other callers pass no target and stay as they are: the till
  (`apps/server/src/till-api.ts:2496`) and invoice delivery actions
  (`apps/server/src/invoice-delivery-actions.ts:246`). The route reads no body today;
  `readJsonBody` turns an empty body into `{}` (`packages/server-kit/src/read-json-body.ts:9-15`),
  so a body with no `printerId` stays today's request.
- **Which job is which, with no schema change.** Read on the job and on its chain's first job
  (`resend_of ?? id`), because a resend copies `sale_id` and `receipt_copy` (`outbox.ts:125-126`)
  but neither link table:
  - `sale_id` set → a receipt, a receipt copy or a full invoice on a receipt printer. Only three
    calls queue a job with a sale, all with bytes from `buildReceiptBytes` → `formatReceipt`
    (`apps/server/src/receipt-print.ts:178-237`): the copy (`:336-341`, built as a duplicate,
    `receiptCopy: true`), the full invoice (`:359-367`, `receiptCopy` equal to its duplicate flag)
    and the original (`:531-537`, built as an original, `receiptCopy: false`). Every other
    `enqueuePrintJob(` call in `apps/server/src` passes no `saleId` (grep on `b58e87c79f`: the
    drawer jobs `:415`, `:560`, `:652`, `:678`, the collection slip `:302`, and the kitchen, payment
    slip, report, test, label and sample pages). So `receipt_copy === true` says the bytes were
    marked a duplicate; whether it is a full invoice is the sale's `counterparty_tax_id`, as
    `resendInvoicePrintJob` reads it (`invoice-print.ts:31-36`), and the ticket itself says F1 or
    F2, so laying out again needs no other distinction.
  - a `kitchen_print_jobs` row on the first job → a kitchen ticket (`linkKitchenJob`,
    `apps/server/src/kitchen-print.ts:843-846`, `:881-891`), joined tickets included (`:2515`). The
    slips at `:1052`, `:1220`, `:1635` and `:2078` are queued with no link.
  - a `receipt_reprints` row on the first job, and no `sale_id` → a refund receipt
    (`apps/server/src/tender-refund-api.ts:218-221`). The other three writers are receipt copies,
    which carry `sale_id` (`orders-reprint.ts:40`, `orders-api.ts:332`,
    `transaction-receipt-api.ts:79`). `receipt_reprints.print_job_id` is unique
    (`packages/db/src/schema/receipt-reprints.ts:28`) and a resend writes no row, hence the first
    job.
- **Receipts and full invoices are laid out again — a small change.** Both pieces exist.
  `readTransactionReceipt(backend, tx, cfg, saleId)` (`apps/server/src/transaction-receipt.ts:70`)
  reads a filed sale's ticket from its sale id alone; the till's Reprint receipt uses it
  (`transaction-receipt-api.ts:59`) before `enqueueReceiptCopy` (`:68`). `buildReceiptBytes`
  (`receipt-print.ts:178`) lays a ticket out for any paper width and resolution, its QR code sized
  for that printer. Task 17b exports `buildReceiptBytes`, adds `layOutSaleReceipt` over the two,
  and hands its bytes to the existing resend in place of the stored ones. The route gets it as a
  closure in `PrintApiDeps`, as `readInvoiceDocument` is passed today (`print-api.ts:111-112`,
  wired at `apps/server/src/boot.ts:2603-2604`). Against the byte copy below, this adds about 25
  production lines and three tests.
  **Why not call `reprintOrderReceipt` / `enqueueReceiptCopy` themselves**, as the ruling names:
  they queue a new job with no `resend_of` (`enqueuePrintJob`, `outbox.ts:27-32`) and always mark it
  a duplicate (`receipt-print.ts:336-341`). Three things break:
  1. `printJobInTrouble` clears a failed job only through a printed job naming it in `resend_of`
     (`apps/server/src/print-job-trouble.ts:57-61`) or another receipt of the sale on the **same**
     printer (`:78-84`), so a failed receipt reprinted elsewhere would keep its printer's alert;
  2. the one receipt a queue Reprint can move that is not already a copy is a **failed** original
     (`canResendPrintJob` refuses a completed one, `outbox.ts:85`). The till reads a sale's
     original-receipt state from `receipt_copy = false` jobs only (`receipt-print.ts:458`), so a
     duplicate-marked reprint would leave the till showing the original as failed;
  3. for a full invoice, `reserveInvoiceDelivery` refuses a receipt job whose `receipt_copy` does
     not match the designation it works out (`apps/server/src/invoice-delivery.ts:140-147`): an
     original that never printed is designated `original`, so a duplicate-marked job is refused,
     and `resendInvoicePrintJob` turns that into `print_job.not_resendable`
     (`invoice-print.ts:46-53`).
  So the laid-out job keeps the job's own designation — a copy stays marked as a copy, a failed
  original prints as the original, as a same-printer Reprint does today — and goes through the same
  resend: same chain, same `receipt_copy`, same invoice-delivery reservation. Like today's queue
  resend it writes no `receipt_reprints` row. **This departs from the ruling's words "marked as a
  duplicate as that route marks it" for one case, a failed original; the PR description says so.**
  Two limits, said in the PR: the layout uses today's receipt trim, logo and address (as Orders →
  Reprint does; `buildReceiptBytes`'s comment, `:177`), and the sale's own receipt language, so a
  copy the till printed in another receipt language (`enqueueReceiptReprint`'s `language`,
  `:313-324`) comes out in the sale's language: the job does not record which it used.
- **Kitchen tickets and refund receipts are copied and centred.** Their bytes start
  `1B 40 1D 4C 00 00 1D 57 nL nH`: `init()` (`packages/printing/src/escpos.ts:63-67`) then
  `printArea(w)` (`:140-144`, `GS L 0 0` then `GS W w`), called first by `formatKitchenTicket`
  (`apps/server/src/kitchen-ticket.ts:412-413`) and the refund receipt
  (`apps/server/src/tender-refund-receipt.ts:86-88`). `GS L` is the left margin and `GS W` the
  print area's width, both in the printer's horizontal unit, which the builder already treats as one
  dot. A job `w` dots wide moves to a printer of `P` dots by setting **every** `GS L` to
  `(P − w) ÷ 2`, rounded down; `GS W` and the images stay as they are. Every one, not the first: a
  joined kitchen ticket (fired and held parts on one paper, `joinKitchenTickets`,
  `kitchen-ticket.ts:486-497`) keeps the second ticket's `printArea` and drops only its `ESC @`
  (`TICKET_START`, `:475`). A search for the byte pattern could also hit image data, so the helper
  walks the commands, stepping over `GS v 0` image data and `GS ( k` data, as the test oracle
  `escPosCommands` does (`packages/printing/src/testing/escpos-commands.ts:39`).
  **Measured** (2026-11-09, `b58e87c79f`): a throwaway script (`/tmp/a405-measure/centre.mts`, not
  committed) built a single kitchen ticket, a joined kitchen ticket and a Spanish refund receipt at
  58 mm / 180 dpi with the real builders, walked them with `escPosCommands`, and set every `GS L`
  for an 80 mm / 180 dpi (512-dot) target. Run as
  `cd apps/server && ./node_modules/.bin/tsx /tmp/a405-measure/centre.mts`; output:

  ```text
  kitchen: 7624 bytes; first ten: 1b 40 1d 4c 00 00 1d 57 68 01
    GS L at 2; GS W at 6:1d 57 68 01
    centred for 512 dots: changed byte offsets 4; first ten now 1b 40 1d 4c 4c 00 1d 57 68 01; same length true; commands same true
    centred for a narrower 320-dot line: refused (null)
  joinedKitchen: 16508 bytes; first ten: 1b 40 1d 4c 00 00 1d 57 68 01
    GS L at 2,7618; GS W at 6:1d 57 68 01,7622:1d 57 68 01
    centred for 512 dots: changed byte offsets 4,7620; first ten now 1b 40 1d 4c 4c 00 1d 57 68 01; same length true; commands same true
    centred for a narrower 320-dot line: refused (null)
  refund: 13964 bytes; first ten: 1b 40 1d 4c 00 00 1d 57 68 01
    GS L at 2; GS W at 6:1d 57 68 01
    centred for 512 dots: changed byte offsets 4; first ten now 1b 40 1d 4c 4c 00 1d 57 68 01; same length true; commands same true
    centred for a narrower 320-dot line: refused (null)
  ```

  So the header holds (`68 01` is 360 dots), the margin (512 − 360) ÷ 2 = 76 = `4c` lands in the
  `GS L` bytes only, the joined ticket's second `GS L` (offset 7618) is found and set too, and the
  rewritten payload parses to the same commands. What it does not show: that a printer honours
  `GS L` for `GS v 0` images. Task 20 prints it on the owner's TM-T88III.
  A printer's dots come from its current `paper_width` and `resolution` through `textGrid(…)
  .widthDots` (`packages/printing/src/layout.ts:57-62`, over `SETTING_WIDTHS` `:30-39`: 360, 384,
  512, 576); both columns are `NOT NULL` (`packages/db/src/schema/printers.ts:55-56`). The job's
  width is read from its own `GS W`, never from its printer, which may have been recalibrated since
  (A404's calibration changes both settings). At another resolution the same dots print at another
  size: a 360-dot job laid out at 180 dpi is about 45 mm wide on a 203 dpi head instead of 51 mm.
  The owner accepts a QR code slightly outside 30–40 mm on such a copy (Orden HAC/1177/2024 art.
  21.1 was put to him), but no job this PR copies draws one: `grep -ci qr` on
  `kitchen-ticket.ts` and `tender-refund-receipt.ts` finds none, and receipts are laid out again.
- **Everything else reprints only on its own printer**: test pages, calibration samples, equipment
  labels, report pages, payment slips, the collection-number slip, the unlinked kitchen slips, and a
  kitchen ticket or refund receipt whose bytes the walk does not recognise. That keeps the spec's
  rule for test and calibration pages.
- **A4 printers are never offered**: `print_jobs.printer_id` references `printers` alone
  (`packages/db/src/schema/print-jobs.ts:38-41`).
- A reprint on another printer still clears the original's trouble: the resend clause of
  `printJobInTrouble` names no printer (`print-job-trouble.ts:57-61`). Task 17b pins it with tests
  rather than relying on reading.
- Inserting a job for a disabled printer throws `printer.not_found` ("That printer no longer
  exists", `outbox.ts:52-57`, `apps/dashboard/src/i18n/codes.ts:838-841`), which is wrong for a
  switched-off printer. The new target check refuses a disabled, deleted or too-narrow target with
  its own code before the insert.
- **Permission.** The route keeps `hardware.manage`. Laying a receipt out again shows nothing that
  permission cannot already read: View printout returns the same job's text under the same gate
  (`print-api.ts:1551`, `gated` at `:1555`). The Orders route's own checks (`visibleOrderPerson` and
  the device's `print-receipt` capability, `orders-api.ts:281-294`) belong to that screen and are
  not added here.

### Point 5 — Used by

- Today's details show "Offered on profiles", profile names only, from
  `GET /management-api/printer-profiles` (`print-api.ts:1597-1614`; client
  `listPrinterProfiles`, `apps/dashboard/src/api/client.ts:3987-3989`; type `PrinterProfileOffer`,
  `:1250-1254`). It returns neither the roles nor A4 printers (`where printerId is not null`,
  `:1610`).
- Roles are `device_profile_printers.role`: receipt, payment slip, cash drawer, invoice
  (`packages/db/src/schema/device-profile-printers.ts`); only the invoice role may name an A4
  printer (its check constraint).
- Departments belong to the venue-service module. A profile's department comes through the seat
  `VENUE_SERVICE.readProfileServiceScopes(tx, ids)` (`packages/module/src/module.ts:1109-1121`,
  used by `withProfileAccess`, `apps/server/src/management-api.ts:653-672`). **No seat method reads
  department names**: `listServiceZones` (`module.ts:819`) drops departments without an active zone
  (`packages/venue-service/src/operations.ts:119`). Task 7 adds `readProfileDepartments` to the seat.
- Station names: the only printer→station read returns ids
  (`GET /management-api/printers/:pid/stations`, `print-api.ts:1588-1595`). The delete-impact read
  joins `kitchen_stations` for names (`apps/server/src/printer-delete.ts:121-126`); Task 8 adds a
  venue-wide read the same way.
- Link targets (plain `<a href="/manage/…">` links are caught by the dashboard and navigate inside
  the app, `apps/dashboard/src/dashboard-app.ts:2207-2240`; `departments-list.ts:373` links to
  `/manage/prep-stations` this way):
  - a department: `/manage/venue-operations/department/<id>` — supported
    (`navigation.ts:20`, read at `packages/venue-service/src/dashboard/venue-departments-shell.ts:356-364`);
  - a device profile: the device profiles screen has no URL state at all (no `UrlStateController`
    in `device-profiles-screen.ts`); its editor opens through `#openEditor(id)` (`:1097`). Task 10
    adds a `profile` URL word;
  - a station: the prep stations screen (venue-service module) declares a `station` word but
    writes it back to null on every read (`prep-stations-screen.ts:193-205`), so a station links to
    `/manage/prep-stations/view/stations` only. Opening one station from a link is left open.
- Whether a person may open a screen is `#canOpenScreen` (`dashboard-app.ts:1464`), passed to other
  screens as `.canOpen` (`:2966`, `:3008`). The printers screen is mounted at `:2951-2954` without it.

### Point 6 — one table

- A4 printers are drawn by `dashboard-page-printers-panel` under the receipt table
  (`printers-screen.ts:3155-3160`; panel `page-printers-panel.ts:472-503`), with columns Name,
  Print agent, Address, Paper, Status (`:318-370`), and a row menu (Rename, Disable, Print test
  page, `:383-405`) only with `canManage` (`:371-380`).
- What the A4 routes allow (`apps/server/src/page-printers-api.ts:82-186`): list, register, and a
  PATCH of `name` and `active: false` only — `active: true` is refused `page_printer.rediscover`
  (`:177`). There is no delete and no address change. So an A4 printer's details offer: Active (off
  only; when off, the existing "Find it again with Add a printer to enable it." line), Print test
  page, Edit (Name only). No Calibrate, no Delete.
- Receipt and A4 ids are both `newId()` UUIDs in separate tables
  (`printers.ts:39`, `page-printers.ts:13`); the screen looks an id up in both lists.

## Held for A1308, and other cuts

Said plainly here, in the backlog (Task 20) and in each PR description.

- **Not in PR 4, because it needs a column** (the A1308 hold was lifted on 2026-11-09, but PR 4
  still adds no table, column or migration): laying out again every printout that is not a receipt
  or full invoice — kitchen tickets, refund receipts, correction slips, payment slips, report pages.
  Receipts and full invoices need no stored input, because the filed sale is their input (point 4).
  The rest would need each job to keep the printer-independent document it was built from, with a
  version number, in a new `print_jobs` column, and Reprint to rebuild it with the same builder
  (`formatKitchenTicket`, `formatCorrectionSlip`, `formatPaymentSlip`, `formatCategorySalesPage`,
  `formatTenderRefundAcknowledgment`). Until then kitchen tickets and refund receipts are copied,
  centred, to a printer at least as wide, and every other printout reprints only on its own
  printer. With it goes the spec's open question about A4 pages for kitchen tickets, payment slips
  and reports.
- **Held until after A760 (A1308 hold): deleting an A4 printer.** `page_printers` has no deletion
  column (`packages/db/src/schema/page-printers.ts:10-35`), and three tables reference it with
  `onDelete: "restrict"`: `invoice_deliveries.page_printer_id`
  (`packages/db/src/schema/invoice-deliveries.ts:65-67`), `devices.invoice_page_printer_id`
  (`devices.ts:55-57`) and `device_profile_printers.page_printer_id`
  (`device-profile-printers.ts:34`). Delivery history keeps rows pointing at it, so a delete has to
  be a soft delete, as receipt printers have (`printers.deleted_at`), which needs a new column.
- **Not built, by design:** switching a disabled A4 printer back on and changing its address from
  its details. Enabling is refused on purpose: "Enabling needs current capabilities and a current
  agent, which only a fresh discovery entry gives: it goes through the POST"
  (`page-printers-api.ts:166-167`, `page_printer.rediscover` at `:178`). The address is part of the
  queue's identity (the unique endpoint index, `page-printers.ts:29`) and its format and media come
  from what that queue answered at discovery, so a new address also goes through Add a printer
  (this reading of the address case is mine; the comment names enabling only).
- **The gap against the spec:** point 6 implies the A4 details carry the same footer as a receipt
  printer's, less calibration. They have no Delete (held, above). PR 3's description says so.
- **Left open:** a station link opens the Stations tab, not the station (the module's screen
  clears its `station` word, `prep-stations-screen.ts:199`).
- **Not a cut:** the details' A4 "Used by" shows profiles listing it for full invoices; no station
  prints to an A4 printer (`station_printers.printer_id` references `printers`).

## Open questions for the owner (each with the default this plan builds)

1. **Reprint elsewhere: same paper width only, or same paper width and resolution?** The plan's
   default was same width and resolution. **Answered by the owner, 2026-11-09, changing the
   default:** "sometimes the important bit will just be getting the receipt printed". Receipts and
   full invoices on a receipt printer are laid out again for any active receipt printer, any width
   and resolution; kitchen tickets and refund receipts are copied byte for byte, centred, to any
   active receipt printer at least as wide, any resolution; a QR code slightly outside 30–40 mm on
   such a copy is accepted ("Any dpi, QR limit or not … nobody will care"). Point 4 has what PR 4
   builds, including where it departs from the ruling's words: a failed original reprinted
   elsewhere stays an original, not a duplicate.
2. **Every reprint now opens a small dialog** (choose the printer, original preselected), one more
   press than today's one-press Reprint. **Answered by the owner, 2026-11-09: the default stands**
   — the dialog for every job, so a job whose own printer is switched off says so instead of "That
   printer no longer exists".

## What goes beyond the spec

- a shared "Today 13:09" date helper (`formatRecentMinute`), used in the details only;
- a help bubble on the details window, and guide sections for the details, Used by, A4 printers,
  Pair again and Reprint;
- the device profiles screen opens a profile named in its address (`/manage/device-profiles/profile/<id>`),
  so a Used by link lands on the profile;
- `GET /management-api/printer-profiles` leaves out retired profiles (open question to nobody: a
  retired profile serves no device; whether a retired profile keeps printer rows was **not
  checked**, so the filter is tested with a seeded one);
- the reprint dialog explains a switched-off original instead of the misleading
  `printer.not_found` refusal.

## PR split and review weight

Twenty-three tasks, four PRs, in order; each later PR is branched from `main` after the earlier one lands
(`python3 ~/workspace/tools/worktree.py new waitron <branch> --headless`, after syncing `main`),
because all four change `printers-screen.ts` and `strings.ts`.

- **PR 1 — "Printer details in a window"** (this worktree and branch,
  `/Users/clintongormley/workspace/worktrees/waitron-feat-a405-printer-details`,
  `feat/a405-printer-details`): Tasks 1–6, points 1 and 2. Dashboard only; same PATCH route and
  permission. **No risk trigger: light path** (no per-task reviewer; `/finish-branch` with its
  plan-vs-spec read and the Codex run-it seat). It restructures the details code, so the simplify
  seat runs.
- **PR 2 — "Where a printer is used"** (`feat/a405-printer-used-by`): Tasks 7–11, point 5.
  **Risk triggers: cross-package contract** (a new method on `VenueServiceContribution` in
  `@waitron/module`, implemented in `@waitron/venue-service`, read by `apps/server`; the
  `printer-profiles` row shape and a new route the dashboard consumes) **and permissions** (a new
  read under `printer.manage` that names departments and stations; today's delete-impact read
  under the same permission already names profiles, devices and stations,
  `printer-delete.ts:60-126`). Full path; two Codex run-it reviews side by side.
- **PR 3 — "A4 printers in the same table"** (`feat/a405-one-printer-table`): Tasks 12–14, point 6
  (Task 14 carries its guide sentence, backlog edit and look). Dashboard only; the A4 routes are unchanged.
  **No risk trigger: light path**; it deletes a widget and moves its tests, so the simplify seat
  runs. Its description flags the gap against point 6: A4 details have no Delete (held for A1308)
  and cannot be switched back on or re-addressed there (refused by design).
- **PR 4 — "Pair again, and reprint to another printer"** (`feat/a405-pair-again-reprint`,
  `/Users/clintongormley/workspace/worktrees/waitron-feat-a405-pair-again-reprint`): Tasks 15–20
  (Task 17 in two parts), points 3 and 4. No table, column or migration. **Risk triggers:
  cross-package contract** (`resendPrintJob` in `@waitron/printing` takes a target printer and
  payload, and the package exports two new helpers; `resendInvoicePrintJob`, `PrintApiDeps`, the
  route's body and `PrintJobRow` change), **permissions** (the resend route keeps `hardware.manage`
  and refuses server-side, each with its domain code, a drawer job, a printout that reprints only
  on its own printer, and a disabled, deleted or too-narrow target), and **fiscal output** (a
  receipt or full invoice laid out again for another printer must be the same receipt — invoice
  number, lines, QR text — keep its original or duplicate marking, and reserve the full invoice's
  delivery as a same-printer reprint does). Full path; two Codex run-it reviews. Size, estimated:
  about 600 production lines (about a third the Pair again window, a third the Reprint dialog) and
  about 950 test lines, plus one line in each of the eleven test files that mount the print API.
  The PR description says the centring was proven on paper by the owner, or that it was not
  (Task 20 Step 3).

## Overlap with open branches (none is a reason to wait)

- `feat/a790-document-routing-foundation` (lane F, #2455, open): touches `docs/backlog/printers.md`
  only among this plan's files (merge-base diff checked 2026-11-05). Its plan keeps the print
  queue's Resend outside A790 (`docs/superpowers/plans/2026-11-04-a790-venue-document-printer-routing.md:46`).
  It adds `document_page_jobs` (A4 page jobs); when those reach the queue, Task 18's offered-printer
  rule must be revisited, and its device invoice choices may change what "Used by → Full invoices"
  means. Rebase the backlog text if both land.
- `feat/a739-payment-window` (last commit 2026-10-22): changes `insertPrintJob` in
  `packages/printing/src/outbox.ts` (a `jobId` option), which Task 17a also edits — a textual
  conflict for whichever lands second.
- `feat/a803-4c-split-table-picker`: changes `VenueServiceContribution` in `module.ts`, where Task 7
  adds a method — textual proximity only.
- The four `feat/a1089-*` branches touch `apps/dashboard/src/api/client.ts` and `strings.ts` —
  ordinary rebase conflicts.

## Review focus

The inputs most likely to bite that no step would otherwise test; each has its test in its task.

1. A details address for a printer id that does not exist, and a printer deleted from another tab
   while its details are open (Task 2).
2. Closing the details, browser Back and leaving through the dashboard's navigation, each with an
   unsaved Edit draft: each asks first, and Keep leaves the draft and the window; Used by links are
   not drawn while editing (Tasks 4c and 10).
3. "Today" just after local midnight, "Yesterday" across a month end, and Spanish (Task 1).
4. A profile listing the printer for two roles shows once with both; a kitchen-display profile has
   no department; a link to a screen the person may not open is plain text (Tasks 8 and 10).
5. A reprint target that is disabled or deleted; a kitchen ticket to a narrower printer; a test
   page or a drawer job with another target; a resend of a resend of a kitchen ticket; a joined
   kitchen ticket (both parts centred); a refund receipt; a failed original receipt reprinted
   elsewhere (still the original, its printer's alert cleared once it prints, the till seeing the new
   job); a receipt copy reprinted elsewhere (still marked a copy); a full invoice whose original
   failed, reprinted elsewhere (its delivery reserved for the new job); a kitchen ticket whose
   printer was recalibrated after it printed (its width read from the job) — each refused or
   accepted server-side, whatever the dashboard offered (Task 17b).

## Words for the owner

Shown to the owner before each PR lands. "New" adds a key; "changed" replaces a key's text;
"removed" deletes the key from both catalogues (grep first that nothing else reads it).

### PR 1 — dashboard (`apps/dashboard/src/i18n/strings.ts`)

| Key | Kind | English | Spanish |
| --- | --- | --- | --- |
| `time.today_at` | new | Today {time} | Hoy {time} |
| `time.yesterday_at` | new | Yesterday {time} | Ayer {time} |
| `printers.details_paper` | new | Paper and drawer | Papel y cajón |
| `printers.connected_through` | new | Connected through | Conectada a través de |
| `printers.connection_roaming` | removed | (was "Can roam between agents" / "Puede cambiar de agente") | |
| `printers.details_help` | new | Active switches the printer on or off at once. Edit changes its name and, for a network printer, its address. | Activa enciende o apaga la impresora al momento. Editar cambia su nombre y, si es de red, su dirección. |

Older dates use Intl's own short day and month in the session's language, then the time:
"3 Nov 13:09" / "3 nov 13:09", with the year when it is not this year ("3 Nov 2025 13:09").
Unchanged and reused: `printers.status` (Status / Estado), `printers.connection` (Connection /
Conexión), `printers.status_active` (Active / Activa), `printers.pending_jobs`, `printers.last_print`,
`printers.transport`, `printers.address`, `printers.local_key`, `printers.poll_id`,
`printers.last_seen`, `printers.last_seen_by`, `printers.agent_unknown` (No recent observation / Sin
observaciones recientes — the "Connected through" value when no agent has seen it),
`printers.connection_network`, `printers.connection_direct`, `printers.paper_width`,
`printers.resolution`, `printers.drawer_attached`, `printers.portable`, `printers.holder`,
`printers.calibrate`, `equipment.label`, `action.edit`, `action.delete`, `action.cancel`,
`action.save`, `printers.name`, `printers.host`, `printers.port`. The bubble is named with
`help.badge_label` filled with the printer's name.

### PR 1 — guide (`apps/server/src/guide/en/printers.md`, `es/printers.md`)

English, after "Calibrate a receipt printer":

```markdown
## Printer details {#printer-details}

Choose a printer's name in the **Printers** tab or the **Print Queue** to open its details.
**Active** switches the printer on or off at once. **Edit** changes its name and, for a network
printer, its address. **Calibrate printer** runs calibration again.
```

Spanish:

```markdown
## Detalles de la impresora {#printer-details}

Elige el nombre de una impresora en la pestaña **Impresoras** o en la **Cola de impresión** para
abrir sus detalles. **Activa** la enciende o la apaga al momento. **Editar** cambia su nombre y, si
es de red, su dirección. **Calibrar impresora** repite la calibración.
```

### PR 2 — dashboard

| Key | Kind | English | Spanish |
| --- | --- | --- | --- |
| `printers.used_by` | new | Used by | Se usa en |
| `printers.used_by_stations` | new | Prep stations | Estaciones de preparación |
| `printers.used_by_departments` | new | Departments | Departamentos |
| `printers.use_receipt` | new | Receipts | Tickets |
| `printers.use_payment_slip` | new | Payment slips | Justificantes de pago |
| `printers.use_cash_drawer` | new | Cash drawer | Cajón portamonedas |
| `printers.use_invoice` | new | Full invoices | Facturas completas |
| `printers.used_by_profile` | new | {profile}: {uses} | {profile}: {uses} |
| `printers.used_by_nothing` | new | No device profile or prep station uses this printer yet. | Todavía no la usa ningún perfil de dispositivo ni estación de preparación. |
| `printers.profiles` | removed | (was "Offered on profiles" / "Ofrecida en los perfiles") | |

The profiles line's label reuses `nav.device_profiles` (Device profiles / Perfiles de dispositivo).
`{uses}` joins the role words with ", " in role order (receipts, payment slips, cash drawer, full
invoices).

Guide, appended to the Printer details section — English: "**Used by** lists the device profiles
that print to it and for what, the prep stations that send it tickets, and the departments those
profiles belong to." Spanish: "**Se usa en** muestra los perfiles
de dispositivo que imprimen en ella y para qué, las estaciones de preparación que le envían
comandas y los departamentos de esos perfiles." The owner cut this guide sentence on 2026-11-06:
no Used by sentence goes into the guide.

### PR 3 — dashboard

| Key | Kind | English | Spanish |
| --- | --- | --- | --- |
| `printers.paper_roll_58` | new | 58 mm roll | Rollo de 58 mm |
| `printers.paper_roll_80` | new | 80 mm roll | Rollo de 80 mm |
| `printers.invoice_printers_title` | removed if unread elsewhere | (was "A4 printers" / "Impresoras A4", the second table's heading) | |
| `printers.invoice_printer_rename` | removed if unread elsewhere | (was "Rename" / "Cambiar nombre"; the row menu now says Edit) | |

Reused: `printers.invoice_printer_paper` (Paper / Papel) as the column heading,
`printers.invoice_printer_a4` (A4), `printers.invoice_printer_letter` (Letter / Carta),
`printers.invoice_printer_agent` (Print agent / Agente de impresión),
`printers.invoice_printer_agent_gone`, `printers.invoice_printer_rediscover` (Find it again with Add
a printer to enable it. / Búscala de nuevo con Añadir impresora para habilitarla.), the test page
notes `printers.test_page_*`, `printers.print_test_page`.

Guide, appended to Printer details — English: "A4 printers are in the same list. Their details have
no calibration; **Print test page** checks one." Spanish: "Las impresoras A4 están en la misma
lista. Sus detalles no tienen calibración; **Imprimir página de prueba** la comprueba."

### PR 4 — dashboard

| Key | Kind | English | Spanish |
| --- | --- | --- | --- |
| `printers.pair_again` | new | Pair again | Emparejar de nuevo |
| `printers.pair_again_looking` | new | Put {printer} in pairing mode near its print agent. Looking for it… | Pon {printer} en modo de emparejamiento cerca de su agente de impresión. Buscándola… |
| `printers.pair_again_missing` | new | {printer} was not found. Check it is on and in pairing mode, then look again. | No se ha encontrado {printer}. Comprueba que esté encendida y en modo de emparejamiento, y vuelve a buscar. |
| `printers.pair_again_look` | new | Look again | Buscar de nuevo |
| `printers.pair_again_done` | new | {printer} is paired again and active. | {printer} vuelve a estar emparejada y activa. |
| `printers.reprint_printer` | new | Print on | Imprimir en |
| `printers.reprint_wide_enough` | new (replaces `printers.reprint_same_setting`, 2026-11-09) | Only printers at least as wide as this printout are offered. | Solo se ofrecen impresoras al menos tan anchas como esta impresión. |
| `printers.reprint_own_only` | new | This printout reprints only on its own printer. | Esta impresión solo se reimprime en su propia impresora. |
| `printers.reprint_original_off` | new | {printer} is disabled. Switch it on in its details, then reprint. | {printer} está deshabilitada. Actívala en sus detalles y vuelve a reimprimir. |
| `printers.reprint_none` | new (reworded 2026-11-09) | No other active printer can take this printout. Switch {printer} on in its details, then reprint. | Ninguna otra impresora activa sirve para esta impresión. Activa {printer} en sus detalles y vuelve a reimprimir. |
| `printers.reprint_sent` | new | Reprint sent to {printer} | Reimpresión enviada a {printer} |

A receipt or full invoice, which any receipt printer can take, shows no hint: every active receipt
printer is offered. Reused: `printers.resend_job` (Reprint / Reimprimir) as the dialog's heading
and button, `action.cancel`, the Pair dialog's existing words.

### PR 4 — error codes (`apps/dashboard/src/i18n/codes.ts`; declared in `apps/server/src/errors.ts`, the throwing file's registry)

| Code | English | Spanish |
| --- | --- | --- |
| `print_job.own_printer_only` | This printout can only be reprinted on its own printer. Choose that printer. | Esta impresión solo se puede reimprimir en su propia impresora. Elige esa impresora. |
| `print_job.printer_unsuitable` (reworded 2026-11-09) | That printer is disabled, deleted or narrower than this printout. Choose another printer. | Esa impresora está deshabilitada, eliminada o es más estrecha que esta impresión. Elige otra impresora. |

The till reprints through its own routes (`till-api.ts:2496` calls `resendInvoicePrintJob` with no
target), so neither code reaches it and the till's `codes.ts` needs no entry. Neither is a recorded
incident code, so `scripts/alert-codes.test.ts` is not concerned; `scripts/errors-reachable.test.ts`
reads only packages with a public barrel, and `apps/server` has none (its `errors.ts` header says
every throwing file imports `./errors.js` directly), so the new file imports it.

### PR 4 — guide

Appended to the existing **Print Queue** section (`{#print-queue}`,
`apps/server/src/guide/en/printers.md:37`), English:

```markdown
**Reprint** sends a printout again. Choose another printer when the first is out of service: a
receipt or invoice can go to any receipt printer, a kitchen ticket or refund receipt to one at least
as wide. Other printouts reprint only on their own printer.
```

Appended to Printer details: "A Bluetooth printer you unpaired is disabled. To use it again, put it
in pairing mode, open its details and choose **Pair again**."

Spanish, appended to **Cola de impresión** (`apps/server/src/guide/es/printers.md:39`):

```markdown
**Reimprimir** vuelve a enviar una impresión. Elige otra impresora si la primera no funciona: un
ticket o una factura puede ir a cualquier impresora de tickets, y una comanda de cocina o un ticket
de devolución, a una al menos igual de ancha. Las demás impresiones solo se reimprimen en su propia
impresora.
```

Appended to Detalles de la impresora: "Una impresora Bluetooth que desvinculaste queda
deshabilitada. Para volver a usarla, ponla en modo de emparejamiento, abre sus detalles y elige
**Emparejar de nuevo**."

Check every bold word against the screen's words in that language (`printers.resend_job`,
`printers.pair_again`) and fix the guide, not the screen, where they differ.

## Existing tests whose assertions change

Each is allowed because the spec changes what it checks; name each in its PR. A case not listed
whose assertion has to change means the task has gone beyond its brief — stop and report.

PR 1:
- `printers-screen.test.ts` — the details page's markup goes (breadcrumb, disclosures, separate
  editors). Rewritten to the modal, assertions kept where the behaviour stays:
  "links the printer breadcrumb back to the selected list" (`:4064`) → "closing the details returns
  to the tab they were opened from"; "opens status first and resets independent printer sections on
  navigation" (`:4095`) → **deleted** (no sections); "renders each printer's transport and derived
  connection mode" (`:1640`) → expects `printers.connected_through` with the agent's name for USB and
  Bluetooth; the inline name and connection cases (`:3219`, `:3386`, `:3659`, `:3909`, `:4251`,
  `:4439`, `:4457`, `:4510`, `:4557`, `:4604`, `:4665`, `:4717`, `:6267`, `:6733`, `:6754`) drive the
  one Edit form instead of two editors, same checks; "offers detail edits and calibration without a
  second general printer editor" (`:4138`) and "starts calibration from printer details at the paper
  settings step" (`:4122`) press the footer's Calibrate; the Delete cases (`:10537`, `:10671`,
  `:10797`) press the footer's Delete, and "the printer page offers Delete beside its Active switch,
  and a dirty name editor asks first" becomes "Delete is offered in the details' footer, not while
  editing"; "opens the added printer's detail editor from its row menu" (`:1189`) expects the
  details in edit mode; "shows Portable printer on the printer's details" (`:9775`) and "the detail
  says a printer is carried by one device at a time…" (`:9782`) read the Paper and drawer rows.
  Every other case that queries `printer-status`, `printer-section-*`, `all-printers-link` or
  `printer-breadcrumb` (72 references in this file) moves to the modal's `data-test`s with its
  checks unchanged.
- `printer-inline.unsaved.test.ts` → becomes `printer-details.unsaved.test.ts` (Task 4c). Its
  per-owner cases run against the one form; "saving a printer name leaves the independently edited
  connection protected" (`:242`) is **deleted** (one form, one save) and replaced by "a save whose
  refresh fails keeps both fields' newer input dirty".
- `printers-screen.a11y.test.ts` — "renders printer editing accessibly" (`:604`), the section
  checks (`:236`, `:365`, `:413`, `:615`, `:642-648`, `:1214`) and "renders the printer page's name
  and connection Save, quiet and changed, accessibly" (`:1204`) → the modal in view and edit mode.
- `printers-screen.save-state.test.ts` — its six detail-page references move to the modal.
- `printer-calibration.unsaved.test.ts` — its two `printer-section-calibration` references press
  the footer's Calibrate.
- `apps/dashboard/src/dashboard-app.test.ts` (`:7940-8030`) — leaving a dirty printer through
  `all-printers-link` becomes closing the details window.
- Nine more in `printers-screen.test.ts`, added in Task 3b by the lane's ruling; each because the
  spec changes this:
  - "updates a printer and its recent jobs after a data event while preserving an inline name
    draft": Status contains "2026" → contains `formatRecentMinute("2026-09-11T12:34:00.000Z")`;
    times now read "Today 13:09" or a short date.
  - "shows the saved drawer independently of the profiles offering it, and the delivering agent
    without discovery": contains "2026-09-26 14:00" → contains
    `formatRecentMinute("2026-09-26T14:00:00.000Z")`; same reason.
  - "keeps printer status live without replacing an inline name draft": contains
    "2026-09-26 16:00" → contains `formatRecentMinute("2026-09-26T16:00:00.000Z")`; same reason.
  - "saves the printer's Active switch from Status and shows the saved value": Status text contains
    "Deshabilitada" → the Active switch is unchecked and labelled `printers.status_active`; Active
    now appears once, as the switch.
  - "shows the fetched Active value when it differs from the switch just pressed": Status text
    contains `printers.status_active` → the switch's label is `printers.status_active` (its checked
    state was already asserted); same reason.
  - "edits a printer name on its details page without opening the calibration wizard": the details
    body contains "Kitchen receipt" → the window's heading is "Kitchen receipt"; the page's h1 is
    gone and the name is the window's heading.
  - "lists the profiles that offer a printer, following their changes but not a device's": the
    label found with `closest("div")` then `dt` → the `dt` beside the value in its label/value row;
    the facts are now one `settingsRows` list, not one `div` per fact.
  - "at 1280px / at 390px the page's Delete stands apart from the Active switch and the fields
    above it" (two cases) → renamed "… stands apart from the Active switch, both above the Status
    facts": the Active switch and Delete now sit under the Status heading above the facts, with no
    gap from them, so the "at least `--wt-space-4` below the fields" check becomes "both end at or
    above the facts' top"; the `--wt-space-3` spacing between Delete and the switch is unchanged.
    Task 4b moves Delete to the footer and replaces both with its footer-order cases.
- Task 4b, as built:
  - The two "… both above the Status facts" layout cases are deleted and replaced by "at 1280px / at
    390px the details' footer reads Close, Delete, then Calibrate and Edit on the right".
  - "offers detail edits and calibration without a second general printer editor": Edit and
    Calibrate are in the footer, and no `edit-printer-name` or `edit-printer-connection` exists
    (it used to assert no `edit-printer-details`, which is now the one Edit).
  - "the printer page offers Delete beside its Active switch, and a dirty name editor asks first"
    → "Delete is offered in the details' footer, not while editing".
  - `printers-screen.save-state.test.ts` "the name and connection editors open quiet and wake on an
    edit" → "the details form opens quiet and wakes on a name or an address edit": it asserted two
    separate editors (the connection Save quiet while the name was changed).
  - `printers-screen.a11y.test.ts` "keeps printer details readable…": Edit's right edge is held
    within the window rather than the Status section, since Edit is now in the footer.
  - Inline name and connection cases read a refusal or `form.fix_fields` from the form's one bottom
    message instead of `printer-name-refusal`, `printer-section-connection` or `printer-status`,
    same text: "rejects an emptied required network host in printer details", "shows a connection
    refusal while leaving its Save available for retry", "shows a refused inline name save below
    the form and leaves Save available", "locks the inline name while its save is pending and
    unlocks it on refusal", "explains an empty inline printer name beside its field", "keeps a
    refused network connection edit available to retry", "locks network fields while their save is
    pending and unlocks them on refusal", "re-checks connection fields after an invalid edit and
    allows Save when both are valid", "leaves the inline printer name Save
    working after a refusal that names no field", and "starts the inline printer name form again
    when it is reopened" (its "no refusal" check now reads an empty bottom message; the old
    selector could no longer match anything).
- Task 4c, as built:
  - `printers-screen.test.ts` "updates a printer and its recent jobs after a data event while
    preserving an inline name draft" and "keeps printer status live without replacing an inline
    name draft": the spec's Edit form hides facts while editing; same two checks, read after Cancel.
    While the form is open the data event leaves the name draft and Save's state as they were; the
    Status facts are read after Cancel (and Discard, where the case has a leave prompt) and show the
    event's values.
  - `printer-details.unsaved.test.ts` (renamed from `printer-inline.unsaved.test.ts`): each case
    runs against the one form, by field (`name`, `host`) instead of by editor; closing the window
    while editing is Escape (the form shows no Close); a third leaving route, the dashboard's own
    navigation, joins close and Back. "saving a printer name leaves the independently edited
    connection protected" is deleted and replaced by "a save whose refresh fails keeps both fields'
    newer input dirty". New: "a Save whose draft a live change has made equal to the printer sends
    nothing and shows the details".
  - `dashboard-app.test.ts` "printer breadcrumb during a pending save" → "printer details window
    during a pending save": one Edit and Save instead of two editors, the window is closed by
    Escape, and the refusal is read from the form's one bottom message instead of
    `printer-name-refusal` or the connection section's alert; same text, same checks.

PR 2:
- `apps/server/src/print-api.printer-wiring.test.ts` "GET /management-api/printer-profiles lists a
  receipt printer on an invoice list, and no row for a page printer there" (`:706`) → now expects
  the page printer's row with `pagePrinterId`; the ordering case (`:668`) also asserts `roles` and
  the department fields; the permission case (`:744`) is unchanged.
- `printers-screen.test.ts` cases reading `printer-profiles` (the "Offered on profiles" fact) read
  the Used by group.
- `printers-screen.test.ts` "shows each fact once…" — its heading list gains `printers.used_by`.

PR 3:
- `page-printers-panel.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts` — the widget is deleted; each
  behavioural case moves (Tasks 12–14 say where), its assertions kept, except "lists each office
  printer under the A4 printers heading…" (`:128`) and "calls them A4 printers, in English and
  Spanish" (`:146`), which now assert the one table's Paper column; "keeps the row menu in a pinned
  actions column" (`:191`) applies to the one table.

PR 4:
- `print-api.printer-wiring.test.ts` "requires hardware.manage and copies the original bytes without
  changing its history" (`:1014`) — unchanged, with no body; its target cases are new.
- `apps/dashboard/src/api/client.test.ts` "resendPrintJob POSTs the selected job with management
  credentials" (`:2534`) → also expects the JSON body `{ printerId }`: the call now names a printer.
- `printers-screen.test.ts` "offers resend for eligible jobs and enqueues the selected document only
  once while pending" (`:5318`) → Reprint opens the dialog with the job's printer chosen; pressing
  the dialog's Reprint twice while pending sends `resendPrintJob("j2", <its printer>)` once, and
  the queue reloads after. "shows a localized resend failure and permits another attempt" (`:5347`)
  → the refusal shows at the dialog's bottom and its Reprint is usable again. "labels Reprint and
  separates it visibly from View printout" (`:5304`) is unchanged.
- The `PrintJobRow` fixtures in `printers-screen.test.ts` gain `reprintRule` and
  `reprintPrinterIds`, and the eleven test files that mount the print API
  (`grep -rln "mountPrintApi(" apps/server/src`, `b58e87c79f`) gain `layOutSaleReceipt` in their
  deps — data, not assertions.

---

## PR 1 — Printer details in a window

### Task 1: A "Today 13:09" date helper

**Files:**
- Modify: `apps/dashboard/src/date-utils.ts` — add `formatRecentMinute`
- Modify: `apps/dashboard/src/i18n/strings.ts` — `time.today_at`, `time.yesterday_at` (EN, ES)
- Test: `apps/dashboard/src/date-utils.test.ts` — it runs in the dashboard's **Node** project, not
  the browser (`apps/dashboard/vitest.config.ts:100-101`), with the zone pinned to America/New_York
  (`date-utils.test.ts:5-7`)

**Interfaces:**
- Produces: `formatRecentMinute(iso: string, now?: Date): string` — in the session's language
  (`currentLocale()`, the same global screen language `t()` follows, so "Today"/"Hoy" and the month
  words always agree) and the browser's zone: "Today HH:MM" when `iso` falls on `now`'s local date,
  "Yesterday HH:MM" on the day before, otherwise Intl's short day and month then `HH:MM`, with the
  year when it differs from `now`'s. 24-hour clock. A future instant on another day takes the last
  form.

- [ ] **Step 1: Write the failing tests.** `it.each` over `en` and `es`, each case calling
  `setLocale` first and an `afterEach` restoring the language it found (CLAUDE.md §4: a test that
  changes the screen language restores it): "Today 13:09" / "Hoy 13:09" for an instant earlier the
  same local day; one minute after local midnight with the instant one minute before it →
  "Yesterday 23:59" / "Ayer 23:59"; 1 November 00:30 local with the instant on 31 October →
  Yesterday; three days earlier → the `3 Nov 13:09` shape (assert with a regex on the day number,
  the month text from `new Intl.DateTimeFormat(currentLocale(), { month: "short" })`, and the time);
  last year → contains the year; an instant whose UTC date differs from its local date reads the
  LOCAL day (the control: the failing case would print the UTC day).
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/date-utils.test.ts` —
  FAILS (no export).
- [ ] **Step 3: Implement** with `dateTimeFormat` from `@waitron/dashboard-kit` (cached formatters,
  `date-format.ts:12-25`), `currentLocale()`, and `fill`/`t` for the two keys.
- [ ] **Step 4: Run** the file whole, then `pnpm exec vitest run scripts/english-only.test.ts` — pass.
- [ ] **Step 5: Commit** — `git commit -s -m "A date helper that says Today 13:09 or Yesterday 18:40 (A405)"`.

### Task 2: The details open in a window over the tab they came from

The content moves into a modal unchanged; Task 3 re-lays it out. Each task leaves the suites green.

**Files:**
- Modify: `apps/dashboard/src/screens/printers-screen.ts` — `render()` (`:4398-4440`) always draws
  the tabs; `#renderPrinterStatus` (`:2750-3042`) becomes `#renderPrinterDetails`, inside
  `<wt-modal size="standard" data-test="printer-details-modal" heading=${p.name}>`; the breadcrumb
  (`:2752-2773`) goes; closing writes `{ printer: null }` through the URL controller, asking first
  through the leave coordinator when a detail draft is dirty (as the breadcrumb's click did,
  `:2758-2769`, and `#requestDetailDelete` does, `:4281-4295`).
- Test: `printers-screen.test.ts`, `printers-screen.a11y.test.ts`, `dashboard-app.test.ts`
  (`:7940-8030`)

**Interfaces:** `data-test="printer-details-modal"`; the modal's `.opener` is the button that opened
it (the queue's `job-printer-<id>`, the table's `printer-row-<id>`, or the row menu's trigger), so
closing returns focus there.

- [ ] **Step 1: Write the failing tests.**
  `it("opens a printer's details in a window over the Printers tab, and closing returns to the tab")`
  — press `printer-row-<id>`: `printer-details-modal` is open, `wt-tabs` is still drawn with
  `printers` selected, the URL holds `printer/<id>`; close it: the URL has no `printer`, focus is on
  `printer-row-<id>`.
  `it("opens the details from the print queue and closes back to the queue")` — on the queue tab,
  press `job-printer-<jobId>`: the modal opens with the queue still drawn behind; close: the queue
  tab is selected and focused on that button.
  `it("opens the details from an address naming the printer")` — mount with
  `/manage/printers/view/printers/printer/<id>`: the modal is open.
  `it("says a printer named in the address does not exist, in the window")` — an unknown id: the
  modal shows `codeMessage("printer.not_found")` and nothing else; while loading it shows
  `printers.table_loading`.
  `it("closes the details of a printer deleted from another tab and says so")` — the live list drops
  the printer: the modal closes and the screen's error is `printer.not_found` (`#printerGone`,
  `:4337-4363`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t "window|address naming|does not exist|deleted from another"`
  — FAIL (no modal; the page replaces the tabs).
- [ ] **Step 3: Implement.** Keep `selectedPrinterId` and the URL word; `#showPrinterStatus` keeps
  writing `view` so the tab underneath stays. Calibrate, Delete and the equipment label open over
  the modal as today (stacked modals, as the Pair dialog over Add a printer).
- [ ] **Step 4: Run** the whole file, `printers-screen.a11y.test.ts`,
  `printers-screen.save-state.test.ts`, `printer-calibration.unsaved.test.ts`,
  `printer-inline.unsaved.test.ts` and `src/dashboard-app.test.ts -t "printer"`. Change only the
  assertions listed for PR 1 (breadcrumb → close). All pass.
- [ ] **Step 5: Commit** — `git commit -s -m "Printer details open in a window over the tab they came from (A405 point 1)"`.

### Task 3: One fact per line, grouped, Active once, times as Today 13:09 (point 1 layout, point 2)

**Files:**
- Modify: `printers-screen.ts` — `#renderPrinterDetails`; drop the three `wt-disclosure`s and the
  `statusOpen` / `connectionOpen` / `calibrationOpen` state (`:699`, `:717-718`, `:2569-2577`);
  import `settingsRows`, `settingsCardStyles` from `../widgets/settings-card.js`
- Modify: `strings.ts` — `printers.details_paper`, `printers.connected_through` new;
  `printers.connection_roaming` removed
- Test: `printers-screen.test.ts`, `printers-screen.a11y.test.ts`,
  `printers-screen.save-state.test.ts`, `printer-calibration.unsaved.test.ts`

**Size, and why this task is not split:** each group's wrapper keeps the old section's
`data-test` — `printer-section-status`, `printer-section-connection`, and `printer-section-calibration`
on the Paper and drawer group — so the existing lookups by those names still find the same facts.
They are 55 lines in `printers-screen.test.ts` (status 5, connection 35, calibration 15), 8 in the
a11y suite, 6 in save-state and 1 in `printer-calibration.unsaved.test.ts` (counted with
`grep -c printer-section-<name>` on `c3a4f8a56a`); most are `text(el, …)` reads that need no change.
What does change is every line that opens, closes or reads the summary of a disclosure: run
`grep -nE "printer-section-[a-z]+.*(open|summary|wt-toggle)|statusOpen|connectionOpen|calibrationOpen"`
over the four files before starting, and migrate only those (the brief's count is whatever that
prints; on `c3a4f8a56a` no more than 26 lines in `printers-screen.test.ts` match the looser
`openSection|toggleSection|section.*\.open|\.open\)\.toBe`). If that grep prints more than about
40 lines, stop after the layout and its new tests, commit cleanly red, and hand the migration to a
second implementer as Task 3b.

The view reads, top to bottom (each group an `h3` and a `settingsRows` list, each row a
`data-test`):
- **Status:** the `wt-switch name="printer-detail-active"` labelled `printers.status_active` (its
  own line, not a row; it acts at once, `#setDetailActive` `:2727-2748`, its refusal under it);
  Pending jobs; Last print (`formatRecentMinute`, or `printers.last_seen_never`).
- **Connection:** Connection type; for USB and Bluetooth, `printers.connected_through` → the agent
  name from `#printerObservation`, else `printers.agent_unknown`; for a network printer,
  `printers.connection` → `printers.connection_network`, then Address, then Last seen by; for
  `cloud_poll`, `printers.connection` → `printers.connection_direct`, Poll ID; Device ID where
  `localKey` is set; Last seen (`formatRecentMinute`) where an observation exists.
- **Paper and drawer:** Paper width, Print resolution, Cash drawer attached, Portable printer, and
  Carried by with the Equipment label button for a portable printer.
- "Offered on profiles" stays as the last Paper and drawer row until PR 2 replaces it.

- [ ] **Step 1: Write the failing tests.**
  `it("shows each fact once, label beside value, in Status, Connection and Paper and drawer")` — the
  modal holds no `wt-disclosure`; three `h3`s with `printers.status`, `printers.connection`,
  `printers.details_paper`; exactly one element in the modal says `printers.status_active` (the
  switch); at 1280 × 800 the label and value of `printer-detail-pending` share a top edge within
  2 px (beside, not above).
  `it("names the agent a USB or Bluetooth printer is connected through")` — a USB printer seen by
  agent "Bar till": `printer-detail-connected-through` reads "Bar till", in Spanish under
  `Conectada a través de`; with no observation it reads `printers.agent_unknown`; no element
  anywhere reads "Can roam between agents" or "Puede cambiar de agente".
  `it("says a network printer may print through any venue agent")` — unchanged words, new row.
  `it("reads today's last print as Today and the time")` — `lastPrintAt` an hour before `now`:
  `printer-detail-last-print` equals `formatRecentMinute(lastPrintAt)` and starts with
  `t("time.today_at")`'s text before `{time}`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t "each fact once|connected through|any venue agent|Today and the time"`
  — FAIL.
- [ ] **Step 3: Implement.** Styles through tokens only. At 390 px the rows stack
  (`settingsCardStyles`' 48rem rule); that is accepted.
- [ ] **Step 4: Run** the file whole and `printers-screen.a11y.test.ts`; change the PR 1 assertions
  listed (sections → groups, the connection mode words). Then
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts` — pass.
- [ ] **Step 5: Commit** — `git commit -s -m "Printer details read one fact per line under Status, Connection and Paper and drawer, and name a USB or Bluetooth printer's agent (A405 points 1 and 2)"`.

### Task 4a: Route the existing inline-editor cases through helpers (tests only, old code)

A preparatory refactor so the form change in Task 4b touches the helpers, not every case. Green
before and after.

**Files:**
- Modify: `printers-screen.test.ts`, `printers-screen.save-state.test.ts`,
  `printers-screen.a11y.test.ts` — add shared helpers to `apps/dashboard/src/widgets/test-helpers.ts`,
  the dashboard's one test-helper file already outside coverage (`apps/dashboard/vitest.config.ts:123`;
  do not add another exclude):
  `openDetailsEdit(el, printerId, part: "name" | "connection")`,
  `saveDetailsEdit(el, part)`, `cancelDetailsEdit(el, part)`, `detailsEditButton(el, action, part)`.
  Today they press `edit-printer-<part>`, `save-printer-<part>`, `cancel-printer-<part>`.

**References migrated:** every line matching `(edit|save|cancel)-printer-(name|connection)` —
109 in `printers-screen.test.ts`, 30 in `printers-screen.save-state.test.ts`, 11 in
`printers-screen.a11y.test.ts` (5 in `printer-inline.unsaved.test.ts` are left for Task 4c). The
field names `printer-detail-name`, `printer-detail-host` and `printer-detail-port` stay in the new
form, so the other 97 lines matching
`(edit|save|cancel)-printer-(name|connection)|printer-detail-(name|host|port)` in
`printers-screen.test.ts` need no change.

- [ ] **Step 1:** Run the three files; note each `Tests` count.
- [ ] **Step 2:** Add the helpers and replace the 150 lines. No assertion changes.
- [ ] **Step 3:** Run the three files — the same counts, all pass;
  `grep -cE "(edit|save|cancel)-printer-(name|connection)"` over the three files prints 0 outside the
  helpers.
- [ ] **Step 4: Commit** — `git commit -s -m "Printer details tests drive the name and connection editors through shared helpers (A405, groundwork)"`.

### Task 4b: Delete, Calibrate and Edit at the bottom; Edit turns the window into one form

**Files:**
- Modify: `printers-screen.ts` — replace `#detailNameScope`/`#detailConnectionScope`,
  `#openDetailName`/`#openDetailConnection`, `#saveDetailName`/`#saveDetailConnection`,
  `#cancelDetail` and `#detailConnectionErrors` (`:2586-2725`) with one draft
  `detailEdit: { id, name, host, port, saving, error } | null` and one `#detailEditScope` from
  `draftScopeFor`; the row menu's Edit (`:2494-2504`) opens the details in edit mode with the name
  focused
- Modify: the Task 4a helpers — `part` is now ignored; they press `edit-printer-details`,
  `save-printer-details`, `cancel-printer-details`
- Test: `printers-screen.test.ts`, `printers-screen.save-state.test.ts`

**Interfaces:** view footer is a `wt-form-actions` in the modal's `footer` slot:
`delete-printer-detail` (danger) in the `cancel` slot, `calibrate-printer-details` in `secondary`,
`edit-printer-details` in the default slot. Edit footer: `cancel-printer-details` in `cancel`,
`save-printer-details` in the default slot. The form holds `wt-input name="printer-detail-name"`
(required) and, for `network_tcp` only, `printer-detail-host` (required) and `printer-detail-port`.
Equipment label stays in its row.

**Cases whose assertions change** (beyond the helpers): only the ones listed for PR 1 that assert two
separate editors — run `grep -n "independently\|second editor\|both editors" printers-screen.test.ts`
and list each in the commit.

- [ ] **Step 1: Write the failing tests.**
  `it("puts Delete, Calibrate and Edit together at the bottom of the details")` — the three buttons
  are in one `wt-form-actions`, Delete in the `cancel` slot, Edit last.
  `it("Edit turns the details into a form of name and address, Save quiet until a change")` — a
  network printer: after Edit the modal shows the three fields with saved values and no facts, Save
  disabled; type a new port: Save enabled; Save sends one `updatePrinter(id, { port: 9101 })` — only
  the changed fields; after the reload the modal is back in view mode showing the new address.
  `it("Edit holds only the name for a USB, Bluetooth or polling printer")` — no host or port field.
  `it("Cancel leaves edit mode and restores the saved values")`.
  `it("marks an emptied name under the field and once at the bottom, and sends nothing")` —
  `form.name_required` under the field, `form.fix_fields` as the actions' `.error`, Save disabled.
  `it("keeps a refused save in the form with the refusal at the bottom and Save usable")`.
  `it("opens the details in edit mode from the row menu's Edit, with the name focused")`.
  `it("offers no Delete while editing")`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t "at the bottom|form of name|only the name|Cancel leaves|emptied name|refused save|row menu's Edit|no Delete while"`
  — FAIL.
- [ ] **Step 3: Implement**, then switch the helpers. The save handler returns early when
  `saveActionState(this.#detailEditScope).unchanged`; the PATCH carries only fields that differ from
  the saved printer; `host`/`port` validation is today's (`:2685-2696`). Delete still goes through
  `#requestDetailDelete` (no draft can be open in view mode).
- [ ] **Step 4: Run** `printers-screen.test.ts`, `printers-screen.save-state.test.ts` and
  `printers-screen.a11y.test.ts` whole. Pass.
- [ ] **Step 5: Commit** — `git commit -s -m "Printer details keep Delete, Calibrate and Edit at the bottom, and Edit turns them into one form (A405 point 1)"`.

### Task 4c: The one form's unsaved-changes behaviour

**Files:**
- Rename and rewrite: `apps/dashboard/src/screens/printer-inline.unsaved.test.ts` →
  `printer-details.unsaved.test.ts` (its 5 button references and 6 field references move to the
  form)
- Modify: `apps/dashboard/src/dashboard-app.test.ts` (`:7940-8030`)
- Modify (only if a test fails for a real defect): `printers-screen.ts`

- [ ] **Step 1: Rewrite the cases** against the one form, keeping each case's behaviour: a departed
  refusal or success leaves a reopened form alone; unload and Cancel ask, then reopen saved values;
  a normalised revert (port `09100` → `9100`) is clean; success clears the draft before a failed
  refresh; newer input after a save stays dirty against the committed baseline; a refusal keeps the
  edits and unload protection; closing the window, browser Back and leaving through the dashboard's
  navigation each ask, Keep keeps the window and draft, Discard leaves once; a detached field from an
  earlier opening changes nothing; a port-only edit sends an explicit cleared port. Add
  `it("a save whose refresh fails keeps both fields' newer input dirty")`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/printer-details.unsaved.test.ts src/dashboard-app.test.ts -t "printer"`
  — the new case FAILS if Task 4b commits only one field's baseline; otherwise all pass. If every
  case passes at once, prove the suite by deletion: remove the `draftScopeFor` registration in a
  throwaway edit, see the close-window case fail, restore.
- [ ] **Step 3: Fix** what fails, in `printers-screen.ts`.
- [ ] **Step 4: Run** both files and `printers-screen.test.ts` — pass.
- [ ] **Step 5: Commit** — `git commit -s -m "The printer details form asks before its changes are lost, wherever the person leaves (A405)"`.

### Task 5: Help bubble, guide section, design-system text

**Files:**
- Modify: `printers-screen.ts` — a `wt-help-tooltip slot="help"` on the details modal, view mode only
- Modify: `apps/dashboard/src/help-guide.ts` — `"printers.printer-details": { page: "printers", section: "printer-details" }`
- Modify: `strings.ts` — `printers.details_help`
- Modify: `apps/server/src/guide/en/printers.md`, `apps/server/src/guide/es/printers.md` — the
  section from "Words for the owner"
- Modify: `apps/server/src/guide-content.test.ts` — the printers case expects
  `["add-printer", "calibrate", "printer-details"]`
- Modify: `docs/developers/design-system.md:4193-4197` — rewrite: printer details are a modal over
  the tab they were opened from, one fact per line in groups (`settingsRows`), Active as its switch
  acting at once, Delete / Calibrate / Edit in the footer, Edit turning the modal into one form of
  name and (network) address, the list's Edit opening it in edit mode, a dirty form asking before
  the window closes; and `:5277-5279` — drop "The printer page still names the printer… A405 plans
  to turn its details into a modal instead."

- [ ] **Step 1: Write the failing tests** — the guide case (ids), and
  `it("explains the details in a help bubble that links to the guide")` (mode, `aria-label`
  `fill("help.badge_label", { part: p.name })`, text `printers.details_help`, `guide-href`
  `guideHref("printers.printer-details")`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts -t "printers"`
  and the dashboard case — FAIL.
- [ ] **Step 3: Write** the section, the bubble and the design-system text.
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/i18n/guide-pages.test.ts`,
  `pnpm exec vitest run scripts/guide-links.test.ts scripts/help-tooltip-mode.test.ts` — pass.
- [ ] **Step 5: Commit** — `git commit -s -m "A help bubble and guide section for printer details (A405)"`.

### Task 6: PR 1's backlog and a look at it

**Files:** `docs/backlog/printers.md` (the A405 section)

- [ ] **Step 1: Backlog.** In the A405 section, delete points 1 and 2 (keep the numbers 3–6 the
  later PRs cite); the entry stays open.
- [ ] **Step 2: Look at it.** In a throwaway, uncommitted test file
  (`apps/dashboard/src/screens/zz-a405-look.test.ts`, deleted afterwards) mount the screen as
  `printers-screen.a11y.test.ts` does (`mountWidget(..., theme)`), open the details of a network
  printer, a USB printer and a portable Bluetooth printer, in view and edit mode, and save
  `page.screenshot({ path })` to an absolute path in a `mktemp -d` folder outside the worktree, for
  light and dark, at 1280 × 800 and 390 × 844, in English and Spanish. Open each image and check:
  label beside value on desktop, nothing running past the window at phone width, one Active, the
  footer order, "Today 13:09", the Connected through line. Render the guide page through the
  server's guide route and look at it. Screenshots are never committed and never copied to Drive;
  show them to the owner directly. Delete the throwaway file.
- [ ] **Step 3: Commit** — `git commit -s -m "Backlog: A405 points 1 and 2 are done"`. Then
  `/finish-branch` with this worktree, naming this plan. The PR description lists the changed
  assertions, what goes beyond the spec, the PR 1 words and guide text, and open questions 1–2 for
  the owner's answer before PR 4.

---

## PR 2 — Where a printer is used

### Task 7: The venue-service seat reads each profile's department

_2026-11-06: changed in Task 8's review from `readDepartmentNames` (names by department id, after
`readProfileServiceScopes`) to `readProfileDepartments`, one query from profile to department,
because the old path also ran an allowed-zones query whose answer was thrown away._

**Files:**
- Modify: `packages/module/src/module.ts` — `VenueServiceContribution` (`:740`) gains
  `readProfileDepartments(tx: Transaction, profileIds: readonly string[]): Promise<{ profileId: string; departmentId: string; departmentName: string }[]>`
  with a one-line doc: each named profile's department, switched off or not; a profile with none is absent
- Modify: `packages/venue-service/src/profile-access.ts` — implement it beside
  `readProfileServiceScopes` (`:257`): one join from each asked-for profile's
  `device_profile_service_access` row to `departments`, no `active` filter
- Modify: `packages/venue-service/src/service.ts` — import it with the others (`:107-112`) and put it
  on the contribution object (beside `readProfileServiceScopes`, `:228`)
- Test: `packages/venue-service/src/profile-access.test.ts` (beside the `readProfileServiceScopes`
  cases, `:508`); and `packages/venue-service/src/service.test.ts`'s list of the contribution's
  method names (`:89`, compared exactly and sorted) gains `"readProfileDepartments"` at its sorted position

- [ ] **Step 1: Write the failing test.** `it("reads each asked-for profile's department, switched off ones included, and nothing for a profile with none or an unknown id")`
  — `useVenueDb`; give two profiles departments, switch one department off, give a third profile
  none; ask for those plus a random UUID: one row per profile with a department, names as seeded;
  an empty id list returns `[]` without a query error.
- [ ] **Step 2: Run** `pnpm --filter @waitron/venue-service exec vitest run src/profile-access.test.ts src/service.test.ts`
  — FAIL (no function; the method-name list differs).
- [ ] **Step 3: Implement.** Use `inArray` and the store's chunking only if the id list can grow
  with venue size (profiles are few; say so in the commit).
- [ ] **Step 4: Run** the file, `pnpm --filter @waitron/module exec tsc --noEmit`,
  `pnpm --filter @waitron/venue-service exec tsc --noEmit`, `pnpm --filter @waitron/server exec tsc --noEmit`,
  and `pnpm exec vitest run scripts/module-seams.test.ts` — pass. Any test fake implementing
  `VenueServiceContribution` that fails to typecheck gains the method.
- [ ] **Step 5: Commit** — `git commit -s -m "The venue-service seat reads each profile's department (A405 point 5)"`.

### Task 8: The server says which profiles use a printer, for what, and which stations

**Files:**
- Modify: `apps/server/src/print-api.ts` — `GET /management-api/printer-profiles` (`:1597-1614`)
  returns one row per (printer or A4 printer, profile):
  `{ printerId: string | null, pagePrinterId: string | null, profileId, profileName, roles: Role[], departmentId: string | null, departmentName: string | null }`,
  roles in the order receipt, payment_slip, cash_drawer, invoice; retired profiles left out; department through
  `VENUE_SERVICE.readProfileDepartments`, one query. Add
  `GET /management-api/printer-stations` → `{ printerId, stationId, stationName }[]` ordered by
  station name, under the same `gated` (`printer.manage`)
- Modify: `apps/dashboard/src/api/client.ts` — `PrinterProfileOffer` (`:1250-1254`) to the new
  shape; `listPrinterStationNames()`
- Modify: `apps/dashboard/src/api/live-queries.ts` — `listPrinterProfiles` (`:105`) also depends on
  `device_profile_service_access` and `departments`; `listPrinterStationNames: ["station_printers", "kitchen_stations"]`
- Test: `apps/server/src/print-api.printer-wiring.test.ts` (beside `:668-760`),
  `apps/dashboard/src/api/client-routes.test.ts` (if it lists routes)

- [ ] **Step 1: Write the failing tests.**
  - `it("GET /management-api/printer-profiles gives each profile's roles for a printer once, with its department")`
    — one profile lists printer P for receipt and cash_drawer, with department "Terrace": one row,
    `roles: ["receipt", "cash_drawer"]`, `departmentName: "Terrace"`; a kitchen-display profile
    with no department: `departmentId: null`, `departmentName: null`.
  - The changed `:706` case: an A4 printer on an invoice list gives a row with `pagePrinterId` and
    `printerId: null`.
  - `it("leaves out a retired profile")` — seed a retired profile still holding a printer row (if
    the schema or store refuses that, record the refusal in the commit and assert instead that the
    route's SQL filters `retired_at`, by reading `.toSQL()` — say which happened).
  - `it("GET /management-api/printer-stations names each station printing to each printer")` and
    `it("GET /management-api/printer-stations requires printer.manage — 401 unauth, 403 staff, 200 manager")`
    asserting the refusals' codes as the `:744` case does.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/print-api.printer-wiring.test.ts -t "printer-profiles|printer-stations|retired"`
  — FAIL.
- [ ] **Step 3: Implement.** One transaction, queries awaited in turn. Every dashboard test fake that
  provides `listPrinterProfiles` (15 files: `git grep -l listPrinterProfiles apps/dashboard/src`)
  also gains `listPrinterStationNames: async () => []`.
- [ ] **Step 4: Run** the server file whole, `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/personal-log-params.test.ts`,
  `pnpm --filter @waitron/server exec tsc --noEmit`, `pnpm --filter @waitron/dashboard exec tsc --noEmit` — pass.
- [ ] **Step 5: Commit** — `git commit -s -m "The server lists each printer's profiles with their roles and departments, and its prep stations (A405 point 5)"`.

### Task 9: A device profile's address opens it

**Files:**
- Modify: `apps/dashboard/src/navigation.ts` — `"device-profiles": { profile: "profile" }`
- Modify: `apps/dashboard/src/screens/device-profiles-screen.ts` — a `UrlStateController`; once the
  profiles have loaded, a `profile` word naming a listed profile calls `#openEditor(id)` (`:1097`)
  and the word is written back to null (replace); an unknown id opens nothing. The owner overruled
  the write-back on 2026-11-06: the word stays while the profile's editor is open, as in the
  catalogue, so a reload opens it again.
- Test: `apps/dashboard/src/screens/device-profiles-screen.test.ts`, `apps/dashboard/src/navigation.test.ts`

- [ ] **Step 1: Write the failing tests.** `it("opens the profile its address names, once")`;
  `it("opens nothing for an address naming no profile")`; the navigation case parses
  `/manage/device-profiles/profile/<id>`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/device-profiles-screen.test.ts src/navigation.test.ts -t "address|profile"`
  — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both files whole and `src/screens/device-profiles-screen.unsaved.test.ts` — pass.
- [ ] **Step 5: Commit** — `git commit -s -m "A device profile's address opens it (A405 point 5)"`.

### Task 10: Used by, with links that leave the window

**Files:**
- Modify: `printers-screen.ts` — `canOpen: (screen: string) => boolean` property (default
  `() => false`); watch `listPrinterStationNames`; a **Used by** group after Paper and drawer
  replacing "Offered on profiles" (`:2784-2786`, `:3000`): a `nav.device_profiles` row listing each
  profile as `printers.used_by_profile` (profile link + role words), a
  `printers.used_by_departments` row, a `printers.used_by_stations` row; rows with nothing are left
  out; nothing at all → `printers.used_by_nothing`
- Modify: `apps/dashboard/src/dashboard-app.ts:2951-2954` — pass `.canOpen=${this.#canOpenScreen}`
- Modify: `strings.ts` — the PR 2 keys; remove `printers.profiles`
- Test: `printers-screen.test.ts`, `printers-screen.a11y.test.ts`, `printer-details.unsaved.test.ts`

Links: profile → `/manage/device-profiles/profile/<id>` when `canOpen("device-profiles")`;
department → `/manage/venue-operations/department/<id>` when `canOpen("venue-operations")`;
station → `/manage/prep-stations/view/stations` when `canOpen("prep-stations")`. Otherwise the name
as plain text. Departments are the distinct departments of the listed profiles, by name.

- [ ] **Step 1: Write the failing tests.**
  `it("says which profiles use the printer and for what, which departments they belong to, and which stations print to it")`
  — rows as above, the role words in order, one department named once though two profiles share it.
  `it("links each name to its screen only where the person may open it")` — with `canOpen`
  allowing only `venue-operations`, the department is an `<a>` with that href and the profile and
  station names are text.
  `it("says nothing uses a printer that no profile or station names")`.
  In `printer-details.unsaved.test.ts`: `it("a Used by link asks before leaving a dirty form")` —
  not reachable in edit mode (the group is in view mode only): assert the group is absent while
  editing, so no link can leave a draft.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t "profiles use the printer|links each name|nothing uses"`
  — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the printers files and `src/dashboard-app.test.ts -t "printer"` — pass;
  change the "Offered on profiles" assertions listed for PR 2.
- [ ] **Step 5: Commit** — `git commit -s -m "Printer details say where the printer is used (A405 point 5)"`.

### Task 11: PR 2's guide, backlog and look

- [ ] **Step 1:** No guide change: the owner cut the Used by sentence on 2026-11-06.
- [ ] **Step 2: Backlog.** Delete point 5 from the A405 section; add under Printers in
  `docs/backlog/printers.md` (and a one-line pointer in `docs/backlog.md`'s Printers area): "**A
  Used by link to a prep station opens the Stations tab, not the station (left open by A405).** The
  prep stations screen writes its `station` address word back to null
  (`packages/venue-service/src/dashboard/prep-stations-screen.ts:199`)."
- [ ] **Step 3: Look** as in Task 6 Step 2, at a printer used by two profiles in two departments
  and a station, both themes, desktop and phone, both languages.
- [ ] **Step 4: Commit** — `git commit -s -m "Guide and backlog for where a printer is used (A405 point 5)"`.
  Then `/finish-branch` (full path: two Codex run-it reviews).

---

## PR 3 — A4 printers in the same table

### Task 12: A4 printer details in the same window

**Files:**
- Create: `apps/dashboard/src/widgets/page-test-pages.ts` — a reactive controller moved out of
  `page-printers-panel.ts` holding each A4 printer's last test page and its passive polling
  (`testPages`, `#testPagePolls`, `readError`/`#readErrorFrom` and the read-ordering rules), with
  `print(row)`, `noteFor(row)` and host connect/disconnect handling
- Modify: `page-printers-panel.ts` — use the controller (the panel still draws its table until
  Task 14)
- Modify: `printers-screen.ts` — `#renderPagePrinterDetails(row)` in the same
  `printer-details-modal` when `selectedPrinterId` names an A4 printer: **Status** (an Active switch
  that only switches off, `updatePagePrinter(id, { active: false })`; when off, disabled with
  `printers.invoice_printer_rediscover` under it), **Connection** (Print agent, Address
  `host:port/resourcePath`), **Paper** (A4 or Letter), **Used by** (profiles listing it for full
  invoices, from Task 8's `pagePrinterId` rows); footer: `print-page-test-<id>` (secondary) and
  `edit-page-printer-details` (default) when `canManage`; the test page note under the footer
- Move tests: the test-page cases of `page-printers-panel.test.ts` (`:413-734`) to
  `apps/dashboard/src/widgets/page-test-pages.test.ts`, mounted through a minimal host, assertions
  unchanged; the disable cases (`:306-348`, `:387-411`) to `printers-screen.test.ts` against the
  switch

- [ ] **Step 1: Move the test-page cases** into `page-test-pages.test.ts` against the not-yet-written
  controller; run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/page-test-pages.test.ts`
  — FAIL (no module).
- [ ] **Step 2: Write the A4 details tests** in `printers-screen.test.ts`:
  `it("opens an A4 printer's details with its agent, address, paper and full-invoice profiles, and no calibration")`;
  `it("switches an A4 printer off from its details and says how to switch it back on")`;
  `it("prints an A4 test page from its details and follows it")`;
  `it("offers no A4 actions without printer.manage")`. Run with `-t "A4 printer's details|switches an A4|A4 test page|no A4 actions"` — FAIL.
- [ ] **Step 3: Implement** the controller (a move, not a rewrite) and the details.
- [ ] **Step 4: Run** `page-test-pages.test.ts`, `page-printers-panel.test.ts` (its moved cases
  removed from it), `printers-screen.test.ts` — pass. Prove the moved suite by deletion once (drop
  the passive flag; the "passive reads" case fails), then restore.
- [ ] **Step 5: Commit** — `git commit -s -m "A4 printers' details open in the same window, with their test page (A405 point 6)"`.

### Task 13: Edit an A4 printer's name in its details

**Files:**
- Modify: `printers-screen.ts` — Edit turns the A4 details into a form of Name only (one
  `draftScopeFor` scope; Save quiet until changed; `updatePagePrinter(id, { name })`; a field
  refusal `management.request_invalid` naming `name` under the field, others at the bottom)
- Move tests: `page-printers-panel.test.ts` rename cases (`:204-305`, `:327-338`, `:359-386`) to
  `printers-screen.test.ts`; `page-printers-panel.unsaved.test.ts` to
  `apps/dashboard/src/screens/printer-details-a4.unsaved.test.ts`, assertions unchanged except the
  opener (Edit in the details footer instead of the row menu's Rename)

- [ ] **Step 1: Move the cases**, run them — FAIL (no form).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** both files whole — pass.
- [ ] **Step 4: Commit** — `git commit -s -m "An A4 printer's name is edited in its details (A405 point 6)"`.

### Task 14: One table for every printer, with a Paper column

**Files:**
- Modify: `printers-screen.ts` — `#renderPrintersSection` (`:3054-3162`): rows are
  `{ kind: "receipt"; printer: Printer } | { kind: "a4"; row: PagePrinterRow }`; columns Name
  (button opening the details for both kinds), Paper (`printers.paper_roll_58`/`_80`,
  `printers.invoice_printer_a4`/`_letter`; header `printers.invoice_printer_paper`), Last seen by
  (an A4 row shows its print agent), Pending jobs (an A4 row shows "—"), Status (the one filter over
  both kinds), Last print ("—" for A4), `actions` pinned end (receipt rows: today's menu; A4 rows,
  with `canManage`: Edit, Print test page, Disable); `rowKey` prefixes the kind; the empty message
  shows only when both lists are empty
- Delete: `apps/dashboard/src/widgets/page-printers-panel.ts`, its three test files (every
  remaining case moved first: the list and A576 cases `:15-199` to `printers-screen.test.ts`
  against the one table; the a11y cases to `printers-screen.a11y.test.ts`)
- Modify: `strings.ts` — `printers.paper_roll_58`, `printers.paper_roll_80`; remove
  `printers.invoice_printers_title` and `printers.invoice_printer_rename` if nothing else reads them

- [ ] **Step 1: Write the failing tests.** `it("lists receipt and A4 printers in one table told apart by Paper")`;
  `it("opens the same details window from an A4 row and a receipt row")`;
  `it("filters receipt and A4 printers together by status")`;
  `it("keeps the row menu in a pinned actions column for both kinds")`; the moved list cases.
  Run with `-t "one table|same details window|filters receipt and A4|pinned actions column"` — FAIL.
- [ ] **Step 2: Implement.** A saved column view (`viewKey="waitron.printers.table"`) holding the
  old keys must still draw: test it by seeding the saved view before mount.
- [ ] **Step 3: Run** `printers-screen.test.ts`, `printers-screen.a11y.test.ts`, and
  `pnpm exec vitest run scripts/pinned-actions-column.test.ts scripts/native-form-fields.test.ts` — pass;
  `git grep -n "page-printers-panel\|dashboard-page-printers-panel"` prints nothing outside docs
  history.
- [ ] **Step 4: Guide and backlog.** Append the A4 sentences to both guide sections; delete point 6
  from the A405 section. Look as in Task 6 Step 2 at the table and an A4 printer's details.
- [ ] **Step 5: Commit** — `git commit -s -m "One table for receipt and A4 printers, told apart by Paper (A405 point 6)"`.
  Then `/finish-branch` (light path, simplify seat on).

---

## PR 4 — Pair again, and reprint to another printer

Line numbers in PR 4's tasks are measured on `b58e87c79f`; recheck each before editing.

### Task 15: Scanning and pair tracking work outside the Add dialog

A refactor; no behaviour changes for the Add dialog.

**Files:**
- Modify: `printers-screen.ts` — a `#scanWanted()` true while `addingPrinter` or a Pair again is
  open, used in place of `this.addingPrinter` in `#loadDiscovered` (`:1352`), `#scan` (`:1429`,
  `:1433`) and `#pair`'s tracking (`:1949`); `#addPaired` (`:1826-1834`) unchanged for now
- Test: `printers-screen.test.ts`, `printer-pair.unsaved.test.ts`, `printer-address.unsaved.test.ts`

- [ ] **Step 1:** Run the three files and note the `Tests` counts (baseline green).
- [ ] **Step 2: Refactor.**
- [ ] **Step 3: Run** the three files — same counts, all pass.
- [ ] **Step 4: Commit** — `git commit -s -m "Printer discovery and pair tracking no longer assume the Add dialog is open (A405 point 3, groundwork)"`.

### Task 16: Pair again on the same printer

**Files:**
- Modify: `printers-screen.ts` — a Pair again button (`pair-again-<id>`) in the details'
  Connection group (`detailsSection` `printer-details-connection`, `:3348-3353`) and in the row
  menu (`#printerActions`, `:2611-2650`, beside Unpair / Disable at `:2630-2640`), for a Bluetooth
  printer that no agent reports paired (`#pairedReport(p) === undefined`, `:1972-1974`); it opens
  `pair-again-modal` (compact) which starts a scan and shows `printers.pair_again_looking` with a
  spinner; when a discovered Bluetooth entry with `printerId === p.id` arrives it opens the existing
  Pair dialog for it (`#openPair`, `:1917-1932`); when the scan window ends unfound it shows
  `printers.pair_again_missing` and `printers.pair_again_look`. The Pair dialog's draft scope takes
  its `parent` from the Add dialog's address scope (`parent: this.#addressScope?.id`, `:1924`),
  which does not exist during Pair again: `#openPair` gains a `parent` argument, and Pair again
  passes the id of a scope the Pair again window registers when it opens (a scope holding no value
  of its own, never dirty by itself; check in `packages/ui`'s `draftScopeFor` that a parent may be
  value-less, and if it may not, stop and report), so closing the Pair again window asks about a
  typed PIN once and discards it with the window. In `#addPaired`, a succeeded pair for the printer
  being paired again switches it on (`updatePrinter(id, { active: true })`, only if inactive),
  closes both dialogs and shows `printers.pair_again_done` as a `wt-notice` — it never opens the
  name form or calibration; closing the Pair again window ends its scan. `#dialogShowsRefreshError`
  (`:4896-4904`) counts the Pair again window, which shows a failed read itself.
- Modify: `strings.ts` — the Pair again keys
- Test: `printers-screen.test.ts`, `printer-pair.unsaved.test.ts`, `printers-screen.a11y.test.ts`

- [ ] **Step 1: Write the failing tests.**
  `it("offers Pair again on a Bluetooth printer no agent reports paired, and not on a paired one")`;
  `it("pairs a disabled Bluetooth printer again on the same record and switches it on")` — no
  `createPrinter` call; `pairBluetooth(agentId, localKey, pin)` once; after the command succeeds,
  `updatePrinter(id, { active: true })` once; no name dialog, no calibration;
  `it("says the printer was not found when the scan ends, and looks again on request")`;
  `it("stops looking when the Pair again window closes")` — no further `listDiscoveredPrinters`
  after close (count calls);
  `it("shows a failed pair's reason and lets the person try again")`.
  In `printer-pair.unsaved.test.ts`: `it("a PIN typed for Pair again asks before it is lost")` and
  `it("closing the Pair again window with a typed PIN asks once, and Discard closes both")`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts src/screens/printer-pair.unsaved.test.ts -t "Pair again"`
  — FAIL.
- [ ] **Step 3: Implement.** The pair route's refusals (`printer.bluetooth_not_discovered`,
  `print-api.ts:884-886`) show in the Pair dialog as today.
- [ ] **Step 4: Run** the three files whole — pass.
- [ ] **Step 5: Commit** — `git commit -s -m "Pair again brings an unpaired Bluetooth printer back on the same record (A405 point 3)"`.

### Task 17a: Find a printout's width, centre it on a wider printer, resend to another printer

`@waitron/printing` only. Point 4 has the byte shapes and the measurement.

**Files:**
- Create: `packages/printing/src/job-width.ts`, exported from `src/index.ts`:
  - `jobWidthDots(payload: Uint8Array): number | null` — walks the payload command by command:
    `ESC @` (2 bytes), `ESC a n` (3), `ESC d n` (3), `ESC p m t1 t2` (5), `GS V 0` (3), `GS L nL nH`
    (4), `GS W nL nH` (4), `GS v 0 m xL xH yL yH` plus `xL…xH × yL…yH` data bytes, `GS ( k pL pH`
    plus `pL + 256 × pH` bytes — the commands `EscBuilder` sends (`escpos.ts:63-200`). Returns the
    `GS W` width when the payload has at least one `GS W` and every `GS W` names the same width;
    `null` for any other byte or command, a command cut short by the end, no `GS W`, or two widths.
    It works on a whole payload and on the first ten bytes alone (`ESC @`, `GS L`, `GS W`), which
    is what the job list reads.
  - `centredForPrinter(payload: Uint8Array, printerDots: number): Uint8Array` — a copy with every
    `GS L` set to `⌊(printerDots − width) ÷ 2⌋`, nothing else changed; throws `RangeError` when
    `jobWidthDots(payload)` is `null` or wider than `printerDots` (callers check first).
  - A printer's dots are `textGrid(paperWidth, resolution).widthDots` (`layout.ts:57-62`); no new
    helper for that.
  Not shared with the test oracle `escPosCommands`, on purpose (its header says why,
  `testing/escpos-commands.ts:31-38`).
- Modify: `packages/printing/src/outbox.ts` — `resendPrintJob(tx, jobId, to?: { printerId: string;
  payload: Uint8Array })`. The existing checks run first and keep their order (`:96-122`); the
  insert (`:123-127`) uses `to.printerId` and `to.payload` when given, with the same `resendOf`,
  `saleId` and `receiptCopy`. Without `to`, today's behaviour, byte for byte. The insert's own
  `printer.not_found` guard (`:52-57`) stays as the backstop; the server checks the target first.
- Test: `packages/printing/src/job-width.test.ts` (new), `packages/printing/src/outbox.test.ts`

- [ ] **Step 1: Write the failing tests.** Payloads are built with `esc(setting)` (`init`,
  `printArea`, `line`, `align`, `qr`, `bitmap`, `feedAndCut`); the expected commands are read back
  with `escPosCommands` (`src/testing/escpos-commands.ts`), never with the code under test. No new
  test helper: search `src/testing/` first.
  - `jobWidthDots`: each of the four settings' payloads gives its width (360, 384, 512, 576); the
    same payload's first ten bytes give the same; `null` for a payload cut inside a command, one
    with an unknown command (`ESC t n`, which the oracle knows and the builder never sends), one
    with no `GS W`, and one with two different `GS W`s.
  - `centredForPrinter`: 360 → 512 sets `GS L` to 76, 384 → 576 to 96, 512 → 512 to 0; a payload
    with two `printArea`s (as a joined kitchen ticket has) gets both set; a payload whose image data
    contains the bytes `1D 4C 00 00` (a `bitmap` whose bits hold them) keeps them, and only real
    `GS L` commands change (compare every other byte with the input); wider than the printer, and an
    unrecognised payload, throw `RangeError`.
  - `outbox.test.ts`: a resend `to` another printer inserts a job on that printer with the given
    payload, `resendOf` the chain's first job, `saleId` and `receiptCopy` kept; a drawer job with
    `to` → `print_job.not_resendable`, as without.
- [ ] **Step 2: Run** `pnpm --filter @waitron/printing exec vitest run src/job-width.test.ts src/outbox.test.ts`
  — the new cases FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the two files whole and `tsc --noEmit` for `@waitron/printing` — pass.
  `@waitron/printing` is mutation-tested with a floor of 90: every branch of the walk needs a case
  that fails when it is deleted.
- [ ] **Step 5: Commit** — `git commit -s -m "Printing can read a printout's width, centre it on a wider printer and resend it to another printer (A405 point 4)"`.

### Task 17b: The server reprints to another printer

**Files:**
- Modify: `apps/server/src/receipt-print.ts` — export `buildReceiptBytes` (`:178`), unchanged.
- Create: `apps/server/src/print-job-reprint.ts`, importing `./errors.js`:
  - `layOutSaleReceipt(backend, tx, cfg: TradingContext, saleId, duplicate, printer: EscSetting)`
    → `buildReceiptBytes(tx, cfg, await readTransactionReceipt(backend, tx, cfg, saleId), saleId,
    duplicate, printer)`, throwing as `enqueueInvoiceReceipt` does when it gives `undefined`
    (`receipt-print.ts:360-363`).
  - `reprintJobOn(tx, layOut, jobId, printerId, personId, now)`:
    1. read the job; none → `print_job.not_found`;
    2. `printerId` is the job's own printer → `resendInvoicePrintJob(tx, jobId, personId, now)`,
       today's path;
    3. `!canResendPrintJob(job)` → `print_job.not_resendable` (as `outbox.ts:103`, so a drawer job
       keeps that code);
    4. the target: active and not deleted in `printers`, else `print_job.printer_unsuitable`
       (`{ id, printerId }`); its dots from `textGrid(…).widthDots`;
    5. `job.saleId` set → `payload = await layOut(tx, job.saleId, job.receiptCopy === true,
       target)`;
    6. otherwise, a `kitchen_print_jobs` or `receipt_reprints` row on `job.resendOf ?? job.id` →
       `jobWidthDots(job.payload)`: `null` → `print_job.own_printer_only` (`{ id }`); wider than
       the target → `print_job.printer_unsuitable`; else `payload = centredForPrinter(job.payload,
       dots)`;
    7. otherwise → `print_job.own_printer_only`;
    8. `resendInvoicePrintJob(tx, jobId, personId, now, undefined, { printerId, payload })`.
- Modify: `apps/server/src/invoice-print.ts:24-57` — `resendInvoicePrintJob` takes an optional
  `to` and passes it to both `resendPrintJob` calls (`:36`, `:38`); the delivery reservation
  (`:40-45`) is unchanged and so covers the new job.
- Modify: `apps/server/src/errors.ts` — declare `print_job.own_printer_only: { id: string }` and
  `print_job.printer_unsuitable: { id: string; printerId: string }`.
- Modify: `apps/server/src/print-api.ts`:
  - `PrintApiDeps` (`:96-116`) gains `layOutSaleReceipt: (tx, saleId, duplicate, printer) =>
    Promise<Uint8Array>`, beside `readInvoiceDocument`; `STATUS` (`:126`) gives both new codes 409.
  - The resend route (`:1538-1549`) reads `readJsonBody`; with no `printerId` it is today's request;
    otherwise `requireBodyUuid(body.printerId, "printerId")` (as `orders-api.ts:287`) and
    `reprintJobOn(tx, deps.layOutSaleReceipt, id, printerId, personId, deps.now?.())`.
  - The job list (`:1422-1535`) adds per row `reprintRule: "any" | "wide_enough" | "own"` and
    `reprintPrinterIds: string[]` — the other active, not-deleted receipt printers the server would
    accept: `any` (a `sale_id`) offers them all; `wide_enough` (a kitchen or refund-receipt link and
    a head `jobWidthDots` reads) those whose dots are at least the job's; `own` none. **No query per
    row:** the select adds the head as `substr(payload, 1, 10)` and the two links as `exists`
    subqueries correlated to `coalesce(print_jobs.resend_of, print_jobs.id)`; one more select
    reads the active printers. `print_jobs` is that select's `.from()` base, which CLAUDE.md §3
    warns can break a correlated `sql` subquery silently — read the emitted SQL with `.toSQL()`,
    and keep the list test below, which tells a linked row from an unlinked one in one list.
- Modify: `apps/server/src/boot.ts:2603-2604` — wire `layOutSaleReceipt` over `nodeBackend` and
  `tradingContext`, as `readInvoiceDocument` is.
- Modify: the eleven test files that mount the print API (`grep -rln "mountPrintApi(" apps/server/src`)
  — `layOutSaleReceipt: () => Promise.reject(new Error("No receipt is laid out here"))`, as
  `equipment-label-api.test.ts:84` does for `readInvoiceDocument`, except where a case reprints a
  receipt elsewhere, which passes the real one.
- Modify: `apps/dashboard/src/api/client.ts` — `resendPrintJob(id, printerId)` (`:4087-4089`) sends
  `{ printerId }`; `PrintJobRow` (`:1438-1450`) gains `reprintRule` and `reprintPrinterIds`.
- Modify: `apps/dashboard/src/i18n/codes.ts` — the two codes' words.
- Test: `apps/server/src/print-job-reprint.test.ts` (new), `apps/server/src/print-api.printer-wiring.test.ts`
  (`describe("print job resend")`, `:1013`), `apps/server/src/invoice-print-api.test.ts`
  (`describe("management invoice receipt resends")`, `:666`), `apps/server/src/alert-sources.test.ts`
  (beside `:978`), `apps/server/src/print-api.unpair-kitchen.test.ts` or `kitchen-print.test.ts`
  (whichever seeds a table's printing problem), `apps/dashboard/src/api/client.test.ts` (`:2534`).
  Before writing a seed, reuse what `invoice-print-api.test.ts` and the printer-wiring suite
  already build (a sale with its receipt job, `recordSale`, the seeded printers).

- [ ] **Step 1: Write the failing tests** (each refusal asserts the domain code, not just a status).
  - `print-job-reprint.test.ts`, through `reprintJobOn` with the real `layOutSaleReceipt`:
    - `it("lays a receipt out again for a printer of the same setting as the bytes it first printed")`
      — an original receipt at 80 mm / 180 dpi, failed with its attempts used up, reprinted on
      another 80 mm / 180 dpi printer: the new job's payload equals the original's, byte for byte.
      This is the check that `readTransactionReceipt` gives the ticket the original was printed
      from. If it fails, use `readSettledTicket(backend, tx, cfg, sale.workingOrderId)` for a sale
      with a working order (as `orders-reprint.ts:28` does) and say so in the PR; if neither gives
      the same bytes, stop and report.
    - `it("lays a failed original receipt out again for a printer of another width, still as the original")`
      — the original at 58 mm / 180 dpi, the target 80 mm / 203 dpi: the new job is on the target,
      `resendOf` the original, `receiptCopy` false, its payload `layOutSaleReceipt(…, false,
      target)`'s and not the stored bytes; `readOriginalReceiptPrint` for the sale names the new
      job, queued.
    - `it("keeps a receipt copy marked as a copy when it is laid out again")` — `receiptCopy` true,
      payload `layOutSaleReceipt(…, true, target)`'s.
    - `it("centres a kitchen ticket on a wider printer")` — payload equals
      `centredForPrinter(stored, 512)`; and a resend of a resend of it (links only on the first)
      likewise; a joined kitchen ticket (`joinKitchenTickets`) has both `GS L`s set (read with
      `escPosCommands`).
    - `it("centres a refund receipt, recorded only in receipt_reprints, on a wider printer")`.
    - `it("refuses a kitchen ticket on a narrower printer")` → `print_job.printer_unsuitable`.
    - `it("reads a kitchen ticket's width from the job, not from its printer's setting now")` — a
      ticket printed at 80 mm / 203 dpi (576 dots); its printer is then recalibrated to 80 mm /
      180 dpi; a 512-dot target is refused `print_job.printer_unsuitable`, a 576-dot one accepted.
    - a test page to another printer → `print_job.own_printer_only`; a disabled target and a
      deleted target → `print_job.printer_unsuitable`; a drawer job with a target →
      `print_job.not_resendable`; the job's own printer as the target → today's resend, the same
      bytes.
  - `print-api.printer-wiring.test.ts`: a malformed `printerId` → `management.request_invalid`; the
    route passes a target through (one receipt reprinted elsewhere, 202, the new job on the target);
    one list holding a receipt, a kitchen ticket, a refund receipt and a test page, with active
    printers at 58 mm / 180 dpi, 80 mm / 180 dpi and 80 mm / 203 dpi and one disabled, gives
    `any` / `wide_enough` / `wide_enough` / `own` and the expected `reprintPrinterIds` (the job's
    own printer and the disabled one never among them). The permission cases stay as they are: the
    gate is the same `gated` call with or without a body.
  - `invoice-print-api.test.ts`: `it("reserves a full invoice's delivery for its receipt laid out on another printer")`
    — a full invoice whose original failed, reprinted elsewhere: a receipt delivery for the new job,
    designation `original`, as the same-printer cases there assert.
  - `alert-sources.test.ts`: `it("stops counting a job once a resend of it has printed on another printer")`.
  - kitchen: `it("clears a table's printing problem once its failed ticket is reprinted and printed on another printer")`.
  - `client.test.ts`: the changed `:2534` case.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/print-job-reprint.test.ts src/print-api.printer-wiring.test.ts src/invoice-print-api.test.ts src/alert-sources.test.ts -t "resend|reprint|another printer|laid out|centres|width"`
  — the new cases FAIL; the two trouble cases may pass at once — if so they pin
  `print-job-trouble.ts:57-61`'s printer-free resend clause, and a deletion control (add
  `and copy.printer_id = print_jobs.printer_id` in a throwaway edit) must make them fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files whole, `src/till-api.receipt.test.ts` and
  `src/till-api.deliveries.test.ts` (the other callers, unchanged), `src/transaction-receipt-api.test.ts`
  (the `buildReceiptBytes` export), the eleven print-API files, and `tsc --noEmit` for
  `@waitron/server` and `@waitron/dashboard` — pass.
- [ ] **Step 5: Commit** — `git commit -s -m "A print queue reprint can go to another printer: receipts and invoices laid out again for it, kitchen tickets and refund receipts centred on one at least as wide (A405 point 4)"`.

### Task 18: The Reprint dialog

**Files:**
- Create: `apps/dashboard/src/widgets/print-job-reprint-dialog.ts` — modelled on
  `order-reprint-dialog.ts` (`wt-dialog`, a `wt-combobox name="printerId"` labelled
  `printers.reprint_printer`); given the job, the screen's receipt printers and the original printer
- Modify: `printers-screen.ts` — Reprint (`:3797-3804`) opens the dialog; `#resendJob`
  (`:3840-3848`) takes the chosen printer
- Create: `apps/dashboard/src/widgets/print-job-reprint-dialog.test.ts`
- Modify: `strings.ts` — the reprint keys

Offered printers: the original first, chosen, when active (whatever its setting now — that is
today's same-printer reprint), then the job's `reprintPrinterIds` that the screen's printer list
holds, by name. The hint follows `reprintRule`: `any` (a receipt or full invoice) none;
`wide_enough` (a kitchen ticket or refund receipt) `printers.reprint_wide_enough`; `own` (anything
else) `printers.reprint_own_only`. A disabled original is not offered and nothing is chosen;
Reprint stays quiet and disabled until a printer is. With no other offer the combobox is replaced
by `printers.reprint_original_off` (`own`) or `printers.reprint_none` (`any`, `wide_enough`), and
Reprint stays disabled. A refusal shows at the bottom through `codeMessage`, Reprint usable again.
A success closes the dialog and shows `printers.reprint_sent` as the screen's `wt-notice`.

**No draft scope, deliberately:** the dialog's only input is a preselected printer, as in the
Orders screen's reprint dialog (`order-reprint-dialog.ts`, which has neither a scope nor an
`*.unsaved.test.ts`); asking "discard changes?" on cancelling a reprint would be wrong. The PR
description asks `/finish-branch`'s convention reviewer to judge this against the CLAUDE.md §3
staged-input rule.

- [ ] **Step 1: Write the failing tests** (dialog suite): an `any` job offers the original chosen,
  then every id in `reprintPrinterIds` including a printer of another width and resolution, no A4
  printer, and no hint; a `wide_enough` job offers the original and its ids with the
  `printers.reprint_wide_enough` hint; an `own` job offers only its printer with the own-only
  line; a disabled original with other offers chooses nothing and keeps Reprint disabled until one
  is chosen; a disabled original with none shows `printers.reprint_original_off` (`own`) or
  `printers.reprint_none` (`wide_enough`) with Reprint disabled; Reprint sends
  `resendPrintJob(id, chosen)` once while pending; a refusal shows
  `codeMessage("print_job.printer_unsuitable")` at the bottom; in `printers-screen.test.ts`, the
  changed `:5318` and `:5347` cases.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/widgets/print-job-reprint-dialog.test.ts`
  and `src/screens/printers-screen.test.ts -t "resend|Reprint"` — FAIL.
- [ ] **Step 3: Implement.** The a11y suite gains the dialog in both themes
  (`printers-screen.a11y.test.ts`).
- [ ] **Step 4: Run** the files and `pnpm exec vitest run scripts/native-form-fields.test.ts` — pass.
- [ ] **Step 5: Commit** — `git commit -s -m "Reprint asks which printer, the original chosen, offering only printers that can take the printout (A405 point 4)"`.

### Task 19: PR 4's guide

- [ ] **Step 1:** Append the Reprint paragraph to the existing **Print Queue** / **Cola de
  impresión** section and the Pair again sentence to Printer details, both languages, as "Words for
  the owner" → PR 4 — guide gives them. The section list is unchanged: the guide case
  (`apps/server/src/guide-content.test.ts:108-118`) already expects `["add-printer", "calibrate",
  "printer-details", "print-queue"]`. A help link `"printers.print-queue"` in `help-guide.ts` only
  if a bubble uses it (none is planned).
- [ ] **Step 2: Run** the guide checks (Task 5 Step 4) — pass.
- [ ] **Step 3: Commit** — `git commit -s -m "Guide words for Pair again and reprinting on another printer (A405)"`.

### Task 20: Backlog, the held remainder, a look, and a test print

**Files:** `docs/backlog.md` (the A405 entry, `:1285-1287`; the leftovers bundle line, `:1275`),
`docs/backlog/printers.md` (the A405 section, `:336-373`; the bundle heading, `:722`)

- [ ] **Step 1: Backlog.** Delete the A405 entry from `docs/backlog.md` and its section from
  `docs/backlog/printers.md`. Retitle the bundle "Printers screen leftovers, inside A405's
  remaining pull requests" to "Printers screen leftovers" in both files (A405 has no pull requests
  left), fixing its anchor link. Add, in the Printers area of both files:
  "**Reprint kitchen tickets and other printouts laid out again for any printer (left by A405
  point 4).** Receipts and full invoices are laid out again from the sale. Every other job keeps
  only its finished bytes, so Reprint copies them: kitchen tickets and refund receipts to an
  active receipt printer at least as wide, centred; everything else to its own printer only.
  Laying them out again needs each job to keep the printer-independent document it was built from,
  with a version number, in a new `print_jobs` column, and each builder (`formatKitchenTicket`,
  `formatCorrectionSlip`, `formatPaymentSlip`, `formatCategorySalesPage`,
  `formatTenderRefundAcknowledgment`) to draw from it; a job whose version the running code cannot
  read falls back to today's rule. Also open: whether kitchen tickets, payment slips and reports
  need an A4 page, or A4 printers stay out for them." And:
  "**Deleting an A4 printer (left by A405 point 6).** `page_printers` has no deletion column and is
  referenced with `restrict` by `invoice_deliveries`, `devices` and `device_profile_printers`, so a
  delete must be a soft delete, which needs a column. Until then A4 details have no Delete.
  Switching an A4 printer back on and changing its address stay in Add a printer by design: both
  need a fresh discovery entry (`apps/server/src/page-printers-api.ts:165-166`)." Keep the
  station-link entry from Task 11.
- [ ] **Step 2: Look** as in Task 6 Step 2: the Pair again window in its looking, not-found and
  found states, the Reprint dialog for a receipt (every printer, no hint), a kitchen ticket (wide
  enough, with its hint), an own-only printout and a disabled original, both themes, desktop and
  phone, both languages; render the guide page.
- [ ] **Step 3: A test print on the owner's 80 mm printer** (Epson TM-T88III, raw ESC/POS at
  `192.168.10.81`, port 9100). The runner cannot see paper; this step sends and records, and the
  owner looks.
  1. Check the Mac reaches it: `nc -z -G 3 192.168.10.81 9100; echo $?` (`0` reachable). From the
     plan-writing session on 2026-11-09 this printed `1`; check again. If it is not `0`, skip to
     item 5.
  2. In a `mktemp -d` folder (nothing committed), a `.mts` script run from `apps/server` with
     `./node_modules/.bin/tsx` (a `.ts` file fails: top-level `await` needs the module form, as
     measured for point 4) builds one **joined** kitchen ticket at 58 mm / 180 dpi with
     `formatKitchenTicket` and `joinKitchenTickets` — fired item "1 x CONTROL" / "1 x CENTRED" and
     held item "1 x HOLD PART" — and writes two files: `control.bin`, the bytes as built (the
     CONTROL ticket), and `centred.bin`, the CENTRED ticket through
     `centredForPrinter(bytes, 512)`.
  3. Record each file's length, first ten bytes (`xxd -l 10`) and `shasum -a 256`, and that every
     `GS L` in `centred.bin` reads `4c 00` (with `escPosCommands`).
  4. Send `control.bin`, then `centred.bin`: `nc -G 3 -w 5 192.168.10.81 9100 < control.bin`, and
     the same for `centred.bin`; record each exit status.
  5. The PR description says what was sent, or that the printer was not reachable and the centring
     is **not proven on paper**, and asks the owner to look before landing. What each print should
     look like: both are 360 dots, about 51 mm, of text on 80 mm paper, whose printable line is 512
     dots, about 72 mm. **CONTROL**: the text starts at the left edge of the printable line, with
     about 21 mm blank on its right, in both parts. **CENTRED**: about 11 mm blank (76 dots) on each
     side, in both the CENTRED part and the HOLD PART. If CENTRED looks like CONTROL, the printer
     ignores `GS L` for images: the PR says so, and the owner decides before it lands.
- [ ] **Step 4: Commit** — `git commit -s -m "Backlog: A405 done, with laying out kitchen tickets and other printouts again left for later"`.
  Then `/finish-branch` with PR 4's worktree, naming this plan (full path: two Codex run-it
  reviews). The PR description lists the changed assertions, the words, the held remainder, the
  owner's answers to open questions 1 and 2 with the one departure (a failed original reprinted
  elsewhere stays an original), the two layout limits (today's trim and logo; the sale's own
  language), and the test print's outcome.
