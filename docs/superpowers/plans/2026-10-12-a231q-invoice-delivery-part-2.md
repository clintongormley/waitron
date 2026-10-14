# A231q implementation plan: invoice delivery, part 2

_2026-10-14 update: A576 supersedes Group A's one-queue-per-host discovery assumption.
Distinct IPP queue paths on one server have separate rows; a raw port inherits queue metadata
only when one distinct queue is announced. See the
[A576 identity map](2026-10-14-a576-ipp-queue-identity.md). The original task descriptions below
record A231q's implementation at the time._

**Status:** plan, written 2026-10-12 on `feat/invoice-delivery-part-2` at `7a11e34b7`; revised the
same day after a fresh-context review. Built on `feat/invoice-delivery-part-2` (2026-10-12/13); see
the pull request.

**What this is.** The rest of A231d ("full invoices by email as a PDF, and on an office printer")
after part 1 (#1399, merge `eb6403150`). The approved plan is
[2026-10-03-invoice-pdf-email-and-office-printing.md](2026-10-03-invoice-pdf-email-and-office-printing.md);
read its header notes, §0, §2, §5, §6 and §7 before any task. Where this file and that one differ,
this file follows the code on this tree and says so in "Starting point". Its §3 (email setup and
settings) is DONE on this branch (commits `422c918e4`..`7a11e34b7`) and is not planned again.

**Order.** Task 0, then C1a and C1b (removing the consent step, the owner's default answer), then
group A (office printers), group B (delivery status, send again, download), and last C2-C4 (email
at the till and the dashboard). Do not build the historical consent screen (tick box, statement,
withdrawal wording) under any answer.

**Rules for every task.** Each task is one implementer dispatch. An implementer that passes about
150 tool calls with the task unfinished stops at a passing (or cleanly failing) point, commits, and
returns a handover: what is done, what is left, files touched, and each check's state.

- Test first: write the failing test, run it, keep the failure, then the smallest code that passes.
- Database suites use `useVenueDb`. A refused write asserts its domain error code. A new guard is
  proven by deletion (delete it, a named case fails) AND by a case showing the legitimate path is
  still served.
- The fiscal core is untouched: no change to `computeHuella`, the chain, number allocation,
  `registros_facturacion`, `recordSale`, `recordCorrection`, `recordSubstitution`,
  `packages/core/src/record-sale.ts` or anything in `packages/fiscal-verifactu`. If a task seems to
  need one, STOP and report. Run
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  UNEDITED in every task and read its test count.
- Public F1 issuance stays disabled. Exercise F1 delivery with synthetic F1 fixtures written through
  the existing core, as part 1's tests do (`apps/server/src/invoice-delivery.test.ts`,
  `unpaid-invoice-delivery.test.ts`).
- No PDF or raster bytes, document table, document hash or document-id key is stored. Bytes are
  made after the transaction that reads the invoice commits, with no transaction open, and dropped
  after transport.
- A4 stays out of `printers` and `print_jobs`. `@waitron/print-agent` imports no other package in
  this repo (the `import-x/no-restricted-paths` zone in `eslint.config.js`).
- Privacy (the old plan §0, its line 55): no customer email, tax id, name or address in any log
  line, error parameter or alert; no SMTP password, credential URL or raw transport or printer text
  in a log line, error parameter or response. Failure reasons are stored as codes from a fixed list.
  The NEW delivery-status responses this plan adds carry no recipient email address. Existing
  responses are unchanged.
- New error codes go in `apps/server/src/errors.ts` beside the `invoice_delivery.*` siblings
  (`:23-28`); run `pnpm exec vitest run scripts/alert-codes.test.ts scripts/errors-reachable.test.ts`.
- Waitron is not live: no data-migration or backwards-compatibility code. Migrations come from
  `pnpm --filter @waitron/db db:generate`, never hand-numbered; read the generated SQL and confirm
  it rebuilds no table (no `__new_` table) unless the task says so.
- Schema change guard list, every time:
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/id-columns-are-references.test.ts scripts/journal-monotonic.test.ts`,
  plus `pnpm --filter @waitron/db exec vitest run src/schema/schema-conformance.test.ts` and the
  fiscal pair above. A new `appendOnly()` table also runs
  `scripts/append-only-migration-sets.test.ts` and
  `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`.
- Forms follow [design-system.md](../../developers/design-system.md) → Forms: required fields marked,
  errors beside the field and once at the bottom above the buttons, field primitives with semantic
  `name`s, a save action quiet and disabled until the draft changes (`draftScopeFor` +
  `saveActionState` from `packages/ui/src/leave-controller.ts`, plus an early return in the save
  handler), other buttons quiet until they can act, and a `*.unsaved.test.ts` for staged input.
- A new till route adds a row to the maps atop `apps/server/src/till-api.profile-actions.test.ts`
  and `till-api.profile-zones.test.ts`, with a refusing case for each.
- No real paper. IPP tests use a fake IPP server in the suite. A local `ippeveprinter` run on this
  Mac is allowed and is described as local, never as CI. Physical HP checks are owner-pending.
- Each package keeps 98/98/98/95 coverage; never close a gap with an ignore comment or an exclude.
- A LOOK task opens the named screens in English and Spanish, light and dark, at 390 and 1280 px
  wide; runs axe for each new state; keeps and inspects the screenshots; and fixes small layout
  defects it finds (anything larger goes back to the driver). Before a browser run check
  `memory_pressure | grep free`.

## Starting point (verified 2026-10-12)

Read on this tree at `7a11e34b7`. Line numbers are from that commit.

**Office printers — what part 1 built.**

- `page_printers` exists: `packages/db/src/schema/page-printers.ts:9-33` stores location, name,
  host, port, resource path, chosen format (`application/pdf`, `image/pwg-raster`, `image/urf`),
  advertised formats, media, resolution and `active`, unique per (location, host, port, path). It is
  classified `state` (`packages/db/src/classification.ts:127`) and transferred with its location
  remapped, imported disabled (`packages/db/src/configuration-transfer.ts:67`,
  `apps/server/src/configuration-transfer.ts:729`). It records no agent.
- Nothing writes or lists it: `rg -n 'pagePrinters' apps/server/src -g '!*.test.ts'` finds only two
  imports and two reads, the staging check (`apps/server/src/invoice-choice-delivery.ts:47-59`) and
  the reservation check (`apps/server/src/invoice-delivery.ts:70-82`). There is no registration
  route.
- There is no location invoice-printer setting: `rg -n 'invoicePrinter|invoice_printer' packages apps -g '*.ts'`
  prints nothing.
- `invoice_deliveries` (`packages/db/src/schema/invoice-deliveries.ts:32-94`) has medium
  `email | a4 | receipt`, a nullable `page_printer_id` key, one active row per sale
  (`invoice_deliveries_active_uq`, `:77-79`, partial on `status in ('queued','sending')`), and
  CHECKs for staff (`:85-88`) and email (`:89-92`, recipient AND consent both present). No CHECK ties
  `a4` to a non-null `page_printer_id`; the writer does. `failure_code` (`:63`) and
  `reported_failure_code` (`:66`) are text columns whose code lists are TypeScript unions only, so
  adding codes needs no migration. Nothing has a foreign key into `invoice_deliveries`:
  `rg -n 'REFERENCES .invoice_deliveries' packages/db/drizzle/` exits 1, while the same search for
  `REFERENCES .sales.\(` finds matches in `0000_baseline.sql` and others (the control).
- `apps/server/src/invoice-delivery.ts`: `reserveInvoiceDelivery` `:40` (designation is derived from
  history: any completed original receipt job or `sent` original row makes the next one a duplicate,
  `:138-142`; `allowInactivePagePrinter` lets issuance reserve for a disabled printer, `:78`),
  `claimInvoiceDelivery` `:185` (sets `claimedAgentId` only for receipts, `:219`),
  `expireInvoiceDeliveryClaims` `:233` (turns EVERY medium's `sending` row older than 60 s by
  `claimedAt` into `unknown`), `reportInvoiceDelivery` `:285` (token, generation and holder checked;
  late and historical reports handled), `reportInvoiceEmailDelivery` `:367` (email retries). There is
  no claim renewal, no A4 claim selector and no explicit send-again or retry entry point for A4 or
  email.
- The renderers exist: `renderInvoicePdf` (`apps/server/src/invoice-pdf.ts:7`),
  `renderInvoiceRaster` (`invoice-raster.ts:13`, A4 only, 300 or 600 dpi) and
  `encodeInvoiceRaster` (`invoice-raster-encode.ts:6`, `"pwg" | "apple"`). The two raster functions
  have no production caller: `rg -n 'renderInvoiceRaster|encodeInvoiceRaster' apps/server/src -g '!*.test.ts'`
  finds only their definitions.
- The email worker handles email only (`apps/server/src/invoice-email-worker.ts:43-104`); boot
  expires every inherited `sending` claim, all media, before starting it (`apps/server/src/boot.ts:1502`).
- Receipt originals are correlated with delivery rows at the agent boundary:
  `apps/server/src/invoice-print.ts` `claimInvoicePrintJobs` `:57`, `reportInvoicePrintJob` `:97`,
  `endDeactivatedInvoicePrintDeliveries` `:145`, called from the pull route
  (`apps/server/src/print-api.ts:457-620`) and the result route (`:622-642`). Receipt claims use the
  SERVER's location, not the agent's (`print-api.ts:515`, `packages/printing/src/runtime.ts:99`), and
  any agent may print to a network receipt printer in that location.

**The print agent today.**

- mDNS asks only for `_pdl-datastream._tcp` (`apps/print-agent/src/linux-devices.ts:261`
  `buildPdlQuery`; `network.ts:7`). `parsePdlResponse` (`network.ts:103-158`) turns every SRV record
  in a reply into a `network_tcp` device whatever its service type, and reads only `usb_mfg`,
  `usb_mdl` and `ty` from the TXT record; it never reads `rp`. The live scan is in a v8-ignored block
  (`linux-devices.ts:275-311`) that merges announced and 9100-swept devices by `host:port`
  (`sweep.ts:105`).
- The agent scans only while the server holds a discovery window open
  (`packages/print-agent/src/agent.ts:454`; the window is opened by the dashboard's Add a printer,
  `print-api.ts:773-791`). So outside that window no discovery report arrives, and the server's map
  forgets an entry after 15 s (`print-api.ts:376-384`) and on restart.
- The office-printer check (`apps/print-agent/src/ipp-probe.ts:127-163`) sends a media-only
  Get-Printer-Attributes to port 631, path `/ipp/print` (`:18-19`, `:165-171`), and marks
  `pagePrinter: true`. The agent loop calls it once per pull over the merged list
  (`agent.ts:483-491`).
- The wider query and format selector (`apps/print-agent/src/ipp-capabilities.ts`:
  `readPrinterCapabilities` `:63`, `buildCapabilitiesQuery` `:140`, `queryPrinterCapabilities` `:160`)
  have no caller outside their test. The HP's raw reply is in
  `apps/print-agent/src/__fixtures__/hp-color-laserjet-m181fw-capabilities.ipp` (PDF and URF, A4 and
  letter, `W8`, `RS600`; no PWG raster).
- Discovered devices reach the server in each pull's `scanned` list (`packages/print-agent/src/client.ts:15-24`,
  `agent.ts:497`). The server screens them (`print-api.ts:278-300`), keeps them per agent in an
  in-memory map inside `mountPrintApi` (`:351-384`, keyed by agent id), and projects them to the
  dashboard (`GET /management-api/discovered-printers`, `:802-866`), merging the office mark per
  `host:port` across agents (`:833-853`). `POST /management-api/printers` (`:869-899`) takes host
  and port from the request body and never consults the map.
- A re-paired agent is a new agent: its join id becomes its agent id on approval
  (`print-api.ts:426-427`), so anything tied to the old id stays tied to the old agent.
- Jobs are pushed one after another inside the pull tick (`agent.ts:541`, `push` `:184-209`), so a
  slow A4 job run there would hold up receipts. `DiscoveredDevice` is in
  `packages/print-agent/src/host.ts:53-68`.

**The dashboard printers screen** (`apps/dashboard/src/screens/printers-screen.ts`, 4141 lines).
An office printer's discovery row shows only "Office printer — not supported for receipts"
(`:1300-1302`, `:3730-3736`; `apps/dashboard/src/i18n/strings.ts:1315` and `:4014`). A disabled
receipt registration found again offers Enable (`:1294-1306`). The Printers tab lists receipt
printers only (`:2885`). There is no page-printer list and no location setting.

**The till and the dashboard for an F1.**

- Till sale view (`apps/till/src/screens/till-ticket-view.ts`): an F1 shows the receipt original's
  print status, handover and Check (`:686-718`), then Print original, Retry original or Reprint
  (`:720-760`). Handlers: `apps/till/src/till-app.ts:9423-9425`. The F1 dialog
  (`apps/till/src/widgets/invoice-recipient-dialog.ts`, mounted at `till-app.ts:9634`) sends no
  delivery choice: `setOrderInvoiceChoice` (`apps/till/src/api/client.ts:2471-2484`) sends revision,
  invoice type and recipient only. The till learns nothing about page printers today (`GET /api/till`,
  `till-api.ts:1238`, returns none).
- Till routes: `GET /api/sales/:id/receipt` `apps/server/src/till-api.ts:2062`, handover `:2080`,
  retry `:2098`, print receipt or payment slip `:2124-2145`, reprint `:2147`; invoice choice `:1806`
  (forwards `delivery`; email availability comes from `deps.invoiceEmailAvailable`, `boot.ts:1470`).
- Dashboard order detail (`apps/dashboard/src/widgets/order-detail-dialog.ts:182`) offers Reprint
  only. `POST /management-api/orders/:id/reprint` (`apps/server/src/orders-api.ts:203-231`) checks the
  device's `print-receipt` action and `report.view` for orders outside the session's scope.
  `readOrderDetail` (`apps/server/src/orders-list.ts:624`) returns reprints (`:647`), no deliveries.
- `rg -n invoice apps/server/src/alert-sources.ts` prints nothing: no alert for an undelivered invoice.
- Devices point at receipt printers in three columns (`packages/db/src/schema/devices.ts:31`, `:36`,
  `:41`: receipt, payment slip, cash drawer) and profiles by role
  (`packages/db/src/schema/device-profile-printers.ts:7`: `receipt`, `payment_slip`, `cash_drawer`).

**What has moved since the old plan.**

- Line numbers drifted: the old plan's `till-api.ts:1960` is now `:2062`, and `till-app.ts:4021` is
  now `:9423`. The consent inventory's `receipt-print.ts:219` issuer fallback is now
  `invoice-choice-delivery.ts:122-124`.
- A366 slice 7 landed (#1501, #1507): receipt presentation and contact are per department.
  `resolveInvoiceEmailContact` (`apps/server/src/invoice-email-contact.ts:8`) has no production
  caller; the consent checker still reads the venue-wide `getReceipt` contact
  (`invoice-choice-delivery.ts:79`). C1b retires that dependency.
- The old plan §7.2 names a backlog "A3 entry, Printing A4 invoices on an office printer". No such
  heading exists now; the open work is the A231d entry (`docs/backlog.md:268`) and
  `docs/backlog/fiscal.md`. The "virtual PDF printer" item is at `docs/backlog/printers.md:289` and
  `docs/backlog.md:2800`; the prepare-venue SMTP item at `docs/backlog/box.md:403`.
- The old plan §5 asked for the HP's wider reply to be captured first. Done (fixture above).
- The demo printer (`boot.ts:1518-1524`) simulates receipts only. This plan adds no demo page
  printer.

**Open points for the owner, settled here by default.**

1. The old plan §4 has the till show "sent to …" with the address. This plan's new status
   responses carry no recipient address; C3b asks the owner before any screen shows one.
2. The old plan does not say which till device action or dashboard permission allows "Print on
   A4". This plan uses the till's `print-receipt` action (B2) and the dashboard reprint rule (B3b).
3. A4 has no automatic retry: a failure waits for an explicit retry, which stays original. The old
   plan specifies automatic retries for email only.
4. An office printer is printed to only by the agent that last reported it (A4, A9), unlike receipt
   network printers, which any agent in the location may print to.

## Task 0. Baseline (small, about 10 calls)

Run before any edit and record the counts in the ledger
(`docs/handoffs/2026-10-12-a231q-invoice-delivery-part-2.md`):
`pnpm --filter @waitron/server exec vitest run src/invoice-delivery.test.ts src/invoice-print-api.test.ts src/receipt-print.test.ts src/till-api.receipt.test.ts src/boot.invoice-delivery.test.ts src/print-api.test.ts`,
`pnpm --filter @waitron/print-agent-app exec vitest run src/ipp-probe.test.ts src/ipp-capabilities.test.ts src/network.test.ts`,
`pnpm --filter @waitron/print-agent exec vitest run src/agent.test.ts src/client.test.ts`, and the
fiscal pair. Done: every count recorded, none failing.

## Group C, first part — remove the consent step

The owner was told the default is "consent removal inside A231q, as its first piece of new work".
**The owner may override; if they choose the alternative, skip C1-C4 and move them to a later
item**, recording that in the backlog. Follow the inventory and failing cases in
[printers.md → Remove the consent step](../../backlog/printers.md#decisions-and-deliberate-limits),
re-running its searches on this tree first. The two tasks split where the tree still typechecks.

### C1a. Make consent optional everywhere (medium-large, about 80 calls)

**Goal.** An email delivery and a staged email choice are valid without consent; nothing yet
deletes the field.

**Change.** `packages/db/src/schema/invoice-deliveries.ts:89-92`: the email CHECK becomes
"email if and only if a recipient"; `consent` stays as an optional column. `packages/db/src/schema/orders.ts:40-43`:
`consent` optional in `StagedInvoiceDelivery`. `apps/server/src/invoice-delivery.ts:18-24`
(`EmailDeliveryRequest.consent` optional), `:157-161` (write consent only when given), `:392`
(copy only when present); `invoice-choice-delivery.ts:64-103` (accept an ABSENT consent; an explicit
`null` is still refused with `delivery.consent`, as `bill-payments.test.ts:2076` checks: default only
when absent, CLAUDE.md §3; a present one is still checked as today) and `:122-124` (the fallback reads `consent?.personId`).

**Migration.** Changing a CHECK rebuilds `invoice_deliveries`. **Receipt, the reviewer's run, not
this plan's (2026-10-12, throwaway worktree):** `db:generate` for this change emitted a rebuild of
`invoice_deliveries`; all 145 migrations applied with foreign keys on; existing rows survived;
`invoice_deliveries_active_uq` still refused a second active row; a consent-less email row was
accepted after the migration and refused without it. Re-run and compare. Before generating, confirm
again that nothing has a key into the table (the search in "Starting point"); after generating, read
the SQL: the partial `invoice_deliveries_active_uq` must come back with its `where` clause and its
column, not a quoted expression (CLAUDE.md §3's drizzle-kit 0.31.11 trap).

**Failing tests first:** an email reservation with a recipient and no consent inserts
(`invoice-delivery.test.ts`); staging an email choice with no consent field succeeds when email is
available (`bill-payments-api.test.ts` or the invoice-choice suite), while `consent: null` is still
refused `delivery.consent`; after the migration a second
active delivery for one sale is still refused (assert with
`refusalOn(…, UNIQUE_VIOLATION, {table: "invoice_deliveries", columns: ["sale_id"]})`, not
`indexViolated`, which matches only an index over an expression,
`packages/db/src/constraint-target.ts:160-170`; corrected 2026-10-12 after C1a); malformed
recipient, unavailable provider, wrong action or zone and stale revision still refuse. Keep every
existing consent case passing in this task. **Run:** the touched server suites, the schema guard
list. **Done:** cases and guards pass; the tree typechecks (`pnpm --filter @waitron/server typecheck`).

### C1b. Delete consent and the venue-wide contact dependency (medium-large, about 80 calls)

**Goal.** Consent no longer exists in types, rows, checks or responses; the email contact comes
from slice 7's selector.

**Change.** Drop the `consent` column and `InvoiceEmailConsent` (`invoice-deliveries.ts:20-27`,
`packages/db/src/index.ts:306`); drop it from `StagedInvoiceDelivery`; the checker
(`invoice-choice-delivery.ts:31-104`) stops reading consent and `getReceipt` (`:79`) and uses
`resolveInvoiceEmailContact` (`invoice-email-contact.ts:8`) where a contact is still needed; the
staged email records the authenticated staff member from the server context, replacing the
`consent.personId` fallback (`:122-124`); the bill read (`apps/server/src/parties.ts`) returns no
consent. **Receipt, the reviewer's run:** `db:generate` for this change emitted only
`ALTER TABLE invoice_deliveries DROP COLUMN consent`, no rebuild; re-run and compare. Retire consent
assertions in the test files the inventory lists, including the `consent: null` case at
`bill-payments.test.ts:2076`; keep every delivery and fiscal assertion. The historical-doc pointers
the inventory asks for are written in the Final gate's stale-prose step, not here.

**Failing tests first:** the inventory's "future failing cases"; a staged email with no staff in
the request is attributed to the authenticated staff member; editing the venue or department
contact rewrites nothing on an earlier delivery. **Run:** the inventory's test files, the schema
guard list. **Done:** `rg -n 'consent' apps/server/src packages/db/src -g '!*.test.ts'` finds only
unrelated card/login consent, cases and guards pass.

## Group A — office printers

### A1. Find printers that announce IPP (medium, about 50 calls)

**Goal.** The mDNS question also asks for `_ipp._tcp`; an IPP announcement yields its port and
resource path; a printer seen both by IPP and on 9100 is one device.

**Change.** `apps/print-agent/src/linux-devices.ts:261` (two questions in one packet),
`network.ts:103-158` (read the SRV owner's service type; read `rp` from an IPP TXT record),
`mergeDiscovered` at `sweep.ts:105` (merge by host, across packets and the sweep),
`packages/print-agent/src/host.ts:53-68` (add an optional `ipp?: { port: number; resourcePath: string }`
and `ippOnly?: true` to `DiscoveredDevice`; the package stays import-free).

**Failing tests first** (`apps/print-agent/src/network.test.ts`, `sweep.test.ts`, synthesised
packets as today):

- An `_ipp._tcp` answer with `rp=ipp/printer` on port 8631 gives `ipp: { port: 8631, resourcePath: "/ipp/printer" }`.
- An `_ipp._tcp` answer with no `rp` gives no device. (The IPP spec allows an empty `rp`; this
  follows the old plan's rule and is a choice, not a protocol fact.)
- A `_pdl-datastream._tcp` answer is unchanged, byte for byte against today's expectations.
- Two separate packets, one `_ipp._tcp` and one `_pdl-datastream._tcp` for the same host, plus a
  9100 sweep hit on it, give one device with port 9100 and the `ipp` endpoint, not `ippOnly`.
- An IPP-only host gives one `network_tcp` device with `ippOnly: true`, whose `port` is its IPP port.
- `buildPdlQuery` asks two questions; the existing 9100 sweep is untouched.

**Run.** `pnpm --filter @waitron/print-agent-app exec vitest run src/network.test.ts src/sweep.test.ts src/linux-devices.test.ts`,
`pnpm --filter @waitron/print-agent exec vitest run`, `pnpm lint` (the import zone). **Done:** the
cases pass; no IPP request is sent by this task.

### A2. Ask each office printer what it can print (medium, about 60 calls)

**Goal.** Replace the media-only check with the wider Get-Printer-Attributes and report each
device's office-printer result, so the server knows the chosen format or why there is none.

**Change.** `apps/print-agent/src/ipp-probe.ts:127-171` (the marker becomes a classifier calling
`queryPrinterCapabilities`, `ipp-capabilities.ts:160`, at the announced endpoint, or at 631
`/ipp/print` for a 9100-only device), `apps/print-agent/src/host.ts:89-92`,
`packages/print-agent/src/host.ts` (add `office?: OfficePrinterReport`, the endpoint plus either
`{ printable: true, documentFormat, media, resolutionDpi, supportedFormats }` or
`{ printable: false, reason }`, mirroring `PrinterCapabilities` at `ipp-capabilities.ts:8-24`;
`pagePrinter` keeps its meaning, "lists A4 or letter"), `packages/print-agent/src/agent.ts:483-491`.

**Rules.**

- An `ippOnly` device is never a receipt candidate, whatever its answer. A failed or unanswered
  query reports it `office: { printable: false, reason: "invalid_reply" }`.
- A merged IPP+9100 device follows the capability answer: listing A4 or letter makes it an office
  printer. A failed query leaves it unmarked, which keeps today's receipt behaviour.
- A 9100-only device keeps today's rule: a failed query leaves it unmarked.

**Failing tests first** (`ipp-probe.test.ts`, `host.test.ts`, `packages/print-agent/src/agent.test.ts`):
one case per rule; the HP fixture marks the device `pagePrinter` with `office.printable` and
`application/pdf`; the only request sent is Get-Printer-Attributes (assert the operation id in every
captured request), one per endpoint per pull, with today's 30 s answer cache and 8-at-a-time bound;
the request uses the announced port and path. Delete the `ippOnly` rule and its case fails.

**Run.** `pnpm --filter @waitron/print-agent-app exec vitest run src/ipp-probe.test.ts src/ipp-capabilities.test.ts src/host.test.ts`,
`pnpm --filter @waitron/print-agent exec vitest run src/agent.test.ts`. **Done:** cases pass; the
existing receipt-printer cases pass unedited.

### A3. The server carries the office-printer report, and refuses it as a receipt printer (medium, about 50 calls)

**Goal.** The pull accepts `ipp`, `ippOnly` and `office`, screens them, keeps them per agent in the
discovery map, and the discovered-printers list returns them. The receipt-printer create route
refuses an endpoint the map marks as an office printer.

**Change.** `apps/server/src/print-api.ts:230-300` (`DiscoveredDeviceWire`, `screenScanned`:
enum-check format and media, dpi 300 or 600, port 1-65535, path starting with `/` and at most 255
characters, at most 32 advertised formats of at most 100 characters each; anything else drops the
field, not the device), `:802-866` (return `office` and `ippOnly`; an office printer is office for
every agent's entry, as `pagePrinter` is now), `:869-899` (`POST /management-api/printers` refuses a
host and port that any fresh map entry marks `pagePrinter`, `ippOnly` or `office`, with a new code
`printer.office_printer`), `apps/dashboard/src/api/client.ts:1208-1220`.

That refusal is weaker than its name: the map holds only what agents reported in the last 15 s of
a discovery window, so a typed-in address of an office printer not seen recently is still accepted.
Say so in the code's error registry entry and in the PR.

**Failing tests first** (`apps/server/src/print-api.test.ts`): a pulled `office` report reaches the
list; a malformed one is dropped while the device stays; two agents, one with a failed query, give
one office entry; creating a receipt printer at a marked endpoint answers `printer.office_printer`
and an unmarked endpoint is still created (the legitimate path). **Run.**
`pnpm --filter @waitron/server exec vitest run src/print-api.test.ts`, `scripts/errors-reachable.test.ts`.
**Done:** cases pass.

### A4. Store the location's invoice printer and the agent that reaches it (small, about 45 calls)

**Goal.** One page printer per location can be its invoice printer (A4); each page printer records
the agent whose discovery report registered or re-enabled it.

**Change.** `packages/db/src/schema/page-printers.ts`, in two generations:

1. `invoiceDefault: flag("invoice_default").notNull().default(false)` and a partial unique index on
   `location_id` where `invoice_default = 1`. **Receipt, the reviewer's run, not this plan's:** on
   2026-10-12 the reviewer ran `db:generate` in a throwaway worktree and got only
   `ALTER TABLE page_printers ADD invoice_default integer DEFAULT false NOT NULL` plus the partial
   unique index, no rebuild; in `node:sqlite` (Node v26.7.0, foreign keys on, a restricting
   `invoice_deliveries` row present) a second default in one location was refused
   `UNIQUE constraint failed: page_printers.location_id` and the child row survived. Re-run and
   compare the SQL.
2. `agentId: id("agent_id").references(() => printAgents.id)`, nullable. This is the smallest
   durable per-agent record: the in-memory map is filled only during discovery windows and lost on
   restart (Starting point), so it cannot decide claims. **Receipt, the reviewer's run:**
   `db:generate` emitted only `ALTER TABLE page_printers ADD agent_id text REFERENCES print_agents(id)`,
   and the chain of 147 migrations applied. Re-run and compare; a rebuild of `page_printers` would
   hit `invoice_deliveries`' restrict key, so stop if one appears.

Configuration transfer imports page printers disabled, so it also clears `invoice_default` and
`agent_id` there (`apps/server/src/configuration-transfer.ts:729`).

**Failing tests first** (`packages/db/src/schema/page-printers.test.ts`,
`apps/server/src/configuration-transfer.test.ts`): a second default in one location is refused,
asserted with `refusalOn(…, UNIQUE_VIOLATION, {table: "page_printers", columns: ["location_id"]})`
(`packages/db/src/constraint-target.ts`; not `indexViolated`, which matches only an index over an
expression, `:160-170`, and answers false for this plain-column partial index); two
locations may each have one; an `agent_id` naming no agent is refused; a transferred printer
arrives with both cleared. **Run:** the schema guard list. **Done:** guards and the fiscal pair
pass; the PR states why these columns are in the core set (they configure delivery of core
invoices).

### A5. Page-printer writers and the A4 failure codes (medium, about 65 calls)

**Goal.** Database functions for every page-printer change, in a new
`apps/server/src/page-printers.ts`: list for a location; register from a discovery report;
re-enable; rename; disable; set or clear the location's invoice printer. This task also defines the
A4 failure codes, once, and stops issuance from queueing an A4 delivery nobody will send.

**Failure codes.** Widen the unions at `invoice-deliveries.ts:63` and `:66` and
`InvoiceDeliveryOutcome` (`invoice-delivery.ts:177`) with one list: `printer_disabled` (destination
disabled: `queued` → `failed`, and `sending` → `unknown`), `switched` (a queued A4 replaced by paper
before any agent took it, B2), `printer_refused` (refused before printing → `failed`),
`printer_unreachable` (no connection → `failed`), `printer_aborted` (aborted or canceled after
acceptance → `unknown`), `timeout` (no answer → `unknown`, existing).

**Rules.**

- Register and re-enable take the endpoint, capability report and agent id from a CURRENT
  discovery entry the server holds (A6 passes it), never from the request body. "Current" (and
  "fresh" below) means the discovered list's existing rule, `isListed` (`print-api.ts:383-384`:
  reported within 45 s while a discovery window is open, otherwise 15 s), the rule `reportedFresh`
  already applies to Bluetooth pairing (`:387-391`, used at `:747`). A report that is not
  printable is refused (`page_printer.not_printable`). Re-enable refreshes format, formats, media,
  resolution and agent, and keeps the id. Registering from a fresh entry at an address that already
  has an ACTIVE page printer does the same: it re-points `agent_id` and refreshes capabilities,
  keeping the id. That is how a re-paired agent (a new agent id, Starting point) takes the printer
  back. A stale or absent discovery entry refuses (`page_printer.not_found`).
- Disable, in one transaction, clears `invoice_default`, turns this printer's `queued` A4 deliveries
  `failed` with `printer_disabled`, and its `sending` ones `unknown` with `printer_disabled`. Enable
  does not resend them.
- Setting the invoice printer clears the location's current default FIRST, then sets the new one,
  in one transaction (the unique index refuses two defaults at once). It refuses a disabled printer
  or one in another location (`page_printer.not_found`).
- `reserveInvoiceDelivery` (`invoice-delivery.ts:70-82`): when issuance reserves an A4 delivery for
  a printer that is disabled (`allowInactivePagePrinter`), the row is inserted `failed` with
  `printer_disabled` instead of `queued`. Issuance is not refused, and the retry stays original.

**Failing tests first** (`apps/server/src/page-printers.test.ts` and `invoice-delivery.test.ts`,
real database, synthetic F1s): one case per rule; an active printer registered again from a fresh
entry by a new agent keeps its id and now records the new agent; the same with a stale or absent
entry refuses and changes nothing; a `sending` delivery ended by disable still has
its late success accepted by `reportInvoiceDelivery` (late-report rule); re-enable keeps the id and
does not requeue; replacing the default in one call succeeds (the legitimate path beside the
index's refusal); an issued F1 whose A4 printer was disabled after staging is filed and its
delivery is `failed`/`printer_disabled`. **Run:** both files,
`src/unpaid-invoice-delivery.test.ts`, `src/bill-payments.test.ts`, the fiscal pair,
`scripts/errors-reachable.test.ts`.

**Changed part-1 checks.** The `disabled-a4` cases in `unpaid-invoice-delivery.test.ts:138-155` and
`bill-payments.test.ts:2320-2382` assert `status: "queued"` for an A4 whose printer was disabled after
staging. Change them to `failed`/`printer_disabled` and list each in the PR's "Changed test checks",
citing the old plan's rule (its 2026-10-07 paid-issuance checkpoint: "Task 5 must report a queued A4
delivery whose destination is disabled without sending it"). Keep their issuance, rollback and replay
assertions. **Done:** cases pass with each guard proven by deletion.

### A6. Page-printer management routes (medium, about 55 calls)

**Goal.** HTTP routes over A5, each needing `printer.manage`: `GET /management-api/page-printers`
(each row carries its recorded agent's id and name, or null),
`POST /management-api/page-printers` (body names the discovered entry: agent id, host, port, path;
it registers, or re-enables a disabled row at that endpoint), `PATCH /management-api/page-printers/:id`
(name; `active: false` disables), `PUT /management-api/page-printers/invoice-printer`
(`{ pagePrinterId: string | null }`). Re-enabling needs a fresh discovery entry, so capabilities and
agent come from current discovery; `PATCH` with `active: true` is refused (`page_printer.rediscover`).
"Fresh" here is `isListed` (`print-api.ts:383-384`), as in A5; the lookup function applies it.

**Change.** A new `apps/server/src/page-printers-api.ts`, mounted from `mountPrintApi` so it can
read the in-memory discovery map (`print-api.ts:371`) through a small lookup function it is given.

**Failing tests first** (`apps/server/src/page-printers-api.test.ts`): a role without
`printer.manage` is refused and a manager is allowed, for every route; register or re-enable with
no matching fresh discovery entry is refused (`page_printer.not_found`); a POST from a new agent's
fresh entry at an active printer's address re-points it (A5), and an entry just past `isListed`'s
bound is refused; the GET returns the recorded agent; body-supplied capabilities
are ignored; a page printer's id is refused with a domain code by `PATCH /management-api/printers/:id`,
by `POST /management-api/stations/:sid/printers/:pid`, and by each device printer choice, receipt,
payment slip AND cash drawer, on the device (`devices.ts:31-41`) and on its profile
(`device-profile-printers.ts:7`); `GET /management-api/printers` never lists a page printer;
responses carry no raw printer text beyond the advertised format names. **Run:** the new file,
`src/print-api.test.ts`, `src/device-api.test.ts`. **Done:** cases pass.

### A7. Dashboard: add an office printer from discovery (medium-large, about 70 calls)

**Goal.** A discovery row whose `office.printable` is true shows "Add as invoice printer"; one that
is not shows the reason, greyed; a receipt printer's row is unchanged; a disabled page printer
found again offers Enable and re-enables the same row. A row at the address of an ACTIVE page
printer, reported by an agent other than the one A6's GET records for it, shows "Use this agent",
which calls A6's POST with that row's entry (the re-point, A5). Today an office row is greyed
(`#unsupportedPagePrinter`, `printers-screen.ts:1300-1302`), and a row is hidden or offered no Add
once `alreadyRegistered` or the screen's own `#registeredDevices` marks it taken (`:1159-1162`,
`:1304-1308`); office rows must not use those marks, and are matched against A6's list by address
and recorded agent instead. A row from the recorded agent itself stays shown as already added.

**Change.** `apps/dashboard/src/screens/printers-screen.ts:1294-1306`, the discovery table
`:3704-3790`, the add dialog `:3678`; the hint string `strings.ts:1315`/`:4014` is replaced (its claim
"not supported" goes stale); the dashboard client gains the A6 calls. Put the new dialog in its own
component under `apps/dashboard/src/widgets/` rather than growing the screen.

**Failing tests first** (`printers-screen.test.ts`, a new `page-printer-add.unsaved.test.ts`,
`printers-screen.a11y.test.ts`): the row states, including an IPP-only device whose query failed,
which shows the reason greyed and no receipt Add; the name field is a field primitive named `name`,
required, explained beside the field and once above the buttons; Add stays quiet and disabled until
a name is entered; a refused request keeps the dialog and the name; an office printer row never
shows the receipt Add; a row from a different agent at an active page printer's address shows "Use
this agent", and pressing it sends A6's POST with that agent's entry and refreshes the row to
"already added", while the recorded agent's own row shows no such action; a refused re-point
(stale entry) shows the refusal and keeps the row. **Run:** the three files, then `pnpm exec vitest run scripts/native-form-fields.test.ts`.
**Done:** cases and axe pass.

### A7L. LOOK: discovery rows and the add dialog (small, about 30 calls)

Including the "Use this agent" row.

Each A7 row state and the add dialog, under the LOOK rule.

### A8. Dashboard: the invoice printers list and the location's choice (medium-large, about 70 calls)

**Goal.** The Printers tab lists page printers marked "Invoice printer (A4)" with rename and
disable; a disabled one says to find it again to enable it; a control sets or clears the location's
invoice printer. This task draws no Print test page button (A13 does).

**Change.** A new `apps/dashboard/src/widgets/page-printers-panel.ts`, mounted in
`printers-screen.ts:2885` (`#renderPrintersSection`). A row menu column is keyed `actions` and
`pinned: "end"` (`scripts/pinned-actions-column.test.ts`). The invoice-printer choice uses a field
primitive (no native `<select>`), a draft scope and a quiet Save.

**Failing tests first** (`page-printers-panel.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts` for
rename and the choice): list and marker; rename; disable clears the choice and the panel says so;
a role without `printer.manage` sees no actions (and the server refuses, A6); a refused save keeps
the draft; a successful save then a failed refresh shows a load failure, not a failed save. **Run:**
the files and `scripts/pinned-actions-column.test.ts`. **Done:** cases and axe pass.

### A8L. LOOK: the invoice printers panel (small, about 30 calls)

The A8 list, rename, disabled row and the choice, under the LOOK rule.

### A9. Claim, renew and report an A4 delivery (medium, about 60 calls)

**Goal.** Database functions in a new `apps/server/src/invoice-page-print.ts`: claim the next due
A4 delivery for an agent; renew a claim; report an outcome.

**Rules.** The claim takes the oldest due `queued` A4 delivery whose page printer is in the
server's location AND records this agent (`page_printers.agent_id`, A4). A printer with no agent is
claimed by nobody (B4 alerts on it). A due delivery whose printer is disabled is turned `failed`
with `printer_disabled` in the same transaction and never handed out. `claimInvoiceDelivery`
(`invoice-delivery.ts:185`) also sets `claimedAgentId` for A4. Renewal moves `claimedAt` forward only
for the current token, generation and holder while the row is `sending`; otherwise it answers
"lost". Renew and report check ONLY the delivery's claim (token, generation, holder), never
`page_printers.agent_id`: a re-point (A5) decides who claims next, not whether a claim already
handed out may finish. Outcomes use A5's codes. No automatic retry.

**Failing tests first** (`apps/server/src/invoice-page-print.test.ts`, real database, synthetic
F1s, controlled clock): another location's delivery is not claimed; another agent's printer is not
claimed, and its own agent claims it (the legitimate path); a disabled destination ends `failed`
with no claim; a second claim before the lease ends gets nothing; renewal keeps a claim alive past
60 s and `expireInvoiceDeliveryClaims` leaves it alone; without renewal it becomes `unknown`; a
lost-claim renewal is refused; duplicate reports are idempotent; the same agent's old token after a
reclaim is history only; a late success before any retry turns `unknown` into `sent`; a late failure
keeps `unknown`; an old success after a retry has been queued, claimed, failed and completed changes
nothing current; a completed original makes the next A4, email or receipt a duplicate; after a
re-point to a new agent, the old agent's renew and report on its existing claim still succeed, and
the next claim goes to the new agent. **Run:** the
file, `src/invoice-delivery.test.ts`, the fiscal pair. **Done:** cases pass; each guard proven by
deletion.

### A10. Agent routes for A4 and the bytes (medium, about 60 calls)

**Goal.** Agent-authenticated routes in a new `apps/server/src/page-print-api.ts`, mounted from
`mountPrintApi`: `POST /print-api/agent/page-jobs/claim` (204 or one job with its claim and the
printer's endpoint, format, media and resolution), `POST /print-api/agent/page-jobs/:id/document`
(claim in the body, never in the URL; returns the bytes), `POST …/:id/renew`, `POST …/:id/result`.

**Rules.** The claim commits before any rendering. The claim fixes the format and resolution: the
claim route records them, from the printer row as read in the claim's transaction, keyed by
delivery id, generation and token hash, in memory in this module. Memory is enough because no claim
outlives the process (boot expires every inherited `sending` claim, `boot.ts:1502`); a document
request with no record answers `invoice_delivery.claim_lost`. The document route never re-reads the
format or resolution from `page_printers`. It checks that the claim is current and `sending` AND
reads `readInvoiceDocument` (`apps/server/src/invoice-document.ts:32`) in ONE `withTransaction`;
after it commits, with no transaction open, it renders in the CLAIMED format: `application/pdf` →
`renderInvoicePdf`; `image/pwg-raster` → `renderInvoiceRaster` + `encodeInvoiceRaster(…, "pwg")`;
`image/urf` → the same with `"apple"`, at the claimed resolution, with `duplicate` from the row's
designation. Renew, document and result check only the claim (token, generation, holder), never
`page_printers.agent_id` (A9). A stale or historical claim gets
`invoice_delivery.claim_lost` and no bytes. Reports go to A9. Nothing is cached.

**Failing tests first** (`apps/server/src/page-print-api.test.ts`): the route-level cases of A9;
a stale claim gets no bytes; claim, then re-point the printer from a new agent's entry with a
different format, then fetch with the first claim: the bytes are in the claimed format; the old
agent's renew and result on that claim still succeed after the re-point; each format's bytes are what the renderer gives for that document
(compare with a direct render, and check the PDF carries «duplicado» for a duplicate); another sale
commits while a render is held (a held renderer stub, as part 1's email worker tests do); a
read-only mirror or fenced node mounts no agent routes (`mountPrintApi` is inside
`if (!fencedOrMirror)`, `boot.ts:1501-1570`); an unauthenticated agent is refused. **Run:** the file
and `src/print-api.test.ts`. **Done:** cases pass.

### A11. The agent prints over IPP (medium, about 70 calls)

**Goal.** A new `apps/print-agent/src/ipp-print.ts`: send one Print-Job with the stored
`document-format`, then poll Get-Job-Attributes until `completed`, `aborted` or `canceled`, or the
bound passes; answer one outcome code from A5's list.

**Rules.** Submission is bounded to 30 s and polling to 120 s. A refused Print-Job (an IPP error
status, HTTP not 200) is `failed`/`printer_refused`; connection refused is
`failed`/`printer_unreachable`. No answer to Print-Job is `unknown`/`timeout`; an abort or cancel
after acceptance is `unknown`/`printer_aborted`; the poll bound passing is `unknown`/`timeout`. An
abort signal stops polling. It never sends the same job twice. It reads `job-state-reasons` only to
choose a code; printer text never leaves the function. Job name is a fixed "Waitron invoice", never
an invoice or customer detail.

_Note, 2026-10-13 (finish-branch review):_ the Print-Job also asks for one copy and the paper size
the server chose, so a printer's own defaults do not decide either; `Host.printPage` takes that
paper size after `format` (commit `5c2cefbc9`).

**Failing tests first** (`ipp-print.test.ts`, a fake IPP server started in the test on a free port,
never 9100, never a real printer): one case per outcome above; abort signal stops polling; exactly
one Print-Job request in every case. Check where the fake server lives against the package's
coverage `include` before putting it under `src/testing/`. **Run:**
`pnpm --filter @waitron/print-agent-app exec vitest run src/ipp-print.test.ts`. **Done:** cases pass.

### A12. The agent's page-job runner (medium, about 70 calls)

**Goal.** The agent claims, fetches, prints, renews and reports A4 jobs outside its pull loop, so
receipts never wait behind an office printer.

**Change.** `packages/print-agent/src/client.ts` (four calls for A10's routes, with a byte-fetch
bound larger than `DEFAULT_TIMEOUT_MS`), `host.ts` (`Host.printPage?(target, bytes, format, signal)`),
`agent.ts` (a runner started beside the pull loop, one job at a time, woken after each pull);
`apps/print-agent/src/host.ts` wires `printPage` to A11.

**Rules.** Claim only when idle. Renew every 20 s while printing. A lost renewal aborts polling but
still reports. Always report once, with the claim, whatever happened; a dropped report is retried
on the next tick with the same claim. Never resubmit after an uncertain answer.

**Failing tests first** (`packages/print-agent/src/agent.test.ts` with the fake host): a receipt job
pulled during a long A4 job prints at once; renewal runs on time; a lost renewal stops polling and
reports; a failed fetch reports `failed`; a report that fails to send is retried with the same
claim; a host without `printPage` claims nothing. **Run:**
`pnpm --filter @waitron/print-agent exec vitest run`, `pnpm --filter @waitron/print-agent-app exec vitest run src/host.test.ts`,
`pnpm lint`. **Done:** cases pass; the package still imports nothing from the repo.

### A13. Print test page on an office printer (small-medium, about 45 calls)

**Goal.** A Print test page action on each active row of A8's panel prints the sample sale
(`apps/server/src/sample-receipt.ts:12`) as an A4 page in the printer's format.

**Rules.** The renderer gains no sample marker: the sample sale already carries the number
`MUESTRA/1` and a sample QR (`sample-receipt.ts:6`, `:17`, `:29`), which the page prints. No database
row: the request is held in memory (as the receipt probes are, `print-api.ts:372`), handed out
through A10's claim route in the SAME job shape with its own id and token, and the document, renew
and result routes recognise that id. The agent needs no change. Its outcome is kept in memory for
the panel. `printer.manage` is required.

**Failing tests first** (server and dashboard): the route needs `printer.manage`; a claimed test
page returns sample bytes and writes no `invoice_deliveries` row; only the printer's own agent can
claim it; its outcome reaches the panel; the button is quiet while a request is out. **Done:** cases
pass; LOOK at the panel's sent and failed states under the LOOK rule.

### A14. End to end with the fake IPP server (medium, about 50 calls)

**Goal.** Prove the whole A4 path with real routes, the real agent loop and the fake IPP server.

**Failing tests first** (extend `apps/server/src/print-agent-e2e.test.ts` or a sibling): a
synthetic F1 A4 delivery is printed and ends `sent`; a disabled destination ends `failed` and the
fake server sees nothing; a stopped agent leaves the claim to lapse into `unknown`, then an explicit
retry prints as original; an old success after that retry changes nothing current. **Done:** cases
pass.

### A15. Local check against `ippeveprinter` (small-medium, about 40 calls)

**Not CI.** Start `ippeveprinter -f image/pwg-raster,image/urf -k` (and once with
`application/pdf`), register it through the product, print one invoice in each format through the
production agent transport, and check that it accepted and kept each file. Re-run part 1's
independent raster readers over the files it kept. Write the results in the ledger and the PR,
saying this ran on a Mac, not in CI, and that it checks acceptance under each format, not how pages
look.

## Group B — delivery status, send again and download

### B0. The till learns the location's invoice printer (small, about 40 calls)

**Goal.** `GET /api/invoice-delivery-options` answers `{ invoicePrinter: { id, name } | null }`
(C2 later adds email availability). Staging an A4 choice must name that location's CURRENT invoice
printer.

**Change.** A new route beside `till-api.ts:1806`; `invoice-choice-delivery.ts:47-59` also requires
`invoice_default = true`.

**Failing tests first:** null with no default or a disabled one; staging A4 with another active
page printer in the location answers `invoice_delivery.printer_invalid` and with the default
succeeds; a missing session is refused; a zone-limited profile is still served. A staged A4 choice also stores the signed-in staff member (`personId` from the session, never the body), as C1b did for email, and issuance falls back to it for a sale with no operator: that turns `receipt-print.test.ts`'s "reports unattributed automatic A4 issuance without inventing an operator" case into an attributed one — list it under Changed test checks (C1b's review, 2026-10-12). The route is not a
table row: add it to the "Not zone-gated" prose list of routes that name no zone
(`till-api.profile-zones.test.ts:172-184`) and to the "Not action-gated" note
(`till-api.profile-actions.test.ts:104`). Part 1's A4 fixtures stage choices with a page printer that is not the default
(for example `bill-payments.test.ts:2197` and `:2336`, `unpaid-invoice-delivery.test.ts:48`; find the
rest with `rg -n 'insert\(pagePrinters\)' apps/server/src`); give those that stage an A4 choice
`invoiceDefault: true` as setup, with their assertions unchanged. **Done:** cases pass.

### B1. One delivery status for an F1 (small-medium, about 45 calls)

**Goal.** `readInvoiceDeliveries(tx, saleId)` in `apps/server/src/invoice-delivery-status.ts`:
the current attempt (medium, original or duplicate, status, failure code, when), whether an original
has completed, the actions open now (retry original; print on A4 with the location's invoice
printer's id and name; print on the receipt printer instead of a queued, unclaimed A4; or nothing),
and the history. It reads the receipt jobs through the existing `readOriginalReceiptPrint`
(`apps/server/src/receipt-print.ts:373`) so older receipt originals without delivery rows still
count. No recipient address.

**Failing tests first** (real database, synthetic F1s): each status on each medium; `failed` and
`unknown` both offer retry original; a completed original offers duplicates only; no invoice
printer, or a disabled one, offers no A4; a queued unclaimed A4 offers the receipt switch and a
`sending` one does not; an F2 offers nothing new. **Done:** cases pass.

### B2. Till routes: read, print on A4, and paper instead (medium, about 70 calls)

**Goal.** `GET /api/sales/:id/deliveries`; `POST /api/sales/:id/deliveries` (`{ medium: "a4", requestKey }`);
`POST /api/sales/:id/deliveries/:deliveryId/to-receipt` (`{ requestKey }`), beside the receipt
routes at `apps/server/src/till-api.ts:2062-2145`. The id is the working-order id, resolved to
`sales.id` as those routes do.

**Rules.** Session required; zones checked; both POSTs also need the device's `print-receipt`
action. A4 reserves through `reserveInvoiceDelivery` with the location's invoice printer; a replayed
request key returns the same row; an active attempt answers `invoice_delivery.active`; an F2 answers
`invoice_delivery.full_invoice_required`. The switch mirrors the old plan's withdrawal-before-claim
rule: in one transaction the A4 row must still be `queued` (otherwise `invoice_delivery.active`), it
becomes `failed` with `switched`, and a receipt original is enqueued through the existing original
path (`enqueueOriginalReceipt`, `receipt-print.ts:429`) and reserved; an original stays original.

**Failing tests first** (`apps/server/src/till-api.deliveries.test.ts`): each rule; two tills
racing get one attempt; paper-then-A4 and A4-then-paper give a duplicate after completion; A4 after
`failed` or `unknown` is original; a switch after an agent claimed the A4 is refused and leaves
both rows as they were; a replayed switch returns the same receipt; new rows in both maps with
refusing cases (missing action, wrong zone). **Run:** the new file and both map files. **Done:**
cases pass.

### B3a. Dashboard: download a PDF (medium, about 55 calls)

**Goal.** `POST /management-api/orders/:id/invoice-pdf` returns a transient PDF, always marked
«duplicado» (even when no original has been delivered), named `<series>-<number>.pdf`.

**Schema.** A new `invoice_pdf_downloads` (id, sale id with a restrict key to `sales`, person id,
requested at), declared `appendOnly()` as a `ledger` table like `receipt_reprints`
(`packages/db/src/classification.ts:23-27`, `packages/db/src/schema/receipt-reprints.ts`), and named
in `packages/migrations/migrations.manifest.json`. The commit says why it is in the core set.

**Rules.** Needs `report.export` (managers and admins); a supervisor is refused. ONE
`withTransaction` writes the audit row and reads `readInvoiceDocument`; the PDF is rendered after
it commits, with no transaction open. A download changes no delivery row and does not complete a
pending original.

**Failing tests first:** permission refusal and allowance; the audit row and nothing else written;
the bytes carry «duplicado» and the file name; an F2 is refused; a download during a `queued`
original leaves it `queued`. **Run:** the new files, the schema guard list. **Done:** cases and
guards pass.

### B3b. Dashboard: print on A4 and the order detail (small-medium, about 45 calls)

**Goal.** `POST /management-api/orders/:id/invoice-deliveries` (`{ medium: "a4", requestKey }`),
following the reprint rule at `orders-api.ts:203-231`; `readOrderDetail`
(`apps/server/src/orders-list.ts:624`) adds the B1 status and the download history.

**Failing tests first:** the reprint rule's refusals and allowances; replay; active refusal; the
detail carries status, history and downloads, and no recipient address. **Done:** cases pass.

### B4. Alert on an undelivered invoice (small-medium, about 45 calls)

**Goal.** An ongoing alert in `apps/server/src/alert-sources.ts`, linking to the order, one per sale,
no customer detail in its params, while an F1 has no completed original and EITHER its current
attempt is `failed` or `unknown`, OR it is an A4 delivery still `queued` 2 minutes after its due
time (no agent took it: the agent is gone, or the printer records none). For that case the
wording tells staff to open Add a printer on the Printers screen and choose "Use this agent" on the
office printer's row (A7).

**Failing tests first:** raised for `failed`, `unknown` and an A4 queued past the bound; not raised
at 1 minute 59; cleared by a later `sent`; not raised for an F2 or a completed original; English and
Spanish wording, the unclaimed-A4 wording naming Add a printer and "Use this agent". **Run:**
`pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts scripts/errors-reachable.test.ts`.
**Done:** cases and guards pass.

### B5. Till sale view: delivery status, Print on A4, paper instead (medium-large, about 70 calls)

**Goal.** For an F1, the sale view shows the current attempt in words ("sending", "printed on A4",
"sent by email", "not delivered", "may not have been delivered", "waiting for the office printer"),
Retry original after `failed` or `unknown`, Print on A4 when an invoice printer is set, and "Print
on the receipt printer instead" while an A4 waits unclaimed. The receipt status, handover and
existing actions (`till-ticket-view.ts:686-760`) keep their behaviour; email shows status only.

**Change.** `apps/till/src/screens/till-ticket-view.ts`, `apps/till/src/till-app.ts:9423-9425`,
`apps/till/src/api/client.ts`, till strings. Reads are passive; a read failure and an action failure
keep separate messages.

**Failing tests first** (`till-ticket-view.test.ts`, `.a11y.test.ts`): each status's words; each
action appears only when B1 offers it; buttons quiet while a request is out; a refused action keeps
the view; an F2 is unchanged. Keep every existing assertion. **Done:** cases and axe pass.

### B5L. LOOK: the till sale view's delivery section (small, about 30 calls)

Each B5 state, under the LOOK rule.

### B6. Till F1 dialog: printed receipt or A4 (medium, about 60 calls)

**Goal.** The F1 dialog offers Printed receipt (default) and A4 only when B0 reports an invoice
printer, and sends the choice in `setOrderInvoiceChoice` (`client.ts:2471`). The public full-invoice
action stays disabled; tests mount the dialog directly.

**Failing tests first** (`invoice-recipient-dialog.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts`):
A4 hidden with no invoice printer; the choice survives close and reopen and a failed request; the
server's `invoice_delivery.printer_invalid` is shown and stays retryable. Keep the existing
assertions. **LOOK** at the two choices under the LOOK rule. **Done:** cases and axe pass.

### B7. Dashboard order detail: delivery, A4 and download (medium, about 60 calls)

**Goal.** `order-detail-dialog.ts` shows the B1 status and history (who, when, medium, original or
duplicate), Print on A4 and Download PDF; Download only with `report.export`.

**Failing tests first:** each status; buttons hidden without permission; a download triggers a file
save with the series-number name; a refused request keeps the dialog; an F2 shows only Reprint.
**Done:** cases and axe pass.

### B7L. LOOK: the dashboard order detail (small, about 30 calls)

Each B7 state, under the LOOK rule.

## Group C, last part — email at the till and the dashboard

Skipped with C1 if the owner overrides the default (see C1).

### C2. Email in the F1 dialog (medium, about 60 calls)

B0's read adds `emailAvailable`. The dialog offers Email when it is true; an address only, no tick
box. Same tests as B6 for the email branch.

### C2L. LOOK: the dialog's email branch (small, about 30 calls)

### C3a. Email routes and switch to paper, server (medium, about 70 calls)

Till and dashboard routes to email an F1 (dashboard: `report.export`; till: `print-receipt` action,
zones, as B2), retry an email original after `failed` or `unknown`, and switch a `queued` email
original to paper atomically (once claimed, the attempt ends `unknown` first), reusing B2's switch
rule. Rows in both till maps with refusing cases. Real-database cases for replay, two clients
racing, retry staying original and duplicate after completion.

### C3b. Email actions on the till (medium, about 60 calls)

Buttons in the till sale view for C3a's actions, with an address field primitive and a
`*.unsaved.test.ts` for the staged address. Ask the owner (open point 1) before any screen shows the
address an email went to.

### C3c. Email actions on the dashboard (medium, about 60 calls)

The same in the dashboard order detail, hidden without `report.export`, with its own
`*.unsaved.test.ts`.

### C3L. LOOK: the email actions on the till and the dashboard (small, about 30 calls)

### C4. Practice-mode email check (small, about 25 calls)

Send a long synthetic invoice into the local capture service and read it back with its attachment
through the inbox API. If `MP_MAX_MESSAGE_SIZE` (`deploy/compose.yml:86`, 1 MB) refuses it, raise it
and say why.

## Owner paper checks, HP1 and HP3 (added 2026-10-12)

The owner ran the A4 path on their HP Color LaserJet MFP M181fw (`~/waitron-campaign-b/questions.md`,
"OWNER-SESSION FINDING 2026-10-12" blocks ~16:40, ~17:10, ~17:12). Three tasks came from it, taken
after B2 and before B3a; HP2 (below) comes before B4, whose wording it extends.

### HP1. Send every IPP request with a chunked body (small) — done, `2f13dfe17`

The HP aborted the agent's Print-Job (0 pages) when it carried `content-length`, and printed the same
bytes sent `transfer-encoding: chunked` (owner A/B: jobs 918 and 919 aborted, 920 printed).
`exchangeIpp` now sends every IPP request chunked; the fake-server tests pin the headers.

### HP3. The A4 invoice's QR black square is 35 mm (small) — done, `092415f09`

The owner measured 30 mm. The 35 mm in `invoice-page.ts` had covered the black square plus a
4-module white border each side, so the square was `35 × n / (n + 8)` mm (28.1 mm for 33 modules,
29.6 mm for 45). The square is now 35 mm for every code size, in the PDF and the raster, with the
border reserved around it.

## Owner paper checks, HP2: an A4 job the printer is holding (empty tray) is not "may not have printed"

Revised 2026-10-12 after a fresh-context review (one critical, one important and five minor
findings, all taken).

**Source.** `~/waitron-campaign-b/questions.md`, "OWNER-SESSION FINDING 2026-10-12 ~17:10 … empty tray"
and "~17:12 … switched off mid-job". Empty tray: the HP answered printer `stopped`, reasons
`media-empty-error, media-needed`; job `processing-stopped`, reason `printer-stopped`. Waitron ended
`unknown`/`timeout` at the 120 s poll bound, and the HP printed the job by itself once paper went in.
Power cycle: the HP forgot the job and printed nothing, so `unknown` was right there.

**Today (read on `3df17e66c`).**
- **The agent never asks the printer.** It asks only for the job's state (`ipp-print.ts:81-82`) and
  polls any state that has not ended (`:161-164`), until a fixed 120 s from submission (`:27`,
  `:147`). Then the answer is `unknown`/`timeout` (`:166`). A job the printer no longer knows
  (0x0406/0x0407) ends at once as `unknown`/`timeout` (`:37-38`, `:160`). That probably explains the
  power-cycle run ending at 61 s, but nobody checked.
- **The server keeps a claim alive while the agent renews.** The runner renews every 20 s
  (`agent.ts:32`, `:357-370`). A renewal moves the lease forward with no upper limit
  (`invoice-page-print.ts:95-116`, `:103`; lease rule `invoice-delivery.ts:248-253`), and refreshes
  the in-memory claim record (`page-print-api.ts:258-259`).
- **No action is offered while `sending`.** `busy` blocks retry and Print on A4
  (`invoice-delivery-status.ts:105-120`, `:127-130`). Paper instead needs `queued` (`:131-138`).
  The server refuses a new attempt while one is active (partial unique index
  `invoice-deliveries.ts:86-88`; `invoice-delivery-actions.ts:49-62`).
- **The A4 queue is per AGENT, not per printer.** The runner has one busy flag (`agent.ts:125`,
  `:430-431`) and waits for each job before claiming the next (`:441-447`). The server hands out the
  oldest due job across all of the agent's printers (`invoice-page-print.ts:61-74`, filtered only by
  `agentId`). Test pages are handed out only when no invoice is due (`page-print-api.ts:146-161`,
  `page-test-pages.ts:131-141`). So a job on printer X holds up printer Y: today for at most 120 s,
  but for the whole hold once HP2 follows held jobs. Meanwhile a test page on Y fails `not_claimed`
  after 5 minutes (`page-test-pages.ts:11`, `:58-59`).

**Design.**
- **One job in flight per PRINTER (HP2a, HP2b).** The server never hands out a job for a printer
  that already has one out. The agent runs claimed jobs side by side and keeps claiming while claims
  succeed.
- **A held job stays `sending`.** That means no new status value and no table rebuild. The agent
  asks the printer itself. If the printer says `stopped` and still has the unfinished job, the job
  is HELD.
- **The countdown restarts while held.** Every poll that finds the job held restarts the 120 s
  bound. Two cases still end `unknown`/`timeout`: a job the printer forgets, and a printer that is
  silent for 120 s after the last held answer.
- **The hold is stored as a code.** It travels, as a code, in each renewal. The server keeps the
  last reported hold in one new nullable column, `invoice_deliveries.printer_hold` (text, no CHECK,
  like `failure_code`, `invoice-deliveries.ts:72`). Each renewal overwrites it; a report or an expiry
  leaves it as it was.
- **Nothing is ever cancelled.**

**Hold codes, fixed list** (`a4HoldCodes` in `packages/db`, `PAGE_HOLDS` in `@waitron/print-agent`).
The agent strips a `-error` suffix, ignores any value ending `-warning` or `-report`, and counts a value
with no suffix. RFC 8011 §5.4.12, quoted: "If the implementation does not add any one of the three
suffixes and the value is not 'none', Clients can assume that the reason is an "error" if the Printer
is in the 'stopped' state …". The first match in this order wins:

| Code | IPP reasons it covers |
| --- | --- |
| `paper_jam` | media-jam |
| `cover_open` | cover-open, door-open, interlock-open |
| `paper_out` | media-empty, media-needed |
| `tray_missing` | input-tray-missing |
| `ink_or_toner_out` | marker-supply-empty, toner-empty |
| `output_full` | output-area-full, output-tray-missing |
| `paused` | paused, moving-to-paused |
| `stopped` | anything else, an empty list included |

Order: HP2a → HP2g. Each task leaves the branch green. The two queue tasks come first, so following
a held job (HP2c) never blocks another printer.

### HP2a. The server hands out one A4 job per printer at a time (medium, about 55 calls)

**Change.**
- **Busy printers.** `claimInvoicePagePrint` (`invoice-page-print.ts:33-92`) reads which page
  printers in the location have an A4 row `sending`. It reads them INSIDE the function, after its
  own expiry of lapsed claims (`:39`), so a lapsed row frees its printer on the same pull. It
  returns that list beside the job, or beside `undefined`.
- **Skips.** `claimInvoicePagePrint` gains an `exceptPrinterIds` argument, filled from a new
  `testPages.printingOn()`, and skips those printers as well as the busy ones. `printingOn()` first
  ends lapsed test pages, as `claim()` and `read()` do (`page-test-pages.ts:55-70`).
- **Test pages in the same transaction.** The claim route (`page-print-api.ts:141-191`) calls
  `testPages.claim` INSIDE the `withTransaction` callback, not after the commit (today `:161`).
  `testPages.claim` is synchronous. Inside the transaction its busy list cannot be stale when two
  claim requests overlap; the client gives up after 3 s (`client.ts:158`) and may claim again.
  `testPages.claim` (`page-test-pages.ts:119-154`) skips the printers the invoice claim returned as
  busy.
- **Unchanged.** The oldest due job among the remaining printers wins. The disabled-printer sweep
  (`invoice-page-print.ts:44-60`) is unchanged.
**Failing tests first** (`invoice-page-print.test.ts`, `page-test-page.test.ts`, `page-print-api.test.ts`):
- **Invoice blocks invoice:** with X `sending`, the claim hands out Y's younger invoice and not X's
  older one.
- **Test page blocks invoice:** with X's test page printing, X's invoice is not handed out and Y's
  is.
- **Invoice blocks test page:** with X `sending`, X's test page waits and Y's test page is handed out.
- **Release:** after X's report, X's next invoice is handed out.
- **Lapsed claim:** a claim on X past its lease frees X on the same call: X's next invoice is handed
  out.
- **Lapsed test page:** a lapsed test page on X frees X the same way.
- **Overlapping claims:** two overlapping claim requests never hand out two jobs for one printer.
- **Second printer served:** with nothing out, behaviour is unchanged (the existing cases pass
  unedited).
**Done:** the cases pass. Three deletion proofs, one per skip: removing it fails its own case.
Another: read the busy list before the expiry, and "lapsed claim" fails.

### HP2b. The agent runs one job per printer side by side (medium, about 65 calls)

**Change.** In `packages/print-agent/src/agent.ts:428-456`:
- **Busy flag replaced.** The one `pageBusy` flag (`:125`) is replaced by one claim loop at a time
  plus a set of jobs in flight. The claim loop claims until the server answers 204, and starts each
  claimed job without waiting for it.
- **Finished jobs wake the loop.** A job that ends sends its report, then wakes the loop.
- **Unsent reports become a list.** The single slot (`unsentPageReport`, `:126`) becomes a list. Each
  report is resent on the next pull with its own claim and dropped on its own after
  `PAGE_REPORT_GIVE_UP_MS` (`:39`).
**Rules.**
- **One job per printer is the server's rule** (HP2a). The agent keeps no lock of its own, so a job
  the server hands out is never left unprinted.
- **Claiming continues while reports are unsent.** This replaces today's rule that an uncertain
  report is resent before any new claim (`agent.ts:124`). The server keeps that job's printer busy
  until its lease lapses, so a new claim cannot print on that printer meanwhile.
- **Otherwise unchanged.** Renewal, settle and report rules per job are as A12 decided.
**Failing tests first** (`agent.test.ts`, fake host and client):
- **Side by side:** while a long job on X prints, a job on Y is claimed, printed and reported.
- **Receipts:** a receipt job still prints at once during both.
- **Kept reports:** two unsent reports are each kept and resent, and each is dropped at its own
  give-up time.
- **Claiming goes on:** while a report is unsent, the next pull still claims and prints a job on
  another printer.
- **One claim loop:** two pulls in a row never run two claim loops.
- **Wake:** a finished job's report wakes the claim loop.
**Run:** the print-agent suite and its `test:coverage`, plus `pnpm lint`. **Done:** the cases pass.
Deletion proof: restore the single busy flag and "side by side" fails. The A12 cases that pinned one
job at a time are rewritten, each listed under Changed test checks with its reason.

### HP2c. The agent tells a job the printer is holding from a lost one (medium, about 60 calls)

**Goal.** `printOverIpp` keeps following a held job and reports each change in its hold. **Start
only after HP1's commit has landed**: HP1 edits `ipp-print.test.ts`.
**Change.** `apps/print-agent/src/ipp-print.ts`; `PAGE_HOLDS` and the `PageHold` type in
`packages/print-agent/src/client.ts`, beside `PAGE_FORMATS` (`:103-107`).
**Rules.**
- **When the agent asks the printer.** A poll that finds the job not yet ended asks the printer for
  `printer-state` and `printer-state-reasons` (Get-Printer-Attributes, operation 0x000B, built like
  `ipp-capabilities.ts:130-147`, bounded like a poll, `:29`). It asks in three cases:
  - the job is `pending-held` (4) or `processing-stopped` (6);
  - `job-state-reasons` holds `printer-stopped`;
  - less than one poll interval plus one poll request timeout is left before the bound.
- **What counts as held.** Printer-state 5 (`stopped`). RFC 8011's job-state table, row '6', says a
  client "can obtain more complete device status remotely by querying the Printer's
  "printer-state", "printer-state-reasons"".
- **Reporting the hold.** `IppPrintOptions.onHold?(hold: PageHold | null)` is called only on a
  change, and with `null` when a held job moves on.
- **The bound.** Each held answer restarts the 120 s bound. Failed polls end a hold only 120 s after
  the last held answer. While held, polls are 10 s apart (`heldPollIntervalMs`, which tests can set).
- **Unchanged.** The abort signal still stops at once. The job is never sent twice and never
  cancelled.
- **Codes only.** Outcomes and `onHold` carry codes; no printer text leaves the function.
**Failing tests first** (`ipp-print.test.ts`, the fake printer in the file, answering 0x000B too):
- **The HP's own answers:** `onHold("paper_out")` is called once. Polling runs past `pollLimitMs`.
  Then the printer answers `processing`, `onHold(null)` is called, and the job completes: `sent`.
- **Held, then lost:** a job that was held is then forgotten (0x0406) and ends `unknown`/`timeout`.
- **Held, then silent:** a printer unreachable for the bound after a held answer ends
  `unknown`/`timeout`. A shorter silence followed by another held answer keeps following the job.
- **Not held:** the job is `processing-stopped` but the printer is not `stopped`. It ends at the
  bound, unchanged from today.
- **Caught at the bound:** a printer that keeps the job `processing` but is `stopped` near the bound
  is held.
- **Code table:** one `it.each` over every keyword in the list, in each suffix form; a `-warning`
  value and an unknown keyword both give `stopped`.
- **Abort:** the signal stops a held job.
- **One send:** exactly one Print-Job request in every case.
**Run:** `pnpm --filter @waitron/print-agent-app exec vitest run src/ipp-print.test.ts`, that
package's `test:coverage`, `pnpm lint`, and the fiscal pair.
**Done:** the cases pass. Deletion proofs: drop the restart of the bound and "the HP's own answers"
fails; drop the `stopped` check and "not held" fails; drop the near-bound check and "caught at the
bound" fails. Write the RFC 8011 quotes, fetched from rfc-editor.org, in the commit message.

### HP2d. The server stores the hold a renewal reports (medium, about 60 calls)

**Change.**
- **Schema.** In `packages/db/src/schema/invoice-deliveries.ts`, add `a4HoldCodes` and a
  `printerHold` column of type `label("printer_hold")`, typed as `A4HoldCode`, and export both
  (`packages/db/src/index.ts:302`).
- **Migration.** Generate it with `pnpm --filter @waitron/db db:generate`. It must be the single
  `ALTER TABLE \`invoice_deliveries\` ADD \`printer_hold\` text;` with no `__new_` table. The
  reviewer measured exactly this in a throwaway worktree.
- **Renew function.** `renewInvoicePagePrint` (`invoice-page-print.ts`) gains `hold` and sets it
  beside `claimedAt`.
- **Renew route.** It reads `body.hold`: absent or `null` means not held; any other value goes
  through `requireEnum` against `a4HoldCodes` (`field: "hold"`, as `readOutcome` does at
  `page-print-api.ts:102-114`).
- **Test pages.** `page-test-pages.ts`: `renew(claim, hold)` keeps the hold. The view carries `hold`
  only while the page is `printing`. A new `holdOn(pagePrinterId)` answers that printer's printing
  test page's hold, or `null`; B4 reads it.
**Failing tests first** (`invoice-page-print.test.ts`, `page-print-api.test.ts`, `page-test-page.test.ts`):
- **Stored:** a renewal with `paper_out` stores it; a later one with `null` or no `hold` clears it.
- **Refused:** a bad value answers 400 and leaves the row unchanged.
- **Lost claim:** a lost claim's renewal writes nothing.
- **Long hold:** a claim renewed every 20 s across 30 minutes of controlled clock stays `sending`.
- **Kept:** a report keeps the last hold.
- **Test page:** a held test page reads `printing` with its hold, and `holdOn` answers it. A lapse
  still ends it `unknown`/`timeout`.
- **Lists match:** `PAGE_HOLDS` equals `a4HoldCodes`, as `page-print-api.test.ts:653` does for
  formats.
**Run:** the three files; `src/invoice-delivery.test.ts`, whose column pin at `:342-349` must still
pass; the plan's schema guard list; and the fiscal pair.
**Done:** the cases and guards pass. Deletion proof: remove the `requireEnum` check and the 400 case
fails, while the case storing a valid `paper_out` still passes.

### HP2e. The agent's runner carries the hold in each renewal (small-medium, about 45 calls)

**Change.**
- `packages/print-agent/src/host.ts:192-197`: `printPage` gains `onHold: (hold: PageHold | null) => void`.
- In `agent.ts`, each job's claim record keeps `hold`, `printClaimed` passes a setter, and
  `keepClaim` sends `hold`.
- `client.ts:594-603`: `renewPageJob(…, hold)` puts it in the body.
- `apps/print-agent/src/host.ts:102-103` passes it through to `printOverIpp`.
**Rules.** No extra request when the hold changes: the next 20 s renewal carries it.
**Failing tests first** (`agent.test.ts`, `client.test.ts`, `host.test.ts`):
- **Carried:** a fake `printPage` reports `paper_out`, so the next renewal body carries it; after
  `null`, the next carries `null`.
- **Separate jobs:** two jobs on two printers carry their own holds.
- **Long hold:** a job held for longer than `PAGE_REPORT_GIVE_UP_MS`, with renewals getting through,
  still reports once at the end.
- **Lost while held:** a `claim_lost` renewal while held aborts the job and reports.
**Run:** the print-agent suite and its `test:coverage`, `host.test.ts`, `page-print-api.test.ts`
(its real-client case), and `pnpm lint`.
**Done:** the cases pass, and the package still imports nothing from the repo. Deletion proof: have
`keepClaim` send `null` always and "carried" fails.

### HP2f. The delivery status shows the hold, end to end (small-medium, about 50 calls)

**Change.**
- **The hold field.** In `invoice-delivery-status.ts`, `InvoiceDeliveryAttempt` gains `printerHold`.
  `rowAttempt` fills it for an A4 row that is `sending` (the hold now) or `unknown` (the last hold
  before it ended), and `null` otherwise.
- **No new action.** Paper instead stays limited to a queued, unclaimed A4, because a held A4 may
  still print and paper would make two originals.
- **A comment to correct.** `:21-22` says `at` for `sending` is "when it was claimed", but a renewal
  moves `claimedAt` (`invoice-page-print.ts:103`). Make it say "claimed or last renewed".
**Failing tests first** (`invoice-delivery-status.test.ts`):
- `printerHold` is set on `sending` and `unknown` A4 rows, and `null` on `sent` and `failed` rows
  and on email and receipt rows.
- A held A4 offers no retry, no A4 and no paper.
**Pins** (these already pass on today's code; they are kept so a change cannot loosen them), in
`till-api.deliveries.test.ts`: a held attempt refuses Print on A4 and paper instead with
`invoice_delivery.active`.
**End to end** (`page-print-agent-e2e.test.ts`, failing first): the fake printer answers as the HP
did. The till's GET shows `sending` + `paper_out` after a renewal. Then paper goes in and the attempt
ends `sent`, with exactly one Print-Job. A second printer's invoice prints meanwhile.
**Done:** the cases pass. Deletion proof: drop the `unknown` arm from `rowAttempt`'s hold and its
case fails.

### HP2g. The test page shows the hold in the office printers panel (small, about 40 calls)

**Change.**
- `apps/dashboard/src/api/client.ts:1276-1288` gains `hold?`.
- `page-printers-panel.ts:297-307` gets a note for a printing page with a hold: "Test page waiting at
  the printer: {reason}".
- EN and ES strings go beside `strings.ts:1341-1352`, one reason for each code: out of paper, paper
  jam, a cover is open, a tray is missing, out of ink or toner, the output tray is full, paused,
  stopped.
**Rules.** The button stays quiet while the page is out (`isOut`, `:39-40`, already covers
`printing`), and polling continues (`:294`).
**Failing tests first** (`page-printers-panel.test.ts`, `.a11y.test.ts`): the note for each code; the
button stays disabled while held; the note returns to "Printing test page" when the hold clears.
**Done:** the cases and axe pass. LOOK at the held note under the LOOK rule.

### Amendment to B4

**B4 stays as planned.** The hold wordings go in a new task right after it.

### B4h. Alert wording for a held invoice, and the test-page store moves to boot (small-medium, about 50 calls)

- **Held invoice.** Raise the alert while an F1 has no completed original and its current attempt is
  an A4 that is `sending` with a `printer_hold`. Word it by hold code, for example "The office
  printer is out of paper. Load paper: the invoice will print by itself. Do not print it again." No
  retry instruction. It clears when the hold clears or the attempt ends.
- **Unknown with a last hold.** Word it "may still print; check the printer first". A power cycle
  while held also leaves the last hold on the row, so the wording promises nothing.
- **Queued behind a hold.** For an A4 still `queued` 2 minutes after it is due, when the SAME
  `page_printer_id` has either:
  - a `sending` row with a hold, or
  - a held test page (`testPages.holdOn(id)`, HP2d),
  the wording names that hold and suggests paper instead, not "Use this agent".
- **Wiring.** Boot creates the test-page store with `createPageTestPages` and hands the same store
  to `mountPrintApi` and to the alert source, as holders are passed to the other alert sources
  (`alert-sources.ts:188`, `:212`):
  - Boot creates it BEFORE the `if (!fencedOrMirror)` block (`boot.ts:1501`) that mounts
    `mountPrintApi` (`:1542`), so the alert sources (`:1797` on) have it on every node.
  - Boot gives it the same `now` that `mountPrintApi` receives.
  - The store has nothing to stop, so nothing goes on `undoOnFailure`.
  - `mountPrintApi` keeps `deps.testPages ?? createPageTestPages(now)` as a default
    (`print-api.ts:469`), so its 14 test call sites stay unedited.
- **Tests.**
  - Each wording in EN and ES.
  - Clearing the hold clears the alert.
  - A hold on printer X leaves the "Use this agent" wording for a queued invoice on printer Y.
  - A boot case shows that the alert reads a held test page requested through the route.
- **Run:** `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts scripts/errors-reachable.test.ts`
  and the boot suites the move touches. **Done:** the cases and guards pass.

### Amendments to B5, B7

**B5, add:**
- **Held words:** "waiting at the office printer: <reason>", one reason per code, EN and ES. A test
  shows that a held attempt shows these words and offers no Retry, Print on A4 or paper instead.
- **Unknown with a last hold:** "may still print; check the printer first".
- **Re-reading:** while the current attempt is `queued` or `sending`, the view re-reads passively
  every 5 s and stops when the view closes.

**B7, add:**
- The same held and unknown-with-a-hold words in the order detail.
- Print on A4 stays absent while held. Download PDF stays available, because B3a changes no delivery
  row.
- The same passive re-read while `queued` or `sending`.

### Owner questions

1. **Cancel a held job?** Should Waitron offer to cancel a job the printer is holding, then allow a
   new print? Default: never cancel. The job waits until it prints or someone cancels it at the
   printer.
2. **Time limit on a hold.** There is none while the printer keeps answering. Meanwhile the next A4
   jobs for the SAME printer wait behind it, test pages included (HP2a). Other printers are not
   affected. Queued invoices can switch to paper. Default: no limit.
3. **A held attempt ended from Waitron's side.** This happens when the printer is disabled
   (`page-printers.ts:163-166`), on a server restart (`boot.ts:1502`), or when an agent restart lets
   the claim lapse. The attempt becomes `unknown` and offers Retry original, yet the printer may still
   print it, which would make two originals. Default: unchanged, but the wording says "may still
   print; check the printer first".

**Limits stated, not fixed.** A printer that never reports `stopped` keeps today's 120 s `unknown`.
The server learns about a hold up to 20 s late. The power-cycle case is unchanged.

### Receipts

- `apps/print-agent/src/ipp-print.ts:27-29, 37-42, 72-85, 115-126, 140-171, 160, 166, 178-204`
- `apps/print-agent/src/ipp-http.ts:11-15, 41`
- `apps/print-agent/src/ipp-capabilities.ts:18-47, 116-147, 139`
- `apps/print-agent/src/host.ts:102-103`
- `packages/print-agent/src/host.ts:137-140, 189-197`
- `packages/print-agent/src/agent.ts:32-39, 125-126, 348-371, 373-411, 413-426, 428-456, 698`
- `packages/print-agent/src/client.ts:103-107, 128-133, 594-603, 619-625`
- `apps/server/src/page-print-api.ts:96-114, 141-191, 146-161, 246-264, 250, 258-259`
- `apps/server/src/invoice-page-print.ts:33-92, 44-60, 61-74, 95-116, 103, 122-149`
- `apps/server/src/invoice-delivery.ts:179, 185-231, 233-268, 288-367`
- `apps/server/src/invoice-delivery-status.ts:12-33, 105-120, 127-138, 144-162`
- `apps/server/src/invoice-delivery-actions.ts:49-62, 89-100`
- `apps/server/src/till-api.ts:2160-2171`
- `apps/server/src/page-test-pages.ts:11, 18-22, 55-70, 119-154, 166-172, 178-189`
- `apps/server/src/print-api.ts:469, 1018-1036`
- `apps/server/src/alert-sources.ts:188, 212`
- `apps/server/src/page-printers-api.ts:167, 176`
- `apps/server/src/page-printers.ts:159-166`
- `apps/server/src/boot.ts:1501-1502, 1542, 1797`
- `packages/print-agent/src/agent.ts:124`, `packages/print-agent/src/client.ts:158`
- `apps/server/src/invoice-delivery.test.ts:342-349`
- `apps/server/src/page-print-api.test.ts:19, 653`
- `packages/db/src/schema/invoice-deliveries.ts:21, 31-40, 72-75, 86-91`
- `packages/db/src/schema/columns.ts:162`
- `packages/db/drizzle/0142_working_order_receipt_locale.sql`
- `apps/dashboard/src/widgets/page-printers-panel.ts:29-40, 294, 297-307`
- `apps/dashboard/src/api/client.ts:1276-1288`
- `apps/dashboard/src/i18n/strings.ts:1341-1352`
- RFC 8011 (fetched 2026-10-12 from rfc-editor.org/rfc/rfc8011.txt): §5.3.7 job-state table rows '4'
  and '6'; §5.4.11 printer-state '5' 'stopped'; §5.4.12 suffix rule and the keyword list (every
  keyword in the hold table is listed there).

## Final gate

1. **Stale prose.** Across base-to-tip, read every claim this build retires: office printers "not
   supported" (the dashboard string and any doc); A4 or office-printer delivery "not built"; "email
   is account email only"; email setup needing a terminal (`apps/server/README.md`'s
   `waitron-credentials set --purpose email.smtp` stays true but is no longer the only way); the
   "virtual PDF printer" line (`docs/backlog/printers.md:289-291`, `docs/backlog.md:2800`), which
   A231q does not build but whose neighbours it may make stale; and the A231d entry
   (`docs/backlog.md:268`, `docs/backlog/fiscal.md`). Grep `office printer`, `page printer`, `A4`,
   `SMTP`, `account email` in `docs/`, `apps/*/README.md` and `deploy/`. Update the A231d entry in
   the same change: delete what is done, leave one short entry per open point. The prepare-venue
   SMTP item (`docs/backlog/box.md:403`) stays open. If group C moved, say so there. If C1 ran, add
   the dated supersession pointers the consent inventory lists in its "Prose audit paths" (the
   2026-10-03 specs and plans, `docs/backlog/fiscal.md` A231d/A231p, `docs/backlog.md` A448, the A366
   §11/slice 7 plan), keeping their research and independent questions.
2. **Checks.** Focused suites per task; let the pre-push hook run once; confirm CI's `changes` job
   selected server, till, dashboard, setup, db, print-agent and print-agent-app, and their coverage
   jobs passed on the current head. Build and open the till, the dashboard AND the setup wizard
   locally (CI builds no front end unless an image input changed). `db`'s mutation floor of 90 is
   scored only by the weekly run on the merged shards
   ([ci-and-gates.md](../../developers/ci-and-gates.md), the per-package table): say in the PR that
   it is unmeasured for this branch until that run, or run the shards and read the aggregate.
3. **Built-image rendering**, if Docker is available here: build the image from `deploy/Dockerfile`,
   copy in a throwaway entry bundled with `scripts/bundle-node.mjs` (kept outside the worktree), and
   render one PDF, one PWG and one URF page inside it; read them back with part 1's readers. Record
   it as a local run. If not possible, it goes on the owner-pending list.
4. **Finish.** Update the ledger to `Status: done`, then `/finish-branch` (full wave: this branch
   touches migrations and a cross-package contract). End at `needs-owner-review`; do not merge.

## Owner-pending

- On the owner's HP: a long F1 as PDF through the product, its QR measured with a ruler and scanned
  with a phone; the same F1 as Apple Raster at 600 dpi; a test page from the Printers tab; what is
  reported with the tray empty; what is reported when the printer is switched off mid-job.
- On the box, in the built image: time and peak memory for one raster page at 300 and at 600 dpi.
- Built-image rendering, if the final gate could not do it locally.
- 58 mm and 80 mm receipt F1 paper output and QR (carried from part 1).
- The owner's answer on consent removal, if it overrides the default (skip C1-C4).
