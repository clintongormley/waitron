# Receipt layout and payments on the receipt — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplified receipts gain a price each, rate letters on mixed-rate bills, a one-row tax table
and solid dividing lines; every receipt shows its payments (with card details) and any amount still
owed as they stand when printed; the payment slip drops its amount owed and prints for every
payment of an already-issued ticket.

**Architecture:** All receipt content is decided in `buildReceiptDocument`
(`apps/server/src/receipt-document.ts`), which emits elements that two renderers draw: thermal
(`receipt-ticket.ts`) and A4/PDF (`invoice-page.ts`). Layout goals add data to the receipt's input
(`TillSaleLine.vatRate`, `TillSaleResult.owed`, card details on tenders), new element kinds where
needed, and labels in every receipt language. The slip lives in `payment-slip.ts` and
`payment-slip-print.ts`.

**Tech Stack:** TypeScript, Vitest, drizzle on `node:sqlite`, the in-repo ESC/POS builder
(`packages/printing`).

**Spec:** [2026-11-17-receipt-layout-and-payments-design.md](../specs/2026-11-17-receipt-layout-and-payments-design.md)

**Lane and landing:** lane L. Three pull requests, in order; each changes what an invoice prints,
so each is finished to green and then **waits for the owner to land it**. PR 1 (Tasks 1–4,
layout) and PR 2 (Tasks 5–6, card details) may start now. **PR 3 (Tasks 7–9, Pendiente and the
slip) starts only after MEAL-END-TICKET (lane L) has landed**: that item lets a part-paid bill be
issued unpaid and rewrites the Pay window and the settle paths these tasks read and change. Re-run
Task 7 Step 1's and Task 9 Step 1's surveys against the code as it is then.

## Global Constraints

- Goals 1–3 apply to the **simplified** receipt only (`simplified` in `buildReceiptDocument`);
  the full invoice's (F1) item table and tax rows do not change.
- Rate letters print only when `result.vatBreakdown.length > 1`; letters run `A`, `B`, `C`… in
  `vatBreakdown` order.
- A unit-price line prints only when `unit × quantity` equals the printed amount to the cent.
- No `Pendiente` line on a deferred (transfer) close (`tender.method === "deferred"`), on a
  settled sale, or on a corrective or replacement (`invoiceType` `R4`/`R5`, recorded with no
  settlement: `packages/core/src/record-replacement.ts`). Tips never count toward the amount owed.
- The payment slip never prints an amount owed, and keeps printing no invoice number: the adviser's
  ruling R2 (`docs/compliance/asesor-questions.md:434`) covers a slip "with no invoice number and no
  QR". Question 24(c) asks whether it may name the ticket; until answered, it does not.
- Tests outside a task's own files assert today's wording (`Base imponible`, `Taxable base`): run
  every file `grep -rln "Base imponible\|Taxable base" apps packages --include='*.test.ts'` lists
  after Task 3, and every file naming `paymentRemaining`/`remaining` after Tasks 8–9.
- The till's on-screen receipt view (`apps/till/src/screens/till-ticket-view.ts`) is out of scope.
  _2026-11-18: #3740 then made that view, opened from Find a bill, draw the receipt builder's
  output, so the card details this design prints, like the rest of that output, show there too.
  It is now a third renderer beside the two named under Architecture, so a new element kind needs
  a case in its `renderReceipt`._
- New words go in every language block of `packages/country-es/src/receipt-labels.ts`
  (`en-GB`, `es-ES`, `ca-ES`, `gl-ES`, `eu-ES`) and every key in `RECEIPT_LABEL_KEYS`
  (`packages/country/src/country.ts:60`). Pre-live: rename freely.
- Coverage holds `98/98/98/95` in every package touched. Comments only for an invariant or a
  non-obvious why; delete stale ones you pass (the `"Card identity belongs on the slip"` comments at
  `till-sale.ts:308,402` go stale in PR 2).
- Run focused tests with `pnpm --filter <pkg> exec vitest run <file> -t "<name>"` (never
  `pnpm test <file> -t`, which drops the filter). Read the `Tests` count.

## Review Focus

1. **58 mm paper.** At `PRINTER_58` (32 columns; 30 as built, see Task 4) a mixed-rate receipt with a `1.234,56` line and a
   two-rate tax table prints no line wider than 32 columns and keeps each letter beside its amount
   (Task 2 and Task 3 tests).
2. **Discounted line.** A line with `listGross` gets its unit price from `listGross`, and its
   discount row carries the same rate letter as the line (Task 2 test).
3. **Bill-wide discount on a mixed-rate bill** (`billAdjustments`): its row prints no letter, since
   it spans rates (Task 2 test).
4. **Refunded part payment.** A bill payment with a completed refund counts net of the refund, tips
   excluded, when working out `owed` (Task 7 test).
5. **Replacement invoice.** An R4 replacing a paid ticket prints no `Pendiente`; a duplicate of a
   settled sale prints its payments and no `Pendiente`; a duplicate of an unpaid departure prints
   `Pendiente` with the whole amount due (Task 7 and Task 8 tests).

---

## PR 1 — layout

### Task 1: every receipt line carries its VAT rate

**Files:**
- Modify: `apps/server/src/till-sale.ts` (`TillSaleLine`), `apps/server/src/receipt-adjustments.ts`
  (`receiptLines`, which already reads `rate: saleLines.vatRate` from the filed lines at about
  line 52 but uses it only for F1)
- Test: `apps/server/src/receipt-adjustments.test.ts` (create if absent),
  `apps/server/src/till-api.receipt.test.ts`

**Interfaces:**
- Produces: `TillSaleLine.vatRate?: string` — the filed line's rate as a decimal string
  (`"10"`, `"21"`), the same spelling as `vatBreakdown[].rate`. Optional so fixtures without it
  still type-check; a mixed-rate receipt whose lines lack it prints no letters.

- [ ] **Step 1: Failing tests.** In `till-api.receipt.test.ts`, `"a reprinted simplified receipt's lines
  carry their filed VAT rates"`: sell one 10% and one 21% product, read the sale back through the
  reprint path's reader (`readSettledTicket`) and through `readTransactionReceipt`, and assert each
  line's `vatRate` matches the product's rate.
  Include the receipt printed straight after a sale (`printSaleReceipt`'s path) as a third read.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/till-api.receipt.test.ts
  -t "VAT rate"` — expect FAIL (`vatRate` undefined).
- [ ] **Step 3: Implement.** In `receiptLines`, set `vatRate` on every line from its filed row's
  `rate` (`GrossLine` has no `vatRate`, so `ReceiptSource` cannot carry it). To find any other
  builder of a receipt line, make the field required for one `tsc` run, then optional again.
- [ ] **Step 4: Run** the Step 2 command — expect PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Give every receipt line its VAT rate"`.

### Task 2: price each, and rate letters on a mixed-rate simplified receipt

**Files:**
- Modify: `apps/server/src/receipt-document.ts` (`withVatGroup`, `takenOff`), `packages/country/src/country.ts`,
  `packages/country-es/src/receipt-labels.ts`
- Test: `apps/server/src/receipt-ticket.test.ts`

**Interfaces:**
- Consumes: `TillSaleLine.vatRate` (Task 1).
- Produces: `rateLetters(vatBreakdown: readonly { rate: string }[]): Map<string, string> | null`
  in `receipt-document.ts` — `null` for one rate; otherwise rate → `"A"`, `"B"`… in order, keyed
  by `compareDecimal`-equal spelling (`"10"` and `"10.00"` are one rate). Task 3 uses it.
- New label `perUnit`: `en-GB` `"{price} each"`, `es-ES` `"{price} por unidad"`, `ca-ES`
  `"{price} per unitat"`, `gl-ES` `"{price} por unidade"`, `eu-ES` `"{price} unitateko"`.

- [ ] **Step 1: Failing tests** in a `describe("simplified receipt: price each and rate letters")`,
  all on `invoiceType: "F2"` sales built from `FILED_SALE`:
  - `"prints the price each under a line of two"`: `Mahou caña` quantity `"2"`, gross `"5.40"`,
    `es-ES` → the line after it reads `2,70 € por unidad` (indented).
  - `"prints a weighed line's price per its unit"`: quantity `"0.5"`, unit `{ "es-ES": "kg" }`,
    gross `"12.00"` → `24,00 € / kg`.
  - `"prints no price each when it does not divide exactly"`: quantity `"3"`, gross `"10.00"` →
    no `por unidad` anywhere.
  - `"prints no price each for one"`: quantity `"1"` → no `por unidad`.
  - `"uses the list price before a discount"`: quantity `"2"`, `listGross` `"6.00"`, gross
    `"5.40"` → `3,00 € por unidad`.
  - `"letters each line by its rate on a mixed-rate bill"`: lines at `vatRate` `"10"` and `"21"`,
    `vatBreakdown` `[10, 21]` → the 10% line ends `A`, the 21% line ends `B`; its discount row
    (`adjustments`) ends with the line's letter.
  - `"prints no letters on a single-rate bill"` and `"prints no letter on a bill-wide discount"`.
  - `"fits 58 mm"`: the mixed-rate sale with a `1234.56` line at `PRINTER_58` — every printed line
    ≤ 32 characters (30 as built, see Task 4), and the letter follows the amount on the same line.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/receipt-ticket.test.ts -t
  "price each and rate letters"` — expect FAIL.
- [ ] **Step 3: Implement.** In `withVatGroup` (simplified path only), after the dish row: when the
  dish quantity is not 1, compute `divideDecimal(listGross ?? gross, quantity, MONEY_SCALE)`; if
  `multiplyDecimal(unit, quantity)` at money scale equals the amount, add a `text` element indented
  under the item: `perUnit` filled with `formatMoney(unit)` for a counted line, or
  `` `${formatMoney(unit)} / ${unitName}` `` for a line with a unit name that is not `soldInEach`.
  When `rateLetters(result.vatBreakdown)` is not null, append `` ` ${letter}` `` to the amount of
  each dish, extra and line-discount row (by that line's `vatRate`); bill-wide adjustments get none.
  (2026-11-17, after review: the price each now comes from the line's recorded `unitPriceGross` or
  `listUnitPriceGross`, never from this division; see the spec's author's calls.)
- [ ] **Step 4: Run** the Step 2 command — expect PASS. Then run the whole
  `src/receipt-ticket.test.ts` and `src/receipt-document.test.ts` (no `-t`): existing cases must
  still pass unchanged.
- [ ] **Step 5: Commit** `git commit -s -m "Price each and rate letters on the simplified receipt"`.

### Task 3: one-row tax table on the simplified receipt

**Files:**
- Create: `apps/server/src/receipt-tax-table.ts`
- Modify: `apps/server/src/receipt-document.ts` (`vatRows` for `simplified`, `ReceiptElement`),
  `apps/server/src/receipt-ticket.ts`, `apps/server/src/invoice-page.ts`, both label files
- Test: `apps/server/src/receipt-tax-table.test.ts`, `apps/server/src/receipt-ticket.test.ts`,
  `apps/server/src/invoice-document.test.ts`

**Interfaces:**
- Consumes: `rateLetters` (Task 2).
- Produces: `interface TaxTableRow { rate: string; base: string; tax: string; total: string }`;
  element `{ kind: "taxTable"; header: TaxTableRow; rows: TaxTableRow[] }`;
  `taxTableLines(header: TaxTableRow, rows: readonly TaxTableRow[], columns: number): TableLine[]`
  (`TableLine` from `receipt-table.ts`; header lines `header: true`).
- New labels `taxRateColumn`, `taxBaseColumn`, `taxAmountColumn`, `taxTotalColumn`: `en-GB`
  `Rate`, `Base`, `VAT`, `Total`; `es-ES` `Tipo`, `Base`, `IVA`, `Total`; `ca-ES` `Tipus`, `Base`,
  `IVA`, `Total`; `gl-ES` `Tipo`, `Base`, `IVE`, `Total`; `eu-ES` `Tasa`, `Oinarria`, `BEZ`,
  `Guztira`.

- [ ] **Step 1: Failing tests.** `receipt-tax-table.test.ts`: `"right-aligns three amount columns
  after the rate"` (42 columns: header then `10%  24,09  2,41  26,50` shape, amounts
  right-aligned under their headings); `"fits 32 columns (30 as built, see Task 4) with two rates and four-figure
  amounts"`. `receipt-ticket.test.ts`: `"prints the simplified tax summary as one row per rate"`
  — Santet's sale (`10%`, base `24.09`, tax `2.41`, total `26.50`, `es-ES`) prints a row holding
  `10%`, `24,09`, `2,41`, `26,50` and no `Base imponible 10%` line; mixed-rate → rows start `A 10%`
  and `B 21%`; F1 sale → unchanged (`Base imponible` rows still print). `invoice-document.test.ts`:
  `"draws the simplified tax table on A4"` — the page's text holds the four headings and both
  rate rows.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/receipt-tax-table.test.ts
  src/receipt-ticket.test.ts src/invoice-document.test.ts -t "tax"` — expect FAIL.
- [ ] **Step 3: Implement** `taxTableLines` (pad amounts to each column's widest cell, rate column
  left; amounts with `formatAmount`, no `€`), emit the element from the simplified branch in place of
  `vatRows()`, draw it in `receipt-ticket.ts` (bold header lines) and `invoice-page.ts` (one text
  line per `TableLine`).
- [ ] **Step 4: Run** the Step 2 command, then the three files whole, then every other file the
  Global Constraints' `Base imponible` grep lists, updating each simplified-receipt assertion to
  the table (F1 assertions stay) — expect PASS.
- [ ] **Step 5: Commit** `git commit -s -m "One-row tax table on the simplified receipt"`.

### Task 4: solid dividing lines on thermal paper

**Files:**
- Modify: `packages/printing/src/escpos.ts`, `packages/printing/src/raster-text.ts`,
  `apps/server/src/receipt-ticket.ts` (`case "rule"`)
- Test: `packages/printing/src/escpos.test.ts`, `packages/printing/src/raster-text.test.ts`,
  `apps/server/src/receipt-ticket.test.ts`, `apps/server/src/receipt-preview-api.test.ts`

**Interfaces:**
- Produces: `rule(): this` on the ESC/POS builder — one band of the grid's line height holding a
  solid horizontal bar 2 dots thick, vertically centred, across `widthDots`; counts as one picture.
  `readRasterText` reads that exact band back as `"-".repeat(columns)`, so previews, `printedLines`
  and `withoutRules` keep reading a rule as dashes.
  (2026-11-17, as built: 58 mm has 30 text columns, not the 32 this plan names; the bar spans
  the text grid, not the full paper width; see the spec's author's calls.)

- [ ] **Step 1: Failing tests.** `escpos.test.ts`: `"rule() draws a solid bar, not dash glyphs"` —
  its image bytes differ from `line("-".repeat(columns))`'s and every set bit lies in two adjacent
  rows spanning the full width. `raster-text.test.ts`: `"reads a drawn rule as dashes"`. And a
  control: a band with a bar 1 dot short of full width does not read as dashes.
  `receipt-ticket.test.ts`: `"draws section rules as solid lines"` — the pictures at `drawReceipt`'s
  `rules` indexes are rule bands. `receipt-preview-api.test.ts`: the existing trim-part cases
  still pass (rules still trimmed from part edges).
- [ ] **Step 2: Run** `pnpm --filter @waitron/printing exec vitest run src/escpos.test.ts
  src/raster-text.test.ts -t "rule"` and the server file — expect FAIL.
- [ ] **Step 3: Implement** `rule()`, the reader's recognition, and `b.rule()` in `receipt-ticket.ts`.
  Kitchen tickets and slips keep their own rules unchanged.
- [ ] **Step 4: Run** both packages' touched files whole — expect PASS. Print one receipt from a
  `wa-wt demo` stack to a real or emulated 80 mm printer, or open the dashboard's receipt preview,
  and look: the line is solid in both themes.
- [ ] **Step 5: Commit** `git commit -s -m "Solid dividing lines on thermal receipts"`, then run
  `/finish-branch` and open PR 1 (owner lands).

## PR 2 — card details on the receipt

### Task 5: card details reach the receipt

**Files:**
- Modify: `apps/server/src/till-sale.ts` (`TenderBlock`, `BillTenderLine`, `readTenderBlock`,
  `readBillTenderLines`; delete the two "Card identity belongs on the slip" comments)
- Test: `apps/server/src/till-api.receipt.test.ts`, `apps/server/src/transaction-receipt-api.test.ts`

**Interfaces:**
- Produces: `card?: CardDetails` (`@waitron/payments`) on the `card` `TenderBlock` and on card
  `BillTenderLine`s, read from the sale's captured payment row of **any** provider (today's joins,
  `till-sale.ts:449,484`, take `provider = 'manual'` only; keep them for `externalRef`); absent when
  the row holds no scheme and last four. `entryMode` maps through the existing
  `mapEntryMode`-shaped values (`contactless`, `chip`, `swipe`, `unknown`).

- [ ] **Step 1: Failing tests** (database-backed): `"a connected-reader card payment's brand and
  last four reach the reprint"` (a captured payment row with `card_scheme` `VISA`, `card_last4`
  `4034`, `card_entry_mode` `contactless`, `card_auth_code` `354739`), read through
  `readSettledTicket` and `readTransactionReceipt`; `"a card bill payment's details reach the
  receipt"`; `"a hand-keyed card with no card row prints no card"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/till-api.receipt.test.ts
  src/transaction-receipt-api.test.ts -t "card"` — expect FAIL.
- [ ] **Step 3: Implement** the reads.
- [ ] **Step 4: Run** the Step 2 command, then both files whole — expect PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Read card details for the receipt"`.

### Task 6: print the card

**Files:**
- Modify: `apps/server/src/receipt-document.ts` (payments block)
- Test: `apps/server/src/receipt-ticket.test.ts`, `apps/server/src/invoice-document.test.ts`

**Interfaces:**
- Consumes: `card` (Task 5). Reuses labels `paymentContactless`, `paymentChip`, `paymentSwipe`,
  `paymentAuthorization`.

- [ ] **Step 1: Failing tests** (`es-ES`, 80 mm and 58 mm): `"names the card on a card payment"`
  — tender `card` with `card` → a row `Visa ****4034 (Sin contacto)` with `26,50 €`, then
  `Autorización 354739`; the same for a card `BillTenderLine`; a typed reference still prints
  `Ref. …`; `unknown` entry mode prints no bracket; `"the A4 page names the card"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/receipt-ticket.test.ts
  src/invoice-document.test.ts -t "card"` — expect FAIL.
- [ ] **Step 3: Implement** in the payments block; the scheme as the provider names it,
  capitalised (`VISA` → `Visa`, `MASTERCARD` → `Mastercard`).
- [ ] **Step 4: Run** both files and `src/till-api.receipt.test.ts` whole — expect PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Print card details on receipts"`, run `/finish-branch`,
  open PR 2 (owner lands).

## PR 3 — Pendiente and the payment slip (after MEAL-END-TICKET lands)

_2026-11-18, as built (#3752): `readReceiptPayments` takes `settled` rather than `invoiceType`. The
slip does not print for every payment of an issued ticket: the design's "Left to the builder" list
gives the conditions._

### Task 7: payments taken before settlement, and the amount owed

**Files:**
- Create: `apps/server/src/receipt-payments.ts`
- Modify: every builder of a `TillSaleResult` found in Step 1, `till-sale.ts` (`TillSaleResult`)
- Test: `apps/server/src/receipt-payments.test.ts`

**Interfaces:**
- Produces: `readReceiptPayments(tx: Transaction, saleId: SaleId, workingOrderId: string | null,
  invoiceType: TillSaleResult["invoiceType"]): Promise<{ payments?: BillTenderLine[]; owed?:
  string }>`. For a settled sale it returns today's `readBillTenderLines` result and no `owed`.
  For an issued, unsettled F1/F2 it lists the bill's **received** bill payments (they live in
  `bill_payments` until `settleSale` writes `tenders`: `bill-payments.ts:790-801`, using the same
  received-and-net reading as `fundsOf`/`readBillBalance` there), with card details as Task 5, and
  `owed` = amount due (`readIssuedSales`, `sale-due.ts`) minus the sum of their net applied amounts
  (tips and completed refunds out, each counted once: `BillTenderLine.amount` already holds
  applied + tip net of refunds), omitted when ≤ 0. R4/R5 and a deferred close: no `owed`.
- Produces: `TillSaleResult.owed?: string`.

- [ ] **Step 1: Survey** every place a `TillSaleResult` is built (as of 2026-11-17: `till-sale.ts`
  about lines 949, 1141, 1866, 2020; `bill-payments.ts:886`; `transaction-receipt.ts:126`) and
  list them in the PR description; each calls `readReceiptPayments`.
- [ ] **Step 2: Failing tests** (database-backed): `"an unpaid departure owes the whole amount
  due"`; `"a part-paid bill issued unpaid lists its payment and owes the rest"` (60.00 due, a
  40.00 card bill payment with a 2.00 tip → one listed payment, `owed` `"20.00"`); `"a refunded
  part payment counts net"`; `"a settled sale owes nothing"`; `"a deferred close owes nothing"`;
  `"a replacement of a paid ticket owes nothing"`.
- [ ] **Step 3: Run** `pnpm --filter @waitron/server exec vitest run src/receipt-payments.test.ts`
  — expect FAIL.
- [ ] **Step 4: Implement** with exact `Decimal` at money scale, then call it from every builder.
- [ ] **Step 5: Run** the new file and every file the builders' own tests live in — expect PASS.
- [ ] **Step 6: Commit** `git commit -s -m "Receipts list payments taken before settlement and
  what is still owed"`.

### Task 8: print Pendiente; the slip prints no amount owed

**Files:**
- Modify: `apps/server/src/receipt-document.ts`, both label files, `apps/server/src/payment-slip.ts`
  (`remaining` input and row), `apps/server/src/payment-slip-print.ts` (the `remaining` reads at
  about lines 100, 112, 146, 194, 207, 253, 287)
- Test: `apps/server/src/receipt-ticket.test.ts`, `apps/server/src/invoice-document.test.ts`,
  `apps/server/src/payment-slip.test.ts`, `apps/server/src/payment-slip-print.test.ts`

**Interfaces:**
- Consumes: `owed` (Task 7). Rename label `paymentRemaining` → `owed` (values unchanged: `es-ES`
  `Pendiente`); its only remaining user is the receipt.

- [ ] **Step 1: Failing tests:** `"prints Pendiente on an unpaid receipt"` (tender `unpaid`,
  `owed` `"60.00"` → `Pendiente 60,00 €`, bold, after the payments); `"prints payments then
  Pendiente on a part-paid receipt"`; `"a duplicate of a settled sale prints no Pendiente"`; the
  A4 page prints it; `"a bill payment's slip shows no amount owed"` (slip text holds neither
  `Pendiente` nor the remainder). Update existing slip cases that assert the remaining row to
  assert its absence.
- [ ] **Step 2: Run** the four files with `-t "Pendiente|owed"` — expect FAIL.
- [ ] **Step 3: Implement**; drop `remaining` from `PaymentSlipInput` and every read feeding it.
  `bill_payments.remaining_after` stays if `grep -rn remainingAfter` shows other readers.
- [ ] **Step 4: Run** the four files whole, plus every file naming `paymentRemaining` — expect PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Receipts print what is still owed; the slip does not"`.

### Task 9: a later payment gets a slip

_2026-11-18: the `finalizeSettleRecovery` path named in Step 1 was dropped on the watcher's call of
that day. When staff press Pay again to file a reader payment whose answer was unclear, that second
Pay prints no slip, even with **Print card slip** ticked; a first Pay that asked for a slip and is
still waiting at the reader prints its slip when it finishes. The owner's choice of 10 November
(`docs/superpowers/specs/2026-10-22-a739-owner-payment-and-receipt-flow.md`, line 3) already accepts
that an unclear reader answer may miss a slip, with "print a copy" as the recovery, and the code
that files the money gets simpler._

_20 November 2026: no longer holds; see "20 November 2026" under the 19 November rework._

**Files:**
- Modify: `apps/server/src/payment-slip-print.ts` and each settle path found in Step 1
- Test: `apps/server/src/payment-slip-print.test.ts`, the settle paths' route tests

- [ ] **Step 1: Survey.** List every path that settles a sale issued **before** the payment (as of
  2026-11-17: a bill payment against an issued unpaid sale, `bill-payments.ts:815`, and its capture
  slip at about line 1734; collecting a placed order, `runCollectOrder`, `till-sale.ts:2254-2355`;
  a connected reader, `finalizeSettle` (2081) and `finalizeSettleRecovery` (2140), which print
  through `printCapturedCardSlip` today). Write the list in the PR description.
- [ ] **Step 2: Failing tests**, one per path: `"a cash payment of an issued ticket prints a
  payment slip"` (the slip holds the amount and no invoice number and no `Pendiente`); the card
  variants show the card as today. Controls, each printing no new slip: a payment that issues the
  ticket itself; a device without a `payment_slip` printer; a profile without `print-receipt`; a
  reader with `prints_own_slip_automatically`; a request without the till's slip request
  (`freezeCardSlip`'s `requested !== true`, `payment-slip-print.ts:42`).
- [ ] **Step 3: Run** the new cases — expect FAIL.
- [ ] **Step 4: Implement** through `resolvePaymentSlipPrinter`; no drawer command in the slip job.
- [ ] **Step 5: Run** the touched files whole — expect PASS. Update the till guide's payment
  section (English and Spanish) only if it describes what prints after a later payment.
- [ ] **Step 6: Commit** `git commit -s -m "A later payment prints a payment slip"`, run
  `/finish-branch`, open PR 3 (owner lands).

## Rework 2026-11-19: payment slips are optional

**Why.** The owner's answers on #3752 (lane L `questions.md`, "WATCHER 2026-11-19 20:56" and
"20:57"): "payment slips should be optional, only if the customer wants one"; "the receipt/invoice is
required, the payment slip is not"; a lost slip "could be reprinted from the printer job queue";
"Payment slips shouldn't have a reprint function. they only print once … each person has the
option of receiving their own payment slip"; and (20:56, "correct") "no reprint function" means no
slip reprint button in the till. The rule from now on: the receipt or invoice is required for every
sale and lists the payments taken before it prints; a duplicate of it may be printed on request. A
payment slip prints once, only when that payer asks, for any method, and is reprinted only from the
print queue. No design may rely on a slip existing. Tasks 7 and 8 (payments and **Pendiente** on the
receipt; no amount owed on the slip) stand. Task 9's automatic slip, and every slip copy, go.

**20 November 2026: a card reader's slip request is stored.** The owner held #3752 because a slip asked for on a card payment whose reader answer was lost never printed. The owner's answers (lane L `questions.md`, "WATCHER 2026-11-20 10:21"): a reader declining while the till waits, with a slip asked for, prints "Payment not taken"; a lost answer settled later, by a manager's Resolve included, prints the slip once, at the device where the payment began. So the choice is kept on the payment (`bill_payments.slip_wanted`, fixed by `bill_payments_guard_update`) and the slip is queued in the same transaction that moves the payment out of waiting (`withSettledSlip`, `payment-slip-print.ts`). Any other failed payment with a slip asked for, a reader with no network or one that refuses to start included, prints "Payment not taken" by the watcher's rule ("prints the slip once when the payment becomes received or failed"). A charge refunded in full before it is released prints no slip; that default is the lane's, not the owner's.

### What the branch does today (head `ec647b65a5`)

Slips that print without anyone asking:
- **Cash or Other card machine, as a bill payment** (`POST /api/working-orders/:id/payments`, which the
  till's bill payments, whole-bill payments and collection use: `apps/till/src/api/client.ts:3723,4986`): `enqueueLaterPaymentSlip`
  (`apps/server/src/payment-slip-print.ts:92`), called at `apps/server/src/bill-payments.ts:1522`
  whenever the sale was already issued. The till cannot ask or decline: a slip field on a cash or
  hand-keyed payment is refused (`bill-payments-api.ts:130,157-159`; test
  `payment-slip-print.test.ts:677`, from `main`).
- **Cash or Other card machine, collecting an issued order** through
  `POST /api/working-orders/:id/collect` (`till-api.ts:2879`): the same call at
  `till-sale.ts:2352`. No screen calls that route any more (`git grep` finds no `/collect` caller
  in `apps/till/src` or `apps/dashboard/src` other than `/api/orders/:id/collect`, a hand-over),
  but the bench does: `apps/server/scripts/bench/trading-day.ts:425` collects a placed order in
  cash with no slip field, and `scripts/bench/trading-day.test.ts` ("trades ten bills through the
  routes and files every one") requires every payment route, `collect` included, to be used. The
  till's own Collect button reaches `/payments` instead (`tender-pay.ts:815-816` → `till-app.ts:8893
  #onCollectOrder` → `client.ts` `collectOrder` → `#collectWholeBill` → `#payWholeBill`).
- Both rest on `originalAttempted` (`receipt-print.ts:572`), the "never on no paper" rule: a slip
  prints if the sale has any original receipt job or original email or A4 delivery, in any state.
  That is also the two-papers case (PR description item 4): a payment taken while an original
  waits is on the original and on a slip. Existing tests for both directions pass:
  "a cash payment of an issued ticket prints a payment slip" (`payment-slip-print.test.ts:1796`) and
  "a cash payment that issues the ticket itself prints no payment slip" (`:2762`); the email and A4
  cases are `:2381-2761`.
- **Connected card readers do not print a Waitron slip by themselves.** `freezeCardSlip` returns
  nothing unless the till sent `printCardSlip: true` (`payment-slip-print.ts:50`), and the till's
  **Print card slip** switch starts off for each payer (`bill-pay-dialog.ts:519,824`,
  `presented-pay-dialog.ts:169,246`, `tender-pay.ts:362,560`). Test "does not print an unrequested,
  declined or unanswered attempt" (`payment-slip-print.test.ts:696`) passes. A reader marked
  **Prints its own slip automatically** (`packages/payments/src/schema/card-readers.ts:14`) prints
  on the device itself; Waitron sends it no print instruction (`git grep -i "print\|receipt"`
  over `packages/payments*/src` finds only that flag and card-detail comments) and so cannot stop it.
- The counter's walk-up sale (`POST /api/sales`, `recordTillSale`, drawer at `till-sale.ts:1126`)
  prints no slip for cash or Other card machine, and has no way to ask for one.

Slip copies (each prints the slip again marked «DUPLICADO», `payment-slip.ts:19,37`):
- **Payments on this bill → Print a copy** (`bill-pay-dialog.ts:1431-1443`, from #2767, A739),
  `POST /api/working-orders/:id/payments/:paymentId/slip-copy` (`bill-payments-api.ts:312`),
  offered by `canCopySlip` (`bill-payments.ts:205,724,739`).
- **Find a bill → Payment slip** (#3803; `till-ticket-view.ts:742-780,1159-1174`),
  `POST /api/sales/:id/payment-slip/:paymentId` (`till-api.ts:2765`), offered by `paymentSlips` on the
  ticket read (`till-api.ts:2490`).
- **The window after a payment → Payment slip** (this branch; `settlement-document-dialog.ts:156-175`,
  `till-app.ts:11174-11205,22916-22926`), `GET` and `POST /api/sales/:id/payment-slip-copy/:paymentId`
  (`till-api.ts:2779,2793`), with `paymentId` added to `/api/pay`'s answer (`till-sale.ts:1163-1171`).
- All three are decided by `decideSlipCopy` (`payment-slip-print.ts:183-476`, about 300 lines).
- The till's three failure messages send staff to these copies (`apps/till/src/i18n/strings.ts:1662-1666`,
  chosen at `till-app.ts:980-985`).

The print queue (the dashboard's **Print Queue**, guide `printers.md#print-queue`):
`GET /management-api/print-jobs` lists, among others, the 100 most recently finished jobs
(`print-api.ts:141,1716-1727`). That count is over every printer and every printout that is not
A4 (the query filters `kind <> 'a4'` and `status = 'done'`), so receipts, station tickets and drawer
openings all use it up, and an older slip drops off the list (read only, not measured; on a busy
service the 100 may cover well under an hour); **Reprint** calls `POST /management-api/print-jobs/:id/resend`
(`print-api.ts:1883`), which needs `hardware.manage`. Run with a throwaway test (deleted) on this
branch: a cash payment after Print the bill queued a drawer job and a slip job, both with no sale id
and no copy mark; with both marked printed, resending the slip on its own printer queued the same
bytes, with no «DUPLICADO»; on another printer it was refused `print_job.own_printer_only`; the
drawer job was refused `print_job.not_resendable` (`canResendPrintJob` accepts only `document` jobs,
`packages/printing/src/outbox.ts:115-128`), as CLAUDE.md §5 requires. A slip's bytes are cleared
after 7 days (`housekeeping.ts:110`), after which it cannot be reprinted.

The receipt duplicate exists and stays: **Reprint** in Find a bill (`till-ticket-view.ts:1146-1155`,
`POST /api/sales/:id/reprint`, `till-api.ts:2807`) and **Print a copy on …** in the window after the
last payment (`settlement-document-dialog.ts:151`, `invoice.print_on_copy`). "a copy of the receipt
lists a cash payment taken after the original, and what is owed" (`payment-slip-print.test.ts:1816`)
passes: the copy is marked «DUPLICADO» and lists `Efectivo 5,00` and `Pendiente 25,00`.

### Decisions (recommended defaults)

- **R-a. Remove every slip copy in this PR — Find a bill's Payment slip (#3803), the bill's Print a
  copy (#2767) and the window's Payment slip — with `decideSlipCopy`, the four routes (three `POST`,
  one `GET`), `canCopySlip`, `paymentSlips`, `/api/pay`'s `paymentId` and the slip's «DUPLICADO»
  marking.** Why: the owner's "Payment slips shouldn't have a reprint function", which supersedes
  the 10 November "print a copy" recovery (A739 addendum line 3) and the watcher's 18 November copy
  decisions. Queue item SLIP-COPY-AFTER-RESTART (lane L `queue.md:84`) becomes moot: the watcher
  drops it.
- **R-b. The choice is the existing switch, offered for every method, off for each payer.** Reuse
  `cardSlipChoice` (`pay-equipment.ts:517`, a `wt-switch`) on the bill payment dialog, the
  presented-bill sheet and the counter's pay panel. Why: staff already know it, it already starts
  off and resets per payer, and Forms needs nothing new (an optional choice, no validation).
  - **When it shows.** For cash and Other card machine: whenever the device has a payment slip
    printer, whatever reader is chosen and whether or not the venue has a card provider. For a
    connected reader: as today, only when that reader does not print its own slip. Today the switch
    is hidden for every method when the chosen reader prints its own slip
    (`bill-pay-dialog.ts:1030-1039`, `tender-pay.ts:1183-1185`, `presented-pay-dialog.ts:305-312`),
    and on the counter it sits inside `#renderCardExtras`, which draws nothing when
    `cardProvider === "none"` (`tender-pay.ts:1187-1188`). R6 fixes both.
  - **Find a bill's Pay** (`widgets/find-bill-dialog.ts:244-270`, cash or Other card machine) has no
    switch today. Recommended: it gets the same switch in R6, since "each person has the option of
    receiving their own payment slip". This was not in the fresh read; the watcher may strike it.
  - **Names.** The request field keeps its name `printCardSlip` on every path (91 uses in 20 files,
    `git grep -c printCardSlip`); renaming it changes nothing anyone sees. Only what staff and the
    Forms rules see changes, last (R8): the label becomes **Print payment slip** / **Imprimir
    justificante de pago**, and the switch's `name` becomes `printSlip`.
- **R-c. A requested cash or Other card machine slip prints whether or not the ticket has printed,
  after the drawer job; one that cannot be queued says so as a reader slip does.** Why: "each person
  has the option of receiving their own payment slip". The server answers `slipPrintFailed` on
  `/api/sales` and `/api/working-orders/:id/payments` as `/api/pay` already does; the till carries it
  to the screen on every path (R7) and shows one message, "Payment received, but the payment slip
  could not print." That replaces three messages that point at copies that no longer exist.
- **R-d. Readers that print their own slip: no change.** Why: Waitron neither sends nor can stop that
  print; the reader's own settings decide it. The guide's existing paragraph (`table-service.md:177-180`)
  stays. **For the owner:** if such a reader prints a slip for every payment, that slip is not
  optional; turning it off is done in the provider's own settings, which nothing here has verified.
- **R-e. The receipt duplicate stays as it is** (Reprint, and Print a copy on … in the window).
- **R-f. A cash or Other card machine slip names how it was paid.** Today a slip without card facts
  prints only Amount, Tip and Charged (`payment-slip.ts:43-58` prints a method row only for card
  facts). R1 adds one line naming the method from the labels the receipt already uses
  (`labels.cash` "Efectivo", `labels.card` "Tarjeta", in `packages/country-es/src/receipt-labels.ts`
  for every language), so no new wording is needed.
- **R-g. The print queue's reach.** A lost slip is reprinted from **Print Queue** only while it is
  among the 100 most recently finished non-A4 printouts on all printers, and within 7 days. **For the
  owner**, with this default: no code change; the guide's Print Queue sentence (R9) says that a
  lost slip should be reprinted soon, because the list shows only the latest printouts.

### Tasks

Each task runs its focused files whole at the end, then
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts inmutabilidad`
(must pass unedited), and `pnpm --filter <pkg> typecheck`. Read the `Tests` count each time. Each
task is sized for one implementer well under 100 tool calls; an implementer that passes about 150
stops at a passing point, commits and hands over. Till tasks run browser-mode tests: check free
memory first (`memory_pressure | grep free`).

Order: R1 (server: slips only when asked) → R2, R3 (server: copies go) → R4, R5 (till: copies go;
one message) → R6, R7 (till: the switch for every method, carried through every path) → R8 (label
and switch name) → R9 (guides and records). R8 is the last code task so it does not edit lines
R2-R5 delete; R9 follows it because the guides quote the new label.

#### Task R1: a cash or Other card machine slip prints only when asked

**Files:** `apps/server/src/payment-slip-print.ts` (replace `enqueueLaterPaymentSlip` with a requested
slip that returns whether it queued), `receipt-print.ts` (delete `originalAttempted`, `:572`; KEEP
`hasOriginalReceiptJob`, `:558`, which `enqueueOriginalReceipt` uses at `:603`),
`optional-document.ts` (its operation name; a payment before the ticket has no sale id, so name the
order), `bill-payments.ts` (non-reader path, about lines 1490-1535: queue the slip whenever asked,
not only when `begun.issued` is set), `bill-payments-api.ts:130-158` (accept `printCardSlip` for
every method, not only `entry: "reader"`), `till-sale.ts` (`recordTillSale` after the drawer job at
`:1126`; add `slipPrintFailed` to its answer; delete the call at `:2352` in the `/collect` route,
which takes no slip field), `till-api.ts:1873` (`/api/sales` accepts `printCardSlip`),
`payment-slip.ts` (R-f: a `method` on the slip input and its one line).
Tests: `payment-slip-print.test.ts`, `payment-slip.test.ts`, `receipt-print.test.ts`.
- [ ] Failing tests first, in `payment-slip-print.test.ts`:
  - "a cash bill payment prints a slip only when asked", before and after the ticket:
    `printCardSlip: true` gives one slip with the amount, the line "Efectivo", no invoice number, no
    **Pendiente** and no drawer command; omitted gives none. The same for a hand-keyed card (line
    "Tarjeta").
  - "a counter cash sale prints a slip only when asked", through `/api/sales`.
  - "a payment after Print the bill prints no slip unless asked".
  - **The slip inside the transaction that files the sale** (fresh read, Important 4): the payment
    that settles the bill through `/payments`, and a counter `/api/sales` cash sale, each with
    `printCardSlip: true` and a temporary trigger refusing the slip's `print_jobs` insert. Expect the
    payment kept, exactly one new fiscal record (`fiscalRecordCount`), the receipt job present, no
    slip job, and `slipPrintFailed: true` in the answer.
  - **A replay prints no second slip** ("they only print once"): the same `/payments` submission
    (same `submissionId`) and the same `/api/sales` request (same `workingOrderId`) sent again with
    `printCardSlip: true` answer as before and leave exactly one slip job.
  - Controls: a profile without `print-receipt` (no slip, no `slipPrintFailed`: the till offers no
    switch there); a device with no slip printer (no slip, `slipPrintFailed: true`); a failed enqueue
    on an already-issued ticket keeps the payment (adapt `:2849`).
  - In `payment-slip.test.ts`: a slip with no card facts prints the method's line in Spanish and
    English.
  - Run `pnpm --filter @waitron/server exec vitest run src/payment-slip-print.test.ts -t "only when
    asked"` — expect FAIL (400 on the slip field).
- [ ] Implement. Delete the `originalAttempted` cases (`payment-slip-print.test.ts:2381-2761`) and
  rewrite the rest of the "a payment after the ticket was issued" group (`:1680`) to ask for the
  slip. `receipt-print.test.ts:1559` returns to `main`'s 2 jobs.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/payment-slip-print.test.ts
  src/payment-slip.test.ts src/receipt-print.test.ts src/bill-payments.test.ts
  src/till-api.fiscal-sale-paths.test.ts src/till-api.receipt.test.ts` and
  `pnpm --filter @waitron/server exec vitest run scripts/bench/trading-day.test.ts -t "trades ten bills"`
  (the bench's cash `/collect` still files) — expect PASS.
- [ ] Commit `git commit -s -m "Print a cash or hand-keyed payment slip only when the payer asks"`.
  The PR description says that the bench's `/collect` cash payment never queues a slip after R1
  (today it does whenever the order's ticket was issued before collection), so its timings can
  change.

#### Task R2: remove Find a bill's Payment slip and the bill's Print a copy from the server

**Files:** `till-api.ts` (`POST /api/sales/:id/payment-slip/:paymentId`, `:2765`; `paymentSlips` on
the ticket read, `:2490`), `bill-payments-api.ts:312-327` (`POST
/api/working-orders/:id/payments/:paymentId/slip-copy`), `payment-slip-print.ts`
(`printSalePaymentSlip`, `readSalePaymentSlips`, `printBillPaymentSlip`, `readBillSlipPayments`, and
those callers' branches of `decideSlipCopy`), `bill-payments.ts:205,724,739` (`canCopySlip`).
- [ ] Failing test first: in `till-api.profile-actions.test.ts`, "no slip copy route exists": `POST`
  to the two paths above answers 404; run it — expect FAIL.
- [ ] Move the checks that used one of these copies only to reach a slip onto a slip requested at
  payment (CLAUDE.md: preserve behavioural assertions), and delete the tests of the copies
  themselves. The list is under **Changed test checks** → R2.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/payment-slip-print.test.ts
  src/bill-payments.test.ts src/kitchen-language.boundaries.test.ts
  src/till-api.fiscal-sale-paths.test.ts src/till-api.receipt.test.ts
  src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts
  src/till-api.session-person.test.ts src/till-device-proof.test.ts` — expect PASS.
- [ ] Commit `git commit -s -m "Remove the Find a bill and bill payment slip copies"`.

#### Task R3: remove the window's slip copy and the copy machinery from the server

**Files:** `till-api.ts` (`GET` and `POST /api/sales/:id/payment-slip-copy/:paymentId`, `:2779,2793`;
the two codes' statuses, `:677-678`), `payment-slip-print.ts` (`paymentSlipCopyAvailable`,
`printPaymentSlipCopy`, `readWholeCardPaymentId`, what is left of `decideSlipCopy`, and the `copy`
argument of `enqueueSlips`), `payment-slip.ts:19,37` (the copy mark), `till-sale.ts:629,1163-1171`
(`/api/pay`'s `paymentId`), `errors.ts:919-922` (both copy codes; `git grep` finds no other
thrower).
- [ ] Failing test first: extend R2's "no slip copy route exists" with `GET` and `POST`
  `/api/sales/:id/payment-slip-copy/:paymentId`, all four routes answering 404; run it — expect
  FAIL.
- [ ] Delete the code and its tests (**Changed test checks** → R3).
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/payment-slip-print.test.ts
  src/payment-slip.test.ts src/till-api.receipt.test.ts src/till-api.profile-actions.test.ts
  src/till-api.profile-zones.test.ts src/till-api.session-person.test.ts
  src/till-device-proof.test.ts src/till-api.fiscal-sale-paths.test.ts` and
  `pnpm exec vitest run scripts/errors-reachable.test.ts` — expect PASS.
- [ ] Commit `git commit -s -m "Remove payment slip copies: a slip prints once"`.

#### Task R3b: an Other card machine slip shows the operation number and machine typed

**Why.** Owner, 2026-11-19 21:43 (lane L `questions.md`, "WATCHER 2026-11-19 21:43"), on a SumUp Solo
used standalone as a backup machine: "the sumup solo doesn't print payment slips, so it would be good
to be able to print one from waitron in this case". The watcher: the slip shows what Waitron knows —
amount, time, card from another machine, and the operation number and machine name when typed. R-f
prints only the method line. Both values are already stored on the manual payment row
(`packages/payments/src/schema/payments.ts:69,71`, `external_ref` and `external_machine`) and the
receipt already prints the operation number as `${labels.reference} <ref>` (`receipt-document.ts:531`),
so no new wording is needed.

**Files:** `apps/server/src/payment-slip.ts` (`PaymentSlipInput` gains `reference: string | null` and
`machine: string | null`, used only when `card` is null and `method` is `"card"`),
`apps/server/src/payment-slip-print.ts` (the requested-slip path reads both from the manual `payments`
row of that bill payment or sale tender and passes them), their tests.
- [ ] Failing tests first: (1) `payment-slip.test.ts`: a hand-keyed slip with reference `OP-77` and
  machine `SumUp Solo` prints the line `Tarjeta · SumUp Solo` (the method line, then ` · ` and the
  machine as typed) and the line `Ref. OP-77`, after the method line and before Amount; with neither
  typed it prints exactly R-f's single `Tarjeta` line and no `Ref.` line; a cash slip never prints
  either. (2) `payment-slip-print.test.ts`: an Other card machine bill payment with
  `externalRef: "OP-77"`, `externalMachine: "SumUp Solo"` and the slip asked for queues a slip whose
  bytes contain both lines; the same on the counter sale (`POST /api/sales`) path. Run — expect FAIL.
- [ ] Implement. Machine and reference are printed through `prepareText` like every other line.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/payment-slip.test.ts
  src/payment-slip-print.test.ts` — expect PASS.
- [ ] Commit `git commit -s -m "Show the operation number and machine on another card machine's slip"`.

#### Task R4: remove Find a bill's Payment slip and the bill's Print a copy from the till

**Files:** `apps/till/src/api/client.ts` (`printPaymentSlip`, `printBillPaymentSlip`, `paymentSlips`,
`PaymentSlipChoice`, `canCopySlip`), `screens/till-ticket-view.ts` (`:742-780,1159-1174`),
`widgets/bill-pay-dialog.ts:1431-1443`, `till-app.ts` (`#onPaymentSlip` and the `bill-slip-copy`
handler), `i18n/codes.ts:620-627` and `i18n/codes.test.ts:28-38,245-246` (the two copy codes),
`i18n/strings.ts` (`bill_pay.slip_copy`, `bill_pay.slip_copy_label`; leave `action.payment_slip` and
`payment_slip.error` to R5, which still uses them).
- [ ] Failing test first: in `till-ticket-view.test.ts`, a paid ticket split across two cards shows
  no `[data-test=payment-slip]` and no `.payment-slips` group on a device that can print receipts;
  run it — expect FAIL.
- [ ] Delete the buttons, events, client methods, codes and their tests (**Changed test checks** →
  R4).
- [ ] Run `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts src/i18n/codes.test.ts
  src/screens/till-ticket-view.test.ts src/screens/till-ticket-view.a11y.test.ts
  src/screens/till-ticket-view.look.test.ts src/till-app-bill-payments.test.ts
  src/till-app-boot-and-counter.test.ts src/till-app-handheld-pay.test.ts src/till-app.test.ts
  src/widgets/bill-pay-dialog.test.ts src/widgets/bill-pay-dialog.a11y.test.ts` — expect PASS.
- [ ] Commit `git commit -s -m "Remove the Find a bill and bill payment slip copy buttons"`.

#### Task R5: remove the window's Payment slip; one slip failure message

**Files:** `apps/till/src/api/client.ts` (`getPaymentSlipCopy`, `printPaymentSlipCopy`, `paymentId`
on `PayOutcome`, `:2140-2141`), `widgets/settlement-document-dialog.ts:156-175`, `till-app.ts` (the copy
state and handlers, `slipPaymentId` (6 uses), `#onPaymentSlipCopy`; `slipFailureKey`, `:980`,
becomes one key; `#moveSlipFailureIntoPay`, `:22570`, checks `payment_slip.capture_failed` by name
and must follow the one key), `i18n/strings.ts:1662-1666` and the Spanish twins (one message;
`action.payment_slip` and `payment_slip.error` go once nothing uses them).
- [ ] Failing test first: in `till-app-bill-payments.test.ts`, a reader payment whose slip failed
  shows "Payment received, but the payment slip could not print." on the counter, the table and a
  part payment; run it — expect FAIL.
- [ ] Delete the window's button, its client methods and their tests, exactly the cases named under
  **Changed test checks** → R5. In `till-app-settlement-documents.test.ts` and
  `settlement-document-dialog.a11y.test.ts` only this branch's slip cases go; every case `main` has
  in those files, including #3835's "closing the documents window after …" cases that prove the
  receipt prints when the window closes, stays untouched.
- [ ] Run `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts
  src/till-app-settlement-documents.test.ts src/widgets/settlement-document-dialog.a11y.test.ts
  src/till-app-bill-payments.test.ts src/till-app-handheld-pay.test.ts
  src/till-app-adjustments.test.ts src/till-app-deferred-close.test.ts src/till-app-drafts.test.ts
  src/till-app-boot-and-counter.test.ts` — expect PASS, and the `closing the documents window after`
  cases in the output with the same count as on `main`.
- [ ] Commit `git commit -s -m "Remove the window's slip copy and say once that a slip did not print"`.

#### Task R6: show the slip switch for every method

**Files:** `widgets/bill-pay-dialog.ts` (`#slipAvailable`, `:1030`, takes the method; the switch at
`:2193` shown for cash and Other card machine; `printCardSlip` sent for every method at `:2091`),
`widgets/presented-pay-dialog.ts` (`:305`, `:426`, `:673`), `widgets/tender-pay.ts` (`:1183-1194`:
the switch moves out of `#renderCardExtras` so it is drawn with no card provider, and the cash and
Other card machine paths send it in their `confirm-payment` and `collect-order` details, including
`#startCard`'s reference step), `widgets/find-bill-dialog.ts:244-270` (R-b: the switch, and
`printCardSlip` in `find-bill-pay`'s detail).
- [ ] Failing tests first, one set per widget: with a slip printer, choosing cash shows the switch
  off, turning it on sends `printCardSlip: true` with the cash payment, and it is off again for the
  next payer; the same for Other card machine; with no slip printer no switch shows. Plus, on
  `bill-pay-dialog`, `presented-pay-dialog` and `tender-pay`: cash shows the switch beside a chosen
  reader that prints its own slip, and that reader's card payment still hides it; on `tender-pay`,
  cash shows the switch when `cardProvider` is `"none"`. Run the four widget test files — expect FAIL.
- [ ] Implement; on the counter panel the one switch serves every method.
- [ ] Run the four widgets' `.test.ts`, `.a11y.test.ts` and `.unsaved.test.ts` (a new switch is
  staged input) — expect PASS.
  Look at the four screens in both themes and at phone width.
- [ ] Commit `git commit -s -m "Offer a payment slip for cash and other card machines"`.

#### Task R7: carry the slip choice and its failure through every till path

**Files:** `apps/till/src/api/client.ts` (`recordSale`, `:3127-3149`, sends `printCardSlip` on both
branches; `collectOrder` and `#collectWholeBill`, `:3633-3666`, take it and return
`slipPrintFailed` with the ticket instead of dropping it; `#payWholeBill`'s retry key,
`:3675-3689`, includes it like the other tender fields; `TillSaleResult` gains `slipPrintFailed`),
`till-app.ts` (the counter's walk-up sale, `:7618`; `#onCollectOrder`, `:8893`; `#sendWholePayment`,
`:9809`, for the presented sheet and the table's whole bill; the presented sheet's cash and
hand-keyed path at about `:21475-21490`; the table dialog's part payments; `#onFindBillPay`).
- [ ] Failing tests first, one per path, each sending `printCardSlip: true` and showing "Payment
  received, but the payment slip could not print." when the answer carries `slipPrintFailed`:
  counter walk-up cash (`till-app-boot-and-counter.test.ts`); counter Collect cash on a placed order;
  presented-sheet cash (`till-app-handheld-pay.test.ts`); table part payment in cash and the table's
  whole bill in cash (`till-app-bill-payments.test.ts`); Other card machine on the counter; Find a
  bill's Pay. In `api/client.test.ts`: `collectOrder` returns `slipPrintFailed`, and a resend after
  an unanswered whole-bill cash payment sends the same submission with the same choice. Run them —
  expect FAIL.
- [ ] Implement.
- [ ] Run `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts
  src/till-app-boot-and-counter.test.ts src/till-app-bill-payments.test.ts
  src/till-app-handheld-pay.test.ts src/till-app.test.ts` — expect PASS.
- [ ] Commit `git commit -s -m "Carry a requested payment slip through every till payment"`.

#### Task R8: relabel the switch and name it for any method (no behaviour change)

**Files:** `apps/till/src/i18n/strings.ts:1660,3815` (`payment_slip.request`), `widgets/pay-equipment.ts`
(`cardSlipChoice`'s `name`), and the tests that select it: `bill-pay-dialog.test.ts:3407`,
`presented-pay-dialog.test.ts:992`, `tender-pay.test.ts:2567`, the three a11y checks
(`bill-pay-dialog.a11y.test.ts:1402-1406`, `presented-pay-dialog.a11y.test.ts:589-593`,
`tender-pay.a11y.test.ts:337-341`), plus any R6/R7 test that selects `[name="printCardSlip"]`. The
request field `printCardSlip` is not renamed (R-b).
- [ ] Change the label to "Print payment slip" / "Imprimir justificante de pago" and the switch's
  `name` to `printSlip`; update the selectors.
- [ ] Run the four widgets' `.test.ts` and `.a11y.test.ts` (R6's four, `find-bill-dialog`
  included), `till-app-bill-payments.test.ts` and `till-app-handheld-pay.test.ts` — expect PASS with only names
  changed.
- [ ] Commit `git commit -s -m "Label the slip switch for any payment, not only a card"`.

#### Task R9: guides and records

**Files:** `apps/server/src/guide/{en,es}/table-service.md` (the branch's lines after "You close the
table separately", en 82-85 / es 89-93; the `{#reader-slips}` section, en 169-186 / es 184-201,
retitled "Payment slips" with its id kept), `{en,es}/kitchen-service.md` (en 444-446 / es 486-488),
`{en,es}/printers.md#print-queue` (R-g: a lost payment slip is reprinted here, on its own printer,
soon, because the list shows only the latest printouts), `docs/developers/design-system.md:6918-6920`
(the bill window's slip lines: Print payment slip for every method; no Print a copy),
`docs/backlog/till.md:2612-2631` and `docs/backlog/printers.md:344` ("Print a copy before full
payment" in the hardware checks), the two A739 specs (replace this branch's 18 November pointers with
a dated 19 November one), the design spec's "Left to the builder" slip lines (a dated pointer), and
the PR description (changed checks, the owner's answers, the bench note from R1, item list cut).
- [ ] Write each guide sentence from the code built in R1-R8: the switch, any method, off for each
  payer; the slip names the method; no copy; Print Queue for a lost slip; keep the receipt duplicate.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts` — expect PASS.
- [ ] Commit `git commit -s -m "Guides: a payment slip prints only when asked"`, then `/finish-branch`.

### Changed test checks

Existing checks on `main` that change, all from the owner's 20:56 answers. Every pointer below was
found with `git grep` at `0e545cbcbd`; "main" means `f77b29f9bb`.

| Task | Where | Before | After | Owner line |
| --- | --- | --- | --- | --- |
| R1 | `payment-slip-print.test.ts:677` | a slip field on cash or hand-keyed card answers 400 | accepted; one slip when asked | "each person has the option of receiving their own payment slip" |
| R2 | `payment-slip-print.test.ts:88`, `:207`, `:649-675`, `:878-1679` ("the Payment slip button on a paid sale"), `:1990`, `:2016` | copies print, marked «DUPLICADO» | deleted | "Payment slips shouldn't have a reprint function" |
| R2 | `till-api.receipt.test.ts:499-505` (`slipPath`), `:2389` (unknown and malformed ids) | the Find a bill copy route | deleted | same |
| R2 | `till-api.receipt.test.ts:2537` (A965 language), `:2607` (card facts and fiscal rows kept), `:2640` (no entry mode) | card facts seeded into the payment row, then printed through the copy route; `:2596` expects the copy mark | the same assertions, with no copy mark, through `printCapturedCardSlip` (`payment-slip-print.ts:110`, exported), the function that prints a requested reader slip at payment and reads that same row; the "after the venue's language changes" half of `:2537` goes, since a slip prints only at payment | same |
| R2 | `till-api.receipt.test.ts:2665` (a reader that prints its own slip gets no Waitron slip) | the copy is refused | the same pair of cases through `/api/pay` with `printCardSlip: true` and that reader's `readerId`, in `payment-slip-print.test.ts` (whose venue has a simulated reader), unless an existing case there already proves both halves (`:2201`, `:2825` are the candidates: name it in the commit) (`freezeCardSlip` returns nothing for it, `payment-slip-print.ts:51-53`): no slip job for the own-slip reader, one for the other | same |
| R2 | `till-api.receipt.test.ts:2706` (paper width and resolution), `:3196` (slip printer, not receipt printer), `:3226` (next slip on the printer the device switched to) | slip printed through the copy route | MOVED, assertions unchanged, onto a slip requested at payment (a cash `/api/sales` sale with `printCardSlip: true`) | same |
| R2 | `till-api.receipt.test.ts:2694` (refuses a hand-keyed card slip) | 409 | deleted; R1's hand-keyed case replaces it | "each person has the option" |
| R2 | `till-api.receipt.test.ts:2747` (no slip printer), `:2768` (no settlement instant) | the press is refused | `:2747` becomes: a requested cash slip with no slip printer keeps the sale and answers `slipPrintFailed`; `:2768` moves onto `printCapturedCardSlip` with `settled_at` null and expects no slip job and `slipPrintFailed` (it passes `paidAt: payment.settledAt` on to `enqueueSlips`, which reads `paidAt!`; not run: if it prints a slip with no valid time, R2 fixes that) | same |
| R2 | `bill-payments.test.ts:3086` (`:3163-3164`), `:3377` (`:3436-3437`); `kitchen-language.boundaries.test.ts:270` (`:313`) | slips printed through `printSalePaymentSlip` | requested slips at payment, same pairing, order and language checks | same |
| R2 | `till-api.fiscal-sale-paths.test.ts:2165-2203` | three actions incl. `payment-slip` | two | same |
| R2, R3 | route lists: `till-api.profile-actions.test.ts:327-347`, `till-api.profile-zones.test.ts:156-157,246-247,782-800,1391-1395`, `till-api.session-person.test.ts:109-111`, `till-device-proof.test.ts:366-415` | copy routes listed | each route's rows go in the task that removes the route | same |
| R3 | `payment-slip.test.ts:24` | "marks a copy and shows no amount owed" | "shows no amount owed" | same |
| R4 | `api/client.test.ts`: the `printPaymentSlip` row (`:2192-2196`) and the `printBillPaymentSlip` row (`:2236-2242`) of two `it.each` tables; `i18n/codes.test.ts:28-38,245-246`; `till-ticket-view.test.ts:562-684`, and `:687-700` keeps its receipt and drawer checks but loses its two slip lines and `paymentSlips`; `.a11y.test.ts:316`; `.look.test.ts:137`; `till-app-bill-payments.test.ts:94-153`; `till-app-boot-and-counter.test.ts:233`, `:1763-1800`, and the `payment-slip` rows of the `it.each` tables at `:1802-1806` and `:1825-1829`; `till-app-handheld-pay.test.ts:2535-2578` keeps its warning check (R5 rewords it) but loses its `canCopySlip` fixture (`:2540`) and its Print a copy assertion (`:2576`); `till-app.test.ts:524`, `:6489-6509`, `:6511-6525`, `:25754-25785`, and `:6527-6542` keeps its receipt and drawer checks but loses its slip line; `bill-pay-dialog.test.ts:1446-1451`; `bill-pay-dialog.a11y.test.ts:174-184` | copy buttons, events and the two copy codes' wording | deleted | same |
| R5 | `till-app-bill-payments.test.ts:191,5147,5216,9518,9555`; `till-app-handheld-pay.test.ts:434,449,464,2532,2568` | three failure messages naming copies | one message | "they only print once" |
| R6 | `presented-pay-dialog.test.ts:1005-1006` | choosing cash hides the slip switch | shows it | "for every method" (watcher's reading of the 20:56 answers) |
| R8 | the three widgets' a11y switch checks (`bill-pay-dialog.a11y.test.ts:1402-1406`, `presented-pay-dialog.a11y.test.ts:589-593`, `tender-pay.a11y.test.ts:337-341`) | label "Print card slip", `name="printCardSlip"` | "Print payment slip", `name="printSlip"` | same |

This branch's own checks (none of them on `main`) that go back or go:
- **R1:** `receipt-print.test.ts:1559` returns to `main`'s 2 jobs (no slip unasked);
  `payment-slip-print.test.ts:2381-2761` (the originals rule) is deleted.
- **R3:** `payment-slip-print.test.ts:2884-3646` (the window's copy) is deleted.
- **R5, `apps/till/src/till-app-settlement-documents.test.ts`:** the block this branch added between
  `afterEach` and "emails an F2 receipt only after Send …" (lines 44-536), with the imports it added
  (`t`, `codeMessage`, `billOf`, `cash`, `floor`, `openDialog`, `paymentOf`, `press`, `tableOrder`,
  `takenOf`, `type`, `BillPaymentView`), its helpers (`cardTicket` through `restOfBill`) and these 22
  cases: "prints a copy of the slip of the payment just taken, once"; "offers no slip when the card
  payment's reply names no payment"; "offers no slip in the window when the server has no copy to
  print"; "… when asking the server fails"; "does not ask about a slip on a device that may not print
  receipts"; "does not let a late answer about one sale's slip reach the next sale's window"; "says in
  the window when a press finds nothing to print"; "says on the page when nothing printed and the
  window has closed"; "does not carry a slip failure into the next sale's window"; "keeps a failure
  arriving after the next sale's window opened out of that window"; "shows a slip failure on the page
  when the window closed while it printed"; "does not show the last sale's slip button while the next
  sale's answer is awaited"; "keeps a failure arriving after the next sale's window opened off the
  page"; "says the disk is full on the page when the window closed while the slip printed"; "offers
  no slip when changing a line settles the bill"; "… when moving dishes settles the bill"; "… when a
  refused edit finds the bill already paid"; "… when an edit settles a counter bill"; "offers no slip
  after a whole cash payment of a table bill"; "copies the card payment the answer names, also when
  it replays an earlier one"; "offers the slip after a reader sale at the counter"; "offers no slip
  after a found bill is paid". Every case from "emails an F2 receipt only after Send …" (`:538`) on
  is `main`'s, including #3835's `closing the documents window after %s` set (`:957-1002`) and "sends
  nothing and keeps the window when staff keep the basket …" (`:1004`): untouched.
- **R5, `widgets/settlement-document-dialog.a11y.test.ts`:** only "the slip copy button and its
  failure are accessible in ${theme}" (`:180`); the rest of the file, #3835's cases included, stays.
- **R5, elsewhere:** `till-app-adjustments.test.ts:432-448` and `:1728-1741`;
  `till-app-deferred-close.test.ts:129-138` and `:795-804`; `till-app-drafts.test.ts:9325-9392`
  (the `describe("a draft action that settles the bill")` block); `till-app-bill-payments.test.ts:3612-3629`
  ("offers the slip of the recorded card payment that settled the bill"); `api/client.test.ts:2148-2177`.
  Each asserts only that the window's slip button is or is not offered, so each would pass
  without proving anything once the button is gone. These files had no slip references on `main`.

Re-grep before closing R5, over `apps/ packages/ scripts/ docs/developers/` and the guides, for
`payment-slip/`, `payment-slip-copy`, `slip-copy`, `payment_slip_no_printer`,
`payment_slip_unavailable`, `printSalePaymentSlip`, `printBillPaymentSlip`, `printPaymentSlip`,
`getPaymentSlipCopy`, `printPaymentSlipCopy`, `paymentSlipCopy`, `canCopySlip`, `paymentSlips`,
`PaymentSlipChoice`, `slipPaymentId`, `readSalePaymentSlips`, `readBillSlipPayments`,
`readWholeCardPaymentId`, `decideSlipCopy`, `enqueueLaterPaymentSlip`, `originalAttempted`,
`bill_pay.slip_copy`, `action.payment_slip`, `payment_slip.capture_failed_` and `bill-slip-copy`:
expect hits only in dated plans, specs and backlog history. At `0e545cbcbd` that sweep found
nothing outside `apps/server/src`, `apps/till/src` and the docs R9 lists; `apps/dashboard`,
`packages/` and `scripts/` mention slips only for printer roles, the reader's own-slip setting and
expired print data, which stay true.

### Size and fiscal safety

About 160 production lines added and 750 removed; about 600 test lines added and 2,900 removed
(`payment-slip-print.test.ts` alone loses about 1,900, `till-app-settlement-documents.test.ts`
about 490). Estimates, not counts.

Nothing here touches the receipt or invoice builders (`receipt-document.ts`, `invoice-document.ts`),
the hash, the chain, numbering or series, or any fiscal or database package. R1 adds a print job,
inside a savepoint (`optionalDocument`), to the payment transactions in `bill-payments.ts` and
`recordTillSale`, the same wrapper the receipt job already uses there. A refused slip rolls back
only its own step; a failure that ends the whole transaction (a full disk) still undoes the payment,
as it would for the receipt job. R1's trigger cases show the first; the golden huella and
`inmutabilidad` runs, unedited, and `till-api.fiscal-sale-paths.test.ts` cover the rest.

**Not established:** whether a reader that prints its own slip can be set to print only on request
(provider settings, R-d); whether anything outside this repository calls
`POST /api/working-orders/:id/collect` (inside it, only the bench does).
