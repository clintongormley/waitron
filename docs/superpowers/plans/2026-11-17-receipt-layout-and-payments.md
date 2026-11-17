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
- New words go in every language block of `packages/country-es/src/receipt-labels.ts`
  (`en-GB`, `es-ES`, `ca-ES`, `gl-ES`, `eu-ES`) and every key in `RECEIPT_LABEL_KEYS`
  (`packages/country/src/country.ts:60`). Pre-live: rename freely.
- Coverage holds `98/98/98/95` in every package touched. Comments only for an invariant or a
  non-obvious why; delete stale ones you pass (the `"Card identity belongs on the slip"` comments at
  `till-sale.ts:308,402` go stale in PR 2).
- Run focused tests with `pnpm --filter <pkg> exec vitest run <file> -t "<name>"` (never
  `pnpm test <file> -t`, which drops the filter). Read the `Tests` count.

## Review Focus

1. **58 mm paper.** At `PRINTER_58` (32 columns) a mixed-rate receipt with a `1.234,56` line and a
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
    ≤ 32 characters, and the letter follows the amount on the same line.
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
  right-aligned under their headings); `"fits 32 columns with two rates and four-figure
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
