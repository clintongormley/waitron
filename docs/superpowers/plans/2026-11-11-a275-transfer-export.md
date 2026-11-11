# A275 Task 6: the accountant's file of bills closed "to be paid by transfer"

**Status: proposed 2026-11-11, for the watcher; on `feat/a275-transfer-export` (off `main` at
`e57d4ba008`).** Every `file:line` below was read at that commit. One thing was run; it is marked
**Measured**. Everything else is read, not run.

**When this lands, a manager or the administrator can:** on the dashboard's **Sales & takings**
report, pick a range of business days with the two date fields already there and press **Export
bills to be paid by transfer (CSV)**. They get a spreadsheet file to give their accountant: one row
for every invoice whose bill was closed "to be paid by transfer" (closed as final in Waitron; the
accountant checks the bank outside Waitron) on a business day in that range. Each row gives the
invoice's number, type, issue date, the day the bill was closed, the customer named on a full
invoice, its amounts as issued, and the numbers of any later corrective invoices (credit notes,
_facturas rectificativas_) against it. The file holds rows only once Task 7 gives staff the button
that closes a bill by transfer; until then it holds the header line alone.

Worked example, range 2026-11-02 to 2026-11-08: a €220 simplified invoice (F2, no customer named)
issued at a meal on 3 November and closed by transfer the next business day, later credited €20 with
corrective invoice R/3; and a €96.80 full invoice (F1) to Cliente SL closed on the 5th. The file:

```
"invoice_number","invoice_type","issue_date","closed_on","recipient_name","recipient_tax_id","base","vat","total","corrected_by"
"A/41","F2","2026-11-03","2026-11-04","","","200.00","20.00","220.00","R/3"
"F/7","F1","2026-11-05","2026-11-05","Cliente SL","B12345674","80.00","16.80","96.80",""
```

The €220 row keeps its amounts as issued; the credit note is named, never netted off. A range of
3–3 November lists nothing: the €220 bill was closed on the 4th.

## Authority

- [Design §4](../specs/2026-10-22-a275-final-transfer-close-design.md#4-close-history-and-accountant-export),
  approved by the owner 2026-10-22 ("A275 looks fine"): an export gated by `report.export`, filtered
  by the day the bill closed, one row per invoice with its identity, the customer where present and
  its amounts as issued, safe against spreadsheet formulas, naming any later fiscal remedy so the
  original is neither erased nor netted. No bank-received date, debt or reconciliation column. This
  cuts the [master plan's Task 6](2026-10-22-a275-final-transfer-close.md#task-6-accountant-export-with-stable-facts-and-remedy-links)
  to current `main` and the lane rules. Owner's minimal scope 2026-10-21 and order "Tasks 4–6":
  lane L `queue.md`, A275 block and line 6.
- No schema change, no migration, no write of any kind. The fiscal core (hash, chain, numbering,
  `registros_facturacion`, the invoice writers) is untouched; the golden hash test and
  `inmutabilidad` are not edited; no existing assertion changes.

## What changed since the master plan (written 2026-10-22, read, never run)

| Master plan said | On `main` now | So this plan |
| --- | --- | --- |
| Input and columns carry `locationId` / `location_id` | `transfer_closures` has no location column (`packages/db/src/schema/transfer-closures.ts:40–54`); lane rule: nothing new is built on locations (`queue.md:21`) | Dropped |
| Scope to this box, reject caller overrides | Per-node reports read this box and those it took over from (`report-api.ts:184–193`); the modelo 303, the other file made for the accountant, covers every box (`report-api.ts:53–54`, `:215–234`); the taxpayer is the one `tenants` row | The file covers the whole venue, like modelo 303: no box filter. One box per venue today, so the two answers are the same |
| Reader in `packages/reporting` | The only way to make a real transfer close in a test, `transferCloseVenue` (`apps/server/src/testing/transfer-close-fixture.ts:44`), lives in `apps/server`, which `packages/reporting` cannot import | Reader and file writer in one new `apps/server/src/transfer-closed-export.ts`, tested through the real `closeBillByTransferTx` |
| Copy `attendance-export-csv.ts`'s quoting "without importing its private cell helper" | That helper is now exported as `csvCell` (`attendance-export-csv.ts:40`) and already reused by `misdated-sales-csv.ts:7`; its formula guard is tested at `attendance-export-csv.test.ts:126–145` | Reuse `csvCell`; no new CSV helper. It quotes every cell and puts an apostrophe before text starting with `=`, `+`, `-`, `@`, tab or CR (`:3–10`). Amounts here are never negative (`sales_total_ck`, `packages/db/src/schema/sales.ts:146`), so no number gains an apostrophe |
| A JSON view under `report.view` plus a CSV under `report.export` | The outcome is the file; Task 5 already puts the day's transfer total on the Sales screen | CSV route only |
| A 366-day limit on the range | No report route limits its range: `period` and `categories` use `requireRange` alone (`report-api.ts:331`, `:356`; `server-kit/src/request-screens.ts:35–41`) | No limit (open question 4) |
| Test "export-only cannot view" | Roles are a ladder: `report.view` from supervisor (`identity/src/permissions.ts:41`), `report.export` from manager (`:52`), and a manager holds every supervisor permission (`:44–45`); nobody can hold export without view | Dropped; one refusal case for a supervisor |
| `void_ids`, `substitution_invoice_ids` columns | No production code writes `sale_voids` or `sale_substitutions`: grep finds inserts only in `packages/core/src/record-void.ts:88` and `record-substitution.ts:210`, whose callers are test files and `testing/order-venue.ts:226–238`; `docs/backlog.md` A556: "no route calls `recordSubstitution`" | Dropped (open question 3). Corrective invoices are real today: the fiscal remedy route (`fiscal-verifactu/src/record-remedy-corrective.ts:24`, behind its enable switch) and soon A802 |
| Remedy ids as JSON arrays of internal ids; `invoice_id`, `node_id`, `currency`, `classification`, `closed_at` columns | An accountant looks invoices up by number (`formatInvoiceNumber`, `packages/core/src/record-sale.ts:105`); every row of this file has the same classification; money is always euros (`packages/shared/src/money-format.ts:6`) | Corrective invoice numbers, space-separated, oldest first; the five columns dropped |
| `issue_date` from stored `issuedAt` plus `issuedOffsetMinutes` | The full invoice prints exactly that day (`apps/server/src/invoice-document.ts:115`) | Same computation |
| Reports → Closed by transfer page | Sales & takings already has from/to business-day fields (`dashboard-sales-screen.ts:386–403`) and an action pattern (its print button, `:575–627`); a download pattern exists (`vat-return-screen.ts:109–140`) | One button under those fields, shown only with `report.export` |

**Measured** 2026-11-11, a throwaway test (deleted, not committed) on a real `transferCloseVenue`:
an €18.00 Counter F2 issued at real time and closed through `closeBillByTransferTx` with
`clockAt(now + 1 day)` was accepted; its sale's `issued_at` read `2026-11-11T08:14:28.702Z` (offset
60), its `transfer_closures.business_day` read `2026-11-12`, so issue day and closure day differ as
the filter test needs. Had the next-day close been refused, the call would have thrown. A later F2
issued at real time was then accepted (no clock-behind refusal), and a €1.21 credit through
`recordCorrection` against the transfer-closed sale was accepted: `corrects_sale_id` rows read
`[{ invoice_number: 1, code: "R", total: -121 }]`. The sale's `vat_breakdown` read
`[{"rate":"21.00","base":"14.88","tax":"3.12"}]`, `total` 1800.

## Changes (one PR, two commits)

**6a, server.**

1. New `apps/server/src/transfer-closed-export.ts`:
   - `listTransferClosedInvoices(tx, { from, to })` → rows of `{ invoiceNumber, invoiceType,
     issueDate, closedOn, recipientName, recipientTaxId, base, vat, total, correctedBy: string[] }`.
     One query: `transfer_closures` joined to its `sales` row and that row's `invoice_series`, where
     `business_day` is between `from` and `to`, ordered by `business_day`, `closed_at`, `id`. A second
     query over the same filter joins `sales c on c.corrects_sale_id = tc.sale_id` (and its series)
     for the corrective invoice numbers, ordered by `c.issued_at`, `c.id`, grouped in JavaScript; no
     date limit on the corrections, so one issued weeks later is still named. No list of ids is bound,
     so a long range cannot exceed the engine's bound-value limit. F1 when `counterparty_tax_id` is
     set, else F2 (the convention at `orders-list.ts:464`, `:946`). `total` through `centsToDecimal`;
     `base` and `vat` are the sums of `vat_breakdown`'s strings with `sumDecimals`, at two places
     (CLAUDE.md §3: JSON amounts are summed in JavaScript at money scale). Reads only.
   - `renderTransferClosedCsv(rows)` → `Uint8Array`: the header above, then one line per row, every
     cell through `csvCell`, `correctedBy` joined by a space, UTF-8 with a byte-order mark, CRLF line
     ends — the shape `renderAttendanceCsv` writes (`attendance-export-csv.ts:37`).
2. `apps/server/src/report-api.ts`, after the `period` route (`:328`): `GET
   /management-api/reports/closed-by-transfer?from=&to=`. `requireManagementSession`, then
   `requireRange` (as `period` does, so a malformed range is a 400 `management.request_invalid` with
   `field` "from", "to" or "range", already in `STATUS`, `:74`), then `gated(…, REPORT_EXPORT_PERMISSION,
   …)` (`:172–181`). Answers `text/csv; charset=utf-8`, `attachment; filename="closed-by-transfer-{from}-{to}.csv"`,
   `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` (the attendance export's headers,
   `attendance-export-api.ts:101–110`). The doc comment at `:164–170` gains "and the transfer file".

**Personal data.** The file carries a customer's name and tax number, as the full-invoice PDF that
`report.export` already downloads does (`orders-api.ts:366–385`). Nothing new is logged; the route's
only refusals carry `{ field }`; the reader throws nothing with sale fields in its params. A log or
error detail that ever does must use a key on `PERSONAL_LOG_KEYS` (`legalName`, `taxId`;
`apps/server/src/log-personal-data.ts:32–46`).

**6b, dashboard.**

3. `api/client.ts`: `downloadClosedByTransfer({ from, to }): Promise<Blob>`, as
   `downloadVatReturnFile` (`:4400–4409`).
4. `screens/dashboard-sales-screen.ts`: `@property canExport = false` (beside `:193`); state
   `exporting` and `exportErrorKey`. Under the date fields (`render`, after the pickers block ending `:403`), only when
   `canExport`: a secondary `wt-button` `data-test="export-transfer"`, loading while sending,
   disabled while the range runs backwards (`#rangeRunsBackwards`, `:263`, whose refusal the screen's
   banner already shows); under it a `p.error role="alert" data-test="export-error"` with
   `codeMessage` — the print action's pattern (`:575–627`). The handler copies
   `vat-return-screen.ts:109–140`: ignore a press while sending, send the range as it stood at the
   press, name the file from that range, keep both date fields as they are on failure so pressing
   again retries.
5. `dashboard-app.ts:2956–2957`: pass `.canExport=${this.#sessionPermissions.includes("report.export")}`,
   as Orders does (`:2963`).
6. Words, EN and ES (`i18n/strings.ts`, near `sales.print_categories`, `:2583`, `:6472`):
   `sales.export_transfer` — "Export bills to be paid by transfer (CSV)" / "Exportar cuentas a pagar
   por transferencia (CSV)".
7. Docs: the A275 lines in `docs/backlog.md` and `docs/backlog/fiscal.md` say Tasks 0–6 are built; a
   dated note under the master plan's Task 6 points here.

**Look at it** (CLAUDE.md §4: open it and look): the Sales screen as a manager, EN and ES, light and
dark, desktop and 390 px wide, with the button idle, sending and refused; and the downloaded file
opened in a spreadsheet. Screenshots stay out of the repository.

## Tests (red first; real `useVenueDb`)

**`apps/server/src/transfer-closed-export.test.ts`** (new; one database for the file,
`resetPerTest: false`, `transferCloseVenue`; a manager and a supervisor with management sessions
made as `report-api.test.ts:160–178` does). Test support: `credit` and its two private helpers in
`testing/order-venue.ts:176–224` take a `BillVenue` instead of an `OrderVenue` (they read only
`db`, `deviceId`, `adminId`, `backend`, `cfg`, `clock`), so the file credits through the real
`recordCorrection`.

1. **Filtered by the closing day, not the issue day.** A Counter F2 (Tarta, €18.00) issued now and
   closed with `clockAt(now + 1 day)` (measured above): listed for the closing day with
   `{ invoiceNumber: "A/1", invoiceType: "F2", issueDate: <today>, closedOn: <tomorrow>,
   recipientName: null, recipientTaxId: null, base: "14.88", vat: "3.12", total: "18.00",
   correctedBy: [] }`; a range of today alone lists nothing. Must be the file's first fiscal write
   ahead of real time, and nothing later writes a fiscal record dated past it except at real time
   (CLAUDE.md §4: a fiscal fixture over a minute ahead of a later recording write).
2. **A full invoice names its customer.** A table F1 to `RECIPIENT` closed now (the shape of
   `transfer-close.test.ts:76–103`): `recipientName: "Cliente SL"`, `recipientTaxId: "B12345674"`,
   `invoiceType: "F1"`.
3. **A later credit is named, not netted.** `credit(venue, bill, "1.00", "-1.21")` on case 2's bill
   after its close: `correctedBy: ["R/1"]`, and `base`, `vat`, `total` as before the credit.
4. **The file.** `renderTransferClosedCsv` of one row whose name is `=HYPERLINK("x")` and of no rows:
   the decoded text equals, exactly, BOM + header + `"'=HYPERLINK(""x"")"` row + CRLF, and BOM +
   header + CRLF. (`csvCell`'s own cases stay at `attendance-export-csv.test.ts`; this pins only
   that this file uses it.)
5. **The route.** As the manager, `?from=<tomorrow>&to=<tomorrow>` answers 200 with the four headers
   and a body equal to `renderTransferClosedCsv` of case 1's row; the supervisor (holds `report.view`)
   answers 403 `authorization.not_permitted`; `from` after `to` answers 400 with `field: "range"`.

**Dashboard** (after `memory_pressure` shows headroom; real Chromium):

6. `dashboard-sales-screen.test.ts`: no `export-transfer` without `canExport`; with it, a press sends
   `{ from, to }` as the fields stand and hands the blob to `URL.createObjectURL` under
   `closed-by-transfer-{from}-{to}.csv`; two presses while sending send one request; a refusal shows
   `codeMessage` in `export-error`, leaves both fields unchanged, and a second press asks again; the
   button is disabled while `from` is after `to`.
7. `dashboard-app.test.ts`: the `it.each` at `:2472–2490` gains a twin for `dashboard-sales-screen`
   (`report.view` → `canExport` false; plus `report.export` → true).

**Deletion controls** (each run once, recorded in the PR, not committed): filter on the sale's issue
day (case 1 fails); recipient columns read as null (case 2); corrections query removed (case 3,
`correctedBy`); `total` taken net of corrections (case 3, `total`); cells quoted without `csvCell`
(case 4); no byte-order mark, or LF line ends (case 4); route gated by `report.view` (case 5, 403);
`requireRange` removed (case 5, 400); screen ignores `canExport`, sends today instead of the fields,
drops the refusal, or never disables (case 6); `.canExport` not passed (case 7). The `order by` has no
control: with the table read in insertion order, removing it changes nothing a test can see.

**Commands:**
`pnpm --filter @waitron/server exec vitest run src/transfer-closed-export.test.ts src/attendance-export-csv.test.ts src/misdated-sales-csv.test.ts src/report-api.test.ts src/report-api.reports.test.ts src/bill-lookup-api.test.ts src/find-bill-transactions.test.ts`
(the last two use the widened `credit`);
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
with `git diff main -- packages/fiscal-verifactu packages/core packages/db` empty;
`pnpm --filter @waitron/dashboard exec vitest run src/screens/dashboard-sales-screen.test.ts src/screens/dashboard-sales-screen.a11y.test.ts src/dashboard-app.test.ts`;
typecheck server and dashboard. Read each run's `Tests` count.

**Implementer dispatches** (each well under 100 tool calls): (i) 6a with cases 1–5; (ii) 6b with
cases 6–7, the look and the docs.

## Size

About 140 production lines (reader and file ~65, route ~20, client ~8, screen ~40, wiring 1,
words 4) and about 225 test lines (server ~150 with setup, dashboard ~70, test-support types ~3).
Under 150, so one PR in two commits; if the build passes 150, split at the commit line (6a alone is a
working route with no button). Review weight: a new permission-gated route and a contract between
server and dashboard, so the full `/finish-branch` wave, Codex as two reviews (lane rule); the owner
lands it.

## Build off `main`, not stacked on Task 5

Task 6 needs nothing Task 5 builds, and the lane rule (owner 2026-11-01, `queue.md:17`, `:20`) says
overlap is never a reason to wait: build on `main`; whoever lands second rebases. Files both touch:

| File | Task 5 (plan, `feat/a275-closed-bills`) | Task 6 |
| --- | --- | --- |
| `apps/server/src/report-api.ts` | overview (`:255`) and daily-close (`:296`) routes, a helper, an import | one route after `:328` |
| `apps/dashboard/src/screens/dashboard-sales-screen.ts` | per-device table and Records in the close | a property, two states, a handler, a block under the date fields |
| `dashboard-sales-screen.test.ts` | new cases; `closureSummary` added to stubs | new cases |
| `apps/dashboard/src/api/client.ts` | `ClosureSummaryDto` near `:1463–1498` | one method near `:4400` |
| `apps/dashboard/src/i18n/strings.ts` | `overview.*`, `sales.*` keys | one `sales.*` key — adjacent lines, expect a small conflict |
| `docs/backlog.md`, `docs/backlog/fiscal.md`, the master plan | A275 lines; note under Task 5 | A275 lines (will conflict; extend the wording); note under Task 6 |

Task 4 (#2797, not landed) also edits `client.ts`, `strings.ts` (`orders.*`) and the A275 backlog
lines; Task 6 does not edit `transfer-close-fixture.ts`, which #2797 changes.

## Left out, and why

- A screen listing the bills, a JSON view, a range limit, a per-box filter: see "What changed".
- Voids and replacement invoices: no route makes either today (open question 3).
- A guide section: no guide page covers Sales & takings (`apps/server/src/guide/en/` has none), and
  master plan Task 7 writes the bilingual closed-by-transfer guide, after which staff can make rows.
- Recording who downloaded the file: neither the modelo 303 nor the time-record export does; doing it
  needs a table or an activity kind (open question 6).
- An index for the range read: the table's index leads with `node_id`
  (`transfer-closures.ts:74`), so a venue-wide range reads the whole table, which holds one row per
  bill closed by transfer. Not measured; a schema change is a migration rebuild, so not here.

## Open questions (each with a default the build follows unless told otherwise)

1. **Column names in English, dots for decimals**, as the time-record export does. Alternative: the
   person's language with comma decimals, as `misdated-sales-csv.ts:44–48` does (~20 more lines),
   if the accountant's spreadsheet is Spanish-set. Default: English.
2. **Whole venue, not this box**, like modelo 303. Identical today (one box per venue). Default:
   whole venue.
3. **No void or replacement-invoice columns** until a route writes them (A556 for replacements);
   that change adds its column here. Default: left out.
4. **No range limit**, as the other report ranges. Default: none.
5. **Who may download: `report.export` (manager and administrator)**, as the design says, though the
   file names customers' tax numbers; `personal_data.export` (administrator only) stays for one
   person's subject-access file. Default: `report.export`.
6. **Downloads are not recorded.** Default: not recorded.
7. **Totals only**: no per-rate VAT lines, no operation date (A444 may give a meal past midnight one),
   no customer country or identifier type. Default: as listed in the example.
8. **The button ships before Task 7** and gives a header-only file until then. Default: ship (owner's
   order, Tasks 4–6 first).

## For the watcher

Questions 1–8 have defaults; nothing blocks the build. Build off `main`; rebase after #2797 or
Task 5, whichever lands first.
