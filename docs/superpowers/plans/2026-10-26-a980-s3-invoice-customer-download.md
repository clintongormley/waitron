# A980 slice S3: find an invoice customer by tax number, and download what the box holds about them

**Status: plan, 2026-10-26. Not yet reviewed. Nothing was built when this was written.** Design:
[A980 data protection, revision 2](../specs/2026-10-22-a980-data-protection-design.md) §2.2 (the
customer rows c1 and c2, and "Customer data that exists today"), §4.2 (the worked example "invoice
customer": Jordi Puig, NIF 12345678Z), §4.3(b), §5.3 row S3 (its tests: "sole-trader fixture;
`es 12345678z`, `ES12345678Z` and `12345678 Z` all find it; a company NIF is found too; nothing
from other customers; a manager refused"), §8 owner answer O5. Overview:
[the build plan](2026-10-24-a980-data-protection-build.md), row S3 and its "S3." note ("The export
holds the invoice PDFs through the existing route, the name, NIF and address on each, the addresses
each was emailed to and when, and one line saying each was sent to the Tax Agency"). It builds on
[S2a1](2026-10-24-a980-s2a1-own-download.md) (the ZIP writer), [S2a2](2026-10-25-a980-s2a2-own-download-ui.md)
(the README and its words file), [S2c](2026-10-25-a980-s2c-actions-admin-download.md) (the
`personal_data.export` permission, the admin route's order of checks, write-lock turns of its own,
nothing written, the refusal that offers an administrator's sign-in) and
[S2d](2026-10-25-a980-s2d-line-voids.md) (this plan's shape). Branch
`feat/a980-s3-invoice-customer-download`, from `main` at `5edf18143`.

**No migration.** No index is added (decision 7). If the timing in Task 3 is over its bar, the slice
stops and the owner is asked; an index would be a later slice of its own, and that one a migration.
**FULL review**: personal data, a permission, and a read of other people's records found by a value
the caller types are risk triggers. Per-task reviews run, then `/finish-branch`, which runs two Codex
reviews, the second told to set this plan aside and test what it does not name.

**It only reads.** No sale, no fiscal record, no delivery row, no download row is written. The golden
huella test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`, its `GOLDEN` object at `:612`)
and `packages/fiscal-verifactu/src/inmutabilidad.test.ts` must pass **unedited**.

## Words used here

- A **full invoice** names its customer: their name, tax number, country and address. A
  **simplified invoice** (the till's ordinary receipt) names nobody. On an issued sale the customer
  is held in `sales.counterparty_tax_id`, `counterparty_legal_name`, `counterparty_country_code` and
  `counterparty_address`, all empty on a simplified invoice
  (`packages/db/src/schema/sales.ts:98-104`). `sales` is append-only: the box refuses to change or
  delete a row (`appendOnly("sales", …)`, `packages/db/src/classification.ts:17`).
- The **NIF** is Spain's tax identification number. The **"ES" prefix** is how Spain's NIF is written
  as an EU VAT number (`ES12345678Z`). This plan calls the NIF a **tax number** in English text.
- To **normalise** a tax number is to rewrite it in one standard spelling (decision 3), so that
  `es 12345678z` and `12345678Z` compare equal.
- The **customer** here is whoever a full invoice names. The box has no customer record: a person
  exists only as text on the invoices that name them (design §2.2).
- The **search** is the new read that lists the full invoices naming a tax number; the **download**
  is the new ZIP of what the box holds about that customer.
- A **write-lock turn** is one `db.withWriteLock` body: while it runs, a sale waits behind it
  (S2c's words, `packages/store/src/write-queue.ts`). The download's **first turn** checks the caller
  and runs the search; its **invoice turns** read one invoice each; its **re-check** checks the
  caller again before any bytes go, as `sendPersonalData` does
  (`apps/server/src/personal-data-export-api.ts:71-89`).
- A **scan** is a read that looks at every row of a table because no index can find the rows asked
  for. `sales` has no index on any `counterparty_*` column: its indexes and unique keys are on the
  series and number, the issue time, the filing state, the corrected sale and the order
  (`sales.ts:118-153`).
- A **mirror** is a read-only copy of the venue's box whose dashboard signs everyone in as an admin
  (S2c's words; `apps/server/src/mirror-session.ts`).

## What this slice builds, and what it leaves

1. **The search**, `GET /management-api/invoice-customers/personal-data?taxId=…`, under
   `personal_data.export`: the full invoices whose stored tax number normalises to the typed one.
2. **The download**, `GET /management-api/invoice-customers/personal-data/export?taxId=…`, under
   the same permission: a ZIP holding `README.txt`, `invoices.json` and one PDF copy of each invoice
   in an `invoices/` folder.
3. **The dashboard**: on **Orders**, a **Find a customer by tax number** button for whoever holds the
   permission, opening a dialog that searches, lists what it found and downloads, English and Spanish.
4. **Words**: the README's lines for the customer's download (English and Spanish, in the README's
   existing words file), the dashboard's strings, and a new section of the Users guide in both
   languages.
5. **Docs**: the backlog, the overview's status paragraph, the design's §4.2, and the owner's
   2026-10-26 decision about void reasons (Task 12).

Left for later, on purpose (each becomes a backlog point in Task 12):

- **A tax number staged on a bill that was never issued.** `working_orders` holds the customer the
  till staged for a full invoice (`recipient_tax_id` and its siblings,
  `packages/db/src/schema/orders.ts:99-102`) before the sale exists; once the sale is issued the same
  values are on the sale, which the search reads. A bill abandoned after a customer was staged keeps
  them and is not searched (not measured how often that happens).
- **A foreign customer's tax number** (decision 4): none can be stored today; when AEAT's question
  on foreign recipients is answered (asesor Q17(a)), the search's rule is revisited.
- **An index** on the customer's tax number, only if Task 3 or a box asks for one (decision 7).
- **Raw printer bytes** of a printed full invoice (`print_jobs.payload`, design §2.2 c3) are not in
  the download, as the overview's S3 note does not list them.

## Decisions this plan makes that the design does not

1. **The search lives on Orders, in a dialog.** Design §4.2 names it: "S3 adds _Orders → Find by
   tax number_". The Orders page already lists issued sales and shows each full invoice's type
   (`apps/dashboard/src/screens/orders-screen.ts:225-232`), and its own search box matches invoice
   numbers and party, delivery and table names, never a tax number
   (`apps/server/src/orders-list.ts:236-240`, `:368-377`). Default:
   - A secondary `wt-button` **Find a customer by tax number** / «Buscar un cliente por NIF» in a
     header row beside the page's heading (`orders-screen.ts:300`), drawn only when the screen's new
     `canExportPersonalData` property is true. The app sets it from the session's permissions, as it
     does for **Users** (`apps/dashboard/src/dashboard-app.ts:2552-2557`), beside the existing
     `canExport` binding (`:2547-2551`).
   - It opens `dashboard-invoice-customer-dialog`, a new app widget
     (`apps/dashboard/src/widgets/invoice-customer-dialog.ts`) built on `wt-dialog`, as
     `order-reprint-dialog.ts` is (`:228`).
   - **The server enforces the permission on both routes** (decision 13); the button's absence is
     only a convenience. A manager, a supervisor and a staff member are refused both routes (Task 6a).
   - Not on **Users**: Users lists staff, and a customer is not a person row.
     **Review focus**: a reviewer may prefer it beside S2c's **Download their data**.

2. **What the dialog shows.** One required field **Tax number** / «NIF» (`name="taxId"`, a
   `wt-input`; its hint is its placeholder "For example ES12345678Z" / «Por ejemplo, ES12345678Z»),
   a **Find** / «Buscar» button and **Close**.
   - **Zero matches**: a `role="status"` line: "No full invoice names this tax number. Letter case,
     spaces, dots, hyphens and an ES at the start make no difference, so check the letters and
     digits." / «Ninguna factura completa lleva este NIF. Las mayúsculas, los espacios, los puntos,
     los guiones y un ES al principio no cambian nada, así que revisa las letras y los números.» No
     download is offered: there is nothing to give (decision 13 for a direct call).
   - **One or more**: a count line ("1 full invoice names this tax number." / "{count} full
     invoices name this tax number.", with the Spanish twins, chosen through the dashboard's
     `countOf`, `apps/dashboard/src/widgets/count-text.ts`), then a `wt-data-table` of the invoices
     (**Invoice**, **Issued**, **Name on the invoice**, **Total**), oldest first, with no row menu, so
     no column is keyed `actions`; then a primary **Download their data** / «Descargar sus datos»
     button (the existing `person.download_data` words, `apps/dashboard/src/i18n/strings.ts:1918`,
     `:5314`). Many invoices are still one customer: every row matched the same normalised tax
     number. Different names on the rows (a sole trader's own name on one, a trading name on
     another) are shown as they are, so the admin can see them before downloading.
   - Changing the field clears the results, so **Download** always applies to the number the list
     shows; the download sends the normalised tax number the search answered with, not the field's
     text.

3. **The normaliser: one function, both sides.** `normaliseInvoiceTaxId(value)` in
   `apps/server/src/invoice-customer-tax-id.ts`: remove every whitespace character (JavaScript's
   Unicode-aware `\s`, so a tab and a no-break space go too), every hyphen and every full stop;
   upper-case; then remove one leading `ES`. The typed value and every stored value go through the
   same function, so the two sides cannot disagree.
   - **How stored values are written today.** Every product path to a full invoice validates the
     tax number with Spain's checker whatever the country, then refuses any country but Spain:
     `checkedInvoiceRecipient` (`apps/server/src/invoice-selection.ts:35-84`; the checker at `:47`,
     the refusal at `:73-77`, the stored form `taxId.normalized` at `:80`), called when the till
     stages the customer (`apps/server/src/working-order.ts:1555-1556`, `:4213-4214`) and again when
     the sale is filed (`invoice-selection.ts:128-146`); `recordSale` runs the country pack's checker
     once more (`packages/core/src/counterparty.ts:13-31`, called at
     `packages/core/src/record-sale.ts:172-173`, written at `:320-323`). The checker's written form
     is upper-case with whitespace and hyphens removed (`compact`,
     `packages/country-es/src/spain.ts:17-19`), and it accepts no `ES` prefix: every form it accepts
     starts with a digit, `X`/`Y`/`Z`, `K`/`L`/`M`, or an entity letter followed by a digit
     (`spain.ts:40-84`). So the stored side is already normalised by its writer; the function still
     runs on it, so a value written another way (a test, a future writer) is matched by the same
     rule.
   - **Why strip hyphens and dots.** People write a DNI as `12.345.678-Z`. The till's checker already
     removes hyphens; it refuses dots (`spain.ts:83`), but no NIF form holds either character, so
     removing them cannot make two different stored numbers equal.
   - **Why stripping `ES` is safe.** No stored NIF can start with `ES`: an `E` entity NIF has a digit
     second (`spain.ts:70`). So removing one leading `ES` never shortens a real number. The
     representative that a careless rule would break is an `E` entity NIF: `E12345674` must be found
     by `E12345674` and by `ESE12345674`, and a rule that drops a leading `E` or `S` would lose it
     (Task 1).
   - **Exact match only.** No prefix, suffix or partial match: `12345678` does not find
     `12345678Z`.
   - **The typed value is refused** with 400 `management.request_invalid` `{ field: "taxId" }`
     when it is missing, longer than 64 characters, or does not normalise to 1 to 20 letters A–Z and
     digits. The 20 leaves room for longer foreign numbers if they ever arrive. The value itself is
     never put in an error's params or a log line: the error boundary writes params into the log
     (`packages/server-kit/src/error-boundary.ts:42-45`); the registry forbids a secret there
     (`apps/server/src/errors.ts:16-19`), and the Verifactu backend restates the rule for an
     operator's own values (`packages/fiscal-verifactu/src/backend.ts:711-713`).
   - **No checksum check.** A mistyped number simply finds nothing; the zero-match line says what to
     check.

4. **A foreign tax number, or an `IDOtro`.** None can be stored today: the till's path refuses a
   non-Spanish customer (`invoice-selection.ts:73-77`), and so does the Verifactu record builder,
   because which `IDOtro` type a non-resident takes is open with the adviser
   (`packages/fiscal-verifactu/src/backend.ts:703-716`; `IDOtro` is AEAT's form for a non-Spanish
   identifier). A corrective invoice of a full invoice is refused too
   (`packages/core/src/correction-eligibility.ts:5-9`). `recordSubstitution`, which also writes a
   customer (`packages/core/src/record-substitution.ts:93`, `:201`), has no caller in `apps/*/src`
   (`git grep -n "recordSubstitution" -- 'apps/*/src/**' ':!*.test.ts'` printed nothing on
   2026-10-26). Default: the same rule applies to any stored value, so a foreign number written as
   `FR12345678901` is found by `fr 12345678901`; nothing else is built, and a backlog point says the
   rule is to be revisited when foreign customers can be invoiced.

5. **What the search reads: issued sales only, every node.** It reads `sales` rows whose
   `counterparty_tax_id` is set, at any node (a customer's data is everything the box holds, and a
   mirror's sales carry the origin's node id). Not the staged copy on `working_orders`, not
   `print_jobs`, and not the fiscal module's tables directly: the shared server code may not import
   the regime (`scripts/module-seams.test.ts:10-31`), so the filed record is reached only through
   the backend's own `filedReceiptFor` (decision 11).

6. **The reads and their turns.** Each turn is `db.withWriteLock` with no `withTransaction` around
   it, as `sendPersonalData` does and says why (`personal-data-export-api.ts:67-71`: the change-log
   drain is a write a full disk refuses); turns are awaited one after another, never `Promise.all`.
   - **The search's one statement.** `select id, counterparty_tax_id from sales where
     counterparty_tax_id is not null`, through `db.all(sql…)` so drizzle builds no objects for
     columns it does not need, **with no `ORDER BY`**; the rows are filtered in JavaScript with
     decision 3's function. Then, in the same turn, the matched ids' own columns by primary key, at
     most 500 ids a statement (S2c's `SALE_LOOKUP_CHUNK`), joined to `invoice_series` for the code:
     id, series code, invoice number, `issued_at`, the four `counterparty_*` columns, `total`; sorted
     in JavaScript by `issued_at`, then id.
   - **Why no `ORDER BY` in the scan.** A probe (below) found that ordering the scanning statement
     by `issued_at` made SQLite walk `sales_tenant_issued_idx` and fetch every row by its position,
     171.1 ms against 121.2 ms without it, at the same size.
   - **The search route** runs the caller's check and the search in one turn.
   - **The download** takes: the **first turn** (the caller's check, the query check, the node's
     place and time zone, the tenant, the search); then **one invoice turn per matched invoice**, in
     order, each reading that invoice's document with the existing reader
     (`readInvoiceDocument`, `apps/server/src/invoice-document.ts:32-161`), whether the backend holds
     a filed record of it (`backend.filedReceiptFor`, `packages/fiscal/src/backend.ts:423`) and its
     email deliveries (`invoice_deliveries` where `sale_id` is the invoice and `medium = 'email'`,
     ordered by `created_at`, then id; both unique indexes on that table start with `sale_id`,
     `packages/db/src/schema/invoice-deliveries.ts:108-109`); then the PDFs are rendered **outside
     any turn** (the renderer is CPU work, `apps/server/src/invoice-pdf.ts:7-29`); then the
     **re-check**, one turn, the caller's check again, before the ZIP is sent.
   - **Consistency.** An email recorded between the first turn and an invoice's turn may appear:
     harmless, it happened before the copy was sent (S2c decision 4's reasoning). No invoice can
     disappear between turns: `sales` refuses deletes (`classification.ts:17`).
   - **A probe run for this plan**, raw `node:sqlite` with Node v26.11.1 on this Mac (Apple M5 Pro):
     every core migration from this worktree, then 1,000,000 sales with every column filled, one in
     twenty naming one of 40,000 customers (50,000 rows), the searched customer on 62 of them; the
     same again with one in five (200,000 rows, the customer on 250). Medians of 12 runs, all plans
     `SCAN sales`:

     | The stored side compared | 50,000 named | 200,000 named |
     | --- | --- | --- |
     | normalised in JavaScript (this plan) | 97.2 ms | 192.5 ms |
     | `replace(upper(…), ' ', '')` in SQL | 84.4 ms | 120.8 ms |
     | five `replace`s and the `ES` strip in SQL | 121.2 ms | 264.6 ms |
     | the same, with `ORDER BY issued_at, id` | 171.1 ms | 309.4 ms |
     | exact equality, no normalising | 80.0 ms | 86.6 ms |

     Scripts and the commands are in `/Users/clintongormley/waitron-campaign-b/a980-s3-plan-probe/`
     (`real.mjs` migrates, `load.mjs <db> 1000000 20` loads, `q.mjs` and `q2.mjs` time). These are
     lower bounds: no drizzle, no caller's check, a warm page cache. Normalising in JavaScript beat
     doing the same in SQL; the scan itself is most of the cost.

7. **The timing and its stop rules** (Task 3, before any route or screen). The fixture: 1,000,000
   sales, about six years of a venue ringing 450 sales a day, the size S2c timed its turns at
   (S2c Task 3). Nobody has measured what share of a restaurant's sales are full invoices; one in
   twenty (50,000) is taken as a generous share for a busy venue, and one in five (200,000) as a
   stress case to show how the cost grows. The searched customer, a business that takes an invoice
   every week for six years, is on 300 invoices, each issued through the real filing code with
   three lines, half of them emailed. Default, on this Mac, median of at least 12 runs:
   - **The search turn** (caller's check, normalising, the scan, the matched rows' columns) over
     **250 ms** at one in twenty: **stop**.
   - **The download's first turn** over **250 ms** at one in twenty: **stop**.
   - **An invoice turn** over **50 ms** median, or any single one over **250 ms**: **stop**. The
     customer's 300 turns run one after another with sales served between them; the 250 ms is S2b's
     and S2c's bar for any one turn (S2c decision 4).
   - **The longest time the event loop was blocked** during the whole download
     (`perf_hooks.monitorEventLoopDelay`'s `max`) over **250 ms**: **stop**. The PDF renderer lays a
     page out synchronously, on the thread that serves sales (`invoice-pdf.ts:18-29`; the backlog's
     measure-on-a-box point records a 2.6 s working-time PDF on that thread).
   - **The one-in-five arm** is recorded and reported in the pull request, with no stop: it is a
     stress figure, not a busy venue's history. If it is over 250 ms, that goes in the PR's FYI for
     the owner.
   - **To stop** means: commit nothing further, write the numbers down, and ask the owner through
     the coordinator. The options to put to them: an index on the stored tax number as its own
     migration slice (every writer already stores one spelling, decision 3, so a plain equality
     index could serve it), or comparing the stored side exactly, without normalising it (80.0 and
     86.6 ms in the probe).
   - Every figure goes in the pull request and in the backlog's "measure on a box" point.

8. **What the ZIP holds.**

   ```text
   jordi-puig-electrician-2026-10-26.zip
     README.txt
     invoices.json
     invoices/F-1.pdf
     invoices/F-2.pdf
     invoices/F-5.pdf
   ```

   `invoices.json`, keys in this order:

   ```text
   { taxId,
     invoices: [{ invoice, issuedAt, name, taxId, countryCode, address, total, pdf, taxRecord,
                  emails: [{ to, requestedAt, status, sentAt }] }] }
   ```

   - The top-level `taxId` is the normalised number searched. Each invoice's `invoice` is its number
     as printed, `formatInvoiceNumber(code, number)` (`packages/core/src/record-sale.ts:105-107`,
     `"F/2"`); `issuedAt` is `issued_at` as stored; `name`, `taxId`, `countryCode` and `address` are
     the four `counterparty_*` columns as stored; `total` is `centsToDecimal(total)` (`"112.40"`);
     `pdf` is the PDF's path in the ZIP; `taxRecord` is decision 11's flag.
   - `emails` lists the invoice's email deliveries (`invoice-deliveries.ts:57-127`): `to` is
     `recipient` (set exactly when the medium is email, `:122-125`), `requestedAt` is `created_at`,
     `status` is the stored `queued`, `sending`, `sent`, `failed` or `unknown` (`:22`), and `sentAt`
     is `completed_at` when the status is `sent`, else null (the email outcome writes `completed_at`
     only for `sent`, `apps/server/src/invoice-delivery.ts:350`). Paper and A4 prints are not emails
     and are left out, as is who asked for each email (`person_id`, a staff member), its request
     key, claim and failure codes.
   - Ordered by `issued_at`, then sale id; emails by `created_at`, then id. The ids are read for the
     order and never written.
   - Left out of `invoices.json`: the lines, VAT and payments, which are in each PDF; the operator
     and anyone who authorised the sale (staff, S2c's territory); the venue's own domicile.
   - **The PDFs are named as the existing route names them**: the series code with anything outside
     `A-Za-z0-9_.-` replaced by `_`, a hyphen, the number, `.pdf`
     (`apps/server/src/orders-invoice-pdf.ts:29`). That expression moves into an exported
     `invoicePdfFileName(code, number)` in the same file, used by both (Task 4). Two series codes
     that differ only in a replaced character could give one name; the build throws rather than
     overwrite (Task 4 pins it).
   - No row, no ZIP: a download with no matching invoice is refused (decision 13).

9. **The PDFs come from the existing reader and renderer, not the existing route.** The route,
   `POST /management-api/orders/:id/invoice-pdf` (`apps/server/src/orders-api.ts:364-383`), finds
   the sale by its **bill** id, requires `report.export`, runs in `withTransaction`, and **writes**
   an `invoice_pdf_downloads` row (`orders-invoice-pdf.ts:11-31`, the insert at `:24`). The download
   instead calls the two functions that route calls, `readInvoiceDocument` (`orders-invoice-pdf.ts:23`)
   and `renderInvoicePdf` (`orders-api.ts:376`), with `duplicate: true` as the route sets
   (`orders-invoice-pdf.ts:26`). So there is no second renderer and the PDF is the one the route
   gives. **If any invoice's document or PDF cannot be produced**, the whole download fails and
   nothing is sent, as any part that throws fails S2c's download: the part logs
   `invoice_customer.pdf_failed` at `error` with the sale id only (a sale id is not personal data)
   and rethrows; the boundary answers 500 `server.internal` (`error-boundary.ts:47-49`). Default:
   no partial copy, because an admin would hand it over without knowing an invoice was missing.
   `readInvoiceDocument` throws on a sale with no customer (`invoice-document.ts:46-47`, which the
   search cannot return) or no taxpayer (`:87`), both faults.

10. **The README: a function of its own, in the same words file, in the venue's language.**
    - `invoiceCustomerReadme(input)` in `apps/server/src/personal-data-readme.ts`, beside
      `personalDataReadme` (`:21-53`), sharing `fill` (`:17-19`) and the shared lines of
      `PERSONAL_DATA_README_WORDS` (title, prepared, the headings, `machineReadable`, `backup`,
      `decides`, `rights`, `ask`, `notice`, `unnamedVenue`;
      `apps/server/src/i18n/personal-data-readme.ts:137-151`, `:264-280`). The staff README's text
      and its tests are not touched: its `origin` sentence speaks of staff entering "your details"
      (`:139-140`), which is not how a customer's data arrived.
    - Its own words go in a new `INVOICE_CUSTOMER_README_WORDS` record in the same file, English
      and Spanish (Task 5 gives the text and what backs each sentence).
    - **The language.** S2c's rule for someone else's download is that person's saved language,
      else the venue's (S2c decision 10, `personal-data-export-api.ts:152-154`). A customer has no
      saved language, so: the venue's, `resolveActiveLocale(null, venueLocale)` then the route's
      `toLanguage` (`:47`). **Open decision for the owner** (FYI, built with this default): the
      language the newest invoice was issued in (`sales.locale`) would follow the customer more
      closely. Worked example: a Spanish venue invoices a visiting English sole trader in English;
      under the default his README is in Spanish.
    - "Prepared for {name}" and the ZIP's name use the name on the **newest** invoice, through
      `archiveFileName` (`apps/server/src/download-archive.ts:36-38`).

11. **The "sent to the Tax Agency" line, per invoice.** A filed record exists only under a regime
    that keeps one: the no-regime backend answers `filedReceiptFor` with nothing
    (`packages/fiscal-none/src/backend.ts:78-80`), Verifactu with the record it filed
    (`packages/fiscal-verifactu/src/backend.ts:355-367`), and those two are the only regimes
    (`ls packages | grep fiscal` on 2026-10-26: `fiscal`, `fiscal-none`, `fiscal-verifactu`).
    Verifactu's record names the customer by name and NIF only, never the address
    (`backend.ts:709-721`, `NombreRazon` and `NIF`).
    - Default: each invoice's `taxRecord` is `filedReceiptFor(db, saleId) !== undefined`, read in
      its invoice turn; the README's line is written only when at least one invoice has it: "For each
      invoice marked "taxRecord": true in invoices.json, the box keeps a tax record that it sends to
      the tax authority (in Spain, the Agencia Tributaria); that record holds your name and tax
      number, not your address." A commented decision at the site says what the flag rests on and
      what would make it wrong: a future regime that keeps records without sending them.
    - **Review focus**: the sentence says "sends"; a record may still be waiting to go.

12. **Nothing is recorded, as S2c records nothing.** S2c's admin download writes no row and leaves
    the admin session's last-seen time alone (`authorizeManager(…, { touch: false })`,
    `personal-data-export-api.ts:140-144`; its "changes no row" case,
    `apps/server/src/personal-data-export-api.staff.test.ts:340-356`). Default: neither the search
    nor the download writes anything, an `invoice_pdf_downloads` row included. **Open decision for
    the owner** (FYI, built with this default): the order's detail dialog lists who downloaded the
    invoice's PDF (`apps/server/src/orders-list.ts:672`), so a copy given out through S3 will not
    show there. Worked example: Jordi asks on 5 October; the admin downloads his ZIP; the next day a
    manager opens bill F/2 on **Orders** and sees no PDF download. The design's §4.5 says the box can
    tell "who downloaded an invoice PDF"; after S3 that is true only of the Orders page's own button.

13. **The routes, their checks in order, and their refusals.** Both routes run, inside their first
    turn, in this order, S2c's order (decision 8 of that plan):
    1. `authorizeManager(db, { managementSessionId, permission: "personal_data.export", touch:
       false })` (`packages/identity/src/manager-login.ts:162-175`): no cookie 401
       `management_session.required` (before the turn), ended or idle 401, a disabled caller 403
       `person.suspended`, no permission 403 `authorization.not_permitted`
       `{ permission: "personal_data.export" }`. **Checked before the query**, so a refused caller
       gets one answer whatever they typed.
    2. The query: any key but `taxId`, or `taxId` given twice: 400 `management.request_invalid`
       `{ field: "query" }`; then decision 3's check, `{ field: "taxId" }`.
    3. The search.
    - The search answers 200 `{ taxId, invoices: [{ invoice, issuedAt, name, total }] }`, possibly
      empty, with `Cache-Control: no-store`.
    - The download with no matching invoice answers 404 **`invoice_customer.not_found`** with empty
      params, a new code (`apps/server/src/errors.ts`), because the path's object is missing (the
      house status rule S2c cites, `docs/developers/conventions-data.md:37-40`). The dashboard never
      offers a download for zero matches and no product code deletes a sale, so from the dashboard
      it means a fault (decision 16).
    - The download sets `Content-Type: application/zip`, the file name, `Cache-Control: no-store`
      and `X-Content-Type-Options: nosniff`, as S2c's does (`personal-data-export-api.ts:99-105`).
    - Both use `withPersonalDataErrors` (`:35-45`), which gains `"invoice_customer.not_found": 404`;
      a missing entry would answer 400, the boundary's default (`error-boundary.ts:42`).
    - The re-check repeats step 1 only; an admin demoted while the PDFs render gets 403 and no file.

14. **Mounted from `boot.ts`, beside the Orders routes; on a mirror it answers.** The download needs
    the fiscal backend and the till's configuration for `readInvoiceDocument`, which
    `mountOrdersApi` already receives (`apps/server/src/orders-api.ts:134-142`, called at
    `apps/server/src/boot.ts:2114-2124`) and `mountMeApi`, where S2c's routes live, does not
    (`apps/server/src/me-api.ts:122-134`). Default: a new `mountInvoiceCustomerDataApi(app, deps,
    log)` in `apps/server/src/invoice-customer-data-api.ts`, called right after `mountOrdersApi` with
    `{ db, backend: tillBackend, till, nodeId: dataNodeId, venueLocale, privacyNoticeUrl:
    config.privacyNoticeUrl, now }`. `dataNodeId` is the node whose data the read paths show, the
    origin's on a mirror (`boot.ts:1650-1663`); it is used only for the time zone. `mountOrdersApi`
    is called outside the `!fencedOrMirror` block (`boot.ts:1894-1975`), so on a mirror the new
    routes are mounted and, being GETs, pass the read-only gate (`apps/server/src/read-only-gate.ts:17`,
    `:32-38`), as S2c's admin route does (S2c decision 9). Task 7 pins it with one mirror case.
    `venuePlace` and `toLanguage` (`personal-data-export-api.ts:47`, `:49-57`) are exported for
    reuse, not copied.

15. **No new permission, no new dependency.** The routes use S2c's `personal_data.export`
    (`packages/identity/src/permissions.ts:18`); `@waitron/server` already declares `fflate` and
    imports `@waitron/core`, `@waitron/fiscal` and `@waitron/db`
    (`apps/server/src/download-archive.ts:1`, `invoice-document.ts:3-13`).

16. **The dialog's states, its draft, and its refusals.**
    - **Find** is a button that is not a save: drawn quiet and disabled while the field is empty or
      invalid, primary once it can act, and loading while its request is out (home CLAUDE.md §3,
      A416 and A427). The field is checked with decision 3's rule on the client too: an invalid value
      shows "Use only letters and digits; spaces, dots, hyphens and an ES at the start are ignored."
      / «Usa solo letras y números; se ignoran los espacios, los puntos, los guiones y un ES al
      principio.» under the field and the form's `form.fix_fields` line above the buttons
      (`strings.ts:773`, `:4152`); the same words show under the field when the server refuses
      `{ field: "taxId" }`.
    - **A draft scope**, as the attendance export dialog has, a dialog that downloads a file
      (`apps/dashboard/src/widgets/attendance-export-dialog.ts:160-185`, committing after a
      download at `:305`): the draft is `{ taxId }`, committed on open, after every answered search
      and after a download, so closing with an unsearched number asks before discarding it; a
      `*.unsaved.test.ts` beside it.
    - **Download** follows S2c's states (S2c decision 11): disabled while out; a `role="status"`
      line "Preparing a copy of the customer's data…" / «Preparando una copia de los datos del
      cliente…»; the file saved under the server's name, else `invoice-customer-data.zip`, the
      address released, as **Users** does (`apps/dashboard/src/screens/staff-screen.ts:127-134`);
      closing the dialog or leaving drops a late answer (a counter, `:116`, `:123`, `:128`).
    - **Refusals**, each under the table with `role="alert"` until the next press, never disabling
      the action: `authorization.not_permitted` reads "Only an administrator can find and download a
      customer's data, and this account can no longer do it. Sign in as an administrator to do it:
      this signs you out here first." / «Solo un administrador puede buscar y descargar los datos de
      un cliente, y esta cuenta ya no puede hacerlo. Inicia sesión como administrador para hacerlo:
      antes se cierra tu sesión aquí.», with S2c's **Sign in as an administrator** button
      (`staff.sign_in_as_admin`, `strings.ts:1185`) dispatching `admin-sign-in` (bubbling,
      composed), which the app answers with its logout as it does for **Users**
      (`dashboard-app.ts:2558`); `invoice_customer.not_found` on a download reads "The box listed
      these invoices a moment ago and now finds none. That is a fault in Waitron." / «La caja
      mostró estas facturas hace un momento y ahora no encuentra ninguna. Es un fallo de Waitron.»
      (S2c decision 12's «la caja»); anything else shows `codeMessage(code)`.
    - `apps/dashboard/src/i18n/codes.ts` gains `invoice_customer.not_found`, both languages ("No full
      invoice names that tax number." / «Ninguna factura completa lleva ese NIF.»), as its header
      asks (`codes.ts:4`).
    - The API client gains `findInvoiceCustomer(taxId)` and `downloadInvoiceCustomerData(taxId)`,
      GETs with `encodeURIComponent`, the second `{ as: "file" }`, as `downloadPersonalData`
      (`apps/dashboard/src/api/client.ts:2368-2375`). Neither is passive: a person pressed it.
    - No help badge and no guide link in the dialog; the guide section is reached from the guide.

17. **The guide.** A new section in the Users guide, after "Download another person's data"
    (`apps/server/src/guide/en/staff.md:46-53`; Spanish `apps/server/src/guide/es/staff.md:50-58`):
    **Download an invoice customer's data** `{#invoice-customer-data}` / «Descargar los datos de un
    cliente de factura» `{#invoice-customer-data}`. The Users page is where the guide already
    explains both data downloads; no guide page exists for Orders
    (`ls apps/server/src/guide/en/` on 2026-10-26). Task 10 gives the text.

18. **The owner's 2026-10-26 decision on void reasons** is recorded in Task 12: keep each
    adjustment's reason in `adjustments.json` as the venue named it. The open "Owner question: a void
    reason that names someone" (`docs/backlog/data-protection.md:149-155`) is deleted and the answer
    moves under that file's "Decisions and deliberate limits".

## Open decisions for the owner (FYI, built with the default)

- **The README's language** (decision 10): the venue's, not the language of the customer's newest
  invoice. With its worked example.
- **No record of who downloaded a customer's copy** (decision 12): the order's PDF-download list does
  not show S3's copies. With its worked example.
- **On a mirror the search and the download answer** (decision 14), as S2c's admin route does.
  Worked example: the owner opens the mirror on the office laptop and, signed in as the mirror's
  admin, finds Jordi by tax number and downloads his invoices.
- **The one-in-five timing figure** (decision 7), if it is over 250 ms.

## Global constraints

- **English only** in code, identifiers, comments, fixtures and tests. Spanish only in
  `apps/server/src/i18n/personal-data-readme.ts`, `apps/server/src/guide/es/staff.md`, the Spanish
  half of `apps/dashboard/src/i18n/strings.ts` and `apps/dashboard/src/i18n/codes.ts`. A test of
  Spanish text reads its expected words from the words file or the strings file. People's names in
  fixtures are names (Jordi Puig); addresses and company names are English ("12 Harbour Road, 46023
  Valencia", "Puig Electrical Ltd").
- **Nothing is written.** No `withTransaction`; every read in `db.withWriteLock` turns, awaited one
  after another. At the end of the slice `git diff --name-only main -- packages/` prints nothing:
  no package changes, so `packages/fiscal-verifactu`'s golden huella test and `inmutabilidad.test.ts`
  run unedited and pass.
- **No tax number, name or email in an error's params or a log line.** The only new log line carries
  a sale id (decision 9).
- **Every database test uses `useVenueDb`.** Every refused request asserts the domain error code and
  status. Exact shapes use `toEqual` or `toBe`, never `toMatchObject`.
- **Fixtures use values the two sides could treat differently**: tax numbers whose letter matters
  (`12345678Z`, so `z` and `Z` differ); an `E` entity NIF (`E12345674`), which a rule dropping a
  leading `E` or `S` would lose; a NIE (`X1234567L`); another customer who shares Jordi's surname,
  so a search by name would mix them (`Puig Electrical Ltd`, `B76543214`); a stored value written
  outside the checker (`es 12345678z` inserted raw), so a rule normalising only the typed side
  fails; amounts whose cents matter (`48.35`, not `48.00`); two different names on Jordi's
  invoices, so the newest-name rule shows; an email that failed and was retried to another address.
  Each tax number is checked valid with `validateSpanishNif` in the fixture, so the fixture is one
  the till could have written.
- **Existing assertions that change on purpose**, each named in the pull request:
  `apps/server/src/guide-content.test.ts:156-163` (the Users page's section ids gain
  `invoice-customer-data` after `person-data`). No other existing assertion is expected to change.
  `apps/server/src/orders-invoice-pdf.test.ts` passes unedited after the file-name function moves
  (Task 4 runs it).
- **Coverage**: `@waitron/server` and `@waitron/dashboard` hold 98/98/98/95. No exclude or ignore
  comment. Neither is mutation-tested (`ls packages/*/stryker.config.json`: `db`, `fiscal`,
  `shared`, `ui-core`, `ui`).
- **Fixture code stays in test files**; existing helpers are used as they are
  (`apps/server/src/testing/order-venue.ts`, `testing/bill-venue.ts`).
- **Greps** use the pathspec `'packages/*/src/**' 'apps/*/src/**'`, and a grep's control the same
  pathspec. Under `git grep -E`, "or" is a plain `|`, and a word's end is `([^a-z_]|$)`, not `\b`
  (S2d's global constraints).
- Commits `git commit -s`; `pnpm format:check` before each commit.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing or
  cleanly failing point, commits, and hands over: what is done, what is left, the files, each
  check's state.
- Browser suites: check `memory_pressure | grep free` first.

## Review focus

- **Whose data**: only invoices whose stored tax number normalises to the typed one; the ZIP names
  no other customer and no staff member; Task 4's "only his" and Task 6b's worked example.
- **The normaliser** (decision 3): one function on both sides; the `E` entity and raw-stored cases;
  exact match only; the refusal never echoes the value.
- **The permission** (decision 13): checked before the query, on both routes, again in the re-check;
  a manager, a supervisor and a staff member refused; Task 6a's proofs by deletion.
- **The turns and the timing** (decisions 6 and 7): no `ORDER BY` in the scan; one turn per invoice;
  PDFs rendered outside any turn; Task 3's numbers and stop rules.
- **The PDFs** (decision 9): the existing reader and renderer, no download row written, whole
  download fails if one cannot be made.
- **The tax-record sentence** (decision 11): per invoice, regime-neutral flag, "sends" while a record
  may still wait.
- **Nothing recorded** (decision 12), and the README's language (decision 10): both FYI to the owner.
- **The mount** (decision 14): `boot.ts`, beside Orders; answers on a mirror.
- **Every README and guide sentence against its source** (Task 5's and Task 10's tables).
- **Codex run-it seat**: two reviews, the second told to set this plan aside.

## The fixture used by Tasks 2, 4 and 6

A venue from `provisionOrderVenue` (`apps/server/src/testing/order-venue.ts:45`) with every set
migrated (`migrationOptionsFor(manifestSets(), null)`), and its full series, found as
`orders-invoice-pdf.test.ts:41-45` does. Each full invoice is written through `recordSale` with a
counterparty, on a new parked bill, exactly as `fullInvoice` in `orders-invoice-pdf.test.ts:49-80`
does, with the values below and three lines each (amounts adding to the total). Its email
deliveries are inserted into `invoice_deliveries` with the columns the email path writes
(`medium: "email"`, `designation: "original"`, a `requestKey`, a `generation` counting from 1, a
staff `personId`, `recipient`, `status`, `createdAt`, and `completedAt` only for `sent`). The
venue's clock is advanced between sales so each `issued_at` is distinct and in table order (the
chain refuses a record dated before the latest, home CLAUDE.md §4).

| Row | Invoice | Name | Tax number written | Address | Total | Emails |
| --- | --- | --- | --- | --- | --- | --- |
| j1 | first | Jordi Puig | `12345678Z` | 12 Harbour Road, 46023 Valencia | 48.35 | `jordi@example.test`, sent |
| p1 | second | Puig Electrical Ltd | `B76543214` | 4 Mill Lane, 46001 Valencia | 310.07 | `office@puig-electrical.example.test`, sent |
| j2 | third | Jordi Puig Electrician | `12345678Z` | 3 Port Avenue, 46024 Valencia | 112.40 | `jordi@example.test`, failed; then `invoices@jordi.example.test`, sent |
| a1 | fourth | Ana Garcia | `X1234567L` | 9 Rose Street, 46010 Valencia | 23.18 | none |
| c1 | fifth | Main Street Residents | `E12345674` | 1 Main Street, 46002 Valencia | 75.55 | `board@mainstreet.example.test`, queued |
| j3 | sixth | Jordi Puig Electrician | `12345678Z` | 3 Port Avenue, 46024 Valencia | 23.95 | none |
| s1 | a simplified sale | (none) | (none) | (none) | 9.90 | none |

Jordi's download therefore holds j1, j2 and j3 in that order, his README is "Prepared for Jordi Puig
Electrician", and none of p1's, a1's or c1's names, numbers, addresses, totals or email addresses
appears in it. Task 2's raw case adds its own rows.

## Task 1 — the normaliser and the query check

Files: `apps/server/src/invoice-customer-tax-id.ts` (new), `apps/server/src/invoice-customer-tax-id.test.ts`
(new).

Interface:

```ts
/** One spelling for a tax number: no whitespace, hyphens or full stops, upper-case, one leading
 * "ES" removed. Used on the typed and the stored side alike. */
export function normaliseInvoiceTaxId(value: string): string;
/** The query's `taxId`, normalised; refuses `management.request_invalid` `{ field: "taxId" }`. */
export function requiredInvoiceTaxId(raw: string | undefined): string;
```

1. Tests first, table-driven with `it.each`:
   - each of `es 12345678z`, `ES12345678Z`, `12345678 Z`, `12.345.678-Z`, `\t12345678z `,
     `Es12345678z` normalises to `12345678Z`;
   - `E12345674` and `ESE12345674` and `es e1234567-4` normalise to `E12345674`; `X1234567L` and
     `esx1234567l` to `X1234567L`; `B76543214` stays;
   - `ESES12345678Z` normalises to `ES12345678Z` (one prefix only), and `12345678` stays `12345678`
     (nothing added);
   - `requiredInvoiceTaxId` refuses, each with `{ field: "taxId" }` and nothing else in its params:
     `undefined`, `""`, `"   "`, `"ES"`, a 65-character string, `"12345678Ñ"`, `"1234/5678Z"`, and a
     21-character alphanumeric value; it accepts a 20-character one.
   Run `pnpm --filter @waitron/server exec vitest run src/invoice-customer-tax-id.test.ts`; watch it
   fail (no module).
2. Write the two functions (the file imports `./errors.js`, as every throwing file does,
   `apps/server/src/errors.ts:20-21`).
3. Omission controls, each run and reverted, the failing case recorded for the pull request: strip
   only spaces (`/ /g`) → the tab and no-break-space row fails; strip `^E?S?` instead of `^ES` → the
   `E12345674` row fails; strip `ES` everywhere → `ESE12345674` fails; put the raw value in the
   refusal's params → the params assertion fails.
4. Run `pnpm --filter @waitron/server typecheck`.

## Task 2 — the search read

Files: `apps/server/src/invoice-customer-data.ts` (new), `apps/server/src/invoice-customer-data.search.test.ts`
(new).

Interface:

```ts
export interface InvoiceCustomerSale {
  saleId: string; invoice: string; issuedAt: string; name: string; taxId: string;
  countryCode: string; address: string; total: string;
}
/** Decision 6's search: one statement over the sales naming a customer, filtered by
 * `normaliseInvoiceTaxId`, then their columns by key. Call it inside a write-lock turn. */
export async function findInvoiceCustomerSales(
  db: Database, taxId: string, options?: { chunk?: number },
): Promise<InvoiceCustomerSale[]>;
```

1. Tests first (`useVenueDb`, `resetPerTest: false`, every set migrated, the fixture above; each case
   calls the function inside `suite.db.withWriteLock`):
   - **Jordi exactly**: `toEqual` j1, j2, j3 in that order, every field, `invoice` as the venue's
     full series prints it, `total` `"48.35"`, `"112.40"`, `"23.95"`.
   - **The company, the NIE and the `E` entity** are each found alone by their own number.
   - **No partial match**: `12345678` and `2345678Z` find nothing.
   - **The stored side is normalised too**: in a case with its own sale, insert one `sales` row
     directly (copy every column of j1's row, a new id and invoice number, `counterparty_tax_id`
     `es 87654321x`; `sales` refuses updates and deletes, not inserts); `87654321X` finds it.
   - **The simplified sale** is never returned, and a search for a number nobody holds returns `[]`.
   - **The statement**: copy `planningEveryStatement` from
     `packages/workforce/src/personal-data.test.ts:1076-1120` and record the search's statements:
     the first's text holds no `order by`, and the matched-row statements take at most 500 ids each
     (a case with the chunk lowered through an optional `{ chunk }` argument, as S2c's
     `actionsPersonalData(db, { chunk })` does, and 3 matches → two statements).
   Run `pnpm --filter @waitron/server exec vitest run src/invoice-customer-data.search.test.ts`;
   watch it fail.
2. Write the function.
3. Omission controls, each run and reverted: compare the stored value without normalising it → the
   raw-stored case fails; add `order by issued_at` to the scan → the statement case fails; match with
   `includes` → the partial case fails.
4. Run `pnpm --filter @waitron/server typecheck`. Read each count.

## Task 3 — time the search, the first turn, the invoice turns and the PDFs, before anything else is built

Files: none committed. A throwaway `apps/server/src/zz-s3-timing.test.ts`, deleted at the end (`git
status --short` shows nothing of it). Results and the loader's text go to
`/Users/clintongormley/waitron-campaign-b/a980-s3-timing/`.

1. **The fixture**, in a `useVenueDb` folder with every set migrated (it opens a real directory under
   the system's temporary folder, `packages/db/src/testing/venue-db.ts:160`), a per-test timeout
   above the load:
   - `provisionOrderVenue`, an admin with a management session;
   - **the customer's 300 invoices** through `recordSale`, as the fixture above does, three lines
     each, half of them with one sent email and one in ten with a failed email first, the clock
     advanced between sales;
   - **the bulk**: 1,000,000 `sales` rows with every column filled, cloned from one of the venue's
     own simplified sales (new id, a raw-inserted series row of the venue's node so invoice numbers
     cannot collide, `issued_at` spread over six years); one in twenty names one of 40,000 other
     customers, each a valid NIF built as `validateSpanishNif` accepts. Insert in batches of 500 rows
     through `db.insert(sales).values(…)`, many batches to a `withWriteLock` turn; foreign keys may be
     switched off for the load with `pragma foreign_keys = off` outside any turn and back on after
     (S2c Task 3's note). Record the load time. If the load passes about ten minutes, halve the bulk
     and say how the figures were scaled.
   - Then, in a second folder or by loading more, **the one-in-five arm**: 200,000 named rows.
   Copy the probe's loader (`/Users/clintongormley/waitron-campaign-b/a980-s3-plan-probe/load.mjs`)
   for the row shape.
2. **Before running, write down what each failure prints**: the medians over decision 7's bars.
3. **The search turn**, at least 12 runs: inside `db.withWriteLock`, `authorizeManager` (`touch:
   false`) then `findInvoiceCustomerSales(db, "12345678Z")`; median and range; `explain query plan`
   of the scan (expected `SCAN sales`).
4. **The first turn**: the same, plus `venuePlace` and `readTenant`, composed as Task 6b will run
   them (both are in `personal-data-export-api.ts:49-57` and `@waitron/db`; export `venuePlace` in
   the throwaway's place by copying it if Task 6a has not exported it yet).
5. **The invoice turns**, for the 300 invoices: each inside its own `db.withWriteLock`,
   `readInvoiceDocument(venue.backend, db, venue.cfg, saleId)`, `venue.backend.filedReceiptFor(db,
   saleId)` and the email read; median, range and slowest. If `readInvoiceDocument` throws "write
   lock: a body asked for the lock it is already holding" (`packages/store/src/write-queue.ts:41-43`),
   stop and report: something inside it takes the lock.
6. **The PDFs**: render each outside any turn with `renderInvoicePdf({ ...document, duplicate: true
   })`; median and slowest render, total bytes; and over the whole sequence of steps 4 to 6 for one
   download, `monitorEventLoopDelay({ resolution: 10 })`'s `max`, with the whole download's wall time.
   Say whether the venue's documents carry a logo (the renderer draws a logo dot by dot,
   `invoice-pdf.ts:31-40`).
7. **The one-in-five arm**: steps 3 and 4 again.
8. **Stop rules** (decision 7): any bar crossed at one in twenty → stop, commit nothing further,
   report every figure to the coordinator with decision 7's options. Otherwise the figures go in the
   pull request and Task 12's backlog line.

## Task 4 — the download's files: invoices.json and the PDFs

Files: `apps/server/src/invoice-customer-data.ts`, `apps/server/src/invoice-customer-data.files.test.ts`
(new), `apps/server/src/orders-invoice-pdf.ts` (`invoicePdfFileName`).

Interface:

```ts
export const INVOICE_CUSTOMER_FILE = "invoices.json";
export interface InvoiceCustomerFilesDeps {
  db: Database; backend: FiscalBackend; till: TillConfig; log: Logger;
  /** Defaults to `renderInvoicePdf`; a test passes a stub. */
  render?: (document: ReceiptDocumentInput) => Promise<Uint8Array>;
}
/** Decision 6's invoice turns, then the PDFs outside any turn. Throws when any invoice cannot be
 * made, after logging `invoice_customer.pdf_failed` with its sale id. */
export async function buildInvoiceCustomerFiles(
  deps: InvoiceCustomerFilesDeps, taxId: string, sales: readonly InvoiceCustomerSale[],
): Promise<{ files: PersonalDataFile[]; anyTaxRecord: boolean; anyEmail: boolean }>;
```

1. Tests first (the fixture above):
   - **Jordi's `invoices.json`, exactly** (`toEqual` the parsed object, and its text equal to
     `jsonFile("invoices.json", expected).content`, so key order is checked): decision 8's shape;
     j2's emails in order, the failed one with `sentAt` null; `pdf` `"invoices/<code>-<n>.pdf"`
     for each; `taxRecord` as `venue.backend.filedReceiptFor` answers for each (read in the test).
   - **The PDFs**: three files at those paths, each starting `%PDF-`; read one with `pdfjs-dist` as
     `orders-invoice-pdf.test.ts:3` does and find Jordi's address and j2's total in its text.
   - **Only his**: no file's text (the PDFs' extracted text included) contains `Puig Electrical`,
     `B76543214`, `X1234567L`, `E12345674`, `310.07`, `office@puig-electrical.example.test` or
     `board@mainstreet.example.test`; and no staff `personId` from the deliveries. Positive control:
     `invoices@jordi.example.test` is found.
   - **The tax-record flag both ways**: with a backend wrapper whose `filedReceiptFor` answers
     `undefined` for j1 only, j1's `taxRecord` is false and the others true; with one answering
     `undefined` for all, `anyTaxRecord` is false.
   - **A PDF that cannot be made**: with a `till` that makes `readInvoiceDocument` throw for j2 (or a
     renderer stub through an optional `render` dependency, defaulting to `renderInvoicePdf`), the
     call rejects, and the log received `invoice_customer.pdf_failed` with `{ saleId: j2 }` and
     nothing else.
   - **Two invoices with one file name**: two series whose codes differ only in `/` and `_` (`F/A`
     and `F_A`), one invoice each with the same number → the call rejects rather than build one
     file twice.
   - **Turns**: a `db` wrapper counting `withWriteLock` calls sees one per invoice, and none is open
     while `render` runs (the stub asserts the lock is free by calling `withWriteLock` itself and
     resolving).
   Run `pnpm --filter @waitron/server exec vitest run src/invoice-customer-data.files.test.ts`; watch
   it fail.
2. Write it; move the file-name expression into `invoicePdfFileName` and use it in
   `readInvoiceForDownload` too.
3. Omission controls, each run and reverted: read the deliveries without `medium = 'email'` → (give
   j1 a receipt delivery in this case) the exact file fails; render inside the turn → the turns case
   fails; catch and skip a failed PDF → the failure case fails.
4. Run `pnpm --filter @waitron/server exec vitest run src/orders-invoice-pdf.test.ts` unedited, and
   `pnpm --filter @waitron/server typecheck`. From the root: `pnpm exec vitest run
   scripts/module-seams.test.ts` (no regime import).

## Task 5 — the README's words

Files: `apps/server/src/i18n/personal-data-readme.ts` (`INVOICE_CUSTOMER_README_WORDS`),
`apps/server/src/personal-data-readme.ts` (`invoiceCustomerReadme`),
`apps/server/src/personal-data-readme.test.ts`.

Interface:

```ts
export interface InvoiceCustomerReadmeInput {
  language: "en" | "es"; venue: string | null; customer: string; date: string;
  privacyNoticeUrl?: string; anyTaxRecord: boolean; anyEmail: boolean;
}
export function invoiceCustomerReadme(input: InvoiceCustomerReadmeInput): string;
```

Layout: title and prepared (shared, the customer's name); `filesHeading`; `- invoices.json:
{holds} {use}`; `- invoices/: {pdfs}`; `machineReadable` (shared); `notFound`; blank;
`originHeading` (shared) and this file's `origin`; blank; `sentToHeading` (shared), `- {backup}`
(shared), `- {taxRecord}` only when `anyTaxRecord`, `- {email}` only when `anyEmail`; blank;
`keptHeading` (shared), each `kept` line, `- {decides}` (shared); blank; `rightsHeading`, `rights`,
`ask` and `notice` (shared, as `personalDataReadme` writes them, `personal-data-readme.ts:45-51`).

| Key | English | Spanish |
| --- | --- | --- |
| `holds` | `the full invoices the venue issued to your tax number: for each one, its number, when it was issued, the name, tax number, country and address on it, its total, the PDF copy in this download, whether the box keeps a tax record of it, and each email address it was sent to, with when the email was asked for, whether it went and when.` | `las facturas completas que el local emitió a tu NIF: de cada una, su número, cuándo se emitió, el nombre, el NIF, el país y la dirección que lleva, su total, la copia en PDF de esta descarga, si el servidor Waitron del local guarda un registro fiscal de ella, y cada dirección de correo a la que se envió, con cuándo se pidió el envío, si salió y cuándo.` |
| `use` | `Kept because an invoice must name its customer and the venue must keep a copy of each invoice it issues.` | `Se guarda porque una factura debe identificar a su destinatario y el local debe conservar una copia de cada factura que emite.` |
| `pdfs` | `a copy of each of those invoices as a PDF, marked as a copy.` | `una copia en PDF de cada una de esas facturas, marcada como copia.` |
| `notFound` | `This copy holds what the box keeps with your tax number. Anything else the venue holds about you, such as a booking, is not found by tax number: ask the venue.` | `Esta copia contiene lo que el servidor Waitron del local guarda con tu NIF. Cualquier otro dato tuyo que tenga el local, como una reserva, no se encuentra por el NIF: pregunta al local.` |
| `origin` | `Staff at the venue entered your name, tax number and address when you asked for a full invoice; the rest was recorded as each invoice was issued and sent.` | `El personal del local introdujo tu nombre, tu NIF y tu dirección cuando pediste una factura completa; el resto se registró al emitir y enviar cada factura.` |
| `taxRecord` | `For each invoice marked "taxRecord": true in invoices.json, the box keeps a tax record that it sends to the tax authority (in Spain, the Agencia Tributaria); that record holds your name and tax number, not your address.` | `De cada factura marcada con "taxRecord": true en invoices.json, el servidor Waitron del local guarda un registro fiscal que envía a la administración tributaria (en España, la Agencia Tributaria); ese registro contiene tu nombre y tu NIF, no tu dirección.` |
| `email` | `Invoices emailed to you are sent through the email service the venue set up.` | `Las facturas que se te enviaron por correo salen a través del servicio de correo que configuró el local.` |
| `kept[0]` | `Nothing in the box deletes or changes an issued invoice: the box refuses to.` | `Nada en el servidor Waitron del local borra ni cambia una factura emitida: el servidor no lo permite.` |
| `kept[1]` | `Nothing in the box deletes the record of an invoice email.` | `Nada en el servidor Waitron del local borra el registro del envío de una factura por correo.` |

**What backs each sentence.** The implementer re-checks each row on the branch and fixes the
sentence, not the row, where they disagree; a sentence with no row is not shipped.

| Sentence | Source |
| --- | --- |
| holds: each field | decision 8's shape |
| use | design §10, R39 (RD 1619/2012 art. 6.1(c)) and R40 (art. 19.1(b)) |
| pdfs: "marked as a copy" | `duplicate: true`, decision 9 |
| notFound: "such as a booking" | `bookings` has no tax-number column (`packages/bookings/src/schema/bookings.ts:41-53`, read by the implementer) |
| origin | the till stages the customer (`working-order.ts:4199-4250`); the sale and its deliveries are written as it is issued and sent |
| taxRecord | decision 11 |
| email | `apps/server/src/invoice-email.ts:22-28` (the venue's transport) |
| kept[0] | `appendOnly("sales", …)`, `packages/db/src/classification.ts:17`; the grep below |
| kept[1] | `invoice_deliveries` is `classify`, not append-only (`classification.ts:159-163`), so this rests on the grep below; if it prints a delete, drop the sentence |

The `kept` check, re-run on 2026-10-26 from the worktree root, and its control (S2d's form):

```text
$ git grep -n -i -E '\.delete\((sales|invoiceDeliveries)\)|delete from "?(sales|invoice_deliveries)([^a-z_]|$)' -- 'packages/*/src/**' 'apps/*/src/**' ':!*.test.ts' ':!**/testing/**'; echo "exit $?"
exit 1
```

The control is S2d's: the same pattern for `line_service_cancellations` prints
`apps/server/src/line-service-state.ts:171` (S2d plan, Task 5). Re-run both on the branch.

1. Tests first: in `personal-data-readme.test.ts`, the whole English README for Jordi with
   `anyTaxRecord` and `anyEmail` true and a privacy-notice address, `toBe` the text written out in
   the test; the same in Spanish built from the two words records; with both flags false, neither
   line is present; a name holding `$&` prints as typed (S2a2 decision 5); every key of
   `INVOICE_CUSTOMER_README_WORDS.en` is in `.es` and the reverse.
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-readme.test.ts`; watch the
   new cases fail and the existing ones pass.
2. Write the words and the function.
3. Omission control, run and reverted: delete the Spanish `taxRecord` → the key-parity case fails.

## Task 6a — the two routes: permission, query, refusals, nothing written

Files: `apps/server/src/invoice-customer-data-api.ts` (new),
`apps/server/src/invoice-customer-data-api.test.ts` (new), `apps/server/src/errors.ts`
(`"invoice_customer.not_found": Record<string, never>`, with a one-line comment),
`apps/server/src/personal-data-export-api.ts` (export `venuePlace` and `toLanguage`; the boundary
gains `"invoice_customer.not_found": 404`).

Interface:

```ts
export interface InvoiceCustomerDataDeps {
  db: Database; backend: FiscalBackend; till: TillConfig; nodeId: string;
  venueLocale: string; privacyNoticeUrl?: string; now?: () => Date;
  render?: InvoiceCustomerFilesDeps["render"];
}
export function mountInvoiceCustomerDataApi(app: Hono, deps: InvoiceCustomerDataDeps, log: Logger): void;
```

1. Tests first (the fixture above, plus an admin, a second admin, a manager, a supervisor and a
   staff member with sessions, as `personal-data-export-api.staff.test.ts:119-170` sets them up;
   `registerModulePermissions(ALL_MODULE_PERMISSIONS)` in `beforeAll`, as `:115-117`):
   - **The search** for an admin: `es 12345678z` answers 200 `{ taxId: "12345678Z", invoices: [j1,
     j2, j3 as decision 13's four fields] }` with `Cache-Control: no-store`; `B76543214` answers
     p1 alone; an unknown number answers `{ taxId, invoices: [] }`.
   - **Refused callers, both routes** (`it.each` over manager, supervisor, staff): 403
     `authorization.not_permitted` `{ permission: "personal_data.export" }`, no file name header.
   - **Permission before the query**: a manager sending `?taxId=%%%` or `?other=1` gets the same 403.
   - **The query**, for an admin: `?other=1` and `?taxId=1&taxId=2` → 400 `{ field: "query" }`;
     no `taxId`, `?taxId=ES`, `?taxId=12345678%C3%91` → 400 `{ field: "taxId" }`; each response
     body is exactly `{ error: { code, params } }` with those params, and the logger's call for it
     carries exactly `{ field, requestId }`, so no typed value reaches the log.
   - **Session refusals**: no cookie 401 `management_session.required`; an ended session 401; a
     disabled admin's live session 403 `person.suspended`.
   - **The download with no match**: 404 `invoice_customer.not_found` `{}`.
   - **Nothing written**: copy S2c's case (`personal-data-export-api.staff.test.ts:340-356`): a
     search and a download leave `total_changes()`, the admin's `lastSeenAt` and a waiting
     `change_log` row unchanged, and `invoice_pdf_downloads` empty.
   Run `pnpm --filter @waitron/server exec vitest run src/invoice-customer-data-api.test.ts`; watch
   it fail.
2. Write both routes in full: the search, and the download's first turn, `buildInvoiceCustomerFiles`,
   the re-check, the README and the ZIP through `zipArchive` and `archiveFileName`
   (`download-archive.ts:36-57`). Task 6b adds the download's end-to-end cases.
3. Proof by deletion, each run and reverted: check the query before the permission → the
   permission-before-query case fails; drop `touch: false` → the last-seen assertion fails; take
   `invoice_customer.not_found` out of the boundary map → the 404 case gets 400.
4. Run `pnpm --filter @waitron/server typecheck`; from the root `pnpm exec vitest run
   scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/english-only.test.ts
   scripts/module-seams.test.ts`. (`errors-reachable` walks `packages/` only and `alert-codes`
   incident codes only, so both should pass untouched; they are run because the slice adds a code.)

## Task 6b — the download end to end: the ZIP, its language, the re-check, the worked example

Files: `apps/server/src/invoice-customer-data-api.ts`,
`apps/server/src/invoice-customer-data-api.export.test.ts` (new).

1. Tests first (same setup as 6a):
   - **Jordi's ZIP**: an admin downloads `?taxId=ES 12345678 z` (encoded): 200,
     `application/zip`, `Content-Disposition` naming `jordi-puig-electrician-<venue date>.zip`;
     the entries are exactly `README.txt`, `invoices.json` and the three PDFs; `invoices.json`
     equals Task 4's expected object; `README.txt` equals `invoiceCustomerReadme` for the venue's
     language, Jordi Puig Electrician, the venue's date, both flags as the fixture gives.
   - **The language**: with `venueLocale` `es-ES` the README's first line is the Spanish title; with
     `en-GB`, English; with an admin whose own saved locale differs, the README still follows the
     venue.
   - **The design's three spellings and the company**: `es 12345678z`, `ES12345678Z` and
     `12345678 Z` each give a ZIP with the same `invoices.json`; `es b76543214` gives p1's.
   - **The re-check**: an admin demoted to manager while the PDFs render (through the `render`
     dependency of Task 4, as S2c's `duringBuild`, `personal-data-export-api.staff.test.ts:58-69`)
     gets 403 and no `Content-Disposition`; an admin disabled meanwhile gets 403
     `person.suspended`; an ended session 401.
   - **A PDF that cannot be made**: 500 `server.internal`, no file.
   - **No secret, no staff**: the ZIP's text holds no staff member's id or name from the fixture's
     deliveries or sales, and not the admin's session token hash.
   Run `pnpm --filter @waitron/server exec vitest run src/invoice-customer-data-api.export.test.ts`.
   The cases should pass at once if Tasks 4 to 6a are right; the proof is step 3. A case that
   fails is a defect to fix in this task, said in the pull request.
2. (No new code unless a case fails.)
3. Omission controls, each run and reverted: remove the re-check → the demotion case sends a file;
   use the admin's locale → the language case fails; use the oldest invoice's name → the file name
   fails.
4. Run `pnpm --filter @waitron/server exec vitest run src/invoice-customer-data-api.test.ts
   src/invoice-customer-data-api.export.test.ts src/personal-data-export-api.staff.test.ts
   src/personal-data-export-api.test.ts`, and `pnpm --filter @waitron/server typecheck`.

## Task 7 — mounted in a real start, and on a mirror

Files: `apps/server/src/boot.ts` (one call after `mountOrdersApi`, `:2114-2124`),
`apps/server/src/boot.personal-data-export.test.ts`, `apps/server/src/boot.mirror.test.ts`.

1. Tests first:
   - In `boot.personal-data-export.test.ts`'s real start (`:29-119`): the admin's cookie gets 200
     `{ taxId: "12345678Z", invoices: [] }` from the search and 404 `invoice_customer.not_found` from
     the download; the manager's gets 403 from both. (The venue there issues no full invoice; the
     ZIP itself is Task 6b's.)
   - In `boot.mirror.test.ts`, in the mirror boot S2c's Task 8b used: the ambient viewer's cookie
     gets 200 from the search (decision 14's default, pinned).
   Run `pnpm --filter @waitron/server exec vitest run src/boot.personal-data-export.test.ts
   src/boot.mirror.test.ts`; watch them fail.
2. Add the mount.
3. Omission controls, each run and reverted: change the search's path in the mount → both new cases
   fail with 404; skip the mount when the node is a mirror → the mirror case fails.
4. Run `pnpm --filter @waitron/server typecheck`. Before committing, check no open pull request
   changes `boot.ts` (`gh pr list --state open --json number,files`); if one does, say so in the PR.

## Task 8 — the dashboard: API client, strings and the dialog's search

Files: `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/i18n/strings.ts`,
`apps/dashboard/src/i18n/codes.ts`, `apps/dashboard/src/widgets/count-text.ts` (the count key),
`apps/dashboard/src/widgets/invoice-customer-dialog.ts` (new),
`apps/dashboard/src/widgets/invoice-customer-dialog.test.ts` (new),
`apps/dashboard/src/widgets/invoice-customer-dialog.a11y.test.ts` (new).

Interface: `@customElement("dashboard-invoice-customer-dialog")` with `api: DashboardApi` and
`open: boolean`; it dispatches `wt-close` as the other dialogs do and `admin-sign-in` (decision 16).
The client gains:

```ts
export interface InvoiceCustomerSearchDto {
  taxId: string;
  invoices: { invoice: string; issuedAt: string; name: string; total: string }[];
}
findInvoiceCustomer(taxId: string): Promise<InvoiceCustomerSearchDto>;
downloadInvoiceCustomerData(taxId: string): Promise<DownloadedFile>;
```

1. Tests first (browser; mount the dialog with a stub `api`, as `staff-screen.personal-data.test.ts:55-100`
   stubs `downloadPersonalData`):
   - **Find** is disabled and quiet with the field empty, primary with text; an invalid value
     (`12/34`) shows the field's message and `form.fix_fields` and keeps it disabled.
   - Typing `es 12345678z` and pressing **Find** calls `findInvoiceCustomer` once with that text.
   - **Zero**: the status line's text equals `t("invoice_customer.none")`; no **Download** button.
   - **Three**: the count line reads the plural key filled with 3; the table shows three rows in the
     answer's order with each invoice number, the date, the name and the total formatted with
     `formatMoney`; **Download their data** is present.
   - Editing the field after a search clears the table and the button.
   - A 400 `{ field: "taxId" }` from the server shows the field's message under the field.
   - The same cases in Spanish read their expected text from the strings file.
   - **a11y**: axe in both themes for the empty, invalid, zero and three-row states (the file follows
     `attendance-export-dialog.a11y.test.ts`).
   Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/invoice-customer-dialog.test.ts
   src/widgets/invoice-customer-dialog.a11y.test.ts`; watch them fail.
2. Write the client methods, strings (English and Spanish, decision 2's and 16's words), the code's
   messages and the dialog's search half.
3. Omission controls, each run and reverted: leave **Find** enabled when empty → its case fails;
   keep the old results after an edit → the clearing case fails.
4. Run `pnpm --filter @waitron/dashboard typecheck`; from the root `pnpm exec vitest run
   scripts/native-form-fields.test.ts scripts/help-tooltip-mode.test.ts
   scripts/pinned-actions-column.test.ts scripts/style-token-names.test.ts
   scripts/primary-coloured-text.test.ts`.

## Task 9 — the dialog's download and refusals, its draft, the Orders button and the app

Files: `apps/dashboard/src/widgets/invoice-customer-dialog.ts`,
`apps/dashboard/src/widgets/invoice-customer-dialog.test.ts`,
`apps/dashboard/src/widgets/invoice-customer-dialog.unsaved.test.ts` (new),
`apps/dashboard/src/screens/orders-screen.ts`, `apps/dashboard/src/screens/orders-screen.test.ts`,
`apps/dashboard/src/dashboard-app.ts` (`:2547-2551`), `apps/dashboard/src/dashboard-app.test.ts`.

1. Tests first:
   - **Download**: pressing it calls `downloadInvoiceCustomerData` with the search's `taxId`
     (`"12345678Z"`), not the field's text; while out, the button is disabled and the status line
     shows; success saves the blob under the server's name (spy `URL.createObjectURL` and the
     anchor's `click`, as `staff-screen.personal-data.test.ts:144-155` does) and releases it; a
     second press while out does nothing.
   - **Refusals**: `authorization.not_permitted` shows decision 16's sentence and the sign-in button,
     whose press dispatches one `admin-sign-in` that crosses the shadow root; `invoice_customer.not_found`
     shows the fault sentence; `server.internal` shows `codeMessage("server.internal")`; none
     disables **Download**.
   - **Closing while a download is out** drops its answer (no anchor click after the dialog closes).
   - **Unsaved** (`invoice-customer-dialog.unsaved.test.ts`, following
     `attendance-export-dialog.unsaved.test.ts:1-60`): a typed, unsearched number asks before
     closing; after a search, closing asks nothing; after a download, nothing.
   - **Orders**: with `canExportPersonalData` false the button is absent; with true it is present
     and opens the dialog.
   - **The app** (beside S2c's cases in `dashboard-app.test.ts`): `it.each([false, true])` the
     Orders screen's `canExportPersonalData` matches `personal_data.export` in the session's
     permissions (the `true` row without `report.export`, the `false` row with it, so a binding to
     the wrong permission fails both); an `admin-sign-in` from the Orders screen calls `api.logout`
     once.
   Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/invoice-customer-dialog.test.ts
   src/widgets/invoice-customer-dialog.unsaved.test.ts src/screens/orders-screen.test.ts` and
   `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "Orders"`; watch the
   new cases fail.
2. Write the download half, the draft scope, the button and the app's binding.
3. Omission controls, each run and reverted: send the field's text instead of the answered `taxId`
   → the download case fails; bind the property to `report.export` → both app rows fail; drop the
   app's `admin-sign-in` listener → the logout case fails.
4. Run `pnpm --filter @waitron/dashboard typecheck` and the root guards of Task 8 step 4.

## Task 10 — the guide

Files: `apps/server/src/guide/en/staff.md`, `apps/server/src/guide/es/staff.md`,
`apps/server/src/guide-content.test.ts`.

English, after "Download another person's data":

```text
## Download an invoice customer's data {#invoice-customer-data}

When a customer asks what the venue holds about them, an admin can find their full invoices by
tax number and download them. On **Orders**, press **Find a customer by tax number**, type the
number and press **Find**. Letter case, spaces, dots, hyphens and an ES at the start make no
difference. The window lists every full invoice that names the number; press **Download their
data** to get a ZIP with a PDF copy of each invoice, an `invoices.json` file with the name, tax
number and address on each and the email addresses each was sent to, and a `README.txt` in the
venue's language. Managers do not see this action. A booking holds no tax number, so this search
does not find bookings. Waitron keeps no list of these requests, so note the request and your
answer in the venue's own records.
```

Spanish:

```text
## Descargar los datos de un cliente de factura {#invoice-customer-data}

Cuando un cliente pregunta qué datos suyos tiene el local, un administrador puede buscar sus
facturas completas por el NIF y descargarlas. En **Pedidos**, pulsa **Buscar un cliente por NIF**,
escribe el número y pulsa **Buscar**. Las mayúsculas, los espacios, los puntos, los guiones y un ES
al principio no cambian nada. La ventana muestra todas las facturas completas que llevan ese NIF;
pulsa **Descargar sus datos** para obtener un ZIP con una copia en PDF de cada factura, un archivo
`invoices.json` con el nombre, el NIF y la dirección de cada una y las direcciones de correo a las
que se envió, y un `README.txt` en el idioma del local. Los gerentes no ven esta acción. Una reserva
no lleva NIF, así que esta búsqueda no encuentra reservas. Waitron no guarda una lista de estas
solicitudes, así que anota la solicitud y tu respuesta en los registros del local.
```

| Sentence | Source |
| --- | --- |
| "an admin" / "Managers do not see this action" | decisions 1 and 13 |
| **Orders** / «Pedidos», the button's and dialog's labels | the strings Task 8 adds; `nav.orders` in both languages, checked in `strings.ts` |
| "Letter case, spaces, dots, hyphens and an ES" | decision 3 |
| the ZIP's contents | decision 8 |
| "in the venue's language" | decision 10 |
| "A booking holds no tax number" | `packages/bookings/src/schema/bookings.ts:41-53`, read by the implementer |
| "keeps no list" | design §4.2 and O7 |

1. Tests first: `guide-content.test.ts:156-163`'s expected ids gain `invoice-customer-data` after
   `person-data` (an assertion changed on purpose), and a new `it.each` over both languages that
   the rendered `invoice-customer-data` section contains `invoices.json`.
   Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`; watch both fail.
2. Write the two sections; check every bold label against the strings files.
3. Omission control: remove the Spanish section → both cases fail for Spanish.
4. Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts`,
   and from the root `pnpm exec vitest run scripts/guide-links.test.ts`.

## Task 11 (visual) — LOOK

Scripts and shots outside the worktree: `/Users/clintongormley/waitron-campaign-b/a980-s3-scripts/`
and `/Users/clintongormley/waitron-campaign-b/a980-s3-shots/`, named
`<what>-<lang>-<theme>-<width>.png`. Nothing committed.

1. **The Orders page and the dialog**: a throwaway browser test built like S2c's look shots
   (`/Users/clintongormley/waitron-campaign-b/a980-s2c-scripts/zz-staff-data-copy.look.test.ts`):
   Orders with the button; the dialog empty, with an invalid value, with zero results, with three
   results, while downloading, and with the permission refusal; English and Spanish × light and dark
   × 1280 and 390 px.
2. **The guide section**: write `/help/en/staff` and `/help/es/staff` as the server renders them to
   HTML and screenshot `#invoice-customer-data` at 1280 and 390 px, light and dark, with the
   workspace's Playwright Chromium. Record its process id and stop only it.
3. **The ZIP**: a throwaway copy of Task 6b's case writing Jordi's English and Spanish ZIPs to the
   shots folder; `unzip -l` each; read both READMEs whole and both `invoices.json`; open one PDF.
   Look for: every file the README names present; the tax-record line present; no other customer's
   name; the PDF marked as a copy.
4. Open every picture and file and write one line each for the pull request's **LOOK** section,
   and a "not looked at" line for anything skipped and why.

## Task 12 — backlog, overview, design note, and the void-reason decision

Files: `docs/backlog/data-protection.md`, `docs/backlog.md` (the A980 entry, only if stale),
`docs/superpowers/plans/2026-10-24-a980-data-protection-build.md`,
`docs/superpowers/specs/2026-10-22-a980-data-protection-design.md` (§4.2).

1. Grep the siblings first: `grep -rn "S3\b\|invoice customer\|tax number\|NIF" docs/backlog.md
   docs/backlog/data-protection.md docs/superpowers/plans/2026-10-2*-a980-*.md
   docs/superpowers/specs/2026-10-22-a980-*.md`.
2. **The void-reason decision** (decision 18): delete the bullet "Owner question: a void reason that
   names someone" (`docs/backlog/data-protection.md:149-155`), and add under `## Decisions and
   deliberate limits`: "**A980 S2d follow-up, 2026-10-26:** the owner chose to keep each
   adjustment's reason in `adjustments.json` as the venue named it on the Voids and comps page, even
   though a reason's name can name someone (the question's example: a reason "Ana's mistake" appears
   in the copies of the person who used it and the person who approved it). The free-text note stays
   out (S2d decision 8)."
3. In `data-protection.md`, replace the S3 bullet (`:210`) with what was built: the search and the
   download, their paths, the permission, the dialog on **Orders**, the ZIP's three kinds of file,
   the README's language, nothing recorded; then new short points: the staged customer on a bill
   never issued; foreign customers and Q17(a); the index, if Task 3 or a box asks for one; and the
   two owner FYIs (decisions 10 and 12) until answered. The "Measure … on a box" point gains Task
   3's figures. `docs/backlog.md`'s A980 entry is edited only if a sentence in it became false.
4. In the overview's status paragraph, after the S2d sentence, a dated pointer: "2026-10-2x: S3 is
   built ([its plan](2026-10-26-a980-s3-invoice-customer-download.md)): an admin finds an invoice
   customer by tax number on **Orders**, ignoring an ES prefix, letter case, spaces, dots and
   hyphens, and downloads a ZIP of their full invoices as PDF copies, an `invoices.json` with the
   name, tax number and address on each, the addresses each was emailed to and when, and whether
   the box keeps a tax record of it, read in write-lock turns with no index and no migration."
   Use the merge date.
5. In the design's §4.2, after the S2d note, a dated note: "2026-10-2x: S3 builds _Orders → Find a
   customer by tax number_; the export's line about the Tax Agency is written per invoice, only
   for invoices the box keeps a tax record of, and says that record holds the name and NIF, not the
   address (the S3 plan's decisions 1, 8 and 11)."
6. `pnpm exec prettier --file-info <file>` on each changed doc: `docs/` is ignored, so each prints
   `"ignored": true`.

## Root guards to run before `/finish-branch`

From the repository root, once all tasks are in:
`pnpm exec vitest run scripts/english-only.test.ts scripts/module-seams.test.ts scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/native-form-fields.test.ts scripts/help-tooltip-mode.test.ts scripts/pinned-actions-column.test.ts scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts scripts/guide-links.test.ts scripts/coverage-thresholds.test.ts`,
and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`. Read each
count. `git diff --name-only main -- packages/` prints nothing. No new package and no new
dependency, so the shard lists should not move.
