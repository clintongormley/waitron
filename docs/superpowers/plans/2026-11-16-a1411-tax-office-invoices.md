# A1411: a page and an export for the tax office — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: **PR 1 (Tasks 1–5), PR 1b (Task 3b) and PR 2 (Tasks 6–8) built**. Written at main `e98aaa981d`.
2026-11-16: D3 amended after Task 2's review (name search as built; VAT rate typed, no list of rates present).
2026-11-16: D3's default month and D4's per-rate layout amended after Task 4's review (the table did not fit beside the dashboard's sidebar).
Fresh Claude read 2026-11-16: Ready after fixes (no Critical, six Important); folded in.
**Amended 2026-11-16 (owner's Q2 answer, 09:10):** a simplified ticket opens as a ticket-width PDF
drawn by the till's own ticket layout (D2, Task 3b, PR 1b); full invoices keep the A4 PDF.
Fresh Claude read of the amendment 2026-11-16: Ready after fixes (no Critical, two Important: an
over-long ticket falls back to A4; the cutter's feed is not drawn); folded in. Cleared by the watcher (not the owner) 2026-11-16 12:51.
**READ** = source read at that commit; **RUN** = a command was run and its output read.

**Goal:** when the tax office asks to see a venue's invoices, one page on the box finds any invoice
the venue issued by any field of the invoices-issued book, opens it in full, downloads it and
prints it, and downloads a whole month's invoices as one file. Without the internet a manager opens
it on their own sign-in; where the box can send email, the venue can also give the inspector a
sign-in of their own that shows invoices and nothing else (Q1). The same page works through
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
`sales`; one invoice as a PDF (A4 for a full invoice, one ticket wide for a simplified ticket, D2),
recorded in the existing `invoice_pdf_downloads`; one month as a streamed ZIP (PDFs plus a CSV book). One dashboard screen, **Invoices**, under Reports. A session
holding `invoice.inspect` and no other permission sees that screen and nothing else of the venue:
the nav already hides what a session does not hold (`apps/dashboard/src/dashboard-app.ts:2404-2406`),
and D8 closes the one screen every signed-in person gets, Orders. No table, no migration, no fiscal
write.

**Tech stack:** TypeScript, Hono, Drizzle on `node:sqlite`, Lit, Vitest with `useVenueDb`, pdfkit
(existing `renderInvoicePdf`), fflate (existing ZIP helpers).

## Global constraints

- Read-only. Nothing here files, allocates, voids, reprints to a printer or changes a sale. Never
  edited: `computeHuella`, the chain, `allocateInvoiceNumber`, `registros_facturacion` and its
  triggers, the alta builders. Golden huella (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`)
  and `inmutabilidad` pass **unedited** after every task; if either would change, STOP.
- No new table and no migration. No new error code unless a task names it (the list's input errors
  reuse an existing `*.invalid` shape; Task 2 says which).
- Nothing on the sale path changes, but every read here takes the write lock: `withTransaction`
  is the lock (`packages/db/src/tenancy.ts`, its comment and `withWriteLock` call) and the engine is
  synchronous, so a long read holds up sales. The list reads `sales` by its `issued_at` index
  (`sales_tenant_issued_idx`) and Task 2 times its worst case; the export reads one invoice per lock
  turn and renders outside it, in turns (`apps/server/src/download-archive.ts:60-88` pattern), and
  stops when the request is aborted or a handover closes the gate.
- English in code; words through the dashboard and server i18n files, English and Spanish.
- Three PRs, each landing on its own (THE RULE): PR 1 = Tasks 1–5 (permission, list, one invoice,
  screen, guide); PR 1b = Task 3b (tickets at ticket width); PR 2 = Tasks 6–8 (the month's
  export). Branches `feat/a1411-tax-office-page`, `feat/a1411-ticket-width` and
  `feat/a1411-tax-office-export`. One `subagent_type: "implementer"` per task, per-task
  reviews, `/finish-branch` full wave with two Codex angles. Fiscal-adjacent, so the owner lands.

## 1. What exists and what each piece reuses

| # | Need | What exists (READ) | This plan |
| --- | --- | --- | --- |
| 1 | Every issued document | `sales` holds one row per issued document: series and number, `issued_at`, `total`, `vat_breakdown` JSON `{rate, base, tax}[]`, customer columns, `corrects_sale_id`, `replaces_original`, `supply_day` (`packages/db/src/schema/sales.ts:67-170`); voids in `sale_voids`; F3 links in `sale_substitutions` | List every row; no other source |
| 2 | The kind of each | `readInvoiceTyping` (`invoice-typing.ts:55-75`) types the printed document only: F1 names a customer tax id, else F2; a corrective R4 with a customer, else R5; never F3. The filing sets F3 for a full invoice replacing tickets (`packages/fiscal-verifactu/src/backend.ts:726`), linked in `sale_substitutions` | The list computes the kind in SQL from `counterparty_tax_id`, `corrects_sale_id` and `sale_substitutions`; an end-to-end test files one sale of each kind through the Verifactu module and pins the page's kind to each record's `tipo_factura` |
| 3 | A search | The module's Fiscal filing screen lists filing cases, not invoices, under `report.export` (`packages/fiscal-verifactu/src/dashboard/index.ts:13-31`); till lookup finds only original full invoices, 20 at most (`invoice-lookup-api.ts:28,44-53`); the till's Transactions tab leaves out voided sales (`find-bill-transactions.ts:73-75`); the dashboard Orders screen lists bills, not invoices (`orders-list.ts`) | New list; none of these is widened, since each serves its own screen |
| 4 | One invoice in full | `readReceiptEmailDocument` admits any sale (`invoice-document.ts:53-60`) and `renderInvoicePdf` draws the A4 page (`invoice-pdf.ts:7`); the per-customer export already renders with `duplicate: true` (`invoice-customer-data.ts:198`) | Same two calls. `POST /management-api/orders/:id/invoice-pdf` (`apps/server/src/orders-api.ts:362`) already downloads a bill's F1 as a copy through `readInvoiceForDownload` (`orders-invoice-pdf.ts:17-35`), recording each download in `invoice_pdf_downloads`. Task 3 adds a by-sale entry beside it for any kind and records there too; since 2026-11-16 a simplified ticket goes through Task 3b instead (D2) |
| 5 | A period's files | `zipArchiveInTurns` adds one entry per turn but joins the whole archive in memory (`download-archive.ts:60-88`) | A streamed variant (Task 7): a month of a busy venue's PDFs must not sit in memory |
| 6 | Who may look | `CORE_PERMISSIONS` (`packages/identity/src/permissions.ts:10-32`); custom roles with any subset a granter holds (`packages/identity/src/roles.ts:254-261`); routes check with `authorizeManager` (`packages/identity/src/manager-login.ts:187-199`) | `invoice.inspect`, default holder `manager` |
| 7 | Remote | Cloud's staff listener passes every `/management-api/*` route and GET `/manage/*` (`apps/server/src/cloud-remote.ts:120-145`) | Nothing to add on the box; Task 4 checks the routes are not on its blocked list |
| 8 | A record of who looked | `recordActivity`, kinds in `packages/db/src/activity-kinds.ts` (the accountant export's `accountant_export.downloaded`, `:95`, `:145`) | One kind, a month downloaded; an opened invoice goes in `invoice_pdf_downloads` (row 4) |
| 9 | The printed ticket | `layOutSaleReceipt(backend, tx, cfg, saleId, duplicate, printer)` (`apps/server/src/receipt-print.ts`) lays out any filed sale's ticket as the till prints it and returns the printer's commands; the print queue's reprint already calls it (`reprintJobOn`, `apps/server/src/print-job-reprint.ts:84`, through `print-api.ts`). `previewPrintJob` (`apps/server/src/print-job-preview.ts:52`) decodes those commands into dot images (each printed line, the logo, the QR code), a line's with the text read back from it; the dashboard's receipt preview and the tests' `printedLines` (`apps/server/src/testing/decode-ticket.ts`) read tickets through it | Task 3b draws `previewPrintJob`'s images onto one PDF page the paper's width; no second ticket layout |

## 2. Decisions (D, the plan's; Q, for the owner through the watcher)

- **D1. Every row of `sales` is listed**, voided ones included and marked "Cancelled" with the
  cancellation date: an annulled invoice was still issued, and its number must be findable. F3
  substitutions and every corrective are listed with their kind and the number they correct.
- **D2. A full invoice's original format is the A4 PDF Waitron already sends by email** (row 4),
  stamped as a copy (`duplicate: true`): the document the customer received by email or download.
  **A simplified ticket's is the printed ticket** (owner, 2026-11-16 09:10: "I think ticket width
  will be needed"; most venues have no A4 printer): it opens as a PDF one ticket wide, drawn by the
  same code that prints it at the till, stamped as a copy as a till reprint is (Task 3b). "Simplified
  ticket" means what `readInvoiceTyping` types F2 or R5 (§1 row 2): a sale naming no customer tax
  id. F1, F3 and R4 stay A4.
- **D3. Search fields** (RIVA art. 63.3, quoted in the research): one text box matching series and
  number (`SERIES/N` exactly, or a bare number), customer name (the house text search,
  `packages/shared/src/text-search.ts`: accents and case ignored, every word but the last must match
  a whole word, the last may match part of a word, in any order) or customer tax id (prefix); issue date from–to (required, venue calendar days); the default is the browser's current month, which differs from the venue's around a month's change, for as many hours as the browser's and the venue's time zones are apart;
  operation date from–to (optional): the sale's `supply_day` where set, otherwise its issue day,
  since `supply_day` is set only on some sales (`sales.ts:101-103`, check `:144`); VAT rate (typed
  as a number); amount (exact euros compared as numbers, not text, matching the
  total, any breakdown base or any breakdown VAT; `vat_breakdown` holds decimal text); kind
  (F1/F2/F3/R4/R5). Fifty rows a page, newest first. The issue range is capped at 366 days so a
  name search cannot scan years of rows; Task 2 times that worst case and shortens the cap if it
  holds the lock too long.
- **D4. Columns:** number, kind, issue date and time, operation date (when it differs), customer
  name and tax id, base, VAT rate and amount per rate (one line per rate inside those cells, lined up rate by rate),
  total, corrected invoice, cancelled.
- **D5. The month's export:** one calendar month per download, a ZIP of `README.txt`,
  `invoices.csv` (D4's columns, one row per VAT rate, the person's language) and
  `invoices/<SERIES>-<N>.pdf` per invoice. A month, not any range, so one download stays bounded
  (Task 6 measures it). Several months are several downloads.
- **D6. The page is a manager's too** (`defaultHolders: ["manager"]`): when an inspector arrives
  unannounced, whoever is in charge must help (RD 1065/2007 art. 173.2, research row 19), and a
  manager can open the page at once. A person who must see tax information only gets a role
  holding `invoice.inspect` alone; the guide says how (Task 5). No seeded role (Q1). Built-in
  roles keep their permissions in the database, so a venue set up before this lands gives its
  managers the page only after a reset; acceptable before go-live (CLAUDE.md §3).
- **D7. Each look is recorded**: an opened invoice in `invoice_pdf_downloads` (who, which sale,
  when), as a bill's download already is; a month's download as an activity entry naming the person
  and the month; listing is not recorded.
- **D8. An inspection-only session is refused the Orders routes.** Every signed-in dashboard person
  gets Orders: the nav always shows it (`dashboard-app.ts:2614`), and without `report.view` its
  routes show today's bills (`orders-api.ts:144-152`, `visibleOrderPerson` `:155-175`), including
  the staff list and the bill actions (invoice email, reprint). A session holding `invoice.inspect`
  and no other permission is refused every `/management-api/orders*` route with
  `authorization.not_permitted`, and its nav hides Orders and the own-schedule landing; it lands on
  Invoices. Tested route by route (Task 1).
  Widened 2026-11-16 after review: every management route now refuses such a session unless it
  opts in (`resolveManagementSession` in `packages/identity/src/management-session.ts`); its own
  account's routes and the tax office's are the ones that do, pinned by the sweep in
  `apps/server/src/boot.management-origin.test.ts`.
  Changed 2026-11-16 (review): the refusal is `authorization.inspection_only`, with no params,
  answered 403 by the shared error boundary when a route's table leaves it out; the live-update
  stream ends such a session with a session-invalid event.
- **Q1 (owner). How does an inspector sign in?** Answered 2026-11-16 08:57 (owner, relayed in lane L's
  questions.md, "## WATCHER 2026-11-16 08:57"): "We just create a user with the relevant permissions, send
  the email, just like any other user" — the default below stands. Default: at the venue a manager opens Invoices on
  their own sign-in (works without the internet); for an inspector's own sign-in, the manager
  creates an ordinary person with an email and a role holding only "See invoices for the tax
  office", and disables that person afterwards. Cost: a new person's first password arrives only by
  an emailed invitation, and re-enabling sends a new one (`apps/server/src/guide/en/staff.md`,
  "Account access"), so the inspector's own sign-in needs the box's email. Alternatives: show the
  invitation link on the manager's screen to hand over, for a box with no email (small, a new way
  to deliver a sign-in secret); or a one-off access code with no person record (a new sign-in path
  to protect). Task 1 checks that such a person appears in no staff list, rota or working-time
  record; if one does, that is a question before Task 4.
- **Q2 (owner), answered 2026-11-16 09:10: a ticket opens at ticket width** (D2). Still adviser
  material (T4's "copy in its original format", 19 Nov); the answer there can only confirm this or
  ask for the A4 form as well, which `renderInvoicePdf` already draws.
- **D9. The ticket copy is laid out for the paper width and resolution of the selling device's
  receipt printer as it is now** (`sales.device_id`, `packages/db/src/schema/sales.ts:73`, through
  `resolveReceiptPrinter`, `apps/server/src/receipt-print.ts`), and for an 80 mm printer at 180 dpi
  when there is none: a sale from a job (`demo_seed`, `readiness_test`, `operator_script`; no
  device), a device with no receipt printer now, or one switched off. 80 mm at 180 dpi is the
  printers table's own default, which the receipt preview also uses
  (`apps/server/src/receipt-preview-api.ts:58`, `DEFAULT_PRINTER`, to be exported for this). A printer changed since the sale
  changes the copy's line width only; every word, amount and the QR code come from the same filed
  sale. Like a till reprint (`layOutSaleReceipt`'s comment, `apps/server/src/receipt-print.ts`),
  the copy carries today's header text, logo and address and the filed sale's issuer, lines, totals
  and QR code.

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
- [ ] D8, failing tests first: with a session holding only `invoice.inspect`, each
  `/management-api/orders*` route mounted in `orders-api.ts` (list, detail, staff, invoice
  deliveries, reprint, invoice PDF) answers `authorization.not_permitted`, and the same routes still
  answer a session with no permission at all as today (the legitimate case); the dashboard nav
  hides Orders for that session and opens Invoices first. Implement in `orders-api.ts`'s scope
  check and `dashboard-app.ts`'s nav filter and landing choice.
- [ ] Check (RUN, recorded in the PR): sign in on the dev stack as a person whose only role holds
  `invoice.inspect`; write down every nav entry and own page shown, and whether the person appears
  in Staff, the rota and the working-time screens. The nav always shows Orders
  (`dashboard-app.ts:2614`) and a person with no venue screen lands on their own schedule
  (`:2445`); after D8, say what is left. Try it with email not set up too, and record how far the
  person gets. Anything beyond Invoices and the person's own sign-in settings is Q1's question.

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
  `(issued_at, id)`; the kind as in §1 row 2, pinned by an end-to-end test that files one sale of
  each kind through the Verifactu module and compares each record's `tipo_factura`.
  Money through `rawCentsToDecimal` / `centsToDecimal` (CLAUDE.md §3).
- [ ] RUN `EXPLAIN QUERY PLAN` on the emitted SQL (`.toSQL()`) and record that it uses
  `sales_tenant_issued_idx`, in `node:26-slim` (CLAUDE.md §4: never a Mac's Homebrew Node).
- [ ] RUN the worst case on the bench year (`pnpm bench`'s venue; testing-guide.md "The bench"):
  366 days, a name that matches nothing, an amount filter. Record the time the lock is held. If it
  passes 200 ms, shorten the cap (92 days, then 31) until it does not, and say so in the PR.

#### Task 3: one invoice as a PDF

(Amended 2026-11-16: a simplified ticket is drawn ticket-width by Task 3b; this task's A4 path stays
for every other sale and for Task 3b's fallback.)

**Files:** `apps/server/src/orders-invoice-pdf.ts`, `apps/server/src/tax-office-api.ts`, their tests.

- [ ] Failing tests: `POST /management-api/tax-office/invoices/:saleId/pdf` answers
  `application/pdf` named by `invoicePdfFileName` for an F2, an F1, an F3 and an R5 (the PDF starts
  `%PDF` and its text holds the invoice number); an unknown id answers `invoice_delivery.not_found`
  (what `readDocument` already throws, `invoice-document.ts:74`); no permission answers
  `authorization.not_permitted`; one `invoice_pdf_downloads` row names the person and the sale;
  `Cache-Control: no-store`. (POST, as the Orders download, so the download record sits behind
  the own-page check — Task 3 review 2026-11-16)
- [ ] Implement `readSaleForDownload(tx, deps, saleId, personId)` beside `readInvoiceForDownload`,
  with `readReceiptEmailDocument` and the same insert, inside `withTransaction` (it writes); render
  with `renderInvoicePdf` after the transaction.

#### Task 4: the Invoices screen

**Files:** create `apps/dashboard/src/screens/tax-office-screen.ts` with `.test.ts` and
`.a11y.test.ts`; `dashboard-app.ts` (`CORE_SCREENS`, `NAV_GROUPS` under Reports,
`requiresPermission: "invoice.inspect"`), `navigation.ts`, `api/client.ts`, i18n strings.

- [ ] Failing tests: the screen lists the route's rows, one line per VAT rate; each filter
  sends its query parameter; the issue range defaults to the current month; next page uses the
  keyset; "Open" POSTs to the PDF route, as the Orders download does, and opens the returned PDF
  in a new tab (the browser's viewer prints and saves it); a
  cancelled invoice shows "Cancelled"; a person holding only `invoice.inspect` lands on this
  screen and sees no other venue screen, Orders included (D8); a read failure shows the load message, not an empty list.
  Fields come from field primitives (`scripts/native-form-fields.test.ts`), dates through the
  existing date field, the table is `wt-data-table`.
- [ ] Look at it in both themes and at phone width (CLAUDE.md §4); axe test both themes.
- [ ] Check `cloud-remote.ts:120-145` lets `/management-api/tax-office/*` through (it passes every
  `/management-api/` path except three named ones); add one case to its suite that a GET of the
  list route is not refused there.

#### Task 5: the guide

**Files:** a new core guide page `apps/server/src/guide/en/invoices.md` and its Spanish twin
(`fiscal-filing.md` is the Verifactu module's page; Invoices is a core screen), registered as the
other pages are (`guide-content.test.ts` shows how), and the screen's help link (`help-guide.ts`).

- [ ] Write what staff do when the tax office asks: open Invoices on your own sign-in; or, where
  email is set up, add a person with a role holding only "See invoices for the tax office", let
  them sign in at the venue or through Cloud, and disable the person afterwards. PR 1 says nothing
  about a month's download; Task 8 adds it. Nothing about how the code decides (CLAUDE.md §3,
  guides).
- [ ] Run `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`.

### PR 1b — tickets at ticket width

Branch `feat/a1411-ticket-width`, cut from PR 1's branch (`feat/a1411-tax-office-page`) while #3490
is open. It goes to `/finish-branch` only once #3490 has landed, after
`git rebase --onto origin/main <PR 1's last head>`; if the owner would rather have it inside #3490,
its commits go onto that branch instead. Size forecast: about 100 production lines (the renderer
about 70, the choice and the route about 30) and 150 test lines; no table, migration, error code,
screen or guide change (the guide says "choose an invoice's number to see it as a PDF", which
stays true).

#### Task 3b: a ticket as the till printed it

**As built (2026-11-16, after the branch's review):** these changes from the steps below.
`ticketDrawing` decodes the laid-out ticket once, inside the transaction, and answers the A4
fallback in two cases: the decoder stopped at its limits (`truncated`), or the page would be taller
than 14,400 pt, Acrobat's largest page side (a 1,500-line ticket the decoder reads whole made a page
over 17,000 pt tall). Every other layout it cannot draw still fails the request. `renderTicketPdf`
draws that result after the transaction, the whole print area as one 1-bit PNG, and dates the PDF at
the sale's issue time as the A4 copy does. The hidden text is drawn in the shipped Noto Sans Mono,
so each character sits over its printed cell. In `node:26-slim`, decoding and drawing take 13.6 ms
and 24,788 bytes for 60 lines, and 48.1 ms and 124,062 bytes for 1,000 lines (receipts in the PR).
`DEFAULT_PRINTER` moved to `receipt-print.ts`. Size as built: about 250 production lines and 560
test lines, the test helper included.

**Files:** create `apps/server/src/ticket-pdf.ts` and `ticket-pdf.test.ts`;
`apps/server/src/orders-invoice-pdf.ts`, `apps/server/src/tax-office-api.ts`, their tests.

- [ ] Failing tests for `renderTicketPdf(bytes: Uint8Array, printer: EscSetting): Promise<Buffer>`,
  over a ticket from `sample-receipt.ts`'s `sampleDocument`, given QR caption text (it draws a QR
  only then, `sample-receipt.ts:46`) and a logo, laid out with `formatReceipt` (as
  `invoice-pdf.test.ts` reads its PDFs, with `pdfjs-dist`, `@napi-rs/canvas` and `jsqr`): one page,
  as wide as the paper (80 mm = 226.77 pt; a 58 mm printer gives 164.41 pt); the page's text (pdfjs
  `getTextContent`) holds every non-blank line `printedLines(bytes)` reads from the same bytes,
  trimmed, in order (this checks no line is dropped or reordered, not the drawing); the page rendered
  at one pixel per dot (scale `dpi / 72`) has, for one chosen text line, dark pixels exactly where
  that line's image has set dots, and a QR code that `jsqr` decodes to the ticket's QR text; bytes
  that `previewPrintJob` reports `unsupported` or `truncated`, or with `omittedGraphics`, make it
  throw.
- [ ] Implement: `previewPrintJob(bytes, { widthDots })`; one dot is `72 / dpi` pt; the print area
  (`widthDots`) is centred on the paper's width. An image block's rows are packed bits, `ceil(width
  / 8)` bytes a row; draw each row's runs of set dots as one rectangle per run (the A4 logo draws a
  rectangle per dot, `invoice-pdf.ts`), placed by the block's `align`. A `feed` block advances `lines`
  is not drawn: the builder never sets a line spacing (`init()` sends only `ESC @`), and the one feed
  a ticket sends is `FEED_BEFORE_CUT` (`packages/printing/src/escpos.ts:18`), blank paper for the
  cutter, just before `cut` (the fresh read decoded the sample ticket at 80 mm and 58 mm: 31 images,
  one feed of 5 lines, one cut). The page ends at `cut` with a bottom margin equal to the top one,
  and is as tall as what was drawn; a feed anywhere but straight before the cut makes it throw. Each image block that carries `text`
  also gets that text written over it with `fillOpacity(0)` in the invoice font, stretched to the
  image's width (pdfkit's `horizontalScaling`, written as `Tz`, `pdfkit.js:4596`), so the viewer's
  search, selection and copy find what the ticket says where it is drawn; pdfkit has no invisible-text option
  (`pdfkit.js:4588` sets modes 0–2 only), so this is the way. A `text` block (bytes sent as text, which `drawReceipt`
  never sends) throws, as an unsupported command does.
- [ ] Failing tests for the choice, then implement it in one function both this route and PR 2's
  export call (`readSaleCopy` in `orders-invoice-pdf.ts`, replacing `readSaleForDownload`'s
  document): a sale naming no customer tax id (F2, R5; D2) is laid out by
  `layOutSaleReceipt(backend, tx, cfg, saleId, true, printer)` inside the transaction, with D9's
  printer (`resolveReceiptPrinter(tx, deviceOrigin(deviceId))`, `packages/shared/src/origin.ts:43`,
  else 80 mm at 180 dpi), and rendered by `renderTicketPdf` after it; any other sale keeps
  `readReceiptEmailDocument` and `renderInvoicePdf`. The sale's tax id and device are read first, so
  an unknown id still answers `invoice_delivery.not_found` (`layOutSaleReceipt` would throw
  `sale.not_found`, `transaction-receipt.ts:82`, which the route does not map). When
  `renderTicketPdf` throws because the decode is incomplete (the decoder stops at 2,048 blocks or
  4 MiB, `print-job-preview.ts:38-42`; the fresh read hit it at 2,100 dish lines), that sale's copy
  falls back to the A4 PDF, so one very long ticket neither fails the page nor ends PR 2's month
  download. Route tests over `POST /management-api/tax-office/invoices/:saleId/pdf`: an
  F2, an R5 and a voided F2 answer a page 226.77 pt wide whose text holds the invoice number and the
  copy label (`receipt-document.ts`'s `label.duplicate`); an F1, an F3 and an R4 answer an A4 page
  (595.28 pt); an F2 sold on a device whose receipt printer is 58 mm answers 164.41 pt; an F2 from
  `demo_seed` answers 226.77 pt; an F2 of 2,100 lines answers an A4 page; each still writes one
  `invoice_pdf_downloads` row. PR 1's
  existing PDF route tests keep passing unchanged except those whose sale is now a ticket: list each
  changed check in the PR.
- [ ] RUN, and record in the PR: render time and bytes for tickets of 6, 60 and 1,000 lines, in a
  `node:26-slim` container (CLAUDE.md §4). If either passes 200 ms or 500 KB, draw each image block
  as one 1-bit PNG made with `node:zlib` instead of rectangles, and say so in the PR. Open an F2's
  copy on the dev stack beside a reprint of the same sale, as the dashboard's print-job preview
  shows it (`print-api.ts` previews a job's commands), and LOOK: the same lines, logo, QR code and
  copy label; text selection in the viewer covers the lines.
- [ ] Golden huella and `inmutabilidad` unedited; nothing under `packages/fiscal-verifactu/src`
  changes.

### PR 2 — the month's export

#### Task 6: measure first

- [ ] RUN, on the bench venue or a seeded venue of 9,000 sales in one month (300 a day, a busy
  restaurant; say which), the render time of 500 PDFs through `renderInvoicePdf` in a
  `node:26-slim` container (CLAUDE.md §4: measure where the box's runtime is), the same for 500
  ticket copies through Task 3b's renderer (most of a restaurant's month is tickets), and the largest
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

Amended 2026-11-16 (Task 8 review): the CSV writes money with the decimal mark of its language, a comma in Spanish, through `deferred-payment-export.ts`'s `amountCell`, not always a decimal point: LibreOffice set to Spanish (3082) read `"3.00"` as text and `"3,00"` and `"-3,00"` as numbers.

Amended 2026-11-16 (Task 8a): the route is `POST /management-api/tax-office/months/:month`, not GET, because the download writes its activity entry and the own-page check covers POSTs, as Task 3's review made the single PDF a POST.

Amended 2026-11-16 (Task 8 review): the path has no `.zip`; each copy comes from `copyOfSale` (split out of `readSaleCopy`), which, unlike `readSaleCopy`, writes no `invoice_pdf_downloads` row (the month writes one `tax_office.month_downloaded` activity entry instead); a sale whose copy cannot be made is left out, logged as `tax_office.copy_failed` and listed in `failed.txt`, instead of ending the month.

Amended 2026-11-16 (A1411-3, [its plan](2026-11-16-a1411-3-zip-request.md)): the month route no longer streams the ZIP. It asks the box to build the file as a background job and answers at once; the person saves the finished file later from `GET /management-api/tax-office/month-download/:id/file`. The permission check before the last chunk and the stop at a handover's gate below are retired: the build stops at the job's stop signal, and the file route checks `invoice.inspect` when the file is fetched. The activity entry is renamed `tax_office.month_requested`.

- [ ] Failing tests: `GET /management-api/tax-office/months/2026-03.zip` streams `README.txt`,
  `invoices.csv` and one PDF per sale issued in March (venue days), voided ones included, each
  through `readSaleCopy` (Task 3b), so a ticket is ticket-width there too; the CSV
  has D4's columns in the person's language and one row per VAT rate, money with a decimal point;
  file names are unique when two series share a number (reuse `uniquePdfPath`'s rule from
  `invoice-customer-data.ts:123`, exported, not copied); aborting the request after the first
  chunk renders no further PDF (a counting renderer stub; record the deliberate-break control in
  the PR: make the route ignore the abort and show the test fails); authority is checked again
  before the last chunk, as `invoice-customer-data-api.ts` does after building; the stream stops
  when a handover closes the request gate, since the gate counts a request only until its handler
  returns (`apps/server/src/handover-gate.ts:39-44`); a second export while one runs is refused with
  a new code `tax_office.export_running` (registered in the server's errors, English and Spanish
  words), so two never render at once; one activity entry
  `tax_office.month_downloaded`; a month with no invoices answers a ZIP with the README and an
  empty CSV.
- [ ] The screen gets "Download the month" beside the date filter, for the month of the range's
  start; the guide's two sections gain one sentence each.

## 4. Verification for each PR

Focused suites of each task; `scripts/native-form-fields.test.ts`, `scripts/help-tooltip-mode.test.ts`,
`scripts/english-only.test.ts`, `scripts/personal-log-params.test.ts` (log fields name the
customer as `customerTaxId`/`customerName`), `scripts/errors-reachable.test.ts`; golden huella and
`inmutabilidad` unedited; `scripts/alert-codes.test.ts` for PR 2's new code. The page opened and looked at in both themes and at phone width.

## 5. Not in this plan

- Cloud-side work: Cloud already relays the dashboard (row 7). Any Cloud page of its own is
  Cloud's repository. Whether Cloud's relay limits a long or large response (the month's ZIP) is
  in Cloud's repository and was not checked; PR 2 says so.
- Purchases (invoices received) and the billing records' XML: the research asks for invoice copies;
  AEAT already holds the records.
- A664's archive reader for years past the box's own data.
