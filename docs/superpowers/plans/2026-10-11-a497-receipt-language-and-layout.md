# A497: Receipt Language Chosen at the Till, and the Printed Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** Staff can choose the language a receipt prints in, at the till, for each sale; the
location's receipt language (Catalan in Catalonia) is the default. The languages offered for that
choice, and for a copy, narrow to the venue's content languages that have receipt wording, plus
the receipt language. The printed receipt gets a tidier top block and a line above TOTAL.

**Spec:** the owner's backlog text, quoted below — `docs/backlog.md` → "A497. Receipt language
chosen at the till, and the printed layout" and its detail section in `docs/backlog/printers.md`
(`#a497-receipt-language-chosen-at-the-till-and-the-printed-layout`), with decisions C113 and C114
and their dated amendments under that file's "Decisions and deliberate limits".

**Tech Stack:** TypeScript, Drizzle over SQLite (`node:sqlite`), Hono, Lit, Vitest (real venue
databases via `useVenueDb`; real headless Chromium for the till and dashboard).

**Execution base:** every `file:line` below was read at main `61420546c` (2026-10-11). Re-read a
cited range before editing it; line numbers drift.

## The owner's text this plan builds (verbatim, `docs/backlog/printers.md`)

> 1. **Staff choose the receipt's own language at the till.** The default is the location's receipt
>    language, which is Catalan in Catalonia. This replaces C113's "no choice when the original
>    prints". […] Before building, trace which language a sale is filed in (`namesLocale`,
>    modifiers.md) against the language its receipt prints in.
> 2. **Which languages are offered.** Both that choice and a copy in another language are offered
>    only in the venue's content languages that have receipt wording (Spanish, Catalan, Galician and
>    Basque today, `packages/country-es/src/receipt-labels.ts`), plus the receipt language. Spanish
>    stays offered in Catalonia (Spain's Constitutional Court, ruling 88/2017). This narrows C114,
>    which offered every language the country pack has. No English receipts (owner, 2026-10-11).
>    A493's receipt editor lists the same languages.
> 3. **The printed layout:** space above and below the logo; a shorter contact block: the legal name
>    and tax ID on one line, the address on two, phone and email on one (A493's mockup preview); a
>    line above TOTAL. That the legal name and tax ID may share one line is not yet checked against
>    what a receipt must show.

## The trace the owner asked for (read at `61420546c`)

- **One setting decides three things today.** `readReceiptLanguage`
  (`packages/catalogue/src/operations.ts:1348-1357`) returns `{ locale: invoiceLocales[0],
  invoiceLocales }` from `locations.invoice_locales`. Every filing path spreads it into
  `recordSale`: `fileImmediateSale` (`apps/server/src/till-sale.ts:825-832`, from `POST /api/sales`),
  card capture (`till-sale.ts:1373` and `:1525`, from `POST /api/pay`), bill payments
  (`apps/server/src/bill-payments.ts:684`, from `POST /api/working-orders/:id/payments`) and
  `issueUnpaidInvoice` (`apps/server/src/working-order.ts:5686`). `recordSale` writes `sales.locale`
  and `sales.invoice_locales` (`packages/core/src/record-sale.ts:318-319`).
- **Dish names are saved in that same language.** `priceOrderLines` snapshots each line's
  descriptions under `invoice_locales` (`working-order.ts:715-731` through
  `toInvoiceLineDescriptions`, `packages/catalogue/src/invoice-descriptions.ts:5-13`), and a trigger
  on `working_order_lines` holds them to exactly those tags. The dashboard's receipt-language route
  always writes one entry (`[language]`, `location-settings-api.ts:208`); the provisioning command
  (`packages/provisioning/src/venue-plan.ts:126`) and configuration transfer
  (`apps/server/src/configuration-transfer.ts:146-149`) can write two. A venue set up through the
  dashboard therefore saves names in its receipt language only.
- **The four `recordSale` sites have many callers.** Besides the routes named above, a bill's sale
  is filed by `issueWhenFullyPaid` (`bill-payments.ts:632`), reached from the card-reader loop
  (`bill-payments-loop.ts:128`), a manager confirming a stuck payment (`payments-api.ts:1194`), a
  line edit or bill split (`till-api.ts:3015`, `:3101`), a discount (`adjustments-api.ts:153`), an
  order edit (`working-order.ts:5511`) and card-reader bill payments (`takeReaderBillPayment`); a
  stuck counter card payment is filed by its recovery (`payments-api.ts:1018-1028` →
  `till-sale.ts:1525`) with an empty request. None of these carries a till request, so a choice the
  till holds in memory cannot reach them. Two `recordSale` callers are deliberately outside this
  plan: `apps/server/src/fiscal-readiness-runner.ts:105` (a one-off test sale in a separate database,
  no order behind it) and the demo scripts under `apps/server/scripts/`; both keep the location's
  language.
- **The print reads the sale back.** `buildReceiptBytes` (`apps/server/src/receipt-print.ts:145-205`)
  prints with `invoiceLocale: language ?? ticket.locale, namesLocale: ticket.locale` — `language` is
  set only by a copy. The emailed A4 invoice uses `sale.locale` for both
  (`apps/server/src/invoice-document.ts:130-131`).
- **Nothing fiscal reads a locale.** `packages/fiscal-verifactu/src` (non-test) has no `locale` or
  `descriptions`; `DescripcionOperacion` comes from `locations.operation_description`. The hash does
  not include either column.
- **A sale's language must be in its stored list.** CHECK `sales_locale_member_ck` and
  `sales_invoice_locales_ck` (1–2 entries) (`packages/db/src/schema/sales.ts:146-149`). A correction
  inherits both (`packages/core/src/record-correction.ts:109`, `:275`).
- **No till request carries a print language** except `POST /api/sales/:id/reprint` (`{ language? }`,
  `apps/server/src/till-api.ts:2112-2131`), validated in `printSaleReceipt` (`till-sale.ts:753-781`)
  against `readVenueReceiptLanguageRules(...).choices` — the whole pack.
- **The offered list today** is the whole pack: `receiptLanguages` in `GET /api/till`
  (`till-api.ts:1302-1304`, `:1334`), the reprint check above, the department receipt editor's
  `languages` (`apps/server/src/department-receipt-api.ts:76-96`) and the receipt preview's check
  (`apps/server/src/receipt-preview-api.ts:225-235`).
- **Content languages** are codes (`es`, `ca`, `ca-ES-valencia`, `en`, …) in the one-row
  `content_languages` table (`packages/catalogue/src/content-languages.ts:152-225`); receipt
  languages are tags (`es-ES`, `ca-ES`, `gl-ES`, `eu-ES`, `packages/country-es/src/spain.ts:293`).
  `contentLanguageCode` (`packages/shared/src/content-languages.ts:65-79`) maps a tag to a code.

## Decisions this plan makes that the spec does not (the DEFAULT is what gets built)

1. **The location's own receipt language stays fixed to Catalan in Catalonia.** The owner's text
   moves the CHOICE to the till and calls the location's language "the default"; it does not unfix
   the location setting. `receipt.language_fixed` and the setup wizard's refusal stay; the pack's
   user-facing reason text (`spain.ts:196-208`, "a copy can be printed in another language") is
   reworded to say staff can choose another language at the till.
2. **What the chosen language changes: the receipt's fixed words, dates and amounts, and the
   department's subtitle and footer. Dish names, units and option answers print in the language
   they were saved in** (C113's "dish names print as they were saved", and today's copy behaviour,
   `receipt-language.test.ts:587`). Worked example for the owner's FYI: a Barcelona venue (receipt
   language Catalan, content languages Catalan and Spanish), staff choose Spanish → the receipt
   reads "Total", "Efectivo", "Factura simplificada", the Spanish date — and "Pa amb tomàquet",
   the Catalan dish name. Saving names in every offered language would change the working-order
   trigger and the line snapshot; it is left as an open backlog line, asked in the FYI.
3. **The choice is stored on the order, on the server.** A new nullable column
   `working_orders.receipt_locale` (core migration; `null` = the location's receipt language). Every
   filing path reads it, so a bill filed by the card-reader loop, a discount, a split or another
   till still prints in the chosen language. Written by (a) `PUT /api/working-orders/:id/receipt-language`
   `{ revision, language }` → `{ revision }`, following `setOrderInvoiceChoice`'s revision rules;
   `language: null` clears it; and (b) an optional `receiptLanguage` on `POST /api/sales`,
   `POST /api/pay` and the collect route, stored on the order in the same transaction BEFORE any
   card-reader call or filing. The inline value is stored only when the request creates the order,
   or the order is open or placed with no sale yet — checked AFTER the settled-replay check, with the
   order's revision bumped as any other change to the order bumps it; otherwise it is ignored (a
   replay returns the stored ticket). The PUT refuses as `invoice-choice` does
   (`setOrderInvoiceChoice`, `working-order.ts:3434`): `working_order.out_of_date` for a stale
   revision, `working_order.not_open` once the order is settled, abandoned or has a sale, and the
   payment-in-flight refusal (`refusePaymentInFlight`).
   **The order-status trigger must learn the column.** `working_orders_enforce_transition` (latest in
   `packages/db/drizzle/0128_delivery_table_release.sql`) lists, per allowed change, the columns
   that must stay unchanged; a column it does not list may change freely, and
   `scripts/behavioural-triggers.test.ts:745` runs a case per column and will go red. So a second,
   hand-written migration drops and recreates that trigger (precedent: 0116 added
   `invoice_delivery`, 0117 rewrote the trigger), putting `receipt_locale` beside the invoice choice
   (changes only with revision + 1 and while no sale exists) and in every other exception's
   hold-unchanged list. The till reads the stored choice back: the party bill list
   (`parties.ts:430-485`, which already reads the bill's invoice choice) and the order read the till
   uses when it retrieves a placed or held order both return it as `receiptLanguage`.
4. **What a sale records.** `sales.locale` = the chosen language, so the original, a later original
   reprint, the emailed A4 invoice and its subject, the party bill's copy default
   (`parties.ts:455`, `:506`) and a correction all follow it. `sales.invoice_locales` = the
   location's list when it already holds the chosen language, else `[location's first, chosen]`
   (always 1–2 entries; both CHECKs hold). The names language is `sales.invoice_locales[0]`; for
   every sale filed before this change that equals `sales.locale`, so old sales print, reprint and
   email exactly as before. The ticket result gains `namesLocale`, set wherever a ticket is built
   (`till-sale.ts:885`, `:1433`, `:1583`; `bill-payments.ts:741`; `readSettledTicket`, through which
   every replay goes; `sample-receipt.ts:12-30`'s `sampleSale`) — optional, defaulting to `locale`, so
   a builder that omits it keeps today's output — and `invoice-document.ts:120-145` selects
   `invoiceLocales` to set it; it is read by
   the print (`receipt-print.ts:200-201`), the A4 invoice (`invoice-document.ts:130-131`) and the
   till's on-screen receipt (`apps/till/src/screens/till-ticket-view.ts:492`, `:608-637`).
5. **Never refuse a filing for its language.** At FILING time a stored or sent language that is not
   offered any more files in the location's receipt language and logs one warning; the sale
   succeeds. At the REQUEST boundary a non-string `receiptLanguage` is a 400
   `management.request_invalid` `{ field: "receiptLanguage" }`, checked before the order is touched
   and before any card-reader call (in `/api/pay`, before `resolveCardCollector`). The PUT route
   refuses an unoffered language the same way (nothing is charged there). A retried request whose
   order is already settled returns the stored ticket unchanged (`till-sale.ts:565-566`, `:641`).
6. **The offered list** = the location's receipt language first, then each pack receipt language
   whose `contentLanguageCode` is one of the venue's content languages, in the pack's order, without
   repeats. Exact-code match: a Valencian venue's `ca-ES-valencia` content language does not offer
   `ca-ES` (asked in the FYI). Used by: the till's choice and copy dialog (`GET /api/till`
   `receiptLanguages`), the PUT route's check, the filing fallback, and the copy route's check —
   which ALSO accepts the sale's own stored language, so a copy in the sale's language is never
   refused after the content languages change.
7. **Out of scope here, left to A493 (lane E, which rebuilds the department receipt editor and
   "lists the same languages"):** the department receipt editor and the receipt preview keep the
   pack's full list. Narrowing that list there now would erase saved subtitle/footer text on the
   next save, because the same list scopes the read, the check and the whole-document write
   (`department-receipts.ts:40-52`, `:112-128`, `:226-230`). This plan exports the offered-list
   helper for A493 to use. The location's own receipt-language dropdown and the setup wizard keep
   the pack's list (the owner's text does not narrow the location setting).
8. **Where staff choose:** a language button beside "Full invoice" on the till's payment panel
   (`apps/till/src/widgets/tender-pay.ts`, `#renderInvoiceButton`), and beside a party bill's
   invoice action, shown only when more than one language is offered. Its label is the chosen
   language's name; it opens the existing language dialog
   (`apps/till/src/widgets/reprint-language-dialog.ts`) titled "Receipt language" / "Idioma del
   tiquet" (concise; the implementer picks the shortest natural form and lists it). On the counter
   the till holds the choice per order id (a `Map`, so switching orders shows each order's own) and
   sends it inline on `recordSale`/`pay`/collect, and with a PUT when the order is placed; on a
   party bill the choice is PUT at once (like the bill's invoice choice, `till-app.ts:7972-8010`).
   The unpaid-departure path needs no till change: it reads the stored choice.
9. **Layout:** (a) one blank line above and below the logo, only when a logo is drawn, in each
   renderer that draws one (thermal `receipt-ticket.ts`; A4 `invoice-page.ts`); (b) the top block:
   trading name (when printed), subtitle, `"<legal name> · <label.nif>: <tax ID>"` on one line (it
   wraps on a narrow roll), the address in at most two lines (street lines joined with ", "; then
   postal code and city, plus the province when it differs, joined with ", "), `"<label.phone>
   <phone> · <email>"` on one line (either part alone), the full-invoice domicile, then the
   duplicate mark; (c) a rule replaces the blank line above TOTAL — a new `rule` document element,
   dashes across the roll, and a new `rule` PAGE element drawn as a thin line by
   `invoice-page.ts`, `invoice-raster.ts` and `invoice-pdf.ts` (whose fallthrough today sends any
   non-text, non-logo element to the QR branch, `invoice-pdf.ts:35`). The till's on-screen receipt
   (`till-ticket-view.ts:520-560`) keeps its own layout; only its address lines follow
   `addressLines`. Whether the legal name and tax ID may share one line stays unchecked against the
   receipt-content rules: an open backlog line.

## Global constraints

- **Unrepairable core untouched:** `computeHuella`, the chain, numbering, `registros_facturacion`,
  `recordSale`/`recordCorrection`/`recordSubstitution` bodies. Only the VALUES the server passes as
  `locale`/`invoiceLocales` change. Run, UNEDITED, in every task that touches a filing path:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`.
- **Two migrations** (decision 3), both numbered by `drizzle-kit` against the current tree, never by
  hand: the generated nullable column add (it must be a plain ``ALTER TABLE `working_orders` ADD``,
  like `0116_invoice_delivery_foundation.sql:64`; if drizzle-kit emits a rebuild, stop and list the
  foreign keys pointing at `working_orders`, CLAUDE.md §3), then a custom migration
  (`drizzle-kit generate --custom`, as 0117 was made) that rewrites
  `working_orders_enforce_transition`. Prove the trigger change by deletion: drop `receipt_locale`
  from one hold-unchanged list and watch `scripts/behavioural-triggers.test.ts` fail. Run the schema guards:
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts
  scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts
  scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts
  scripts/migration-upgrade.test.ts`. No new error code.
- Tests first, printed red before green. Rejected requests assert the domain code. Fixtures give
  each language DIFFERENT text where names matter (CLAUDE.md §3).
- A test assertion pinning the OLD behaviour (C113/C114) changes only where this spec changes it;
  list every changed check in the PR (owner's 2026-10-05 decision).
- Concise product text (owner rule); English and Spanish strings (and every other language the
  touched string files carry).
- LOOK every changed till surface in EN and ES, both themes, 1280 and 390 wide; render thermal
  receipts (80 mm and 58 mm) and the A4 page to images and look.

## Review focus

- Decision 4's list rule against the two CHECKs, and against a two-entry location list.
- That no filing path can be refused, or replayed into a second record, because of the language.
- That a sale filed before this change prints, reprints and emails exactly as before.
- That every `recordSale` caller except the two named exclusions reads the stored choice (grep, and a
  test per entry family).

---

## Task 1: Printed layout — the document and the roll

**Files:** `apps/server/src/receipt-document.ts`, `apps/server/src/receipt-ticket.ts`,
`apps/server/src/venue-address.ts` (`addressLines`; its consumers: `receipt-print.ts:166`,
`receipt-presentation.ts:43` → the till's on-screen receipt, `receipt-preview-api.ts:307`,
`management-api.ts:1254` and `department-receipt-api.ts:84` → the dashboard's address display
`venue-receipt-defaults-editor.ts:322`; say in the report what each shows after), and their tests.

- [ ] Failing tests: the document's top-block elements in order for a simplified and a full invoice
  (decision 9b, with the language's own labels); a two-street-line address with postal code, city
  and a differing province → exactly two lines; phone + email on one line, and each alone; a `rule`
  element directly before TOTAL; the thermal bytes hold a dash row of the roll's column count
  before the TOTAL row; a blank line before and after the logo bitmap only when a logo is given.
- [ ] Implement. Until Task 2 lands, the A4 renderers may skip `rule` (TypeScript exhaustiveness
  will show where); Task 2 draws it.
- [ ] Run: `pnpm --filter @waitron/server exec vitest run receipt-document receipt-ticket venue-address receipt-preview receipt-print`.
- [ ] Render an 80 mm and a 58 mm ticket to PNG and LOOK. Commit.

## Task 2: Printed layout — the A4 page

**Files:** `apps/server/src/invoice-page.ts`, `invoice-raster.ts`, `invoice-pdf.ts`, their tests
(`invoice-pdf.test.ts`, `invoice-raster.test.ts`; there is no `invoice-page.test.ts`).

- [ ] Failing tests: the page has a `rule` element just above TOTAL; the raster draws it as dark
  pixels across the content width; the PDF draws a line there and never a QR; the logo has space
  above and below.
- [ ] Implement; run the suites; render an A4 page to PNG and LOOK. Commit.

## Task 3: The offered receipt languages

**Files:** `apps/server/src/venue-locale.ts` (pure `offeredReceiptLanguages(receiptLanguage,
packChoices, contentCodes)` and `readOfferedReceiptLanguages(tx, { locationId })`, exported for
A493), `till-api.ts` (`receiptLanguages` in `GET /api/till`), `till-sale.ts:753-781`
(`printSaleReceipt`'s check: offered OR the sale's own `sales.locale`; reword the C114 comment at
`:763-765`), `packages/country-es/src/spain.ts:185-208` (decision 1's reason text and comment),
tests (`receipt-language.test.ts:641`, `:656`; `venue-locale.test.ts`; `spain.test.ts`'s reason
case; `registry.test.ts` if it pins the text).

- [ ] Failing tests: the pure function (Madrid, content `es,en` → `["es-ES"]`; Barcelona, content
  `ca,es,en` → `["ca-ES","es-ES"]`; content `es,gl,eu`, receipt `es-ES` → `["es-ES","gl-ES",
  "eu-ES"]`; a receipt language outside the content languages stays first; `ca-ES-valencia` does
  not offer `ca-ES`; no repeats); `GET /api/till` returns the narrowed list; a copy in a pack
  language not offered is refused `management.request_invalid` `{ field: "language" }`; a copy in
  the sale's own language is accepted after that language left the content languages.
- [ ] Implement, reading content languages through the existing accessor (`contentLanguagesOr` /
  `readContentLanguages`). Focused runs; golden + `inmutabilidad` gates. Commit.

## Task 4a: The stored choice — column, trigger and PUT route

**Files:** `packages/db/src/schema/orders.ts` (`workingOrders`, `:65`) + the two migrations (Global
constraints), the PUT route in `till-api.ts` (beside `invoice-choice`, `:1786`) and its write
function beside `setOrderInvoiceChoice` (`working-order.ts:3434`), the till API client method (no
UI), and `parties.ts:430-485` plus the till's order-retrieval read returning `receiptLanguage`.

- [ ] Failing tests: the behavioural-trigger guard red for the new column (run it before the
  trigger rewrite to print the red); the PUT stores `es-ES` and returns the next revision; a stale
  revision → `working_order.out_of_date`; a settled order or one with a sale →
  `working_order.not_open`; an unoffered language or a non-string → 400 `management.request_invalid`
  `{ field: "language" }`; `null` clears it; the party bill list and the retrieval read return it.
- [ ] Generate both migrations; run the schema guards (Global constraints) and the trigger
  proof-by-deletion. Implement. Focused runs. Commit.

## Task 4b: Every filing path reads the stored choice

**Files:** `saleLanguageFor(tx, locationId, stored)` → `{ locale, invoiceLocales }` beside
`readOfferedReceiptLanguages` (decisions 4–5), and the four `recordSale` sites: `till-sale.ts`
`fileImmediateSale` and the two card-capture sites (`:1374`, `:1526`), `bill-payments.ts`
`issueWhenFullyPaid` (`:632`; reached also through `issueIfFullyPaid`, `:771`), `working-order.ts`
`issueUnpaidInvoice`.

- [ ] Failing tests (Barcelona venue, content `ca,es`, names DIFFERENT per language): a bill with
  the stored choice `es-ES`, paid in two parts, files `sales.locale = "es-ES"`, `invoice_locales =
  ["ca-ES","es-ES"]`; the same bill completed by a discount, by a line edit, and by a card-reader
  completion through the loop, files `es-ES`; an unpaid departure files `es-ES`; with no stored
  choice every path files Catalan exactly as today; a stored language no longer offered files
  Catalan and the sale succeeds; a correction of an `es-ES` sale inherits `es-ES`; a two-entry
  location list `["ca-ES","es-ES"]` with `es-ES` chosen keeps the list as it is.
- [ ] Implement. Focused runs (`receipt-language`, `bill-payments-api`, `till-api.fiscal-sale-paths`,
  `adjustments-api`, `unpaid-departure`); golden + `inmutabilidad` UNEDITED. Commit.

## Task 5a: The counter's inline choice

**Files:** `till-sale.ts` (`TillSaleRequest`, `IntegratedPayRequest`, `runTillSale`'s copied fields
`:1983-1991`, the order-creation sites `:596-605` and `:1074-1083`, the settled-replay checks),
`till-api.ts` (`/api/sales`; `/api/pay`, checking before `resolveCardCollector` ~`:1660`; the
collect route `:2181-2197`), the till API client request types.

- [ ] Failing tests: a counter cash sale with `receiptLanguage: "es-ES"` stores it on the new order
  and files `es-ES`; the same through `/api/pay` (card) and through collect of a placed order; a
  stuck counter card payment recovered by a manager files the language sent with `/api/pay`; a
  non-string is 400 before any card-reader call and files nothing; an unoffered string files
  Catalan and succeeds; a replay of a settled order with a different language returns the stored
  ticket unchanged.
- [ ] Implement. Focused runs; golden + `inmutabilidad` UNEDITED. Commit.

## Task 5b: The names language on every ticket

**Files:** the ticket result type (`TillSaleResult`) gains optional `namesLocale`; its builders
(decision 4); `receipt-print.ts:200-201`; `invoice-document.ts:120-145`; `invoice-email.ts:37` reads
the subject from `invoiceLocale` (check it follows `sales.locale`).

- [ ] Failing tests: a Spanish-chosen sale's original prints Spanish fixed words with the CATALAN
  dish name, unit and option answer; its copy in Galician (when offered) likewise; the emailed A4
  document and subject are Spanish with the Catalan name; a sale filed the OLD way (locale =
  list[0]) prints byte-identical (one existing case left unchanged proves it); every builder sets
  `namesLocale` = `invoice_locales[0]`.
- [ ] Implement. Focused runs (`receipt-print`, `receipt-language`, `invoice-document`,
  `invoice-email`); golden + `inmutabilidad` UNEDITED. Commit.

## Task 6: The till — the counter's language button

**Files:** `apps/till/src/till-app.ts`, `apps/till/src/widgets/tender-pay.ts`,
`apps/till/src/widgets/reprint-language-dialog.ts` (title/action props if it has none),
`apps/till/src/screens/till-ticket-view.ts` (names from the result's `namesLocale`), the till's
i18n strings, tests (`till-app.test.ts`, `tender-pay.test.ts`, the dialog's tests and a11y test,
the ticket view's tests).

- [ ] Failing tests: one offered language → no button; two → the button shows the default's name
  (the location's receipt language from `GET /api/till`); choosing Spanish relabels it and the next
  `recordSale` / `pay` / collect request carries `receiptLanguage: "es-ES"`, and placing the order
  PUTs it; each order keeps its own choice; a placed or held order retrieved on this till starts from
  its stored `receiptLanguage` (Task 4a's read); the copy dialog after the sale defaults to the sale's
  language; the on-screen receipt shows Catalan dish names and option answers on a Spanish sale.
- [ ] Implement (follow the reprint dialog's pattern; it returns a choice and saves nothing).
  Focused till runs; LOOK EN/ES, both themes, 1280 and 390. Commit.

## Task 7: The till — a party bill's language

**Files:** `apps/till/src/till-app.ts` (party bills, beside `#onChooseBillInvoice`), the widget that
emits `choose-bill-invoice`, tests.

Its invoice action is emitted by `apps/till/src/screens/till-table-order-screen.ts`
(`choose-bill-invoice`).

- [ ] Failing tests: a party bill shows the language button beside its invoice action (two
  languages offered), labelled with the bill's stored choice or the default; choosing PUTs it with
  the bill's revision and adopts the returned revision; a refused PUT shows the error and keeps the
  old label; another bill keeps its own.
- [ ] Implement; focused runs; LOOK; commit.

## Task 8: Documents

- [ ] `docs/backlog/printers.md`: rewrite C113 and C114 under "Decisions and deliberate limits" as
  they now stand (A497, 2026-10-11), keeping their history to one line; DELETE the A497 detail
  section and its `docs/backlog.md` entry; add short open entries: the legal-name/tax-ID line check;
  names saved in one language only (decision 2); Valencian content and Catalan receipts
  (decision 6).
- [ ] `docs/backlog/service-periods.md`, A493 section: point its language line at
  `readOfferedReceiptLanguages`, and drop "the others print as copies on request" (staff now
  choose the original's language too) — one sentence each.
- [ ] Prose that states the old behaviour: `docs/developers/modifiers.md:437-443`,
  `docs/developers/products.md:113-122`, the comment at `packages/db/src/schema/tenants.ts:56-70`
  (a schema comment is not a shipped migration; confirm no existing `drizzle/*.sql` changed), the
  setup help string `apps/setup/src/i18n/strings/venue.ts:38-39` if it says receipts print only in
  that language, the dashboard's "(receipts)"/"(copies)" labels are A493's (leave them). Historical
  specs get no rewrite. Commit.
