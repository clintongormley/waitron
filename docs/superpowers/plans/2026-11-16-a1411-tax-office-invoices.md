# A1411: a page and an export for the tax office — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: **draft for the watcher**. Written at main `e98aaa981d`.
**READ** = source read at that commit; **RUN** = a command was run and its output read.

**Goal:** when the tax office asks to see a venue's invoices, the venue can, on the box and without
the internet, give someone a sign-in that shows only invoices; on one page that person can find any
invoice the venue issued by any field of the invoices-issued book, open it in full, download it and
print it; and they can download a whole month's invoices as one file. The same page works through
Waitron Cloud's remote access, which already carries the dashboard (§1, row 7).

**Ask:** `docs/backlog.md:393` (owner, 2026-11-06). Research and the legal reading:
`docs/compliance/research/2026-11-06-adviser-online-access.md`: «visualización, búsqueda selectiva,
copia o descarga en línea e impresión» (RD 1619/2012 art. 21.2), search by «cualquiera de los datos
que deban reflejarse en los libros registro» (Orden EHA/962/2007 art. 5.3), and «debidamente
disociado el acceso a la información con trascendencia tributaria» (RD 1007/2023 art. 8.4). The
adviser question T4 (`docs/compliance/2026-11-19-adviser-meeting.md:252`) does not gate this: the
backlog says it is needed whatever the answer.

**Architecture:** one new core permission, `invoice.inspect`. One read-only server module
(`apps/server/src/tax-office-api.ts`) with three routes: a paged, filtered list of every row of
`sales`; one invoice as an A4 PDF; one month as a streamed ZIP (PDFs plus a CSV book). One
dashboard screen, **Invoices**, under Reports. A person whose only role holds `invoice.inspect`
sees that screen and nothing else of the venue (the nav already hides what a session does not
hold, `apps/dashboard/src/dashboard-app.ts:2404-2406`). No table, no migration, no fiscal write.

**Tech stack:** TypeScript, Hono, Drizzle on `node:sqlite`, Lit, Vitest with `useVenueDb`, pdfkit
(existing `renderInvoicePdf`), fflate (existing ZIP helpers).

## Global constraints

- Read-only. Nothing here files, allocates, voids, reprints to a printer or changes a sale. Never
  edited: `computeHuella`, the chain, `allocateInvoiceNumber`, `registros_facturacion` and its
  triggers, the alta builders. Golden huella (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`)
  and `inmutabilidad` pass **unedited** after every task; if either would change, STOP.
- No new table and no migration. No new error code unless a task names it (the list's input errors
  reuse an existing `*.invalid` shape; Task 2 says which).
- Nothing on the sale path changes. The list reads `sales` by its `issued_at` index
  (`packages/db/src/schema/sales.ts`, `sales_tenant_issued_idx`); the export renders in turns
  (`apps/server/src/download-archive.ts:60-88` pattern) and stops when the request is aborted.
- English in code; words through the dashboard and server i18n files, English and Spanish.
- Two PRs, each landing on its own (THE RULE): PR 1 = Tasks 1–5 (permission, list, one invoice,
  screen, guide); PR 2 = Tasks 6–8 (the month's export). Branches `feat/a1411-tax-office-page`
  and `feat/a1411-tax-office-export`. One `subagent_type: "implementer"` per task, per-task
  reviews, `/finish-branch` full wave with two Codex angles. Fiscal-adjacent, so the owner lands.

## 1. What exists and what each piece reuses

| # | Need | What exists (READ) | This plan |
| --- | --- | --- | --- |
| 1 | Every issued document | `sales` holds one row per issued document: series and number, `issued_at`, `total`, `vat_breakdown` JSON `{rate, base, tax}[]`, customer columns, `corrects_sale_id`, `replaces_original`, `supply_day` (`packages/db/src/schema/sales.ts:67-170`); voids in `sale_voids`; F3 links in `sale_substitutions` | List every row; no other source |
| 2 | The kind of each | `readInvoiceTyping` (`invoice-typing.ts:55-75`): F1 names a customer tax id, else F2; a corrective R4 with a customer, else R5. It reads one sale at a time. A full invoice replacing tickets is linked in `sale_substitutions` | The list computes the kind in SQL from the same columns, and a test pins it equal to `readInvoiceTyping` for each seeded kind, so the page and the filing cannot disagree |
| 3 | A search | Till lookup finds only original full invoices, 20 at most (`invoice-lookup-api.ts:28,44-53`); the till's Transactions tab leaves out voided sales (`find-bill-transactions.ts:73-75`); the dashboard Orders screen lists bills, not invoices (`orders-list.ts`) | New list; none of these is widened, since each serves its own screen |
| 4 | One invoice in full | `readReceiptEmailDocument` admits any sale (`invoice-document.ts:53-60`) and `renderInvoicePdf` draws the A4 page (`invoice-pdf.ts:7`); the per-customer export already renders with `duplicate: true` (`invoice-customer-data.ts:198`) | Same two calls, `duplicate: true` |
| 5 | A period's files | `zipArchiveInTurns` adds one entry per turn but joins the whole archive in memory (`download-archive.ts:60-88`) | A streamed variant (Task 7): a month of a busy venue's PDFs must not sit in memory |
| 6 | Who may look | `CORE_PERMISSIONS` (`packages/identity/src/permissions.ts:10-32`); custom roles with any subset a granter holds (`packages/identity/src/roles.ts:254-261`); routes check with `authorizeManager` (`manager-login.ts:187-199`) | `invoice.inspect`, default holder `manager` |
| 7 | Remote | Cloud's staff listener passes every `/management-api/*` route and GET `/manage/*` (`apps/server/src/cloud-remote.ts:120-145`) | Nothing to add on the box; Task 4 checks the routes are not on its blocked list |
| 8 | A record of who looked | `recordActivity`, kinds in `packages/db/src/activity-kinds.ts` (the accountant export's `accountant_export.downloaded`, `:95`, `:145`) | Two kinds: an invoice opened, a month downloaded |

## 2. Decisions (D, the plan's; Q, for the owner through the watcher)

- **D1. Every row of `sales` is listed**, voided ones included and marked "Cancelled" with the
  cancellation date: an annulled invoice was still issued, and its number must be findable. F3
  substitutions and every corrective are listed with their kind and the number they correct.
- **D2. The original format is the A4 PDF Waitron already sends by email** (row 4), stamped as a
  copy (`duplicate: true`). For a full invoice it is the document the customer received by email or
  download; for a simplified ticket it is the electronic form of the ticket. A ticket-width PDF that
  mirrors the thermal layout is the alternative (Q2).
- **D3. Search fields** (RIVA art. 63.3, quoted in the research): one text box matching series and
  number (`SERIES/N` exactly, or a bare number), customer name (folded, contains) or customer tax
  id (prefix); issue date from–to (required, default the current month, venue calendar days);
  operation date from–to (optional, on `supply_day`); VAT rate (the rates present in the range);
  amount (exact euros, matching the total, any breakdown base or any breakdown VAT); kind
  (F1/F2/F3/R). Fifty rows a page, newest first. The issue range is capped at 366 days so a name
  search cannot scan years of rows; `issued_at` is indexed (Global constraints).
- **D4. Columns:** number, kind, issue date and time, operation date (when it differs), customer
  name and tax id, base, VAT rate and amount per rate (one sub-row per rate, as the book has it),
  total, corrected invoice, cancelled.
- **D5. The month's export:** one calendar month per download, a ZIP of `README.txt`,
  `invoices.csv` (D4's columns, one row per VAT rate, the person's language) and
  `invoices/<SERIES>-<N>.pdf` per invoice. A month, not any range, so one download stays bounded
  (Task 6 measures it). Several months are several downloads.
- **D6. The page is a manager's too** (`defaultHolders: ["manager"]`): when an inspector arrives
  unannounced, whoever is in charge must help (RD 1065/2007 art. 173.2, research row 19), and a
  manager can open the page at once. A person who must see tax information only gets a role
  holding `invoice.inspect` alone; the guide says how (Task 5). No seeded role (Q1).
- **D7. Each look is recorded**: opening an invoice and downloading a month write an activity entry
  naming the person and the invoice or month; listing does not.
- **Q1 (owner). How does an inspector sign in?** Default: the manager creates an ordinary person
  with an email and a role holding only "See invoices for the tax office", and suspends that person
  afterwards. Alternative: a one-off access code the manager issues from the page, with no person
  record; more code (a new sign-in path), and a new kind of login to protect. Task 1 checks that
  such a person appears in no staff list, rota or working-time record; if one does, that is a
  question before Task 4.
- **Q2 (owner). Is the A4 copy of a simplified ticket its original format (D2)?** Default yes; it
  is also adviser material (T4's "copy in its original format").

## 3. Tasks

### PR 1 — the page

#### Task 1: the permission and what a holder sees

**Files:** `packages/identity/src/permissions.ts`, `apps/dashboard/src/i18n/permissions.ts`,
their tests; root guards that pin permission lists (`git grep -n '"fiscal.view"' -- '*.test.ts'`
finds them; run each).

- [ ] Failing test: `invoice.inspect` is declared with `defaultHolders: ["manager"]`; a custom role
  holding it alone is accepted by `roles.ts`; the access-roles screen shows it with its label in
  English and Spanish ("See invoices for the tax office" / "Ver facturas para Hacienda").
- [ ] Add it; run the permission and role suites and every guard the grep finds.
- [ ] Check (RUN, recorded in the PR): sign in on the dev stack as a person whose only role holds
  `invoice.inspect`; write down every nav entry and own page shown, and whether the person appears
  in Staff, the rota and the working-time screens. The nav always shows Orders
  (`dashboard-app.ts:2614`) and a person with no venue screen lands on their own schedule
  (`:2445`); say what each shows such a person. Anything beyond Invoices and the person's own
  sign-in settings is Q1's question.

#### Task 2: the list route

**Files:** create `apps/server/src/tax-office-api.ts`, `apps/server/src/tax-office-list.ts`, and
`apps/server/src/tax-office-list.test.ts`; mount beside the report routes (`report-api.ts`'s mount
site in `boot.ts`).

- [ ] Failing tests with `useVenueDb`, one seeded sale of each kind (F1, F2, F3 replacing two F2s,
  an R5, a voided F2, a sale with `supply_day` set, a two-rate sale): `GET
  /management-api/tax-office/invoices?from&to` returns every one with D4's columns; each D3 filter
  narrows to exactly the matching rows (a name, a tax id prefix, `SERIES/N`, a bare number, a rate,
  an amount equal to a base, to a VAT amount and to a total, an operation date range, a kind); a
  range over 366 days and a malformed filter answer the same 400 code the period report uses for a
  bad range (find it in `report-api.ts`, reuse it); a session without `invoice.inspect` gets
  `authorization.not_permitted`; page 2 continues page 1 with no gap or repeat when two sales share
  an `issued_at`.
- [ ] Implement: one query over `sales` joined to `invoice_series`, left-joined to `sale_voids` and
  the corrected sale's number and `sale_substitutions`; rate and amount filters through `json_each(vat_breakdown)`; keyset paging on
  `(issued_at, id)`; the kind as in §1 row 2, with the test pinning it to `readInvoiceTyping`.
  Money through `rawCentsToDecimal` / `centsToDecimal` (CLAUDE.md §3).
- [ ] RUN `EXPLAIN QUERY PLAN` on the emitted SQL (`.toSQL()`) and record that it uses
  `sales_tenant_issued_idx`.

#### Task 3: one invoice as a PDF

**Files:** `apps/server/src/tax-office-api.ts`, its test; `packages/db/src/activity-kinds.ts`.

- [ ] Failing tests: `GET /management-api/tax-office/invoices/:saleId/pdf` answers
  `application/pdf` for an F2, an F1 and an R5 (the PDF starts `%PDF` and its text holds the
  invoice number); an unknown id answers the existing not-found code; no permission answers
  `authorization.not_permitted`; one activity entry `tax_office.invoice_opened` names the person
  and the sale; `Cache-Control: no-store`.
- [ ] Implement with `readReceiptEmailDocument(..., saleId)` then `renderInvoicePdf({ ...document,
  duplicate: true })`, the read inside one `withWriteLock` turn as `invoice-customer-data.ts`
  does; declare the activity kind.

#### Task 4: the Invoices screen

**Files:** create `apps/dashboard/src/screens/tax-office-screen.ts` with `.test.ts` and
`.a11y.test.ts`; `dashboard-app.ts` (`CORE_SCREENS`, `NAV_GROUPS` under Reports,
`requiresPermission: "invoice.inspect"`), `navigation.ts`, `api/client.ts`, i18n strings.

- [ ] Failing tests: the screen lists the route's rows, one sub-row per VAT rate; each filter
  sends its query parameter; the issue range defaults to the current month; next page uses the
  keyset; "Open" opens the PDF in a new tab (the browser's viewer prints and saves it); a
  cancelled invoice shows "Cancelled"; a person holding only `invoice.inspect` lands on this
  screen and sees no other venue screen; a read failure shows the load message, not an empty list.
  Fields come from field primitives (`scripts/native-form-fields.test.ts`), dates through the
  existing date field, the table is `wt-data-table`.
- [ ] Look at it in both themes and at phone width (CLAUDE.md §4); axe test both themes.
- [ ] Check `cloud-remote.ts:120-145` lets `/management-api/tax-office/*` through (it passes every
  `/management-api/` path except three named ones); add one case to its suite that a GET of the
  list route is not refused there.

#### Task 5: the guide

**Files:** `apps/server/src/guide/en/fiscal-filing.md`, `apps/server/src/guide/es/fiscal-filing.md`
(a section `{#tax-office}` each), the screen's help link (`help-guide.ts`).

- [ ] Write what staff do when the tax office asks: open Invoices, or create a person with a role
  holding only "See invoices for the tax office", let them sign in at the venue or through Cloud,
  suspend the person afterwards; a written request is answered with a month's download (PR 2).
  Nothing about how the code decides (CLAUDE.md §3, guides).
- [ ] Run `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`.

### PR 2 — the month's export

#### Task 6: measure first

- [ ] RUN, on the bench venue or a seeded venue of 9,000 sales in one month (300 a day, a busy
  restaurant; say which), the render time of 500 PDFs through `renderInvoicePdf` in a
  `node:26-slim` container (CLAUDE.md §4: measure where the box's runtime is), and the largest
  single event-loop block while rendering. Record per-invoice time, the month's projected time and
  bytes in the PR. If a month projects over 15 minutes or a block over 100 ms, stop and write the
  numbers in questions.md with a smaller unit (a week) as the default.

#### Task 7: a streamed ZIP

**Files:** `apps/server/src/download-archive.ts` and its test.

- [ ] Failing tests: `zipStream(entries: AsyncIterable<{name, content}>, at)` returns a
  `ReadableStream<Uint8Array>` whose bytes unzip (fflate `unzipSync`) to exactly the entries; it
  pulls the next entry only after the previous chunk was read (a counting iterator shows at most
  one entry ahead); cancelling the stream stops the iterator (`return()` called).
- [ ] Implement over fflate's `Zip` with `ZipPassThrough` for PDFs and `ZipDeflate` for text, as
  `zipArchiveInTurns` does.

#### Task 8: the route and the button

**Files:** `tax-office-api.ts`, `tax-office-export.ts` (create), tests; the screen; i18n; the
guide sections from Task 5.

- [ ] Failing tests: `GET /management-api/tax-office/months/2026-03.zip` streams `README.txt`,
  `invoices.csv` and one PDF per sale issued in March (venue days), voided ones included; the CSV
  has D4's columns in the person's language and one row per VAT rate, money with a decimal point;
  file names are unique when two series share a number (reuse `uniquePdfPath`'s rule from
  `invoice-customer-data.ts:123`, exported, not copied); aborting the request after the first
  chunk renders no further PDF (a counting renderer stub; record the deliberate-break control in
  the PR: make the route ignore the abort and show the test fails); authority is checked again
  before the last chunk, as `invoice-customer-data-api.ts` does after building; one activity entry
  `tax_office.month_downloaded`; a month with no invoices answers a ZIP with the README and an
  empty CSV.
- [ ] The screen gets "Download the month" beside the date filter, for the month of the range's
  start; the guide's two sections gain one sentence each.

## 4. Verification for each PR

Focused suites of each task; `scripts/native-form-fields.test.ts`, `scripts/help-tooltip-mode.test.ts`,
`scripts/english-only.test.ts`, `scripts/personal-log-params.test.ts` (log fields name the
customer as `customerTaxId`/`customerName`), `scripts/errors-reachable.test.ts`; golden huella and
`inmutabilidad` unedited. The page opened and looked at in both themes and at phone width.

## 5. Not in this plan

- Cloud-side work: Cloud already relays the dashboard (row 7). Any Cloud page of its own is
  Cloud's repository.
- Purchases (invoices received) and the billing records' XML: the research asks for invoice copies;
  AEAT already holds the records.
- A664's archive reader for years past the box's own data.
