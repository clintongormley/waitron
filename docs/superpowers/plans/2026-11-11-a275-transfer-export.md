# A275 Task 6: the accountant's file of bills closed "to be paid by transfer"

_2026-11-11 (owner, 13:49): the words people see are now "Deferred payment" / «Pago aplazado», not "To be paid by transfer"; the file and button names follow. Code names keep `transfer` until a follow-up rename._

**Cleared by the watcher 2026-11-11 10:24 with two changes (below, marked "watcher 10:24"); owner
question 1 answered "B" 2026-11-11 10:25 (each download recorded).** Earlier status: proposed
2026-11-11, revised the same day after a fresh reader's review; for the watcher;
on `feat/a275-transfer-export` (off `main` at `e57d4ba008`). Every `file:line` below was read at
that commit. One thing was run; it is marked **Measured**. Everything else is read, not run.

**When this lands, a manager or the administrator can:** on the dashboard's **Sales & takings**
report, pick a range of business days with the two date fields already there and press **Export
bills to be paid by transfer (CSV)**. They get a spreadsheet file, in the venue's language, to give
their accountant: one row for every invoice whose bill was closed "to be paid by transfer" (closed as
final in Waitron; the accountant checks the bank outside Waitron) on a business day in that range.
Each row gives the invoice's number, type, issue date, the day the bill was closed, the customer named
on a full invoice, its amounts as issued, and the numbers and total of any later corrective invoices
(credit notes, _facturas rectificativas_) against it. The file holds rows only once Task 7 gives staff
the button that closes a bill by transfer; until then it holds the header line alone.
_2026-11-11: rows can already come from a device whose profile has the close action switched on
and that sends a close to the till route directly; no till screen sends one until Task 7._

Worked example, a Spanish venue, range 2026-11-02 to 2026-11-08: a €220 simplified invoice (F2, no
customer named) issued at a meal on 3 November, closed by transfer the next business day and later
credited €20 by corrective invoice R/3; and a €96.80 full invoice (F1) to Cliente SL closed on the 5th:

```
"Número de factura","Tipo","Fecha de expedición","Cerrada el","Cliente","NIF del cliente","Base imponible (EUR)","IVA (EUR)","Total (EUR)","Rectificada por","Total rectificado (EUR)"
"A/41","F2","03/11/2026","04/11/2026","","","200,00","20,00","220,00","R/3","-20,00"
"F/7","F1","05/11/2026","05/11/2026","Cliente SL","B12345674","80,00","16,80","96,80","","0,00"
```

The €220 row keeps its amounts as issued; the credit note is named and totalled in its own columns,
never netted off. A range of 3–3 November lists nothing: that bill was closed on the 4th. An English
venue gets "Invoice number", "Type", "Issue date", "Closed on", "Customer", "Customer tax number",
"Base (EUR)", "VAT (EUR)", "Total (EUR)", "Corrected by", "Corrections total (EUR)" and decimal points.
**Today only an F2 can show a correction:** `recordCorrection` refuses any invoice that names a
customer (`packages/core/src/record-correction.ts:207` → `correction-eligibility.ts:5–8`).

## Authority

- [Design §4](../specs/2026-10-22-a275-final-transfer-close-design.md#4-close-history-and-accountant-export),
  approved by the owner 2026-10-22 ("A275 looks fine"): an export gated by `report.export`, filtered
  by the day the bill closed, one row per invoice with its identity, the customer where present and
  its amounts as issued, safe against spreadsheet formulas, naming any later fiscal remedy so the
  original is neither erased nor netted. No bank-received date, debt or reconciliation column. This
  cuts the [master plan's Task 6](2026-10-22-a275-final-transfer-close.md#task-6-accountant-export-with-stable-facts-and-remedy-links)
  to current `main` and the lane rules. Owner's minimal scope 2026-10-21 and order "Tasks 4–6":
  lane L `queue.md`, A275 block and line 6.
- No schema change, no migration. The only write is the download's activity-log entry under owner
  question 1's recommended option. The fiscal core (hash, chain, numbering, `registros_facturacion`,
  the invoice writers) is untouched; the golden hash test and `inmutabilidad` are not edited; no
  existing assertion changes.

## Owner question (answered B, 2026-11-11 10:25)

**1. Who may download this file, and is each download recorded?** The file is a bulk list of
customers' tax numbers. Example: a manager downloads October's file on 3 November: 40 rows, six of
them full invoices naming customers, three of those sole traders (people, so personal data). Two
existing rules pull different ways: a full invoice's PDF is downloadable with `report.export` and each
download is recorded, who and when (`apps/server/src/orders-invoice-pdf.ts:30`, table
`invoice_pdf_downloads`); and exporting another person's data was made administrator-only by A980 O5
(`packages/identity/src/permissions.ts:13–14`, `personal_data.export`). The design (2026-10-22) says
`report.export`.

| Option | What happens in the example | Extra lines |
| --- | --- | --- |
| A. Managers and administrator may download; not recorded | The manager gets the file; nothing says they did | none |
| **B. Managers and administrator may download; each download recorded (recommended)** | The manager gets the file; the activity log says who downloaded which days and how many rows, on 3 November. A box that cannot write that entry (a full disk) gives no file | ~10 production (an activity kind `transfer_export.downloaded`, data `{ from, to, rows }` with no names, in `packages/db/src/activity-kinds.ts`; one `recordActivity` in the route's transaction), ~20 test. No migration: a table like `invoice_pdf_downloads` would need one |
| C. Administrator only | The manager asks the administrator, who downloads it | ~2 production (the route's permission and the screen's flag read `personal_data.export`); the refusal case uses a manager |

Recommended B: it keeps the approved design's permission, so the manager who deals with the
accountant can serve themselves, and records each bulk export the way a single invoice's PDF already
is, without a migration.

## What changed since the master plan (written 2026-10-22, read, never run)

| Master plan said | On `main` now | So this plan |
| --- | --- | --- |
| Input and columns carry `locationId` / `location_id` | `transfer_closures` has no location column (`packages/db/src/schema/transfer-closures.ts:40–54`); lane rule: nothing new is built on locations (`queue.md:21`) | Dropped |
| Scope to this box, reject caller overrides | Per-node reports read this box and those it took over from (`report-api.ts:184–193`); the modelo 303, the other file made for the accountant, covers every box (`report-api.ts:53–54`, `:215–234`); the taxpayer is the one `tenants` row | The file covers the whole venue, like modelo 303: no box filter. One box per venue today, so the two answers are the same |
| Reader in `packages/reporting` | The only way to make a real transfer close in a test, `transferCloseVenue` (`apps/server/src/testing/transfer-close-fixture.ts:44`), lives in `apps/server`, which `packages/reporting` cannot import | Reader and file writer in one new `apps/server/src/transfer-closed-export.ts`, tested through the real `closeBillByTransferTx` |
| Copy `attendance-export-csv.ts`'s quoting "without importing its private cell helper" | That helper is now exported as `csvCell` (`attendance-export-csv.ts:40`) and already reused by `misdated-sales-csv.ts:7`; its formula guard is tested at `attendance-export-csv.test.ts:126–145`. `csvCell(null)` prints `null` (`String(value)`, `:8`). The newer adviser-facing file, `misdated-sales-csv.ts`, writes in the venue's language (`box-health-api.ts:225`), dates as DD/MM/YYYY (`:107`) and amounts through its own `amountCell` (`:44–48`), which writes a comma for Spanish and keeps a minus sign free of the formula apostrophe | Text cells through `csvCell` with `null` written as empty; amounts through `amountCell`, exported from `misdated-sales-csv.ts` (one word); dates and language as that file does. No new CSV helper |
| A JSON view under `report.view` plus a CSV under `report.export` | The outcome is the file. (Task 5's plan, not landed, proposes the day's transfer total on the Sales screen) | CSV route only |
| A 366-day limit on the range | No report route limits its range: `period` and `categories` use `requireRange` alone (`report-api.ts:331`, `:356`; `server-kit/src/request-screens.ts:35–41`) | No limit (open question 3) |
| Test "export-only cannot view" | Roles are a ladder: `report.view` from supervisor (`identity/src/permissions.ts:41`), `report.export` from manager (`:52`), and a manager holds every supervisor permission (`:44–45`); nobody can hold export without view | Dropped; one refusal case for a supervisor |
| `void_ids`, `substitution_invoice_ids` columns | No production code writes `sale_voids` or `sale_substitutions`: grep finds inserts only in `packages/core/src/record-void.ts:88` and `record-substitution.ts:210`, whose callers are test files and `testing/order-venue.ts:226–238`; `docs/backlog.md` A556: "no route calls `recordSubstitution`" | Dropped (open question 2) |
| Remedy ids as JSON arrays | **No production path writes a correction of a transfer-closed bill today.** The fiscal remedy route runs with `ENABLED_REMEDIES = new Set()` (`fiscal-verifactu/src/record-remedy-routes.ts:21`, used at `:47`); the only other writer, cancelling a placed order (`working-order.ts:7488–7517`), needs the order `placed`, and a transfer-closed order is settled. The column is kept because the design asks for it and A802 (correcting part of a paid invoice, in this lane's queue) will write corrections through `sales.corrects_sale_id`, which this reader follows | Corrective invoice numbers (`formatInvoiceNumber`, `packages/core/src/record-sale.ts:105`), space-separated, oldest first, plus their total in its own column |
| `invoice_id`, `node_id`, `currency`, `classification`, `closed_at` columns | Every row of this file has the same classification; money is always euros (`packages/shared/src/money-format.ts:6`); an accountant looks invoices up by number | Dropped |
| `issue_date` from stored `issuedAt` plus `issuedOffsetMinutes` | The full invoice prints exactly that day (`apps/server/src/invoice-document.ts:115`) | Same computation |
| Reports → Closed by transfer page | Sales & takings already has from/to business-day fields (`dashboard-sales-screen.ts:386–403`) and an action pattern (its print button, `:575–627`); a download pattern exists (`vat-return-screen.ts:109–140`) | One button under those fields, shown only to those owner question 1 admits |

**Measured** 2026-11-11, a throwaway test (deleted, not committed) on a real `transferCloseVenue`:
an €18.00 Counter F2 issued at real time and closed through `closeBillByTransferTx` with
`clockAt(now + 1 day)` was accepted; its sale's `issued_at` read `2026-11-11T08:14:28.702Z` (offset
60), its `transfer_closures.business_day` read `2026-11-12`, so issue day and closure day differ as
the filter test needs. Had the next-day close been refused, the call would have thrown. A later F2
issued at real time was then accepted (no clock-behind refusal), and a €1.21 credit through
`recordCorrection` against that transfer-closed F2 was accepted: `corrects_sale_id` rows read
`[{ invoice_number: 1, code: "R", total: -121 }]`. The sale's `vat_breakdown` read
`[{"rate":"21.00","base":"14.88","tax":"3.12"}]`, `total` 1800.

## Changes (two PRs, below; one commit each)

**6a, server.**

1. New `apps/server/src/transfer-closed-export.ts`:
   - `listTransferClosedInvoices(tx, { from, to })` → rows of `{ invoiceNumber, invoiceType,
     issueDate, closedOn, recipientName, recipientTaxId, base, vat, total, correctedBy: string[],
     correctionsTotal }`. One query: `transfer_closures` joined to its `sales` row and that row's
     `invoice_series`, where `business_day` is between `from` and `to`, ordered by `business_day`,
     `closed_at`, `id`. A second query over the same filter joins `sales c on c.corrects_sale_id =
     tc.sale_id` (and its series), reading `c`'s number and `c.total`, ordered by `c.issued_at`,
     `c.id`, grouped in JavaScript; no date limit on the corrections, so one issued weeks later is
     still named. No list of ids is bound, so a long range cannot exceed the engine's bound-value
     limit. F1 when `counterparty_tax_id` is set, else F2 (the convention at `orders-list.ts:464`,
     `:946`). `total` and each correction's total through `centsToDecimal`, the corrections summed
     with `sumDecimals` (`"0.00"` when none); `base` and `vat` are the sums of `vat_breakdown`'s
     strings with `sumDecimals` (CLAUDE.md §3: JSON amounts are summed in JavaScript at money scale).
   - `renderTransferClosedCsv(rows, language: "en" | "es")` → `Uint8Array`: a header in that
     language, then one line per row. Text cells through `csvCell`, a `null` written as `""`; dates
     DD/MM/YYYY; amounts through `amountCell`; `correctedBy` joined by a space; UTF-8 with a
     byte-order mark, CRLF line ends (`attendance-export-csv.ts:37`, `misdated-sales-csv.ts:117`).
   - Words in a new `apps/server/src/i18n/transfer-export.ts`, EN and ES, beside
     `i18n/misdated-sales.ts`.
2. `misdated-sales-csv.ts:44`: export `amountCell`.
3. `apps/server/src/report-api.ts`, after the `period` route (`:328`): `POST
   /management-api/reports/closed-by-transfer?from=&to=` (a POST because it writes the activity entry:
   the own-page origin check and the read-only gate pass a GET unchecked; finish-branch review
   2026-11-11). `requireManagementSession`, then
   `requireRange` (as `period` does: a malformed range is a 400 `management.request_invalid` with
   `field` "from", "to" or "range", already in `STATUS`, `:74`), then one `withTransaction` that calls
   `authorizeManager` with `report.export` (`:172–181` shows the shared gate; this route needs its
   `authorizedBy`), reads the rows and records the activity (option B, owner 10:25). The language is the
   venue's: `deps.venueLocale` (`:60`) through the existing `toLanguage`
   (`apps/server/src/personal-data-export-api.ts:53`), never a new mapping (watcher 10:24). Answers
   `text/csv; charset=utf-8`, `attachment; filename="closed-by-transfer-{from}-{to}.csv"`,
   `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` (`attendance-export-api.ts:101–110`).
   The doc comment at `:164–170` gains "and the transfer file".
4. Option B (owner 10:25): `packages/db/src/activity-kinds.ts` gains `transfer_export.downloaded`, data
   `{ from, to, rows }`, subject `report`.

**Personal data.** The file carries customers' names and tax numbers (owner question 1). Nothing new
is logged; the route's only refusals carry `{ field }`; the reader throws nothing with sale fields in
its params; the activity entry names no one but the downloader, by id. A log or error field that ever
carries a customer's name or tax number is named for the customer (`customerTaxId`,
`customerName`, CLAUDE.md §3) and added to `PERSONAL_LOG_KEYS` (`apps/server/src/log-personal-data.ts:32–46`,
which lists neither today); never a bare `legalName` or `taxId`.

**6b, dashboard and guide.**

5. `api/client.ts`: `downloadClosedByTransfer({ from, to }): Promise<Blob>`, as
   `downloadOrderInvoicePdf` (a POST, `:4366`).
6. `screens/dashboard-sales-screen.ts`: `@property canExport = false` (beside `:193`); state
   `exporting` and `exportErrorKey`. Under the date fields (`render`, after the pickers block ending
   `:403`), only when `canExport`: a secondary `wt-button` `data-test="export-transfer"`, loading while
   sending, disabled while the range runs backwards (`#rangeRunsBackwards`, `:263`, whose refusal the
   screen's banner already shows); under it a `p.error role="alert" data-test="export-error"` with
   `codeMessage`, the print action's pattern (`:575–627`). The handler copies
   `vat-return-screen.ts:109–140`: ignore a press while sending, send the range as it stood at the
   press, name the file from that range, keep both date fields as they are on failure so pressing
   again retries.
7. `dashboard-app.ts:2956–2957`: pass `.canExport=${this.#sessionPermissions.includes("report.export")}`,
   as Orders does (`:2963`) (`personal_data.export` under option C).
8. Words, EN and ES (`i18n/strings.ts`, near `sales.print_categories`, `:2583`, `:6472`):
   `sales.export_transfer` — "Export bills to be paid by transfer (CSV)" / "Exportar cuentas a pagar
   por transferencia (CSV)".
9. Data-protection guide, "Full invoices", who receives the data — one sentence each, appended:
   EN `apps/server/src/guide/en/data-protection.md:312–314`: "and your accountant, when you give them
   the file of bills closed to be paid by transfer from **Sales & takings**, which lists each such
   invoice's customer name and tax number." ES `guide/es/data-protection.md:335–337`: "y tu asesor,
   cuando le das el archivo de cuentas cerradas a pagar por transferencia de **Ventas y
   recaudación**, que lista el nombre y el NIF del cliente de cada una de esas facturas."
10. Docs: the A275 lines in `docs/backlog.md` and `docs/backlog/fiscal.md` say Tasks 0–6 are built;
    a dated note under the master plan's Task 6 points here.

**Look at it** (CLAUDE.md §4: open it and look): the Sales screen as a manager, EN and ES, light and
dark, desktop and 390 px wide, with the button idle, sending and refused; and a downloaded file opened
in a spreadsheet in each language. Screenshots stay out of the repository.

## Tests (red first; real `useVenueDb`)

**`apps/server/src/transfer-closed-export.test.ts`** (new; one database for the whole file,
`resetPerTest: false`, so the cases run in this order and later ones see earlier rows;
`transferCloseVenue`; a manager and a supervisor with management sessions made as
`report-api.test.ts:160–178` does). Test support: `credit` and its two private helpers in
`testing/order-venue.ts:176–224` take a `BillVenue` instead of an `OrderVenue` (they read only `db`,
`deviceId`, `adminId`, `backend`, `cfg`, `clock`), so the file credits through the real
`recordCorrection`.

1. **Filtered by the closing day, not the issue day.** A Counter F2 (Tarta, €18.00) issued now and
   closed with `clockAt(now + 30 hours)`, so the close lands on a later business day even before the
   05:00 day change: listed for that day with
   `{ invoiceNumber: "A/1", invoiceType: "F2", issueDate: <today>, closedOn: <tomorrow>,
   recipientName: null, recipientTaxId: null, base: "14.88", vat: "3.12", total: "18.00",
   correctedBy: [], correctionsTotal: "0.00" }`; today alone lists nothing. This close writes no
   fiscal record (the invoice was already issued), so later fiscal writes at real time pass the
   clock-behind stop (measured; CLAUDE.md §4). The local-day reader case added at review issues a
   sale a year ahead, last of the reader's cases; nothing after it in the file writes a fiscal record.
2. **A full invoice names its customer.** A table F1 to `RECIPIENT`, closed now (the shape of
   `transfer-close.test.ts:76–103`): `recipientName: "Cliente SL"`, `recipientTaxId: "B12345674"`,
   `invoiceType: "F1"`.
3. **A later credit is named and totalled, not netted.** `credit(venue, case1Bill, "1.00", "-1.21")`
   after case 1's close (case 1's F2: a credit of case 2's F1 is refused, `sale.correction_unsupported`):
   `correctedBy: ["R/1"]`, `correctionsTotal: "-1.21"`, and `base`, `vat`, `total` as in case 1.
4. **Ordered by closing day.** Today to tomorrow lists case 2's F1 (closed today, written second)
   before case 1's F2 (written first, closed tomorrow).
5. **The file.** `renderTransferClosedCsv` in English of two rows, an F2 with no customer and a
   correction, and an F1 whose customer is `=HYPERLINK("x")`: the decoded text equals, exactly, BOM +
   header + `…,"","",…,"R/1","-1.21"` + `…,"'=HYPERLINK(""x"")",…` + CRLF; of no rows, BOM + header +
   CRLF; in Spanish, the Spanish header, `"14,88"`, `"-1,21"` and dates as DD/MM/YYYY. (`csvCell`'s
   own cases stay in `attendance-export-csv.test.ts`; this pins only that this file uses it.)
6. **The route** (mounted with `venueLocale: "es-ES"`, after case 3). As the manager,
   `?from=<tomorrow>&to=<tomorrow>` answers 200 with the four headers and a body equal to
   `renderTransferClosedCsv(<reader for that range>, "es")`, whose one data line names `A/1` and
   `R/1`; under option B, one new `activity_log` row of kind `transfer_export.downloaded`, actor the
   manager, data `{ from, to, rows: 1 }`. The supervisor (holds `report.view`) answers 403
   `authorization.not_permitted` and adds no activity row. (No backwards-range case: it is tested
   where `requireRange` lives; watcher 10:24.) Added at review (2026-11-11): a GET or HEAD to the
   address serves no file and records nothing; a refused activity insert answers 500 with no file.
   A reader case added then, last of the reader's cases: an invoice issued at
   `<next year>-01-01T23:30Z` at offset +60 shows issue date `<next year>-01-02` and closing day
   `<next year>-01-01`; it writes a fiscal record a year ahead, so no later case in the file writes
   one.

**Dashboard** (after `memory_pressure` shows headroom; real Chromium):

7. `dashboard-sales-screen.test.ts`: no `export-transfer` without `canExport`; with it, a press sends
   `{ from, to }` as the fields stand and hands the blob to `URL.createObjectURL` under
   `closed-by-transfer-{from}-{to}.csv`; two presses while sending send one request; a refusal shows
   `codeMessage` in `export-error`, leaves both fields unchanged, and a second press asks again; the
   button is disabled while `from` is after `to`.
8. `dashboard-app.test.ts`: the `it.each` at `:2472–2490` gains a twin for `dashboard-sales-screen`
   (`report.view` → `canExport` false; plus `report.export` → true).

**Deletion controls** (each run once, recorded in the PR, not committed): filter on the sale's issue
day (case 1 fails); recipient columns read as null (case 2); corrections query removed (case 3,
`correctedBy`); corrections total left at zero (case 3); `total` taken net of corrections (case 3,
`total`); `order by` removed (case 4: insertion order puts case 1 first); `null` passed to `csvCell`
unmapped (case 5 reads `"null"`); cells quoted without `csvCell` (case 5); amounts through `csvCell`
(case 5 reads `"'-1.21"`); language ignored (case 5, Spanish); no byte-order mark, or LF line ends
(case 5); route gated by `report.view` (case 6, 403); `recordActivity` removed (case 6, option B); added at review: route registered with
`app.get` (the GET/HEAD case gets 200), `recordActivity`'s failure swallowed (the refused-insert case
gets 200), issue date taken as the UTC day (the local-day case reads `…-01-01`); screen ignores `canExport`, sends today instead of the
fields, drops the refusal, or never disables (case 7); `.canExport` not passed (case 8).

**Commands:**
`pnpm --filter @waitron/server exec vitest run src/transfer-closed-export.test.ts src/attendance-export-csv.test.ts src/misdated-sales-csv.test.ts src/report-api.test.ts src/report-api.reports.test.ts src/bill-lookup-api.test.ts src/find-bill-transactions.test.ts src/guide-content.test.ts`
(the bill-lookup and find-bill suites use the widened `credit`);
`pnpm --filter @waitron/db exec vitest run src/activity-log.test.ts` (option B);
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
with `git diff main -- packages/fiscal-verifactu packages/core packages/db/src/schema packages/db/drizzle`
empty;
`pnpm --filter @waitron/dashboard exec vitest run src/screens/dashboard-sales-screen.test.ts src/screens/dashboard-sales-screen.a11y.test.ts src/dashboard-app.test.ts`;
typecheck db, server and dashboard. Read each run's `Tests` count.

**Implementer dispatches** (each well under 100 tool calls): (i) 6a cases 1–4; (ii) 6a cases 5–6;
(iii) 6b with cases 7–8, the guide lines, the look and the docs.

## Size, and the split

About 190 production lines: 6a about 135 (reader and file ~75, words ~28, route ~22, `amountCell`
export 1, activity kind and entry ~9 under option B), 6b about 55 (client ~8, screen ~40, wiring 1,
words 4), plus two guide sentences. About 300 test lines: 6a about 215 (setup ~35, reader cases ~80,
file cases ~45, route ~55), 6b about 75, test-support types ~3. Clearly over 150, so **two PRs**:
**6a** (server: the route works by its address, no button yet; `main` stays green and working) and
**6b** (dashboard button, wiring, guide, docs) stacked on 6a until it lands. Review weight for each: a
permission-gated route and a contract between server and dashboard, so the full `/finish-branch`
wave, Codex as two reviews (lane rule); the owner lands both.

## Build off `main`, not stacked on Task 5

Task 6 needs nothing Task 5 builds, and the lane rule (owner 2026-11-01, `queue.md:17`, `:20`) says
overlap is never a reason to wait: build on `main`; whoever lands second rebases. Files both touch:

| File | Task 5 (plan, `feat/a275-closed-bills`) | Task 6 |
| --- | --- | --- |
| `apps/server/src/report-api.ts` | overview (`:255`) and daily-close (`:296`) routes, a helper, an import | one route after `:328` (6a) |
| `apps/dashboard/src/screens/dashboard-sales-screen.ts` | per-device table and Records in the close | a property, two states, a handler, a block under the date fields (6b) |
| `dashboard-sales-screen.test.ts` | new cases; `closureSummary` added to stubs | new cases (6b) |
| `apps/dashboard/src/api/client.ts` | `ClosureSummaryDto` near `:1463–1498` | one method near `:4400` (6b) |
| `apps/dashboard/src/i18n/strings.ts` | `overview.*`, `sales.*` keys | one `sales.*` key, adjacent lines: expect a small conflict (6b) |
| `docs/backlog.md`, `docs/backlog/fiscal.md`, the master plan | A275 lines; note under Task 5 | A275 lines (will conflict; extend the wording); note under Task 6 (6b) |

Task 4 (#2797, not landed) also edits `client.ts`, `strings.ts` (`orders.*`) and the A275 backlog
lines; Task 6 does not edit `transfer-close-fixture.ts`, which #2797 changes.

## Left out, and why

- A screen listing the bills, a JSON view, a range limit, a per-box filter: see "What changed".
- Voids and replacement invoices: no route makes either today (open question 2).
- A how-to guide section: no guide page covers Sales & takings (`apps/server/src/guide/en/` has
  none), and master plan Task 7 writes the bilingual closed-by-transfer guide, after which staff can
  make rows. The data-protection guide is updated here (change 9), because who receives customers'
  data changes when this lands.
- An index for the range read: the table's index leads with `node_id` (`transfer-closures.ts:74`),
  so a venue-wide range reads the whole table, which holds one row per bill closed by transfer. Not
  measured; a schema change is a migration rebuild, so not here.

## Open questions (each with a default the build follows unless told otherwise)

1. **Totals only**: no VAT per rate, no operation date (A444 may give a meal past midnight one), no
   customer country or identifier type. (2026-11-12: A444 instead removed the operation date;
   no invoice carries one.) Default: the columns in the example.
2. **No void or replacement-invoice columns** until a route writes them (A556 for replacements);
   that change adds its column here. Default: left out.
3. **No range limit**, as the other report ranges. Default: none.
4. **The button ships before Task 7** (owner's order, Tasks 4–6 first) and gives a header-only file
   until Task 7 lets staff close a bill by transfer. Default: ship.
5. **The venue's language, not the signed-in person's**, as the misdated-sales file does. Default:
   the venue's.

## For the watcher

Owner question 1 was answered B (2026-11-11 10:25); 6a is built to it. Open questions 1–5 have
defaults. Build 6a off
`main`; rebase after #2797 or Task 5, whichever lands first.
