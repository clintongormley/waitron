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
read; and the resend route (`print-api.ts:1503-1514`) takes an optional target printer, checked in
`resendPrintJob` (`packages/printing/src/outbox.ts:95-131`). One new shared date helper in the
dashboard. The `printers` guide page (landed with A404) gains sections in English and Spanish.

**Tech stack:** Lit web components, Vitest 4 (browser mode, real headless Chromium, for
`@waitron/dashboard`; Node for `@waitron/server`, `@waitron/printing`, `@waitron/venue-service`),
Hono, Drizzle over SQLite.

**Spec:** `docs/backlog/printers.md`, section "A405 — printer details and the print queue"
(points 1–6). Plan shape follows `docs/superpowers/plans/2026-11-05-a404-add-calibrate-printer.md`.

Line numbers below were measured on `c3a4f8a56a`.

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

- A succeeded Unpair switches the printer off (C109, #960; the comment at `:2514`). The Add a
  printer dialog can already bring a switched-off registration back **under its existing id**:
  `#disabledPrinter` (`:1380-1384`) and the `disabled` branch of `#registerDiscovered`
  (`:1513-1520`) call `updatePrinter(id, { active: true, … })`. So the spec's "the only way back is
  adding it again as a new printer" is how it looks, not what happens — but it means scanning,
  Pair and add, the name form and calibration again, from a dialog that does not say it is the
  same printer.
- **No new server route is needed.** Pairing is `POST /management-api/print-agents/:id/bluetooth/pair`
  (`print-api.ts:869-888`), which refuses `printer.bluetooth_not_discovered` unless that agent
  reported the address from a scan recently (`:881-883`). So the dashboard must run a discovery scan
  first (`startPrinterDiscovery` / renew / `listDiscoveredPrinters`, as `#scan` does, `:1294-1333`),
  find the agent that reports the printer, then pair through it, then switch the printer on with
  the existing PATCH.
- The scan and the command tracking only run while the Add dialog is open: `#loadDiscovered`
  (`:1231`), `#scan` (`:1309`, `:1313`) and `#pair` (`if (this.addingPrinter) this.#trackCommand(…)`
  inside `:1815-1851`) all test `this.addingPrinter`. A succeeded pair goes to `#addPaired`
  (`:1707-1715`, called from `#absorbCommands` at `:1683`), which opens the name form. Task 15
  loosens the first; Task 16 adds the Pair again branch.

### Point 4 — Reprint to another printer

- Reprint today: the queue's `Reprint` (`:3289-3305`) calls `resendPrintJob(id)` → route
  `print-api.ts:1503-1514` (permission `print.resend`) → `resendInvoicePrintJob`
  (`apps/server/src/invoice-print.ts:24-57`) → `resendPrintJob` (`outbox.ts:95-131`), which copies
  the stored bytes to the **same** printer. `canResendPrintJob` (`outbox.ts:75-89`) refuses drawer
  jobs; the job list computes `canResend` (`print-api.ts:1493-1497`). Two other callers pass no
  target and stay as they are: the till (`apps/server/src/till-api.ts:2442`) and invoice delivery
  actions (`apps/server/src/invoice-delivery-actions.ts:246`).
- **"Same paper width" is not enough: the bytes are built for a paper width AND a resolution.** Every
  text line is a raster band `textGrid(...).widthDots` wide (`packages/printing/src/escpos.ts:53-56`,
  `:70-78`); the four settings draw 360, 384, 512 and 576 dots (`packages/printing/src/layout.ts:30-39`,
  `:57-62`); a receipt sets its print area to that width (`apps/server/src/receipt-ticket.ts:82-83`)
  and sizes its QR code in dots from the resolution (`:156-163`). A404's measured experiment
  (A404 plan, "The QR question") printed a QR code stored for 203 dpi on a 180 dpi head at 41.5 mm,
  over the 40 mm legal limit (`docs/compliance/verifactu-findings.md:1000`). **This plan offers only
  printers with the same paper width and the same resolution** as the original printer's current
  settings, and asks the owner to confirm (open question 1).
- Paper width and resolution are stored only for receipt printers (`printers.paper_width`,
  `printers.resolution`, `packages/db/src/schema/printers.ts:55-56`). **A4 printers have no print
  jobs today:** `print_jobs.printer_id` references `printers` alone
  (`packages/db/src/schema/print-jobs.ts:38-42`), and the queue joins `printers`
  (`print-api.ts:1456`). A4 printers are never offered for a reprint.
- **Test and calibration pages cannot be told apart from other printouts without a schema change.**
  Nothing records a job's kind beyond `document` / `drawer` (`print-jobs.ts:52`). What can be
  told: a receipt or full invoice on a receipt printer carries `sale_id` (`receipt-print.ts`, the
  `enqueuePrintJob(…, { saleId })` calls), and a kitchen ticket has `kitchen_print_jobs` rows
  (`linkKitchenJob`, `apps/server/src/kitchen-print.ts:831-834`, `:870-880`). Everything else has
  neither: test pages and calibration samples (`print-api.ts:1319`, `:1354`, `:1373`), equipment labels
  (`:1297`), report pages (`report-api.ts:402`), payment slips (`payment-slip-print.ts:101`), refund
  acknowledgements (`tender-refund-api.ts:218`, no `saleId` passed) and the kitchen slips enqueued
  without links (`kitchen-print.ts:1383`, `:1452`, `:1843`). So **only receipts and kitchen tickets
  may move to another printer; every other printout reprints on its own printer**, which keeps the
  spec's rule for test and calibration pages. A resend copies `sale_id` (`outbox.ts:125`) but not
  kitchen links, so the kitchen test reads the links of the chain's first job (`resend_of ?? id`).
- A reprint that prints on another printer still clears the original's trouble: the resend clause
  of `printJobInTrouble` names no printer (`apps/server/src/print-job-trouble.ts:56-60`). Task 17
  pins this with a test rather than relying on reading.
- Inserting a job for a disabled printer throws `printer.not_found` ("That printer no longer
  exists", `outbox.ts:52-57`, `codes.ts:782-785`), which is wrong for a switched-off printer. The
  new target check refuses a disabled or mismatched target with its own code before the insert.

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
  (`packages/venue-service/src/operations.ts:119`). Task 7 adds `readDepartmentNames` to the seat.
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

- **Held until after A760 (A1308 hold):** point 4's "every job keeps the input it was built from"
  — a stored, versioned, printer-independent document on each print job, and Reprint laying the job
  out again for the chosen printer with the same builder (`formatReceipt`, `formatKitchenTicket`,
  `formatCorrectionSlip`, `formatPaymentSlip`, `formatCategorySalesPage`). It needs a new column on
  `print_jobs`. With it go: reprinting onto a printer of another paper width or resolution;
  reprinting payment slips, report pages, equipment labels, refund acknowledgements and the
  unlinked kitchen slips onto another printer; and the spec's open question about A4 pages for
  kitchen tickets, payment slips and reports.
- **Cut because the A4 routes do not exist (no schema needed, but new server features beyond the
  spec):** deleting an A4 printer, changing an A4 printer's address, and switching a disabled A4
  printer back on from its details (the server refuses it, `page-printers-api.ts:177`).
- **Left open:** a station link opens the Stations tab, not the station (the module's screen
  clears its `station` word, `prep-stations-screen.ts:199`).
- **Not a cut:** the details' A4 "Used by" shows profiles listing it for full invoices; no station
  prints to an A4 printer (`station_printers.printer_id` references `printers`).

## Open questions for the owner (each with the default this plan builds)

1. **Reprint elsewhere: same paper width only, or same paper width and resolution?** The spec says
   paper width; the bytes also depend on resolution, and a 203 dpi QR code on a 180 dpi head prints
   over the 40 mm legal limit (above). **Default: same width and resolution.**
2. **Every reprint now opens a small dialog** (choose the printer, original preselected), one more
   press than today's one-press Reprint. **Default: the dialog for every job**, so a job whose own
   printer is switched off says so instead of "That printer no longer exists".

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

Twenty-one tasks, four PRs, in order; each later PR is branched from `main` after the earlier one lands
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
  runs.
- **PR 4 — "Pair again, and reprint to another printer"** (`feat/a405-pair-again-reprint`):
  Tasks 15–20, points 3 and 4 (schema-free part). **Risk triggers: cross-package contract**
  (`resendPrintJob` in `@waitron/printing` gains a target; `resendInvoicePrintJob`, the route body
  and `PrintJobRow` change), **permissions** (the resend route keeps `print.resend` and must refuse a
  drawer job, an unmovable kind, a disabled, deleted or mismatched target server-side, each with its
  domain code), and **fiscal-adjacent output** (a receipt or full invoice printed on another
  printer must keep its QR code within 30–40 mm). Full path; two Codex run-it reviews.

## Overlap with open branches (none is a reason to wait)

- `feat/a790-document-routing-foundation` (lane F, #2455, open): touches `docs/backlog/printers.md`
  only among this plan's files (merge-base diff checked 2026-11-05). Its plan keeps the print
  queue's Resend outside A790 (`docs/superpowers/plans/2026-11-04-a790-venue-document-printer-routing.md:46`).
  It adds `document_page_jobs` (A4 page jobs); when those reach the queue, Task 18's offered-printer
  rule must be revisited, and its device invoice choices may change what "Used by → Full invoices"
  means. Rebase the backlog text if both land.
- `feat/a739-payment-window` (last commit 2026-10-22): changes `insertPrintJob` in
  `packages/printing/src/outbox.ts` (a `jobId` option), which Task 17 also edits — a textual
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
   not drawn while editing (Tasks 4b and 10).
3. "Today" just after local midnight, "Yesterday" across a month end, and Spanish (Task 1).
4. A profile listing the printer for two roles shows once with both; a kitchen-display profile has
   no department; a link to a screen the person may not open is plain text (Tasks 8 and 10).
5. A reprint target with the same paper width but another resolution, a disabled target, a drawer
   job with a target, a test page with another target, and a resend of a resend of a kitchen
   ticket — each refused or accepted server-side, whatever the dashboard offered (Task 17).

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
profiles belong to. Each name opens its own screen." Spanish: "**Se usa en** muestra los perfiles
de dispositivo que imprimen en ella y para qué, las estaciones de preparación que le envían
comandas y los departamentos de esos perfiles. Cada nombre abre su pantalla."

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
| `printers.reprint_same_setting` | new | Only printers with the same paper width and resolution are offered. | Solo se ofrecen impresoras con el mismo ancho de papel y la misma resolución. |
| `printers.reprint_own_only` | new | This printout reprints only on its own printer. | Esta impresión solo se reimprime en su propia impresora. |
| `printers.reprint_original_off` | new | {printer} is disabled. Switch it on in its details, then reprint. | {printer} está deshabilitada. Actívala en sus detalles y vuelve a reimprimir. |
| `printers.reprint_none` | new | No active printer has the same paper width and resolution. Switch {printer} on in its details, then reprint. | Ninguna impresora activa tiene el mismo ancho de papel y resolución. Activa {printer} en sus detalles y vuelve a reimprimir. |
| `printers.reprint_sent` | new | Reprint sent to {printer} | Reimpresión enviada a {printer} |

Reused: `printers.resend_job` (Reprint / Reimprimir) as the dialog's heading and button,
`action.cancel`, the Pair dialog's existing words.

### PR 4 — error codes (`apps/dashboard/src/i18n/codes.ts`; declared in `packages/printing/src/errors.ts`)

| Code | English | Spanish |
| --- | --- | --- |
| `print_job.own_printer_only` | This printout can only be reprinted on its own printer. Choose that printer. | Esta impresión solo se puede reimprimir en su propia impresora. Elige esa impresora. |
| `print_job.printer_unsuitable` | That printer is disabled or uses a different paper width or resolution. Choose another printer. | Esa impresora está deshabilitada o usa otro ancho de papel u otra resolución. Elige otra impresora. |

The till never sends a target (`till-api.ts:2442`), so neither code reaches it and the till's
`codes.ts` needs no entry.

### PR 4 — guide

English, a new section after Printer details, and a sentence appended to Printer details:

```markdown
## Reprint from the print queue {#print-queue}

In the **Print Queue**, **Reprint** sends a printout again. A receipt or a kitchen ticket can go to
another active printer with the same paper width and resolution, for when the first one is out of
service. Other printouts reprint only on their own printer.
```

Appended to Printer details: "A Bluetooth printer you unpaired is disabled. To use it again, put it
in pairing mode, open its details and choose **Pair again**."

Spanish:

```markdown
## Reimprimir desde la cola de impresión {#print-queue}

En la **Cola de impresión**, **Reimprimir** vuelve a enviar una impresión. Un ticket o una comanda
de cocina puede ir a otra impresora activa con el mismo ancho de papel y la misma resolución, por si
la primera no funciona. Las demás impresiones solo se reimprimen en su propia impresora.
```

Appended: "Una impresora Bluetooth que desvinculaste queda deshabilitada. Para volver a usarla,
ponla en modo de emparejamiento, abre sus detalles y elige **Emparejar de nuevo**."

Check every bold word against the screen's words in that language (`printers.list_title`,
`printers.jobs_title`, `printers.status_active`, `action.edit`, `printers.calibrate`,
`printers.resend_job`, `printers.pair_again`, `printers.print_test_page`) and fix the guide, not the
screen, where they differ.

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
- `printer-inline.unsaved.test.ts` → becomes `printer-details.unsaved.test.ts` (Task 4b). Its
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

PR 2:
- `apps/server/src/print-api.printer-wiring.test.ts` "GET /management-api/printer-profiles lists a
  receipt printer on an invoice list, and no row for a page printer there" (`:706`) → now expects
  the page printer's row with `pagePrinterId`; the ordering case (`:668`) also asserts `roles` and
  the department fields; the permission case (`:744`) is unchanged.
- `printers-screen.test.ts` cases reading `printer-profiles` (the "Offered on profiles" fact) read
  the Used by group.

PR 3:
- `page-printers-panel.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts` — the widget is deleted; each
  behavioural case moves (Tasks 12–14 say where), its assertions kept, except "lists each office
  printer under the A4 printers heading…" (`:128`) and "calls them A4 printers, in English and
  Spanish" (`:146`), which now assert the one table's Paper column; "keeps the row menu in a pinned
  actions column" (`:191`) applies to the one table.

PR 4:
- `print-api.printer-wiring.test.ts` "requires print.resend and copies the original bytes without
  changing its history" (`:836`) — unchanged with no body; its target twins are new.
- `printers-screen.test.ts` "offers resend for eligible jobs and enqueues the selected document only
  once while pending" (`:4908`) and "shows a localized resend failure and permits another attempt"
  (`:4937`) press Reprint, then the dialog's Reprint; "labels Reprint and separates it visibly from
  View printout" (`:4894`) is unchanged.

---

## PR 1 — Printer details in a window

### Task 1: A "Today 13:09" date helper

**Files:**
- Modify: `apps/dashboard/src/date-utils.ts` — add `formatRecentMinute`
- Modify: `apps/dashboard/src/i18n/strings.ts` — `time.today_at`, `time.yesterday_at` (EN, ES)
- Test: `apps/dashboard/src/date-utils.test.ts` (it runs with the zone pinned to America/New_York,
  `:5-7`)

**Interfaces:**
- Produces: `formatRecentMinute(iso: string, now?: Date, locale?: string): string` — in the
  browser's zone: "Today HH:MM" when `iso` falls on `now`'s local date, "Yesterday HH:MM" on the
  day before, otherwise Intl's short day and month in `locale` then `HH:MM`, with the year when it
  differs from `now`'s. 24-hour clock. A future instant on another day takes the last form.

- [ ] **Step 1: Write the failing tests.** `it.each` over `en-GB` and `es-ES` with fixed `now`s:
  "Today 13:09" / "Hoy 13:09" for an instant earlier the same local day; one minute after local
  midnight with the instant one minute before it → "Yesterday 23:59" / "Ayer 23:59"; 1 November
  00:30 local with the instant on 31 October → Yesterday; three days earlier → `3 Nov 13:09` shape
  (assert with a regex on the day number, the month text from
  `new Intl.DateTimeFormat(locale, { month: "short" })`, and the time); last year → contains the
  year; an instant whose UTC date differs from its local date reads the LOCAL day (the control: the
  failing case would print the UTC day).
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/date-utils.test.ts` —
  FAILS (no export). Browser mode, real Chromium.
- [ ] **Step 3: Implement** with `dateTimeFormat` from `@waitron/dashboard-kit` (cached formatters,
  `date-format.ts:12-25`) and `fill`/`t` for the two keys.
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
- Test: `printers-screen.test.ts`, `printers-screen.a11y.test.ts`

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

### Task 4a: Delete, Calibrate and Edit at the bottom; Edit turns the window into one form

**Files:**
- Modify: `printers-screen.ts` — replace `#detailNameScope`/`#detailConnectionScope`,
  `#openDetailName`/`#openDetailConnection`, `#saveDetailName`/`#saveDetailConnection`,
  `#cancelDetail` and `#detailConnectionErrors` (`:2586-2725`) with one draft
  `detailEdit: { id, name, host, port, saving, error } | null` and one `#detailEditScope` from
  `draftScopeFor`; the row menu's Edit (`:2494-2504`) opens the details in edit mode with the name
  focused
- Test: `printers-screen.test.ts`, `printers-screen.save-state.test.ts`

**Interfaces:** view footer is a `wt-form-actions` in the modal's `footer` slot:
`delete-printer-detail` (danger) in the `cancel` slot, `calibrate-printer-details` in `secondary`,
`edit-printer-details` in the default slot. Edit footer: `cancel-printer-details` in `cancel`,
`save-printer-details` in the default slot. The form holds `wt-input name="printer-detail-name"`
(required) and, for `network_tcp` only, `printer-detail-host` (required) and `printer-detail-port`.
Equipment label stays in its row.

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
- [ ] **Step 3: Implement.** The save handler returns early when
  `saveActionState(this.#detailEditScope).unchanged`; the PATCH carries only fields that differ from
  the saved printer; `host`/`port` validation is today's (`:2685-2696`). Delete still goes through
  `#requestDetailDelete` (no draft can be open in view mode).
- [ ] **Step 4: Run** the file whole and `printers-screen.save-state.test.ts`; change the listed
  inline-editor assertions (same checks through the one form). Pass.
- [ ] **Step 5: Commit** — `git commit -s -m "Printer details keep Delete, Calibrate and Edit at the bottom, and Edit turns them into one form (A405 point 1)"`.

### Task 4b: The one form's unsaved-changes behaviour

**Files:**
- Rename and rewrite: `apps/dashboard/src/screens/printer-inline.unsaved.test.ts` →
  `printer-details.unsaved.test.ts`
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
  — the new case FAILS if Task 4a commits only one field's baseline; otherwise all pass. If every
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

### Task 7: The venue-service seat reads department names

**Files:**
- Modify: `packages/module/src/module.ts` — `VenueServiceContribution` (`:740`) gains
  `readDepartmentNames(tx: Transaction, ids: readonly string[]): Promise<{ id: string; name: string }[]>`
  with a one-line doc: every named department that exists, switched off or not
- Modify: `packages/venue-service/src/operations.ts` — implement it (a `departments` select by id,
  no `active` filter)
- Modify: `packages/venue-service/src/service.ts` — export it on the contribution object (beside
  `readProfileServiceScopes`, `:228`)
- Test: `packages/venue-service/src/service.test.ts` (or the file that tests
  `readProfileServiceScopes`; grep)

- [ ] **Step 1: Write the failing test.** `it("reads the names of the departments asked for, switched off ones included, and nothing for an unknown id")`
  — `useVenueDb`; seed two departments, switch one off; ask for both plus a random UUID: two rows,
  names as seeded; an empty id list returns `[]` without a query error.
- [ ] **Step 2: Run** `pnpm --filter @waitron/venue-service exec vitest run src/service.test.ts -t "names of the departments"`
  — FAIL.
- [ ] **Step 3: Implement.** Use `inArray` and the store's chunking only if the id list can grow
  with venue size (profiles are few; say so in the commit).
- [ ] **Step 4: Run** the file, `pnpm --filter @waitron/module exec tsc --noEmit`,
  `pnpm --filter @waitron/venue-service exec tsc --noEmit`, `pnpm --filter @waitron/server exec tsc --noEmit`,
  and `pnpm exec vitest run scripts/module-seams.test.ts` — pass. Any test fake implementing
  `VenueServiceContribution` that fails to typecheck gains the method.
- [ ] **Step 5: Commit** — `git commit -s -m "The venue-service seat reads department names by id (A405 point 5)"`.

### Task 8: The server says which profiles use a printer, for what, and which stations

**Files:**
- Modify: `apps/server/src/print-api.ts` — `GET /management-api/printer-profiles` (`:1597-1614`)
  returns one row per (printer or A4 printer, profile):
  `{ printerId: string | null, pagePrinterId: string | null, profileId, profileName, roles: Role[], departmentId: string | null, departmentName: string | null }`,
  roles in the order receipt, payment_slip, cash_drawer, invoice; retired profiles left out; department through
  `VENUE_SERVICE.readProfileServiceScopes` then `readDepartmentNames`. Add
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
  and the word is written back to null (replace); an unknown id opens nothing
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
- [ ] **Step 5: Commit** — `git commit -s -m "Printer details say where the printer is used, each name a link to its screen (A405 point 5)"`.

### Task 11: PR 2's guide, backlog and look

- [ ] **Step 1:** Append the Used by sentences to both guide sections; run the guide checks (Task 5
  Step 4).
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

### Task 15: Scanning and pair tracking work outside the Add dialog

A refactor; no behaviour changes for the Add dialog.

**Files:**
- Modify: `printers-screen.ts` — a `#scanWanted()` true while `addingPrinter` or a Pair again is
  open, used in place of `this.addingPrinter` in `#loadDiscovered` (`:1231`), `#scan` (`:1309`,
  `:1313`) and `#pair`'s tracking (`:1815-1851`); `#addPaired` (`:1707-1715`) unchanged for now
- Test: `printers-screen.test.ts`, `printer-pair.unsaved.test.ts`, `printer-address.unsaved.test.ts`

- [ ] **Step 1:** Run the three files and note the `Tests` counts (baseline green).
- [ ] **Step 2: Refactor.**
- [ ] **Step 3: Run** the three files — same counts, all pass.
- [ ] **Step 4: Commit** — `git commit -s -m "Printer discovery and pair tracking no longer assume the Add dialog is open (A405 point 3, groundwork)"`.

### Task 16: Pair again on the same printer

**Files:**
- Modify: `printers-screen.ts` — a Pair again button (`pair-again-<id>`) in the details'
  Connection group and in the row menu, for a Bluetooth printer that no agent reports paired
  (`#pairedReport(p) === undefined`, `:1853-1855`); it opens `pair-again-modal` (compact) which
  starts a scan and shows `printers.pair_again_looking` with a spinner; when a discovered Bluetooth
  entry with `printerId === p.id` arrives it opens the existing Pair dialog for it (`#openPair`,
  `:1798-1813`); when the scan window ends unfound it shows `printers.pair_again_missing` and
  `printers.pair_again_look`; in `#addPaired`, a succeeded pair for the printer being paired again
  switches it on (`updatePrinter(id, { active: true })`, only if inactive), closes both dialogs and
  shows `printers.pair_again_done` as a `wt-notice` — it never opens the name form or calibration;
  closing the Pair again window ends its scan
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
  In `printer-pair.unsaved.test.ts`: `it("a PIN typed for Pair again asks before it is lost")`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts src/screens/printer-pair.unsaved.test.ts -t "Pair again"`
  — FAIL.
- [ ] **Step 3: Implement.** The pair route's refusals (`printer.bluetooth_not_discovered`,
  `print-api.ts:881-883`) show in the Pair dialog as today.
- [ ] **Step 4: Run** the three files whole — pass.
- [ ] **Step 5: Commit** — `git commit -s -m "Pair again brings an unpaired Bluetooth printer back on the same record (A405 point 3)"`.

### Task 17: The server reprints to another suitable printer

**Files:**
- Modify: `packages/printing/src/outbox.ts` — `resendPrintJob(tx, jobId, { printerId }: { printerId?: string } = {})`;
  when `printerId` is given and differs from the job's: refuse `print_job.own_printer_only` unless
  the job has a `sale_id` or the chain's first job (`resend_of ?? id`) has a `kitchen_print_jobs`
  row; refuse `print_job.printer_unsuitable` unless the target is active, not deleted, and has the
  original printer's current `paper_width` and `resolution`; then insert for the target. The
  existing checks run first and keep their order (`:95-122`). Export
  `canReprintElsewhere(tx, job)` for the list
- Modify: `packages/printing/src/errors.ts` — declare both codes with their params
  (`{ id: string }`; `{ id: string; printerId: string }`)
- Modify: `apps/server/src/invoice-print.ts:24-57` — `resendInvoicePrintJob` passes an optional
  `printerId` through to both `resendPrintJob` calls
- Modify: `apps/server/src/print-api.ts` — the resend route (`:1503-1514`) reads an optional body
  `{ printerId?: string }` (`requireUuidParam` when present; an empty or missing body is today's
  request); the job list (`:1418-1501`) adds `reprintElsewhere: boolean` per row
- Modify: `apps/dashboard/src/api/client.ts` — `resendPrintJob(id, printerId?)` (`:4090-4092`) sends
  the body only with a target; `PrintJobRow.reprintElsewhere` (`:1441-1452`)
- Modify: `apps/dashboard/src/i18n/codes.ts` — the two codes' words
- Test: `packages/printing/src/outbox.test.ts`, `apps/server/src/print-api.printer-wiring.test.ts`
  (`describe("print job resend")`, `:835`), `apps/server/src/alert-sources.test.ts` (beside `:980`),
  `apps/server/src/kitchen-print.test.ts` or `print-api.unpair-kitchen.test.ts` (whichever seeds a
  table's printing problem)

- [ ] **Step 1: Write the failing tests** (each refusal asserts the domain code, not just a status).
  - `outbox.test.ts`: a receipt job (with `saleId`) to an active printer of the same width and
    resolution → a new job on the target, `resendOf` the original, `saleId` kept; a kitchen job
    (link row) likewise; a resend of a resend of a kitchen job (links only on the first) likewise;
    a test-page-shaped job (no sale, no link) to another printer → `print_job.own_printer_only`;
    the same job to its own printer id → accepted as today; a target of the same width and other
    resolution → `print_job.printer_unsuitable`; a disabled target and a deleted target → same
    code; a drawer job with a target → `print_job.not_resendable` (unchanged order); no target →
    today's behaviour, byte for byte.
  - `print-api.printer-wiring.test.ts`: the route with `{ printerId }` still requires `print.resend`
    (401 unauth, 403 for a session without it, asserting codes); a malformed `printerId` →
    `management.request_invalid`; the list marks a receipt job `reprintElsewhere: true` and a test
    page `false`; an invoice receipt reprinted elsewhere reserves its invoice delivery for the new
    job (as `invoice-print-api.test.ts` asserts for a same-printer resend).
  - `alert-sources.test.ts`: `it("stops counting a job once a resend of it has printed on another printer")`.
  - kitchen: `it("clears a table's printing problem once its failed ticket is reprinted and printed on another printer")`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/printing exec vitest run src/outbox.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/print-api.printer-wiring.test.ts src/alert-sources.test.ts -t "resend|reprint|another printer"`
  — the target cases FAIL (no parameter); the two trouble cases may pass at once — if so they pin
  `print-job-trouble.ts:56-60`'s printer-free resend clause, and a deletion control (add
  `and copy.printer_id = print_jobs.printer_id` in a throwaway edit) must make them fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files whole, `src/invoice-print-api.test.ts`, `src/till-api.receipt.test.ts`,
  `src/till-api.deliveries.test.ts` (the other callers, unchanged), `pnpm exec vitest run scripts/errors-reachable.test.ts`,
  and `tsc --noEmit` for `@waitron/printing`, `@waitron/server`, `@waitron/dashboard` — pass.
- [ ] **Step 5: Commit** — `git commit -s -m "A print queue reprint can go to another active printer with the same paper width and resolution, for receipts and kitchen tickets only (A405 point 4)"`.

### Task 18: The Reprint dialog

**Files:**
- Create: `apps/dashboard/src/widgets/print-job-reprint-dialog.ts` — modelled on
  `order-reprint-dialog.ts` (`wt-dialog`, a `wt-combobox name="printerId"` labelled
  `printers.reprint_printer`); given the job, the printers and the original printer
- Modify: `printers-screen.ts` — Reprint (`:3296-3302`) opens the dialog; `#resendJob`
  (`:3331-3339`) takes the chosen printer
- Create: `apps/dashboard/src/widgets/print-job-reprint-dialog.test.ts`
- Modify: `strings.ts` — the reprint keys

Offered printers: for a `reprintElsewhere` job, active printers with the original's paper width and
resolution, the original first and chosen when active, with `printers.reprint_same_setting` as the
hint; for any other job, the original alone with `printers.reprint_own_only`. An original that is
disabled: not offered, nothing chosen; with no other offer the combobox is replaced by
`printers.reprint_original_off` (own-only jobs) or `printers.reprint_none` (others), and Reprint is
quiet and disabled. A refusal shows at the bottom through `codeMessage`, Reprint usable again. A
success closes the dialog and shows `printers.reprint_sent` as the screen's `wt-notice`.

**No draft scope, deliberately:** the dialog's only input is a preselected printer, as in the
Orders screen's reprint dialog (`order-reprint-dialog.ts`, which has neither a scope nor an
`*.unsaved.test.ts`); asking "discard changes?" on cancelling a reprint would be wrong. The PR
description asks `/finish-branch`'s convention reviewer to judge this against the CLAUDE.md §3
staged-input rule.

- [ ] **Step 1: Write the failing tests** (dialog suite): the original preselected among same-setting
  printers, a different-resolution printer absent, A4 printers absent; an own-only job offers only
  its printer with the own-only line; a disabled original with no alternative explains and keeps
  Reprint disabled; Reprint sends `resendPrintJob(id, chosen)` once while pending; a refusal shows
  `codeMessage("print_job.printer_unsuitable")` at the bottom; in `printers-screen.test.ts`, the
  changed `:4908` and `:4937` cases.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/widgets/print-job-reprint-dialog.test.ts`
  and `src/screens/printers-screen.test.ts -t "resend|Reprint"` — FAIL.
- [ ] **Step 3: Implement.** The a11y suite gains the dialog in both themes
  (`printers-screen.a11y.test.ts`).
- [ ] **Step 4: Run** the files and `pnpm exec vitest run scripts/native-form-fields.test.ts` — pass.
- [ ] **Step 5: Commit** — `git commit -s -m "Reprint asks which printer, the original chosen, offering only printers the printout fits (A405 point 4)"`.

### Task 19: PR 4's guide

- [ ] **Step 1:** Add `{#print-queue}` and the Pair again sentence (both languages); the guide case
  expects `["add-printer", "calibrate", "printer-details", "print-queue"]`; a help link
  `"printers.print-queue"` in `help-guide.ts` only if a bubble uses it (none is planned).
- [ ] **Step 2: Run** the guide checks (Task 5 Step 4) — pass.
- [ ] **Step 3: Commit** — `git commit -s -m "Guide sections for Pair again and reprinting from the print queue (A405)"`.

### Task 20: Backlog, the held remainder, and a look

**Files:** `docs/backlog.md` (the A405 entry, about `:3885`), `docs/backlog/printers.md`

- [ ] **Step 1: Backlog.** Delete the A405 entry from `docs/backlog.md` and its section from
  `docs/backlog/printers.md`. Add, in the Printers area of both files:
  "**Reprint any printout on any printer, laid out again (left for after A760 — A1308 hold; from
  A405 point 4).** Every print job would keep the printer-independent document it was built from,
  with a version number, and Reprint would lay it out again for the chosen printer with the same
  builder (`formatReceipt`, `formatKitchenTicket`, `formatCorrectionSlip`, `formatPaymentSlip`,
  `formatCategorySalesPage`); a job whose version the running code cannot read falls back to its own
  printer or one of the same setting. Needs a column on `print_jobs`. Until then only receipts and
  linked kitchen tickets may go to another printer, and only one with the same paper width and
  resolution; payment slips, report pages, equipment labels, refund acknowledgements and unlinked
  kitchen slips stay on their own printer. Also open: whether kitchen tickets, payment slips and
  reports need an A4 page, or A4 printers stay out for them." And: "**A4 printers cannot be
  deleted, re-addressed or switched back on from their details (left open by A405).** No route does
  any of the three (`apps/server/src/page-printers-api.ts`)." Keep the station-link entry from
  Task 11.
- [ ] **Step 2: Look** as in Task 6 Step 2: the Pair again window in its looking, not-found and
  found states, the Reprint dialog with alternatives, own-only, and disabled-original states, both
  themes, desktop and phone, both languages; render the guide page.
- [ ] **Step 3: Commit** — `git commit -s -m "Backlog: A405 done, with reprinting any printout anywhere left for after A760"`.
  Then `/finish-branch` with PR 4's worktree, naming this plan (full path: two Codex run-it
  reviews). The PR description lists the changed assertions, the words, the held remainder, and
  the owner's answers to open questions 1 and 2 (or asks them again if unanswered).
