# A696: invoice dates and record offsets in the location's time zone

> **Supersession, 2026-10-20:** the owner's 2026-10-15 ~22:25 direction replaces mid-payment
> zone repair with startup validation and checks at every saved-zone writer. Follow the
> [startup redesign](2026-10-20-a696-startup-zone-validation-design.md) for the current proposal.
> The audit, sourced evidence, measurements and earlier status statements below remain historical.
> The saved-zone/DST and ordinary receipt/till scope stays; full design, plan and build approval
> remain outstanding. This documentation change implements nothing.

**Current status, 2026-10-15:** the saved venue zone and inclusion of restricted guided repair
are approved directions. The [guided repair proposal](2026-10-15-a696-guided-zone-repair-design.md)
now supplies the exact permission, workflow and validation for owner review. Full design,
implementation plan and build remain unapproved.

**Dated update, owner 17:20:** include repair only for an invalid or missing saved zone. A manager
confirms the correct named zone; recovery retains the capture and uses the later issuance instant.
Already-settled replay retains its saved facts; valid-to-valid changes keep their normal locks.
This supersedes the references below to the repair *scope* being unresolved. The original audit,
measurements and proposals below remain historical; no repair or stricter issuance validation has
been built by this documentation change.

**Historical status at the 05:12 decision:** venue-zone behavior approved; full design,
implementation plan and build unapproved. Post-capture repair scope was unresolved.
Audit baseline supplied by the driver: main `d0d2447d239062f21086e46a6cec3e8a9f311fa6`.
Written 2026-10-15. This is an audit and a behavior contract, not an implementation plan.
The later build is a separate FULL fiscal PR. Golden huella and `inmutabilidad` checks stay
UNEDITED; an unexpected protected-check change is a stop for owner review.

## Owner decision recorded 2026-10-15: the venue's saved time zone

You answered **“A — Venue's time zone”** in the watcher session. The receipt is
`~/waitron-campaign-e/questions.md`, under **WATCHER 2026-10-15 ~05:12**, “OWNER ANSWER to
A696 question 1”. Every **new** invoice date and record offset, ordinary receipt and till
display must use the venue's saved time zone, including daylight saving time, independently
of the process zone. Old records retain their stored dates, offsets and hashes.

This approves that behavior only. It does not approve the full design, an implementation plan
or a build. The audit, measurements, provenance and original question below are retained as
history; their recommendation wording is superseded only for this approved behavior.
The remaining mechanisms and acceptance proposals still await approval, including strict
zone validation, which is unbuilt. A444's operation/service-date decision stays separate.

**Next decision, unresolved:** how you repair a genuinely invalid or missing saved zone found
after a card capture, before an invoice exists. No repair policy, new permission or tested
repair tool is approved here. The normal settings history locks remain in scope for preservation.
Settle an owner-usable repair design before seeking full-design, plan or build approval;
the first answer alone releases none of them. The historical blocker is described under
[Configuration snapshots, caching and errors](#configuration-snapshots-caching-and-errors).

## Historical first-question rationale, before the owner answer

Your location already has `locations.time_zone`, but the live invoice clock reads the server
process's offset. A Madrid location can therefore acquire a different invoice date when you move
the same server between process time zones. The proposed default is to derive each **new** invoice's
calendar date and generation-record offset from that location's configured named time zone at
the event's instant, including daylight saving time (DST). Keep the instant itself unchanged. Ordinary F2 receipt printing and till display are part of
this recommendation: they use the recorded offset so they show the same day as the filed invoice.

At `2026-10-14T23:30:00Z`, the proposed Madrid values are issue date `15-10-2026` and
`FechaHoraHusoGenRegistro = 2026-10-15T01:30:00+02:00`. The driver measured those values under a Madrid process and measured the previous
day under UTC, with the configured location unchanged; see the receipts below. The queue's worked-example wording needs care: **00:30 Madrid on
15 October is `2026-10-14T22:30:00Z`**, not 23:30Z. At 23:30Z Madrid reads 01:30.

This chooses a product source of time-zone configuration. It does **not** claim that AEAT requires
an IANA configuration field. IANA names, such as `Europe/Madrid` and `Atlantic/Canary`, identify
rules for converting instants into local dates and offsets. Primary-source evidence is recorded below.

## Evidence boundary

All findings in the inventory are **source-only**. This writer read source and configuration,
did not execute tests or an image, did not inspect the driver's `a696-audit.test.ts`, and ran no
git operations. Baseline identity is supplied by the driver, not independently checked here.
Line references below describe that supplied audit tree. The inventory is based on production
source, not test outcomes or generated migration snapshots, plus the explicitly identified
installed library.

The source closure searches covered `recordSale`, `recordCorrection`, `recordSubstitution`,
`recordVoid`, `appendToChain`, record builders, `issuedAt`/`issued_at`, issue-date fields,
`generadoEn`, offsets and clock constructors across `apps`, `packages` and `scripts`, with a
separate inspection of `bench`. The production inserts found are
`packages/core/src/record-sale.ts:306`, `record-correction.ts:264`,
`record-substitution.ts:189`, and `packages/fiscal-verifactu/src/chain.ts:211`.
The throughput bench's `bench_sales` insert is a separate synthetic table
(`bench/pglite-throughput/src/bench.ts:189`), not an issuing path.

### Measured issuing paths and preservation controls

The driver ran a disposable `apps/server/src/a696-audit.test.ts` in the installed registered
worktree at the audit baseline, using Node v26.11.1 and `@waitron/verifactu@0.2.1`. Each case
provisions a real temporary database through `useVenueDb`; the venue stays `Europe/Madrid`.
The probe fakes Date alone at `2026-10-14T23:30:00Z` and changes process `TZ` between UTC and
Madrid. Before running, it predicts UTC will store 14 October/+0 if the process controls dating,
versus 15 October/+120 if the venue controls it. Madrid is the opposite-direction control.

| Measured path                                                                                                | UTC process: stored invoice date / offset | Madrid process: stored invoice date / offset |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | -------------------------------------------- |
| Walk-up cash, retrieved held order, unpaid-invoice writer, final table bill payment, active emergency series | `2026-10-14` / 0                          | `2026-10-15` / 120                           |
| Core R5 correction, core F3 substitution, direct core F1 (public F1 remains disabled)                        | `2026-10-14` / 0                          | `2026-10-15` / 120                           |
| Normal reader capture and captured-crash recovery, using the real orchestration with the fake provider       | `2026-10-14` / 0                          | `2026-10-15` / 120                           |
| Actual unpaid-departure route and cancel-generated R5 route, with an administrator session                   | `2026-10-14` / 0                          | `2026-10-15` / 120                           |

Every new record in these rows reconstructs generation as `2026-10-14T23:30:00+00:00` under UTC
and `2026-10-15T01:30:00+02:00` under Madrid. A fiscal void at that instant also follows the
process offset, but **its invoice date is always the original invoice's stored date**: when the
original was issued at noon on 14 October, both process cases retain `14-10-2026` on annulment.
Same-id walk-up, held-order and emergency replays after advancing to next-day noon retain all
fiscal rows. For outbox sends at next-day noon under `Asia/Tokyo`, both original process cases
send three records accepted by the installed fake and preserve their complete stored fiscal
payloads and rows (only the transport wrapper and RefExterna are removed for comparison).
This does not establish real AEAT acceptance or prove lost-response/restart/restore paths.

The demo seeder was run at the audit instant in both process zones. It deliberately generates
11 earlier UTC service-window instants that day, so both runs retain 14 October; their offsets
are respectively 0 and 120. That measures backdated issuance, not a seeded sale at 23:30Z.
Readiness, standalone CLIs, fixed-date demos, configuration import, restore, accepted-offline
card and the non-payment auto-issue triggers remain **source-only**, not runtime-qualified here.

Commands and results:

- `A696_EXPECT_VENUE=1 pnpm --filter @waitron/server exec vitest run src/a696-audit.test.ts`
  produced **8 failures / 8 passes**: each UTC path failed the independent proposed 15 October
  expectation, while all eight Madrid controls passed. No product fix follows this RED run.
- The final characterization command, without that proposed-rule switch, produced **28 passes**.
  It measures the current defect and preservation behavior; it is not evidence that A696 is fixed.
- `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  produced **20 passes**; both protected files remain unedited.

Raw predictions, complete disposable test, JSON rows, full logs and summaries are retained in
`~/waitron-campaign-e/receipts/a696-*` (`a696-probe-predictions.txt`, `a696-audit.test.ts`,
`a696-issued-paths.jsonl`, `a696-measured-summary.json`, `a696-resend.jsonl`, `a696-seed.jsonl`,
`a696-red-final.log`, `a696-routes-final.log`, `a696-protected.log`). The temporary suite was
removed from the worktree after copying it; this change contains documentation only. Early
harness failures (wrong relative import, non-idempotent test-helper replay, submission wrappers
and a missing signed-in operator argument) are retained in their logs, not counted as product defects.
The driver also ran the same 28 cases at `2026-10-14T12:00:00Z`: **28 passes**. All 28 captured
invoice/annulment rows retained 14 October in both process zones; offsets remained 0 versus 120.
This is the same-day control, where the date defect is invisible. The retained control suite and
logs are `a696-noon-audit.test.ts`, `a696-noon-issued-paths.jsonl` and `a696-noon-control.log`.
All times and offsets above are observed driver outputs.

### Primary-source provenance

Retrieved 2026-10-15. Quote first, then the bounded interpretation:

| Source and exact location                                                                                                                                                                                                                        | Short quotation                                                             | Bounded reading                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [AEAT SuministroInformacion.xsd](https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroInformacion.xsd), IDFacturaExpedidaType/FechaExpedicionFactura, downloaded lines 277–280 | «Fecha de emisión de la factura»                                            | Invoice issue date; the type `sf:fecha` is a 10-character DD-MM-YYYY string (downloaded lines 685–689). It carries no zone itself.                                                                                               |
| Same AEAT XSD, RegistroFacturacionAltaType and RegistroFacturacionAnulacionType, lines 176/205                                                                                                                                                   | `<element name="FechaHoraHusoGenRegistro" type="dateTime"/>`                | Generation timestamp is a separate dateTime element for both record kinds. This schema alone does not prescribe using an IANA configuration string.                                                                              |
| [Orden HAC/1177/2024, art. 7(e)](https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138#a7)                                                                                                                                                       | «de acuerdo al territorio desde donde se expide la correspondiente factura» | Generation date/time follows the territory from which the invoice is issued. The recorded instant must be accurate; art. 7(f) separately gives the one-minute bound.                                                             |
| Same order, art. 7(g)                                                                                                                                                                                                                            | «deberá incluir el huso horario aplicado»                                   | Include the offset applied when the record is generated. Configured location time_zone is the proposed Waitron mechanism, not a field mandated by this wording.                                                                  |
| Same order, art. 13(1)(a)/(b)                                                                                                                                                                                                                    | «Fecha de expedición de la factura»                                         | The enumerated hash fields include issue date and generation date/time/offset for alta and annulment. Changing these future literals changes future hashes; adding Waitron's own time_zone metadata to the hash is not proposed. |

The schema and order distinguish issue date and generation timestamp. Neither tells Waitron to
store an IANA configuration name. Choosing the issuing location's configured zone is this design's
recommendation. No live AEAT submission was made. Source bytes and SHA-256 receipts are kept
under `a696-aeat-SuministroInformacion.xsd`, `a696-boe-1177.html` and
`a696-authority-sha256.txt` in the lane receipts. A444's separate service-date research and asesor
question remain in `docs/backlog.md:155` and `docs/compliance/asesor-questions.md:301`;
this audit does not decide them.

## Three different dates

| Concept                                                                      | Source behavior                                                                                                                                                                                                                                                                                                                                                                                                           | Proposed A696 boundary                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue date, `FechaExpedicionFactura`                                         | The backend supplies `sale.issuedAt` to the builder with `sale.offsetMinutes` (`packages/fiscal-verifactu/src/backend.ts:223`, `:235`). The builder extracts a calendar date.                                                                                                                                                                                                                                             | Use the issuing location's calendar day at actual issuance. A held order's opening date and a card's settlement date do not become issue dates.                                                                              |
| Generation moment, `FechaHoraHusoGenRegistro`                                | The same reading supplies `generadoEn` and offset for ordinary alta, corrective and substitution records (`backend.ts:235`, `:447`, `:567`). Void takes its own new reading (`:344`).                                                                                                                                                                                                                                     | Preserve the actual generation instant and express it with that location's offset at that instant. A resend retains the original literal.                                                                                    |
| Operation/service date, `sales.operation_date`, potentially `FechaOperacion` | For F1, core uses the bill's `openedAt` in its stored location zone; without a bill it uses the issue reading's day (`packages/core/src/record-sale.ts:276`). F2 stores null. The fiscal backend's alta input at `backend.ts:220` does not pass `FechaOperacion`. Paper exposes the saved operation day only when different from the saved issue day (`apps/server/src/receipt-issuer.ts:23`, `invoice-document.ts:146`). | Do not change the service-date selection, add `FechaOperacion`, or switch VAT's service-date rule under A696. A444 remains unresolved. Correcting which zone interprets an issue instant does not decide when the meal ends. |

The reporting business day also differs from all three: `day_cutover` is stored beside the zone
(`packages/db/src/schema/tenants.ts:82`). Do not use its 06:00 default to date an invoice.
VAT currently rates issuance through `issueMoment` using that reading's local calendar day
(`apps/server/src/issue-moment.ts:17`). A696 must keep rating and invoice dating on the same
reading; a move to service-time VAT determination belongs to the outstanding service-date work.

## Complete source inventory

In this table, **process clock** means `apps/server/src/till-backend.ts:14`: `new Date()` plus
`-instant.getTimezoneOffset()` at line 21. It reads neither `locations.time_zone` nor a reporting
clock. Boot creates two clock objects: the backend clock through `makeFiscalBackend`
(`till-backend.ts:46`, `boot.ts:1472`) and the till clock (`boot.ts:1503`). The latter is also
passed to management payments (`boot.ts:1668`) and the bill-payment recovery loop (`:2311`).

**Issue snapshot** means `issueMoment` (`issue-moment.ts:17`): one `clock.now()`, VAT rated by
`localCalendarDate`, then a clock whose `now()` always returns that reading. The calendar
conversion adds the supplied offset to the instant, then reads the ISO day
(`packages/catalogue/src/vat-rates.ts:102`).

| Path                                                                                              | Clock acquisition and chain to the writer                                                                                                                                                                                                                                                                                                                                                | Source result and required design treatment                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Walk-up cash or staff-recorded standalone card                                                    | `apps/server/src/till-sale.ts:2138` delegates to `runPayWorkingOrder`; `:636` checks settled replay first; `:741` calls `fileImmediateSale`; `:894` takes the issue snapshot from the process clock; `:910` calls core `recordSale`.                                                                                                                                                     | New invoice dates and record offsets follow process zone. Replace the new-issuance snapshot's offset source with the configured location.                                                                                                                                                                                                                                             |
| Retrieved held order, zero-due invoice, placed order paid on collection before any invoice exists | `till-sale.ts:2145` admits retrieved orders; shared payment issuance is `:881`; `collectOrder` begins at `:1994` and calls `fileImmediateSale` for uninvoiced collection at `:2084`.                                                                                                                                                                                                     | Parking, placing and serving are not generation events. Acquire the issue reading when the invoice is actually created. `working-order.ts:6037` places and `:6039` prints a collection ticket, without calling `recordSale`.                                                                                                                                                          |
| Integrated card capture, including accepted-offline card evidence                                 | `till-sale.ts:1290` accepts `captured`/`accepted_offline`; `finalizeCapture` at `:1475` takes its own issue snapshot at `:1503` and calls core at `:1513`.                                                                                                                                                                                                                               | The provider's `settledAt` stamps the tender; issuance uses the current process reading after capture. Keep this event choice, change only its zone interpretation. Validate configuration before starting an irreversible capture as well as at issuance.                                                                                                                            |
| Captured payment recovered before an invoice exists, including manager recovery                   | `finalizeRecovery`, `till-sale.ts:1615`, returns a settled replay first (`:1630`), then takes the issue snapshot (`:1639`) and calls core (`:1676`). Management recovery delegates into the same orchestration (`payments-api.ts:1029`).                                                                                                                                                 | A new invoice dates recovery-time generation, not the old capture. A recovery that finds an invoice must retain it.                                                                                                                                                                                                                                                                   |
| Invoice-first/deferred core API and later cash/card collection                                    | `packages/core/src/record-sale.ts:275` takes the supplied clock; `:353` distinguishes immediate settlement from deferred. Live unpaid issuance is described below. `till-sale.ts:1827` and `finalizeSettleRecovery` (`:1878`) settle an existing sale.                                                                                                                                   | Deferred issuance still creates the fiscal record immediately. Later settlement writes no new issue or generation date. The standalone CLI below also exercises this API. There is no separate automatic invoice-at-placement call in `placeOrder` (`working-order.ts:6005`).                                                                                                         |
| Table/bill final cash, manual card, or reader payment                                             | `bill-payments.ts:1132` / `:1307`; completion enters `issueWhenFullyPaid` (`:637`), takes the process issue snapshot (`:670`), then calls core (`:698`).                                                                                                                                                                                                                                 | Partial payment dates do not become invoice dates. Generate once when fully paid; preserve received-at dates on tenders (`:683`).                                                                                                                                                                                                                                                     |
| Bill card completion by worker, polling/retry, or manager attestation                             | `bill-payments-loop.ts:128` calls `completeBillPayment`; the latter calls `issueWhenFullyPaid` (`bill-payments.ts:1223`, `:1241`). Manager attestation uses the same completion (`payments-api.ts:1214`).                                                                                                                                                                                | A provider settlement can be earlier than the new invoice reading. All completion paths need the same venue-aware issuance behavior.                                                                                                                                                                                                                                                  |
| Non-payment action leaving a bill fully paid                                                      | Held-order save (`working-order.ts:5900`), line edit (`till-api.ts:3545`), split (`:3656`) and adjustment (`adjustments-api.ts:156`) call `issueIfFullyPaid` (`bill-payments.ts:785`).                                                                                                                                                                                                   | These are additional invoice triggers, not just edits. They share the same issue snapshot and must appear in acceptance coverage.                                                                                                                                                                                                                                                     |
| Table unpaid departure, open or placed bill                                                       | `unpaid-departure.ts:80` separates already-issued bills; `:109` calls `priceForIssuance`; `working-order.ts:6067` freezes the process issue reading; `unpaid-departure.ts:119` calls `issueUnpaidInvoice`; core call at `working-order.ts:6105`.                                                                                                                                         | New deferred invoice dates departure-time issuance. Already-issued bills keep their dates. Each invoice has its own frozen reading; no new requirement to make an entire party share one instant.                                                                                                                                                                                     |
| Live cancellation credit of an issued placed order                                                | `working-order.ts:6238` finds the invoice; `:6251` calls `creditWholeInvoice`; `cancel-credit.ts:64` calls core correction with `deps.clock` (`:74`). Core reads it once (`record-correction.ts:254`), stores the new issue instant/offset (`:272`) and passes them to the backend (`:327`).                                                                                             | New R5 has its own current issue date and generation time. Its reference to the old invoice keeps the old stored calendar date.                                                                                                                                                                                                                                                       |
| Generic corrective invoice/rectificativa API and refund distinction                               | `record-correction.ts:95` is exported; backend construction at `backend.ts:423`, `:447`. Core correction explicitly leaves money refund separate (`record-correction.ts:262`). Open-bill money refund requires an open bill (`bill-refunds.ts:631`) and inserts refund facts (`:656`), not an invoice.                                                                                   | Apply the new zone to new corrective issuance. Do not confuse a provider/payment `recordVoid` or refund with a fiscal anulación or rectificativa. No new refund or correction workflow is proposed.                                                                                                                                                                                   |
| Fiscal void/anulación                                                                             | Core `record-void.ts:101` calls the backend; backend reads the original alta and its node (`backend.ts:327`, `:341`), then takes **its own process clock** (`:344`). New generation instant/offset at `:357`; original date is anchored at midnight minus the new offset (`:353`). Core's own audit `voidedAt` is separate (`record-void.ts:89`).                                        | This path would be missed by changing only the till's clock. Use the original record's writing node/location for the new generation offset; retain the old invoice identity date. No application fiscal-void caller was found by the closure search; core API coverage is required.                                                                                                   |
| Substitution/canje                                                                                | Core reads `input.clock.now()` (`record-substitution.ts:177`), stores new issue instant/offset (`:197`) and passes them on (`:263`). Backend sets new F3 date/time (`backend.ts:557`, `:567`) and reconstructs every old reference from its stored day (`:540`).                                                                                                                         | New F3 uses the venue zone; substituted references retain their dates. No production application caller was found; this is an exported core capability, not a newly enabled route.                                                                                                                                                                                                    |
| Offline/emergency fiscal identity or series                                                       | Emergency preparation creates allocation metadata, including `issuedAt: new Date().toISOString()` (`emergency-preparation.ts:220`); activation is through `allocated-lifecycle.ts:9`, `:63`. The fiscal record closure search finds only the four backend append calls (`backend.ts:239`, `:361`, `:451`, `:571`).                                                                       | An allocation timestamp is not `FechaHoraHusoGenRegistro`. Once an allocated identity is active, invoice creation still uses the normal writers above. No separate client-side offline invoice generator was found. Accepted-offline card processing is the capture path above. Do not build offline selling or a new emergency filing path here.                                     |
| Duplicate/replayed sale, recovery winner and reprint                                              | Settled gates at `till-sale.ts:636`, `:1083`, `:1502`, `:1630`; `readSettledTicket` reads saved `issuedAt` (`:774`, `:820`), filed receipt (`:800`) and saved issuer/date facts (`:827`). Reprint at `:2169` uses receipt printing.                                                                                                                                                      | No new issuance reading or re-rating. Preserve saved fiscal fields and replay facts, including original dates, even after process-zone/configuration changes.                                                                                                                                                                                                                         |
| Outbox first send, retry/backoff, restart reset, brake probe and release                          | Drain maps stored rows through `toEnvioRegistro` and submits (`drain.ts:287`, `:1000`). Retry schedules update `envios` (`:992`), probe stamps envío time (`:913`), release updates scheduling (`:955`), restart reset enters through `slot.ts:79`.                                                                                                                                      | Sending time is not generation time. Reconstruct from saved offset and date, never current process/venue zone. Duplicate lookup also uses stored date/month (`drain.ts:1433`).                                                                                                                                                                                                        |
| Reconciliation-triggered resubmission                                                             | Reconciliation selects the stored issue month/date (`reconcile.ts:245`, `:248`) and formats that saved identity (`:252`). Its clock supplies detection time (`:152`). A first accepted-but-absent result calls `remediateNoTrace` (`:172`), which resets `envios` and stamps retry/detection metadata (`:376`), then the normal drain reconstructs the original row.                     | The detection clock is not a generation clock. Keep the original invoice date, generation literal and hash through this resubmission too; do not re-bucket existing records through today's configured zone.                                                                                                                                                                          |
| Filing cases and corrective resubmission                                                          | `filing-cases.ts:110` records notes/resolution, with optional already-existing remedy id; insert at `:165`. It does not call an invoice writer or record builder. Drain preserves old rows as above.                                                                                                                                                                                     | No current source path generating `Subsanacion`, `RechazoPrevio` or `SinRegistroPrevio` was found in the production closure search. A696 must not manufacture such a path or re-date a row to fix a refusal. A future genuinely new corrective filing must acquire its own generation reading while retaining the invoice identity required by its separately approved remedy design. |
| Configuration export/import                                                                       | `configuration-transfer.ts:93` exports location `time_zone`; table selection uses declared configuration contributions (`:179`, `:252`), validated on import (`:623`). Core's list (`packages/db/src/configuration-transfer.ts:26`) excludes sales; fiscal contribution is `kind: "none"` (`packages/composition/src/modules.ts:252`).                                                   | Imports configure the destination's future zone; they do not import fiscal history through this route. No generic historical invoice importer was found. Reject an unsupported history table under existing allowlisting; do not rebuild history from a new zone.                                                                                                                     |
| Archive/file/bucket restore and export of whole history                                           | Backup packs `db.dump` (`backup-sweep.ts:153`, `:161`); file validation supplies the restored database (`restore.ts:763`); placement renames/copies it (`:436`); migrations run at `:281`. Stream restore produces a database (`restore-stream.ts:299`) and uses the same validated write (`:341`). Fiscal restore activates the supplied identity (`allocated-lifecycle.ts:49`, `:60`). | These restore saved rows rather than re-issue invoices. Preserve stored dates, offsets, predecessor references and hashes; new post-restore records use the restored location setting. Test the preservation claim through the actual restore paths.                                                                                                                                  |
| Paper recovery export                                                                             | `packages/fiscal-verifactu/src/paper-recovery-export.ts:38` prepares allocation/approval evidence, not invoice records.                                                                                                                                                                                                                                                                  | This is not an invoice-history importer or a generation clock. Preserve the supplied recovery evidence rather than deriving it from invoice dates.                                                                                                                                                                                                                                    |
| Fiscal readiness sample                                                                           | `fiscal-readiness-runner.ts:128` provisions/reuses an isolated venue. New sample uses `systemClock()` for backend (`:140`) and core (`:159`). Its injected `args.now` supplies tender time (`:136`, `:162`), not the invoice clock. An existing sale skips new issuance (`:135`).                                                                                                        | Use the isolated venue's configured location and one explicit issue reading. Do not report an `args.now`-only probe as a controlled invoice-clock experiment. Retained readiness records/resends keep their historical dates.                                                                                                                                                         |
| Installed/CLI demo seed                                                                           | Installed demo delegates at `demo-seed.ts:26`; restaurant seeding calls `seedSales` (`scripts/demo-seed/seed.ts:123`). `seed-sales.ts:208` reads wall time, builds historical instants from UTC calendar days (`:215`, `:231`), derives **process offset per instant** (`:239`), rates that day (`:241`), sets the backdating clock and issues (`:304`).                                 | Keep the supplied historical instant; derive its offset from that seeded location. Do not substitute today's offset for historical instants. Demo schedule generation's UTC-day choice is distinct from invoice-zone conversion.                                                                                                                                                      |
| Standalone live-clock sales CLIs                                                                  | `scripts/record-one-sale.ts:47` and `scripts/settle-invoice-first.ts:51` duplicate `new Date()` / `getTimezoneOffset()`. They call core sale (`:143` / `:137`); the latter also calls correction (`:187`).                                                                                                                                                                               | These bypass the boot clock, so a boot-only fix misses them. Resolve their writing node's configured zone before issuing.                                                                                                                                                                                                                                                             |
| Fixed reporting/demo CLIs                                                                         | `scripts/daily-close-demo.ts:50` supplies August instant and `:58` hardcodes +120; `daily-close-z-demo.ts:60`, `:67` does likewise; `modelo-303-demo.ts:232` uses 10:00Z and +120, passed through `clockAt` (`:214`) to sale/correction (`:494`, `:532`).                                                                                                                                | Explicit fixture clocks, not process-zone clocks. Keep their instants and scenarios, derive the configured zone's offset, and require unchanged results where the configured zone at those August instants already agrees. Do not rewrite their history or protected fiscal fixtures.                                                                                                 |

### Zero offsets and UTC: which are actually invoice inputs

No independent hardcoded zero-offset Spanish issuer was found among the live call chains above.
On a UTC process, their process-derived offset is zero. That is the defect candidate, not evidence
that the final formatter ignores offsets.

`packages/fiscal/src/clock.ts:116` defaults an **unanchored generic** trusted reading to zero
unless a resolver is supplied; anchored readings default to the saved anchor offset (`:129`).
The production source search found the constructor/export but no application call to
`createTrustedClock`. This is not the boot clock, and A696 should not change its general clock
confidence policy. `packages/fiscal-none/src/backend.ts:44` uses `new Date()` and zero for its
void reference; this backend writes no Spanish fiscal record and is not an alternate Veri*Factu
issuer. Zero-offset attendance facts in `till-sale.ts:118`, `bill-payments.ts:1123`,
`bill-refunds.ts:121` and `working-order.ts:270` are not invoice generation inputs.

UTC storage is intentional and separate: `ts` maps a `Date` to `toISOString()`
(`packages/db/src/schema/columns.ts:23`); sales store an ISO instant plus
`issued_offset_minutes` (`record-sale.ts:315`). Do not replace UTC instant storage with an
unqualified local timestamp.

## Formatting, storage, hashes and resends

The installed dependency is `@waitron/verifactu@0.2.1` (`pnpm-lock.yaml:3997`). In the following
receipts, **V** means
`node_modules/.pnpm/@waitron+verifactu@0.2.1/node_modules/@waitron/verifactu/dist/`.
These are inspected dependency files, not repository source or AEAT authority.

`V/records.js:78` formats the supplied issue instant with the supplied offset; `:124` formats
generation time. Void does the equivalent at `:142` and `:151`. `V/format.js:108` shifts by the
explicit offset and uses UTC calendar accessors. `:119` emits whole seconds and an explicit
numeric `+hh:mm`/`-hh:mm`, including `+00:00`, not `Z`. Its shift helper refuses non-integer or
out-of-range offsets (`:98`). No process-zone lookup occurs in those formatters.

`chain.ts:172` builds the complete record, validates against `input.generadoEn` (`:189`), then
stores it (`:199`). `registro-row.ts:118` converts the generated literal to a UTC instant and
saves the offset separately. Issue date is stored as `YYYY-MM-DD` (`:131`, `:157`);
generation instant and `offset_minutos` have existing columns (`schema/registros.ts:93`).
References to corrected/substituted invoices are saved as their built date strings
(`registro-row.ts:138`). The predecessor's date is copied from the stored predecessor
(`chain.ts:157`, `registro-row.ts:112`).

On reconstruction, `registro-row.ts:329` formats **the stored instant and stored offset**;
`:343` and `:353` format stored calendar dates without looking up a zone. Chain verification
rebuilds that record (`verify.ts:64`), as does outbox submission (`drain.ts:1001`). Thus the
recommended change is at acquisition for new issuance, not reconstruction or send time.

The alta hash input is exactly issuer, series/number, issue date, invoice type, total tax, total,
predecessor hash and generation literal (`V/huella.js:35`). Anulación hashes its annulled issuer,
number and date, predecessor hash and new generation literal (`:49`). `computeHuella` hashes
the resulting canonical text (`:86`). A different textual offset changes a new record's hash
even when it describes the same instant. A changed calendar day can also change invoice identity.
Keep the algorithm and field list unchanged. Never add the configured zone name, location id,
environment or any other Waitron metadata to that text.

**Recommended storage decision: no migration and no data rewrite.** Existing issue dates,
instants and integer offset columns can represent the proposed new values. That is a design
assessment from the schema, not a measured compatibility result. Historic records, including
those produced in an unintended zone, retain their dates and offsets. Extend a chain using its
stored predecessor hash; do not recompute or replace that predecessor to make old rows look local.
The current pre-live reset allowance is not permission for A696 to repair history silently.

## Runtime deployment, read separately from appliance measurements

The runtime stage is `node:26-slim` (`deploy/Dockerfile:149`); its explicit ENV block
(`:250`) sets no `TZ`. The app service's environment and mounts (`deploy/compose.yml:21`, `:42`)
contain no `TZ` forwarding or local-time-file mount. The development compose environment begins
at `docker-compose.yml:15`; it also contains no such setting. `deploy/waitron.sh:202` installs
the selected compose file and `:629` starts it; source search found no time-zone setup there.
`apps/server/src/box-env.ts:17` merges configuration files into a returned environment object;
it is not a measurement of Node's effective process time zone.

These source facts do not establish the base image's inherited setting, a locally modified
compose, or the owner's running appliance zone. **The current published image and owner appliance remain unmeasured.**
A cached `waitron:dev` image, id `248ccc7f108f`, ran a network-disabled Node entrypoint probe
and printed Node v26.8.1, resolved zone UTC and offset 0 at the audit instant. It carries no
source label, so it cannot establish current-image behavior. Pulling the current published image
stalled without output in its Docker credential-helper child; the driver retained the process
snapshot and stopped only that owned pull/helper. See `a696-image-zone.log` and
`a696-appliance-limit.txt` in the lane receipts. Setting `TZ=Europe/Madrid` in deployment alone is not the recommended solution: it would
still bind invoice semantics to process configuration, miss Canary locations, and leave separate
CLI/test environments responsible for matching it.

## Recommended behavior contract, unapproved

### Resolve the writing location and freeze one issuance reading

Use the writing node's `nodes.location_id` and that location's `time_zone`. The existing mapping
is visible in `packages/reporting/src/business-day.ts:190`, but invoice conversion needs only
the zone, not the reporting day cutover. Check the request/order location against its existing
node/location constraints; do not choose a customer's zone, browser zone, saved language,
taxpayer domicile or device process zone. The void path resolves the original record's writing
node. Readiness and demos resolve their own isolated/seeded node, not the live appliance node.

Keep the current trusted source for the instant and its warning/confidence fields. Derive only
the offset from `(instant, configuredZone)`. Freeze a copied reading so pricing, sale storage,
record construction and immediate response cannot sample opposite sides of midnight or DST.
Do not mutate a shared `Date` or caller clock. Card capture/recovery keeps acquiring the invoice
instant at the current finalization point; payment settlement instants remain separate.

Put named-zone conversion in a neutral shared helper. A reusable existing algorithm is
`packages/venue-service/src/hours-occurrences.ts:9`, whose formatter cache is keyed by zone and
whose offset is computed for each instant; importing that domain package into core would need a
dependency check. Core or its generic issuance boundary should own resolving node/location and
preparing the reading, so standalone core users cannot silently retain process-zone dating.
The fiscal backend's void path must use the same preparation. Keep the low-level record builder
and `appendToChain` accepting explicit instants/offsets unchanged.

The server's `issueMoment` must receive that prepared reading **before** `rateLines` runs, then
pass the same reading to core. Resolving the zone only inside `recordSale` would leave VAT rated
on a different day. Sale, correction and substitution core entry points need the same preparation
contract; direct backend callers remain responsible for their explicit record input. API names
and exact helper placement are builder choices after approval, subject to module boundaries.

### Configuration snapshots, caching and errors

Read the zone in the issuing transaction, once for the invoice, and keep it with the frozen
reading for that invoice. Do not perform one settings lookup per line. A synchronous
`TrustedClock.now()` cannot itself await a database read; prepare the zone asynchronously before
using that clock, rather than hiding a database read in it. Keep queries in a transaction sequential.

Cache pure `Intl.DateTimeFormat` objects by validated zone if useful. Do not cache an offset, an
entire location setting for the life of a process, or a date-only result. An offset belongs to an
instant, not to the zone forever. A permitted zone edit before first issuance must affect the next
invoice without restarting. A captured request's final issuance uses the setting observed in its
issuing transaction; do not persist or later reuse a pre-capture numeric offset across DST.

Current settings edits already reject invalid/numeric zones (`venue-details.ts:197`) and lock
zone changes after sales, orders, daily closes or cutover history (`:95`, `:242`). **Keep those
rules.** Zone-change tests must distinguish an eligible edit from a test-only simulated settings
change after issuance. A696 grants no operator right to change historical invoice dates.

An absent, blank, invalid or unsupported stored zone must never silently fall back to UTC,
Madrid or the process zone. Validate at configuration/setup/import boundaries and before a
new external card capture. `planVenue` currently copies the supplied zone (`venue-plan.ts:193`);
do not assume every CLI path got browser validation. Surface malformed configured time as a
configuration fault, with a registered domain error and localized boundary wording. Existing
`venue.detail_invalid` is app-owned (`apps/server/src/errors.ts:48`), so a shared core helper
cannot assume it owns that registry entry. Exact shared error naming is a build-time convention
choice, not a new recovery policy in this design.

Missing node/location, a failing formatter or invalid instant must leave no partial fiscal row
or consumed number. Do not introduce an automatic sale-blocking clock-confidence threshold;
degraded-clock warnings retain their current semantics. **Unresolved build blocker: invalid zone discovered after capture.** Keep the captured payment
and its recovery evidence, generate no fiscal row under a guessed offset, and expose the fault.
That recommendation does not yet supply a usable repair path: the normal settings route locks
zone edits once an order exists. No administrative repair bypass is authorised here. Before a
plan or build is approved, the owner must decide the permitted repair route or explicitly accept
that issuance remains blocked until an administrator restores valid configuration by a separately
defined procedure. Following the [2026-10-15 answer](#owner-decision-recorded-2026-10-15-the-venues-saved-time-zone),
this repair question is next, with a worked hypothetical captured-payment example. Strict
issuance-zone validation is unbuilt; this audit does not reproduce that proposed fault.
The first answer alone does not release implementation.
The pre-live reset allowance does not make a reset a remedy for an already-captured payment.

### Preserve stored facts and the current scope of presentation

New issue and generation values use the location zone. Old sale rows, fiscal rows, stored
reference dates, fiscal replay facts, QR date inputs and hash inputs retain their stored facts.
Replays and sends must work even when current zone configuration is unreadable; they do not need
to convert the historical instant through today's zone. A newly generated void/correction after
a settings change still references the original stored date exactly.

There is an existing **presentation gap**: `readReceiptIssuer` only emits
`issuedOffsetMinutes` for a named recipient (`receipt-issuer.ts:30`). Without it, thermal
`receipt-document.ts:84` and browser `till-ticket-view.ts:145` format in their own runtime zone.
A fiscal-only acquisition change could therefore file 15 October while an ordinary F2 receipt
on the same UTC box still prints 14 October. **The recommended A696 build includes closing this
gap**, rather than leaving that mismatch in the proposed result.

Pass the saved invoice offset to receipt printing and till display independently of whether a
recipient exists. Keep recipient-only issuer/customer blocks gated as today. Reuse the stored
sale/fiscal facts; do not recompute an old date from today's location or browser zone. An older
invoice actually recorded at offset 0 continues to show its recorded day, even if the current
venue is Madrid. Preserve existing replay facts and compare repeated responses from the same
candidate; adding an offset field to the response/rendering contract is permitted by this proposed
design, not a demand to preserve an old JSON shape. Exact contract placement is a builder choice.
No storage migration or backwards-compatibility layer is proposed. F1/A4 already reads the saved
offset (`invoice-document.ts:145`) and must remain consistent. The future plan inventories any
changed whole-shape checks and leaves protected fiscal checks unedited unless separately approved.

Do not enable F1 issuance while resolving A696. The live guards still refuse it at
`till-sale.ts:493` and `working-order.ts:3635`. Core F1 is part of the audit and must be qualified
at its existing boundary without treating A444 as settled.

## Acceptance contract for the future separate build

**Every row below is a proposed requirement, not a test result.** CI must execute the relevant
behavior cases in **separate Node processes under both `TZ=UTC` and `TZ=Europe/Madrid`**.
A shell-only local rerun or a workflow environment variable never exercised by selected tests is
insufficient. Use the same configured location and fake instant in both processes and assert equal
filed dates, offsets and generation literals. Report real test counts/current-head CI evidence.
Use failing-first behavioral cases for the later build; do not edit protected golden huella or
inmutabilidad tests. Normal suites and fiscal gates remain required by the FULL workflow.

| Scenario in both process zones                                                                                           | Required assertions                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Madrid `2026-10-14T23:30:00Z`; control `2026-10-14T12:00:00Z`                                                            | At night: sale instant stays `23:30Z`, offset +120, row date `2026-10-15`, field `15-10-2026`, generation literal `2026-10-15T01:30:00+02:00`. Noon control: 14 October and +120. State predicted old failure before running; do not use noon alone.                                                                                                                                                                                                                                      |
| The queue's actual 00:30 example, `2026-10-14T22:30:00Z`                                                                 | Madrid date 15 October, literal `2026-10-15T00:30:00+02:00`; no assertion silently swaps this instant for 23:30Z.                                                                                                                                                                                                                                                                                                                                                                         |
| Every new-issuance trigger in the inventory                                                                              | Walk-up cash/manual card, held/placed/zero-due, reader capture and accepted-offline, captured recovery, bill final payment/recovery/attestation, save/line-edit/split/adjustment auto-issue, unpaid departure, deferred core API, correction, void, substitution, readiness, seed and both live-clock CLIs. Use each reachable real boundary; label core-only/unavailable routes instead of claiming a live route was exercised. Assert one invoice and one new record where appropriate. |
| Card or held order crosses local midnight                                                                                | Invoice/VAT rating share the final issuance reading; provider settlement and order opening retain their own instants. A retry finding the invoice keeps its original date.                                                                                                                                                                                                                                                                                                                |
| Winter/summer and midnight in `Atlantic/Canary`                                                                          | Winter zero becomes numeric `+00:00`, summer +60. At the 23:30Z October example: Canary date 15 October, literal `2026-10-15T00:30:00+01:00`. Also choose an instant where Canary's date differs from Madrid's, such as `2026-10-14T22:30Z`: Canary 14 October, Madrid 15 October. No constant +120. This tests conversion without enabling an unimplemented tax territory.                                                                                                               |
| Madrid spring DST boundary                                                                                               | Proposed fixed cases `2026-03-29T00:59:59Z` / `01:00:00Z`: `01:59:59+01:00` / `03:00:00+02:00`, same civil date. No fabricated nonexistent local time.                                                                                                                                                                                                                                                                                                                                    |
| Madrid autumn repeated hour                                                                                              | `2026-10-25T00:30Z` / `01:30Z`: `02:30+02:00` / `02:30+01:00`. Instants remain distinct, saved offsets differ, reconstruction and hashes match their original literals.                                                                                                                                                                                                                                                                                                                   |
| Eligible zone change while server remains running                                                                        | Before order/sale history, change configured zone through the real permitted settings boundary. The next invoice observes the new zone; formatter caching does not retain an old offset/setting. Existing history locks remain enforced.                                                                                                                                                                                                                                                  |
| Simulated post-issue zone/runtime change                                                                                 | With a fixture-only later settings mutation or restored copy, existing fiscal replay fields, stored issue date, record literal, QR date and hash stay unchanged. This is a preservation test, not permission to bypass the settings lock.                                                                                                                                                                                                                                                 |
| Receipt printing and till display, including F2 without a recipient                                                      | At the night instant, new Madrid invoices show 15 October on thermal paper and the till even when server/browser zones differ; replay/reprint uses the saved offset. Old offset-0 invoices retain 14 October. Recipient-only blocks remain gated. Qualify EN/ES, light/dark, phone/desktop in the real browser and inspect rendered receipt artifacts (LOOK).                                                                                                                             |
| Core F1 with bill opened before midnight                                                                                 | Issue day uses issuance in the venue zone. Existing saved service-start `operation_date` stays as currently selected; when it differs it remains separately represented. No `FechaOperacion` added to fiscal XML by A696; A444 remains open.                                                                                                                                                                                                                                              |
| Void/correction/substitution of an old invoice                                                                           | New generation has the new event's offset. Original invoice identity/reference day is unchanged even when its old offset or zone differs. Substitution covers multiple original dates. New chain pointer uses the original predecessor hash.                                                                                                                                                                                                                                              |
| Failed send, lost answer, restart resend, reconciliation no-trace resubmission, brake probe/release and duplicate lookup | Compare reconstructed fiscal payload and hash to the first attempt, not envío bookkeeping timestamps. Send across midnight/DST with a different process zone; no new generation date or hash. Reconciliation retains stored month/date selection. Case note/resolution generates no new fiscal row.                                                                                                                                                                                       |
| Configuration export/import                                                                                              | Zone is retained/validated and first destination issuance follows it; sales/fiscal history tables are refused by allowlisting. Import is not replayed issuance.                                                                                                                                                                                                                                                                                                                           |
| File/archive and bucket restore                                                                                          | Compare actual saved fiscal date, instant, offset, references, hash and reconstructed payload before/after restore and first drain. New post-restore issuance follows restored location; new identity activation does not re-date old records.                                                                                                                                                                                                                                            |
| Invalid/missing zone or failed conversion                                                                                | No silent zero/process fallback; error names configuration. Failure before capture moves no money; failure in issuance rolls back invoice number and all local invoice writes. Captured-payment recovery evidence is retained and the failure is visible. Verify that saved replays/resends still need no current-zone lookup.                                                                                                                                                            |
| Readiness/demo/CLI and protected fixtures                                                                                | Control the actual issuing clock, not readiness's tender-only `args.now`. Backdated seed computes offsets at historical instants; explicit August demos retain their intended values. Golden huella and inmutabilidad remain unedited and pass. A need to alter their expectations returns to the owner.                                                                                                                                                                                  |

The measurements above qualify only the named audit paths. The future build must execute this
acceptance contract. Fresh-context review checked the inventory, source provenance and measured
receipts. Its two material findings are reflected here: F2 rendering belongs in the proposed
build, and post-capture invalid-zone repair remains an explicit owner decision. The review and
triage are retained as `a696-review-1.md` and `a696-review-delta.md` in the lane receipts.
There is no implementation plan or approval to build. The captured-payment repair question above
is an explicit second decision still unresolved after the recorded first answer.

## Historical first owner question, answered 2026-10-15

The original question and recommendation below are retained as audit history. The
[dated owner decision above](#owner-decision-recorded-2026-10-15-the-venues-saved-time-zone)
records the approved answer; the post-capture repair question remains unresolved.

**Should new invoices use the location's configured time zone for filing, receipt printing and
till display, regardless of the server's time zone?**

The recommendation preserves old invoice dates, offsets, replay facts and hashes. A444's separate
operation/service-date decision remains open.

Recommendation, unapproved: **yes**. At `2026-10-14T23:30Z`, a Madrid location issues on
15 October at `01:30+02:00` even on a UTC server; at `22:30Z`, it issues at `00:30+02:00`.
For a meal opened on 14 October, this does not independently choose its operation/service date.
The alternatives are to retain the server-process rule, which makes deployment choose invoice
dates, or to choose a fixed UTC/peninsular rule, which ignores the location's configured rules
and, for a peninsular default, Canary local time. None of those alternatives is approved here.
The captured-payment repair question follows this first decision; approval of the time-zone default alone is not full-design or build approval.
