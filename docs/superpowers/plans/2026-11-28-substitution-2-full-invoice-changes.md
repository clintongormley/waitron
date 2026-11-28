# Substitution 2: splitting, cancelling and changing the customer of a full invoice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Staff can reopen (split), pay part of, or cancel a printed full invoice (part A, D4), and
can change the customer on a past full invoice (part B, D5), with Waitron filing the corrective
invoices decided on 2026-11-28.

**Architecture:** Splitting and cancelling reuse today's whole-credit path (`creditWholeInvoice`),
which learns three things: to credit a full invoice by differences ("I") to zero, naming the same
customer, in the full correctives' series; to credit **any** invoice that already holds
corrections, receipt or full invoice, by minus what its latest version stands at; and to say whether
the credit is an **R4** (a split: the sale went ahead, only who gets the paper changes) or an **R1**
(a cancel: the sale is undone, VAT law art. 80.Dos). The bills after a split start as full invoices
for that customer. A customer change is a new action in Find a bill: the same tax number files an
**R4 by substitution** ("S") with the same amounts and the corrected customer; a different tax number
files an R4 "I" to zero and a new full invoice (F1) to the new customer. Whether a corrective is R1 or
R4 is stored on the sale, not guessed from its shape.

**Tech stack:** TypeScript, Hono server, Drizzle on `node:sqlite`, Lit till, Vitest (Node and
browser), the `@waitron/verifactu` library and its live AEAT test mode.

**Spec:** `docs/superpowers/specs/2026-11-28-corrections-by-substitution-design.md` (branch
`docs/corrections-by-substitution`, worktree `~/workspace/worktrees/waitron-docs-corrections-by-substitution`):
D4 and D5, its section 2 rows "Split or cancel a printed full invoice" to "Invoice the meal to a
different customer", and section 5 points 2 and 3. Plan 1 (D1–D3) is
`docs/superpowers/plans/2026-11-28-substitution-1-correctives.md`; plan 3 (D6–D10) is
`docs/superpowers/plans/2026-11-28-full-invoice-for-a-receipt.md` (both read as scratchpad drafts,
2026-11-28).

Status: written 2026-11-28 for lane L; revised the same day after one fresh-context review; not yet cleared by the watcher. FISCAL: the owner lands every pull request. Lane L builds it. Line numbers are `main` at
`2bfa7a34e3`, read, not run, unless a run is named. Lines on unlanded branches name the branch and
its head.

**Words.** A *receipt* is a simplified invoice (AEAT's F2). A *full invoice* names the customer (F1).
A *corrective* is a new invoice correcting an earlier one: R1 for art. 80 causes (money back,
discounts, a sale undone), R4 for "the rest", R5 for any receipt's. *By differences* ("I") carries
only the change; *by substitution* ("S") carries the corrected figures and the figures it replaces.
The *latest version* is the original or its newest restatement (plan 1's `latestVersionOf`; its
column `restates_sale_id`). *What it stands at* is the latest version's figures. *To zero* means a
corrective by differences of minus what the invoice stands at. The *customer block* is what AEAT's
record carries about the customer (`Destinatarios`): name and tax number, never the address.

**Two parts.** Part A (PR 0's A cases, PRs 1, 2, 3) delivers D4 and needs nothing from part B or from plans 1 and
3. Part B (PR 0's B cases, PRs 4 to 8) delivers D5, and needs plan 1's restatements and plan 3's link. The owner
can land part A and defer part B.

---

## Should this exist?

1. **The need**, in the owner's words (design §1): splitting or cancelling a printed full invoice,
   "yes" to including it, with option "b" for the new bills; changing a full invoice's customer was
   "proposed in the session and kept in scope by 'Please build the plans to get this all
   implemented'". Today all of it is refused or missing: Reopen bill, Pay for items on a printed bill
   and Nothing was served refuse a full invoice (`apps/server/src/bill-reopen-state.ts:26-35`,
   `sale.correction_unsupported`; the till hides both actions, `till-table-order-screen.ts:7114-7115`),
   any invoice already corrected cannot be credited in full (`sale.correction_not_whole`,
   `packages/core/src/record-correction.ts:494-500`), and nothing changes an issued invoice's customer
   (the record fix refuses it, `packages/fiscal-verifactu/src/record-remedy-http.ts:101-118`). Staff
   then leave a wrong or unsplittable invoice standing, or the accountant issues correctives by hand
   outside Waitron's numbering and its chain with AEAT. **Once it lands** staff can reopen, pay part
   of and cancel a printed full invoice, also one corrected before, and fix or change its customer
   from Find a bill or while giving money back. **Still unavailable:** a customer change on an
   invoice AEAT refused for its customer block (A1089's "no writer at all", `docs/backlog.md:215`),
   and Cancel or Reopen of a bill whose receipt plan 3 swapped for a full invoice (plan 3's N9).
   **Simplest alternative:** refuse as today. It does not meet the ask. A smaller build that does:
   every customer change as an R4 "I" to zero plus a new F1, never an R4 "S". It drops PRs 4 and 7
   and most of the dependency on plan 1, but issues two documents and cancels an invoice whose only
   fault is a misspelt name; the owner chose the R4 "S" for that (D5). **Extras beyond the ask:** one
   stored column saying R1 or R4 (Task 1); crediting a corrected receipt to zero comes with the
   corrected full invoice's, since the code is the same (P13).
2. **True size** (estimate; by file, then three times for production, as CORRECT-FULL-INVOICE's
   "True size"): about 2,850 production and 5,150 test lines over nine pull requests, plus the
   library PR. Generated: core's starting migration and its snapshot, once per part (PR 1, PR 5b),
   about 20 and 40 lines. Table at the end.
3. **Who approved it.** D4 and D5 and their quotes are in the design's §1 table, status "approved by
   the owner in session waitron-84, 2026-11-28". R1 for a cancel and R4 for a split are the main
   session's change to this plan's brief (2026-11-28). Every default below is lane L's and UNVERIFIED
   until the watcher clears the plan. The types are best guesses the adviser confirms (section "For
   the adviser"); the build does not wait for the answer.

## Decisions, each with a default

The build goes ahead on each default.

| # | Decision | Default (lane L) | Who |
| --- | --- | --- | --- |
| P1 | The type for a **split** (Reopen bill, Pay for items on a printed bill) | R4 "I" to zero naming the customer as the latest version names it, `full_corrective` series: the sale went ahead and only who gets the paper changes, AEAT's «Resto» | adviser |
| P2 | **Nothing was served** on a full invoice | R1 "I" to zero, same customer and series: the sale is undone, art. 80.Dos, as the adviser sheet's question 6 reasons for a dish that never came. Not an annulment (*anulación*), as today's code already chooses for a customer-named invoice (`cancel-credit.ts:57`): the customer may hold the paper. | adviser |
| P3 | What bills made after **Reopen bill** start as | The reopened bill: a full invoice for the latest version's customer, with the printed bill's delivery. A new bill that Move dishes or Pay for items makes **from a reopened bill** set for a full invoice starts with that bill's choice. Staff may change the customer or switch any to a receipt (owner's option "b"), **except** the reopened bill while it holds payments carried from the printed bill: today's lock refuses F1 → F2 once a bill has a received payment (`working-order-invoice.ts:153-166`). Moves and Pay for items on any other bill are unchanged. | owner |
| P4 | Pay for items on a printed full invoice | It reopens the bill (P1), and the person paid out starts with the reopened bill's choice (P3), shown on Pay with Change and Receipt instead before paying (PR 3). On a bill not reopened from a printed one, nothing changes: today's new bill copies no invoice choice (`pay-for-items.ts:283-292`). | owner |
| P5 | Where the corrective to zero goes on Reopen bill and Nothing was served | The way the original went (CORRECT-FULL-INVOICE PR 4a's `sendFiledCorrective`), with no choice in those windows; Find a bill prints or emails it again (that item's PR 4b/5). | owner |
| P6 | "Same customer with corrected details" or "a different customer" | The same tax number, identifier type and issuing country, after the country pack's normalising, is a details fix (R4 "S"); anything else is a different customer (R4 "I" + new F1). So a mistyped tax number is put right by cancelling and reissuing: heavier, and legal in our reading. | owner, adviser |
| P7 | An address-only change | Still an R4 "S": the paper changes, though the record's customer block equals the original's. | adviser |
| P8 | The new F1 to a different customer | Issued now in the full-invoice series, carrying the original's date of operation (`FechaOperacion`), as plan 3's D10 does, so the VAT stays in the original's quarter. Its money stays on the old F1, which keeps its payments, as plan 3's N2 does for a receipt; the R4 credit and the new F1 move none; the new F1's later correctives count against the old F1. One row of plan 3's `sale_reissues` links the three (PR 5b). | adviser |
| P9 | Where staff change the customer | **Change customer** on a past full invoice in Find a bill, a full screen on lane O's field block (O5a-0), beside Give money back; for details and amounts together, a **Customer** line in Give money back's corrective block (PR 7). | owner |
| P10 | Who may change the customer | Whoever holds `sale.rectify` ("Issue corrective receipts and invoices"), else a PIN from someone who does, after the zone and profile check Give money back runs (`checkAccess`, `tender-refund-authorization.ts:76`). | owner |
| P11 | Refused for now, each with a next step | A different customer on a printed bill not yet paid ("Reopen the bill and choose the customer there"); any customer change while a give-back is open ("Finish it in Money back under way first"); a different customer on an unpaid deferred invoice or one that took an advance off, until PR 8; a different customer on a full invoice that is itself a link's new invoice (moved once already, or plan 3's swap of a receipt), because its money sits two links back ("You can still correct this customer's details"). | owner |
| P12 | The tax-office list's R4 wording, now that R4 is not only a replacement | "Corrective invoice (other causes)" / «Factura rectificativa (resto)» for every R4, in place of CORRECT-FULL-INVOICE D11's "replacing another". | owner |
| P13 | Crediting an invoice that holds corrections | A whole credit of minus what it stands at, naming the latest version (plan 1's S3), for receipts and full invoices alike; today it refuses `sale.correction_not_whole`. Plan 1's S9 leaves this to plan 2. So Reopen bill and Nothing was served work after an earlier give-back on a receipt too. | owner |

**The owner's 25 November answer** ("once we have issued a full invoice … keep with full invoices,
and not switch back to receipts", CORRECT-FULL-INVOICE design §6, answer 2) and **option "b"** of 28
November cover different things in this plan's reading: every document issued **against** a full
invoice stays a full invoice's corrective (R1 or R4, never an R5; core's guard,
`correction-eligibility.ts:7-21`, stays), while the bills after a split are **new sales**, and option
"b" lets staff make any of them a receipt. PR 2's description says so to the owner.

## For the adviser

The main session adds these to question 15 of `docs/compliance/2026-11-19-adviser-meeting.md`:

1. P1: R4 "I" to zero for splitting a printed full invoice; the new bills as full invoices or receipts.
2. P2: R1 "I" to zero for cancelling a full invoice where nothing was served, not an annulment.
3. P6: a mistyped tax number put right by an R4 "I" to zero and a new F1, not an R4 "S".
4. P7: an R4 "S" whose customer block is unchanged because only the address was wrong.
5. P8: the new F1 to a different customer dated today with the original's date of operation.

## Dependencies

| On | What this plan assumes, without designing it | Needed by |
| --- | --- | --- |
| **Plan 1** | PR 1: `restates_sale_id`, `restated_total`, `restated_vat_breakdown`, the trigger that refuses a restatement once the target holds a correction by differences (its S2), `latestVersionOf(tx, targetId)` and `figuresOfVersion(tx, saleId)` (its Task 2), the backend's `rectifiesSaleId` and `substitution: { replaced; restated }` (Tasks 3 and 5), `substitutionFields` (Task 6). PR 2: `apps/server/src/restated-invoice.ts` (Task 8) and the tax-office list (Task 10). PR 4: the full invoice's A4 page for an "S" (Task 14). Its PR 0 may carry this plan's cases. | part B (PR 0's B cases, PR 4 onward). Part A uses none of it; if plan 1 PR 1 lands first, PR 1 Task 4 also checks against `figuresOfVersion`. |
| **Plan 3** | PR 2: Task 2.1's `sale_reissues` (`original_sale_id`, `credit_sale_id`, `invoice_sale_id`, each with a unique index) and its trigger `sale_reissues_check_pair`; Task 2.2's `correctivesOf` branches and coverage trigger (a link's new invoice's correctives count against the original) and `correctionTargetFor` (a linked original answers its new invoice). PR 3: Task 3.3's internal `writeSale` in `record-sale.ts`. PRs 4a/4b: every reader of its §5 following `sale_reissues`. Its "Seams with plans 1 and 2" names what PR 5b adds. Its PRs 8 and 9 (a receipt that took an advance off, an unpaid one). | PR 5b; PR 8 |
| **CORRECT-FULL-INVOICE** (lane L) | PR 4a #4560 (open, head `411edfbd56`): `sendFiledCorrective` in `apps/server/src/corrective-delivery.ts`; the choose-way branch (`feat/correct-full-invoice-choose-way`, head `8732f4f400`, not pushed): `readCorrectiveChoice`, `parseCorrectiveDelivery`, `checkCorrectiveDelivery`, `sendFiledCorrective`'s `chosen`, the till's `widgets/corrective-choice.ts`; PR 4b's `invoice_corrections.delivery` and its rebuild; PR 5's past R1 in Find a bill | PR 2 (4a); PRs 5a, 7 (choose-way, 4b, 5) |
| **Lane O** (`docs/superpowers/plans/2026-11-28-o-o5-invoice-details.md`, not yet cleared, nothing built) | O5a-0's `apps/till/src/widgets/invoice-details-fields.ts` (`till-invoice-details-fields`, `check()` → `{ recipient, send }`); O5a's full screen; O5b's `widgets/pay-invoice-line.ts` | PR 3 (O5a, O5b); PR 6 (O5a-0) |

Plan 1 and plan 3 may still rename things before they land. The first step of each PR that
consumes them reads their landed Interfaces and writes any rename into the PR description.

**Core's starting migration** is rebuilt by plan 1 PR 1, plan 3 PR 2, CORRECT-FULL-INVOICE PR 4b and
this plan's PRs 1 and 5b. Whichever lands second takes `main`'s copy of the migration during the
rebase (`git checkout --ours`) and reruns `pnpm --filter @waitron/server migration-baseline rebuild
--set core` (CLAUDE.md §3). One rebuild per part: PR 5b's also adds PR 7's column, so part B resets
venues once, and part A carries nothing of part B if the owner defers it.

## Global constraints

- Every corrective of a full invoice is filed in the `full_corrective` series and names a customer;
  none is ever an R5 (owner, 25 November, answer 2).
- No registered business address refuses `fiscal.taxpayer_domicile_missing` **before** any number is
  taken or any money moves (`requireTaxpayerDomicile`, `packages/core/src/correction-eligibility.ts:55-59`).
- A corrective that changes no customer copies the customer block **as filed** from the latest
  version's record; only a customer change builds a new one (`buildDestinatarios`,
  `packages/fiscal-verifactu/src/backend.ts:882`).
- A refusal says what happened and what each choice does, and never sends the person to somebody
  else (CLAUDE.md §3).
- Till words in English and Spanish; "corrective invoice" / «factura rectificativa» (owner, 25 November,
  answer 3); a screen change updates `guide/en` and `guide/es` with shared `{#id}` headings.
- At their caps (`scripts/product-file-size-limits.json:35-42`): `till-app.ts` 25,244 of 25,250,
  `screens/till-ticket-view.ts` 1,246 of 1,250, `screens/till-table-order-screen.ts` 7,479 of 7,500,
  `widgets/bill-pay-dialog.ts` 2,431 of 2,500. Move code out before adding. `packages/fiscal-verifactu/src/backend.ts`
  is 957 of the default 1,000.
- A schema change's PR opens with "Resets every venue: core's starting migration is rebuilt."
- A new till route adds refusing cases and inventory rows to `till-api.profile-actions.test.ts`, zone
  rows to `till-api.profile-zones.test.ts`, and its place in `till-api.session-person.test.ts`'s lists.
- A new `eq(sales.correctsSaleId, …)` or `corrects_sale_id =` line takes an entry in
  `scripts/corrective-sums.test.ts`'s `ALLOWED`; a new file that records incidents joins
  `scripts/alert-codes.test.ts`'s `INCIDENT_CODE_SOURCES`.

## Review focus

1. **An invoice already corrected**, then reopened, cancelled or moved to another customer: the credit
   takes off what it stands at, never the original's total, and its lines reverse what is left of each
   line, with a free item's share and a divided set menu (CLAUDE.md §3) adding up per rate. Task 4.
2. **An address-only change**: the R4 "S" record's customer block equals the original's; the paper
   shows the new address. Task 10.
3. **A different customer across a quarter's end**: the original's quarter keeps its VAT once; today's
   quarter nets to zero. Task 14.
4. **A press sent twice, or racing a give-back**: a resend answers as the first and files nothing more;
   a change while a give-back is open or a card refund pending is refused with nothing written. Tasks 13, 14.
5. **A foreign customer** (another identifier type or issuing country, AEAT's `IDOtro`) renamed: the
   same-customer rule compares identity after normalising, so it files an R4 "S" carrying `IDOtro`. Task 13.

---

# Part A — split and cancel a printed full invoice (D4)

## PR 0 — AEAT's test service accepts the new shapes (verifactu library)

In `~/workspace/repos/verifactu`, as plan 1's PR 0 and lane A's `canje` (verifactu #158) do it: one
mode in `scripts/live-aeat.mjs` (builder plus branch, through `submitChainedProbe`), its tests in
`scripts/live-aeat.test.mjs`, its name in `.github/workflows/live-aeat.yml`'s options. Each case is its
own chain, one record per request. Test service only. **If plan 1's PR 0 is not yet built, lane L
adds these cases to its `substitution-corrections` mode and this PR is dropped.**

### Task 0: the `full-invoice-changes` mode

| Case | Records | Gates |
| --- | --- | --- |
| A1 | F1 to customer A (NIF) at 10 % and 21 %; R4 "I" to zero: F1's `Desglose` negated, `Destinatarios` A as sent, no `ImporteRectificacion` | PR 2 |
| A2 | the same with R1 "I" to zero (run 37286368370's R1 "I" took off part of an F1, not all) | PR 2 |
| A3 | F1 to A; R1 "I" of one dish; R4 "I" of the rest, naming the F1 | PR 2 |
| A4 | F1 to A; R1 "S" (plan 1's case C shape); R4 "I" of minus its restated figures, naming the R1 "S" | PR 2 once plan 1 PR 4 is on `main` |
| B1 | F1 to A; R4 "S": same `Desglose` and `ImporteTotal`, `ImporteRectificacion` the F1's base and tax, A's NIF with another name | PR 4 |
| B2 | the same with `Destinatarios` identical to the F1's (P7, address-only) | PR 4 |
| B3 | F1 to A; R1 "S" one dish lower, A's NIF with another name | PR 7 |
| B4 | F1 to A; R1 "S"; R4 "S" naming that R1 "S", its restated figures rectified, another name | PR 4 |
| B5 | A1's pair, then an F1 to customer B (another NIF) with `FechaOperacion` yesterday | PR 5b |

- [ ] **Step 1: failing tests**: the builder's records for each case as values (`TipoFactura`,
  `TipoRectificativa`, `ImporteTotal`, `Desglose`, `ImporteRectificacion`, `Destinatarios`,
  `FacturasRectificadas`), the library's `validate` empty for every record, and the exit decision (0
  only when every case runs and is `Correcto`).
- [ ] **Step 2:** `node --test scripts/live-aeat.test.mjs`; FAIL on the missing builder.
- [ ] **Step 3:** implement; stop and send nothing more if the Madrid day changes mid-case.
- [ ] **Step 4:** `node --test scripts/live-aeat.test.mjs`, `npm run lint`, `npm run format:check`; exit 0.
- [ ] **Step 5:** commit `-s`, PR. After the owner lands it, `gh workflow run live-aeat.yml --repo
  waitron-io/verifactu --ref main -f mode=full-invoice-changes`; the run id and each answer go in this
  plan's header. A refusal stops the PR it gates; the lane writes to the watcher with the
  `CodigoErrorRegistro`.

Part A's cases can run alone (mode argument `part-a`) if part B is deferred.

---

## PR 1 — the packages credit a full invoice, or a corrected invoice, to zero (nothing calls it)

**First line: "Resets every venue: core's starting migration is rebuilt."** Risk triggers: fiscal,
migration. Full path, two Codex reviews.

Today a corrective's type is guessed: R4 when it is a replacement, else R1
(`packages/orders-sales/src/invoice-typing.ts:96`; the tax-office list in SQL,
`apps/server/src/tax-office-list.ts:63-73`). Plan 1 stores no R1/R4 type, so Task 1 adds it.

### Task 1: store why a corrective was issued

**Files:**

- Modify: `packages/db/src/schema/sales.ts` (column and check beside `sales_replaces_original_ck`, `:148-151`)
- Generated: core's starting migration and snapshot
- Test: `packages/db/src/schema/sales.test.ts`

**Interfaces:** Produces `sales.correction_reason`, `label("correction_reason").$type<"article_80" | "other">()`,
null exactly when `corrects_sale_id` is null (`sales_correction_reason_ck`). "article_80" is R1 (or R5);
"other" is R4 (or R5).

- [ ] **Step 1: failing tests**: a corrective with no reason is refused; an ordinary sale with one is
  refused; each value is stored; any other value is refused.
- [ ] **Step 2:** `pnpm --filter @waitron/db exec vitest run src/schema/sales.test.ts`; FAIL.
- [ ] **Step 3:** add them; `pnpm --filter @waitron/server migration-baseline rebuild --set core`;
  fixtures that insert correctives directly gain the field (grep `correctsSaleId:` in `src/testing/`
  and tests).
- [ ] **Step 4:** run it, then `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
  `scripts/behavioural-triggers.test.ts`, `scripts/starting-migrations.test.ts` and
  `packages/fiscal-verifactu/src/inmutabilidad.test.ts`; PASS.
- [ ] **Step 5:** commit.

### Task 2: the record builder files an R4 "I", or an R1 "I", to zero

**Files:**

- Modify: `packages/fiscal-verifactu/src/correction-record-type.ts:8-26` (plan 1's Task 6 edits its comment; whichever lands second rebases)
- Modify: `packages/fiscal-verifactu/src/backend.ts:567-700` (type `:635`, customer block `:655-656`)
- Modify: `packages/fiscal/src/backend.ts:503-507`, its fake, `packages/fiscal-none/src/backend.ts`
- Test: `correction-record-type.test.ts`, `backend.test.ts`

**Interfaces:** Produces `correction: { …; reason: "article_80" | "other" }` and
`correctionRecordType(original, namesCustomer, reason)` → `"R1" | "R4" | "R5" | undefined`: R4 for an
F1 (or an R4 "S" replacing one) naming a customer with "other"; R1 with "article_80", as today; R5
whatever the reason.

- [ ] **Step 1: failing tests**: the grid gains the reason (F1 + customer + "other" → R4; + "article_80"
  → R1; R4 "S" + "other" → R4; F2 + "other" → R5; F3 and an earlier "I" stay `undefined`). An R4 "I"
  against an F1 carries `TipoFactura` R4, `TipoRectificativa` I, the **stored** `Destinatarios` even
  when the sale names another customer, no `ImporteRectificacion`, and `validate` returns nothing.
- [ ] **Step 2:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/correction-record-type.test.ts src/backend.test.ts`; FAIL.
- [ ] **Step 3:** implement; the copy condition at `:655` becomes "R1 or R4". If `backend.ts` would pass
  1,000 lines, move `recordCorrection`'s input building into a new `correction-record-input.ts`.
- [ ] **Step 4:** those, plus `src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/correction-amount.huella.test.ts`; PASS.
- [ ] **Step 5:** commit.

### Task 3: core takes the reason and credits a full invoice in full

**Files:** `packages/core/src/record-correction.ts` (input `:39-117`, call `:150-154`, row
`:360-385`, backend call `:405-421`), `packages/core/src/correction-eligibility.ts:24-32`,
`packages/core/src/record-replacement.ts`; test `record-correction.test.ts`, `record-replacement.test.ts`.

**Interfaces:** `RecordCorrectionInput.reason?: "article_80" | "other"`, stored and passed on. A whole
credit of a full invoice must state it; "other" is refused on a partial credit and without
`fullInvoice`. Absent elsewhere: "article_80"; a replacement stores "other".
`requireFullInvoiceNotWholeCredit(fullInvoice, wholeInvoice, reason, saleId)` refuses
`fullInvoice && wholeInvoice` with no reason, and "other" without both.

- [ ] **Step 1: failing tests**: a whole credit of an F1 with "other" writes a `full_corrective` sale,
  total minus the F1's, the reason, the stored customer and the current registered address, and an R4
  "I"; with "article_80" an R1 "I"; either with no registered address refuses
  `fiscal.taxpayer_domicile_missing`, no number taken; "other" on a partial or without `fullInvoice`
  refuses `sale.correction_unsupported`; `:689`'s case passes with a reason and refuses without one; a
  receipt's corrective stores "article_80".
- [ ] **Step 2–5:** `pnpm --filter @waitron/core exec vitest run src/record-correction.test.ts src/record-replacement.test.ts` FAIL; implement; PASS with `pnpm --filter @waitron/core test:coverage` at 98/98/98/95; commit.

### Task 4: crediting an invoice that holds corrections (P13)

**Files:**

- Create: `packages/core/src/standing-credit.ts`
- Modify: `packages/core/src/record-correction.ts` (`wholeInvoiceBreakdown`, `:483-536`)
- Modify: `apps/till/src/i18n/codes.ts:548-551` (`sale.correction_not_whole`)
- Modify: `scripts/corrective-sums.test.ts` (an entry for `standing-credit.ts`'s read)
- Test: new `packages/core/src/standing-credit.test.ts`; `record-correction.test.ts`

**Interfaces:**

- Produces `standingCredit(tx, targetId: SaleId): Promise<{ total: string; vatBreakdown: VatBreakdownLine[]; lines: RecordSaleLine[] }>`:
  minus the target's stored figures plus every corrective's change (`correctivesOf`), per rate in
  whole cents; its lines reverse what is left of each invoice line (`readCorrectionAmountHistory`,
  `correction-history.ts:221`, then `remainingLines`, `correction-allocation.ts:189`), each naming the
  line in `correctsLineId`; lines with nothing left are left out. When plan 1's `figuresOfVersion` is
  on `main`, the figures must equal minus `figuresOfVersion(latestVersionOf(target))`, else
  `sale.correction_history_unusable`.
- `wholeInvoice` admits a target holding corrections when `total`, the breakdown and the lines equal
  `standingCredit`'s; otherwise `sale.correction_not_whole`. A target at zero refuses it too. Which
  version the record names is plan 1's (its S3: the latest).

- [ ] **Step 1: failing tests**: a 9.00 receipt with −3.00 given back is credited −6.00 at 5.45/0.55,
  its lines minus what is left; an F1 with an R1 "I" of one dish gives an R4 "I" of the rest; a free
  item's share and a divided set menu (CLAUDE.md §3) add up per rate; two rates where one is all given
  back leaves that rate out; a target at zero refuses; an uncorrected invoice gives exactly today's
  credit (the existing whole-credit cases pass unedited).
- [ ] **Step 2:** `pnpm --filter @waitron/core exec vitest run src/standing-credit.test.ts src/record-correction.test.ts`; FAIL.
- [ ] **Step 3: implement.** The till's words for `sale.correction_not_whole`, now reached only when
  the invoice changed between reading and pressing: "This invoice was corrected while you were working.
  Open the bill again to see what is left, then try again." / «Esta factura se ha rectificado mientras
  trabajabas. Vuelve a abrir la cuenta para ver lo que queda e inténtalo de nuevo.»
- [ ] **Step 4:** those, `pnpm --filter @waitron/core test:coverage`, `pnpm exec vitest run scripts/corrective-sums.test.ts`,
  the till's `codes.test.ts`; PASS.
- [ ] **Step 5:** commit.

### Task 5: readers say R4 or R1

**Files:** `packages/orders-sales/src/invoice-typing.ts:77-101` (R4 when the reason is "other"; `inFull`
stays on `replacesOriginal`); `apps/server/src/tax-office-list.ts:63-73` and the `tax_office.kind.*`
words (P12); the accountant export's labels only where one says "replacement" for an R4 "I". Tests:
`packages/orders-sales/src/receipt-issuer.test.ts`, `apps/server/src/tax-office-list.kinds.e2e.test.ts`,
`apps/server/src/receipt-issuer.test.ts`.

- [ ] **Step 1: failing tests**: an R4 "I" types R4 and prints the full-invoice corrective layout with
  negative lines and the customer (not "replaces in full", not 0,00 €); an R1 "I" to zero types R1 and
  prints the same way; a partial R1 is unchanged; the tax-office list shows P12's words; A1407's R4
  replacement still types R4 with `inFull`.
- [ ] **Step 2–5:** FAIL, implement, PASS; look at both from `receipt-look.ts` (80 mm and A4, Spanish
  and English; pictures stay in the working folder); commit.

**Leaves:** nothing changes for anyone. Sale-path read changed: no.

---

## PR 2 — Reopen bill and Nothing was served on a printed full invoice (server and till, one PR)

One PR, so that no `main` answers "reopen the bill first" (`advance-taken-off.ts:145-151`) while the
till still hides Reopen bill (`till-table-order-screen.ts:7114`). Waits for #4560 and PR 0's cases
A1 to A3. Risk triggers: fiscal, money. Full path, two Codex reviews.

Today: Reopen bill and Pay for items on a printed bill reach `refuseSplitBill`
(`split-after-print.ts:145-154`), which refuses a customer-named invoice (`bill-reopen-state.ts:26-35`);
Nothing was served sends one to the corrective path (`cancel-credit.ts:57`), which core refuses
(`creditWholeInvoice`, `cancel-credit.ts:91-129`, files with no `fullInvoice`). Cancel already refuses
a bill holding money or served dishes (`working-order-counter.ts:199-200`), so a cancelled full invoice
always had nothing served (P2).

### Task 6: `creditWholeInvoice` credits a full invoice, or a corrected one

**Files:**

- Modify: `apps/server/src/cancel-credit.ts:91-129` (total, breakdown and lines from `standingCredit` in place of `-invoice.total` and `reversedLines`, `:107-110`)
- Modify: `apps/server/src/working-order-counter.ts:207` (passes "article_80" and the person), `apps/server/src/split-after-print.ts:120` (passes "other" and the person)
- Modify: `apps/server/src/working-order-context.ts:64-72` (`TillSaleDeps.invoiceEmailAvailable?`, passed at boot as Give money back's deps are)
- Test: new `apps/server/src/full-invoice-credit.test.ts`

**Interfaces:** `creditWholeInvoice(tx, deps, cfg, invoice, authz, credit: { reason: "article_80" | "other"; personId: string })`.
The reason is read only when the target names a customer. For such a target it asks the regime first
(`backend.correctionAdmissionFor`, as `correction-history.ts:190` does), files with `fullInvoice`, the
reason and the `full_corrective` series, then `sendFiledCorrective(tx, deps, cfg, { id: correctiveSaleId,
requestedBy: credit.personId }, correctiveSaleId)` (P5). The F3 check at `:103` stays until plan 3
removes F3.

- [ ] **Step 1: failing tests**: Nothing was served on a printed F1 files one R1 "I" to zero naming the
  customer, settles the F1 owing nothing, abandons the bill, and sends the corrective the way the F1
  went (A4, email, receipt printer); no registered address writes nothing; a receipt with an earlier
  give-back is now cancelled for what is left (P13); a receipt with none is unchanged.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/full-invoice-credit.test.ts`; FAIL.
- [ ] **Step 3:** implement. **Step 4:** it, plus `src/cancel-credit*.test.ts src/working-order-counter*.test.ts`; PASS. **Step 5:** commit.

### Task 7: Reopen bill lets a full invoice through, and the bills after it start as one

**Files:**

- Modify: `apps/server/src/bill-reopen-state.ts:26-35` (the customer refusal and its comment go)
- Modify: `apps/server/src/split-after-print.ts:326-356` (`openSplitBill` sets the choice)
- Modify: `apps/server/src/bill-actions.ts:341-411` (`moveDishes`: a new bill made from a reopened bill set for a full invoice takes its choice)
- Create: `copyInvoiceChoice(tx, fromBillId, toBillId)` in `apps/server/src/merge-invoice.ts` (the fields `carryMergeInvoice` keeps, `:158-166`)
- Modify: `apps/server/src/pay-for-items.ts:395-430` (`reopenIfPrinted` keeps refusing a printed full invoice with `sale.correction_unsupported` until PR 3: three lines, removed there)
- Modify: `apps/server/src/reopen-with-advance.test.ts:997-1034`
- Test: `apps/server/src/full-invoice-credit.test.ts`, `apps/server/src/bill-actions*.test.ts`

**Interfaces:**

- The reopened bill: `invoiceType` "F1", the `recipient*` columns from the target's sale row
  (`counterparty*`; the target is `correctionTargetFor`, `packages/core/src/correction-target.ts:12-18`,
  until PR 4 reads the latest version), and the printed bill's `invoiceDelivery`.
- `moveDishes` with `toBillId === null`: when the source's `reopenedFrom` is set and its `invoiceType`
  is "F1", `copyInvoiceChoice(source, new bill)` before the dishes move (the limit check reads the
  type, `:404`). A move to an existing bill, and every move from a bill not reopened, are unchanged
  (`checkMoveInvoice`, `:315-330`, still returns null unless every dish moves).

- [ ] **Step 1: failing tests**: Reopen bill on a printed F1 files an R4 "I" to zero and opens a bill
  for the same customer and delivery; Move dishes of some dishes from it to a new bill gives that bill
  the same choice; Pay for items from it gives the person paid out an F1 for that customer; a move from
  an ordinary open F1 bill to a new bill still carries nothing; the reopened bill holding a carried
  payment refuses F2 with `invoice.choice_locked`, a moved-to bill switches to F2; Pay for items on a
  printed F1 still refuses; `:997` takes `:864`'s RA-D4 shape for a full invoice (Refund a payment on
  the advance says reopen first; the reopen files an R4 naming Harbour Foods; the advance is given back
  on the reopened bill).
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/full-invoice-credit.test.ts src/reopen-with-advance.test.ts`; FAIL.
- [ ] **Step 3:** implement; `advance-taken-off.ts:145` needs no edit.
- [ ] **Step 4:** them, plus `src/split-after-print*.test.ts src/pay-for-items*.test.ts src/advance-taken-off*.test.ts src/bill-actions*.test.ts`; PASS.
- [ ] **Step 5:** commit.

### Task 8: the till offers them; words and guides

**Files:**

- Modify: `apps/till/src/screens/till-table-order-screen.ts:7110-7148` (drop `!namesCustomer(bill)` from `reopens`) and `:514-515` (cut the comment saying the server refuses it; `namesCustomer` stays for `:5472`)
- Modify: `apps/till/src/widgets/cancel-credit-dialog.ts`, the Reopen bill window, `apps/till/src/i18n/strings.ts` (`:2241-2268` and the Spanish from `:4718`)
- Modify: `apps/server/src/guide/en/table-service.md:132-148`, `:776-789`, and `guide/es/table-service.md`'s twins (`:831-836` and the full-invoice section)
- Test: `apps/till/src/till-app-parties-closing.test.ts` (it pins the cancel's refusals; the menu cases go beside them), `apps/till/src/widgets/cancel-credit-dialog.test.ts`, `apps/server/src/guide-content.test.ts`

If `till-app.ts` needs a line, move one block out first.

| Key | English | Spanish |
| --- | --- | --- |
| `cancel_credit.scope_full` | Only when nothing was served. {customer} gets a corrective invoice that cancels this invoice. | Solo si no se sirvió nada. {customer} recibe una factura rectificativa que anula esta factura. |
| `cancel_credit.approval_full` | If you cannot issue corrective invoices yourself, someone who can approves it with their PIN next. | Si no puedes emitir facturas rectificativas, alguien que pueda lo aprueba después con su PIN. |
| `cancel_credit.done_full` | Corrective invoice {number} for {customer} issued. The bill is cancelled. | Factura rectificativa {number} para {customer} emitida. La cuenta está anulada. |
| `split.scope_full` | This cancels the invoice to {customer} with a corrective invoice and reopens the bill. Each new bill starts as a full invoice to {customer}; you can change that. | Esto anula la factura a {customer} con una factura rectificativa y reabre la cuenta. Cada cuenta nueva empieza como factura completa a {customer}; puedes cambiarlo. |
| `split.done_full` | Corrective invoice {number} for {customer} issued. The bill is reopened. | Factura rectificativa {number} para {customer} emitida. La cuenta está reabierta. |

Guides: "Nothing was served" (`en :784-788`, `es :831-836`) loses "names no customer" and gains, for a
full invoice, that the paper stays with the customer, that a corrective invoice cancels it, and that
it needs **Issue corrective receipts and invoices**, not **Void sales**. "Once the bill is printed or
has taken a payment, it stays a full invoice" (`en :147-148`) becomes: printed and not reopened, or
holding a payment (P3). Reopen bill's paragraph says the new bills start as full invoices for the same
customer.

- [ ] **Step 1: failing tests**: on a printed F1 with no payment the menu shows Nothing was served and
  Reopen bill; with a payment only Reopen bill; the windows show the `_full` lines with the customer
  and number; a receipt's are unchanged; the guides keep their ids.
- [ ] **Step 2:** `pnpm --filter @waitron/till exec vitest run <those files>`; FAIL.
- [ ] **Step 3:** implement. **Step 4:** PASS with the till's `codes.test.ts`. Pictures at 390 × 844 light
  and dark, English and Spanish: the menu, both windows, both end lines; in the PR, never committed.
- [ ] **Step 5:** commit.

**Leaves:** D4 for Reopen bill, Move dishes after it, and Nothing was served. Sale-path read changed:
yes (Reopen reads the target's customer). The description quotes the owner's two answers and P1–P3, P5, P13.

---

## PR 3 — Pay for items on a printed full invoice (server and till)

Waits for PR 2, O5a and O5b. Risk triggers: fiscal, money. Full path.

### Task 9: the server reopens it and takes a choice with the payment

**Files:** `apps/server/src/pay-for-items.ts` (`PayForItemsRequest`, `:304-324`, gains `invoice`;
`retryPrintOf`, `:326`, fingerprints it; PR 2's guard goes), `apps/server/src/bill-payments-api.ts`
(parse it); test new `apps/server/src/pay-for-items-full-invoice.test.ts`.

**Interfaces:** `PayForItemsRequest.invoice?: { invoiceType: "F2" } | { invoiceType: "F1"; recipient; delivery? }`,
accepted only when the source is a printed full invoice or a bill reopened from one, checked with
`checkedInvoiceRecipient` and `checkedInvoiceChoiceDelivery` (as `setOrderInvoiceChoice`,
`working-order-invoice.ts:129-175`) before anything moves, and applied to the new bill after the move.
Absent: the reopened bill's choice (Task 7).

- [ ] **Step 1: failing tests**: Pay for items with cash on a printed F1 reopens it with an R4 and
  issues an F1 to the same customer; with `{ invoiceType: "F2" }` a receipt; with another customer an
  F1 to them; `invoice` on an ordinary open bill refuses `management.request_invalid`; an invalid
  recipient moves nothing and collects no card; a resend with a different `invoice` answers
  `submission.id_reused`; F2 over the €3,000 receipt limit is refused as a receipt payment is today.
- [ ] **Step 2–5:** FAIL, implement, PASS with `src/pay-for-items*.test.ts`, commit.

### Task 10a: Pay for items shows the choice

**Files:** `apps/till/src/widgets/bill-pay-dialog.ts` (O5b's `pay-invoice-line` in the items kind,
properties only), `apps/till/src/state/pay-for-items.ts` (sends `invoice` when changed), the opener of
O5a's screen in "this payment only" mode in a new file beside O5a's, both guides' Pay for items
paragraph; tests `state/pay-for-items.test.ts` and the Pay dialog's items suite.

- [ ] **Step 1: failing tests**: on a printed full invoice or a bill reopened from one, Pay for items
  shows "Full invoice · {customer}" with Change and Receipt instead; Change → save sends nothing to the
  bill and the payment carries `invoice`; Receipt instead sends `{ invoiceType: "F2" }`; any other bill
  shows no line.
- [ ] **Step 2–5:** FAIL, implement, PASS, pictures at 390 × 844 light and dark, commit.

**Leaves:** D4 whole (P4).

---

# Part B — change a full invoice's customer (D5)

Each PR here waits for plan 1's PRs 1, 2 and 4 on `main`, and its PR 0 B case. The owner may defer
part B; part A does not depend on it.

## PR 4 — the packages can restate a full invoice for its customer (nothing calls it)

Risk triggers: fiscal. Full path, two Codex reviews.

### Task 11: `sameCustomer` and core's customer restatement

**Files:** Create `packages/core/src/same-customer.ts`, `packages/core/src/record-customer-correction.ts`;
modify `packages/core/src/errors.ts`, `scripts/alert-codes.test.ts` (only if the new file records an
incident); tests `same-customer.test.ts`, `record-customer-correction.test.ts`.

**Interfaces:**

- `sameCustomer(a: Counterparty, b: Counterparty): boolean`: equal after `recipientIdentifierResult`
  (`@waitron/country-packs`) normalises both: identifier type, issuing country and tax number (P6).
- `recordCustomerCorrection(tx, backend, { origin, nodeId, seriesId, correctsSaleId, counterparty, authz, clock, operationDescription }): Promise<{ saleId; fiscal }>`.
  Refuses, each before a number: an invoice naming nobody, a corrective, an F3, a voided one, one at
  zero; a counterparty not `sameCustomer` with the latest version's (`sale.customer_different`,
  `{ saleId }`); a target holding a correction by differences (`sale.customer_fix_after_difference`,
  `{ saleId }`, worded before plan 1's S2 trigger would refuse the insert). Then `checkedCounterparty`
  and `requireRecipientAddress` (`packages/core/src/counterparty.ts:7-33`), `requireTaxpayerDomicile`,
  `recordCorrection`'s authorization. Writes a `full_corrective` sale: total 0, no lines, an empty VAT
  breakdown, reason "other", the new customer and the registered address, `corrects_sale_id` the
  target, `restates_sale_id` = `latestVersionOf(target)`, `restated_total` and
  `restated_vat_breakdown` = `figuresOfVersion(latest)`. Calls the backend with `rectifiesSaleId` the
  latest version, `substitution: { replaced: figures, restated: figures }` and `customerChange: true`.

- [ ] **Step 1: failing tests**: the same NIF with spaces or lower case is the same; another NIF, a
  passport of the same number, another issuing country are not. An F1 of 36.30 € (two rates) gives one
  row as above, the fake backend seeing replaced = restated = 36.30; after plan 1's R1 "S" it names
  that "S" and carries its restated figures; each refusal takes no number.
- [ ] **Step 2–5:** `pnpm --filter @waitron/core exec vitest run src/same-customer.test.ts src/record-customer-correction.test.ts` FAIL; implement; PASS with core's coverage; commit.

### Task 12: the record, and every later corrective names the corrected customer

**Files:** `packages/fiscal/src/backend.ts:503-507` (`customerChange?: true`), its fake;
`packages/fiscal-verifactu/src/backend.ts` (with `customerChange`, `Destinatarios` from
`buildDestinatarios(sale.counterparty)`; otherwise copied from the **latest version's** stored record,
as plan 1's `rectifiesSaleId` names it, not the original's); `packages/core/src/record-correction.ts:239-246`
(the customer copied onto a full invoice's corrective is the latest version's row's);
`apps/server/src/split-after-print.ts` (`openSplitBill` reads `latestVersionOf`'s customer); tests
`backend.test.ts`, `record-correction.test.ts`, `full-invoice-credit.test.ts`.

- [ ] **Step 1: failing tests**: the R4 "S" record has `Desglose` and `ImporteTotal` the F1's,
  `ImporteRectificacion` its base and tax, `Destinatarios` the new name, `FacturasRectificadas` the
  latest version, and `validate` is empty; an address-only change files the original's customer block
  (Review focus 2); a later give-back's R1 "S" names the corrected customer; Reopen bill after a
  customer fix starts the bill with the corrected customer and files its R4 "I" naming the R4 "S".
- [ ] **Step 2–5:** FAIL, implement, PASS (plus the fiscal-verifactu trio of Task 2 Step 4), commit.

### Task 10b: the paper

**Files:** plan 1's `apps/server/src/restated-invoice.ts` and its A4 page (`invoice-layout.ts`, plan 1
Task 14) print the corrective's own row's customer; test `apps/server/src/receipt-issuer.test.ts`.

- [ ] **Step 1: failing test**: the R4 "S" prints «Factura rectificativa», the new customer and
  address, the F1's lines and total, the amount of the change 0,00 €, naming the version it replaces;
  80 mm and A4. **Step 2–5:** FAIL, implement, PASS, look (`receipt-look.ts`), commit.

**Leaves:** nothing changes for anyone.

---

## PR 5 — Change customer on the server (5a details, 5b another customer)

Waits for PR 4 and the choose-way branch on `main`; 5b also for plan 3's PRs 2, 3, 4a and 4b. Risk triggers:
fiscal, money (5b), permissions. Full path, two Codex reviews each.

### Task 13: the read and the details fix (5a)

**Files:** Create `apps/server/src/customer-change.ts`, `apps/server/src/customer-change-api.ts`
(registered where `give-back-api.ts` is); modify `apps/server/src/till-api-errors.ts`,
`apps/server/src/errors.ts`, `scripts/corrective-sums.test.ts` as needed; tests new
`apps/server/src/customer-change.test.ts` and the three inventory suites.

**Interfaces:**

- `GET /api/transactions/:saleId/customer-change` (passive) → `{ customer; latestNumber; offered: boolean; refusal?: { code }; delivery: CorrectiveChoice }`
  (`CorrectiveChoice` from `readCorrectiveChoice`).
- `POST /api/transactions/:saleId/customer-change` with `{ submissionId, recipient, delivery?, override? }`
  → `{ kind: "details"; corrective: { number; customer; sent } } | { kind: "reissued"; corrective; invoice: { number; customer; sent } }`.
  Order: `checkAccess`; the PIN step as `give-back-api.ts:126-134` builds it (`overrideOf`,
  `overrideToCheck`, `withPinCheckAhead`), with `sale.rectify` where that route checks `sale.refund`
  (`:131`); in one `withIssuanceTransaction`: P11's refusals (`customer_change.reopen_first`,
  `customer_change.give_back_open`, `customer_change.unpaid_unsupported`), the pending-card refusals
  Give money back makes, `checkCorrectiveDelivery` on `delivery`, then `recordCustomerCorrection` when
  `sameCustomer`, else Task 14; then `sendFiledCorrective(…, chosen)`. The same `submissionId` answers as
  the first; another body under it refuses `submission.id_reused`. Until 5b, a different tax number
  refuses `sale.customer_different`, and a target holding a correction by differences refuses
  `sale.customer_fix_after_difference`; from 5b both reissue.

- [ ] **Step 1: failing tests**: the read offers a paid F1 with the latest customer, and not a receipt,
  a corrective or an F1 at zero; a corrected name files one R4 "S" sent the chosen way (print, email)
  or the original's way with none; a placed unpaid bill with a new tax number, an open give-back, no
  registered address each refuse with nothing written; no `sale.rectify` needs a PIN; another zone's
  till is refused; a resend files nothing more; a passport customer renamed files `IDOtro` (Review
  focus 5); profile and zone rows.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit.

### Task 14: a different customer (5b)

**First line: "Resets every venue: core's starting migration is rebuilt."** The money follows plan 3's
widened link ("Seams with plans 1 and 2"): the old F1 keeps its payments, the R4 credit and the new F1
move none, and the new F1's correctives count against the old F1. No second link table.

**Files:**

- Modify: `packages/db/triggers/core.sql`: `sale_reissues_check_pair` (plan 3 Task 2.1) also admits a row whose original names a customer and is no corrective; whose credit has `corrects_sale_id` the original or its replacement, `correction_reason` "other" and the original's customer; and whose new invoice names a customer, corrects nothing and credits nothing. `sale_settlements_check_coverage` (`:118-130`, as plan 3 Task 2.2 leaves it) gains the condition below.
- Modify: `packages/db/src/correctives-of.ts`: a fifth condition, so a corrective that is any link's `credit_sale_id` is left out of every branch (`not exists (select 1 from sale_reissues ri indexed by sale_reissues_credit_key where ri.credit_sale_id = s.id)`).
- Modify: `packages/db/src/schema/` (`invoice_corrections.customer`, JSON, null allowed, for PR 7, and `AND new.customer IS old.customer` in `invoice_corrections_guard_update`, beside PR 4b's `delivery`); rebuild
- Create: `packages/core/src/record-customer-reissue.ts` (it joins `sale_reissues`' writers in `scripts/write-path-tables.json`)
- Modify: `apps/server/src/customer-change.ts`; `scripts/corrective-sums.test.ts` (the new condition's reason)
- Test: `packages/db/src/correctives-of.test.ts`, `packages/db/src/schema/sale-reissues.test.ts`, new `packages/core/src/record-customer-reissue.test.ts`, new `apps/server/src/customer-change-reissue.test.ts`

**Interfaces:**

- `recordCustomerReissue(tx, backend, { origin, nodeId, originalSaleId, counterparty, recipientAddress, fullSeriesId, correctiveSeriesId, authz, clock, operatorId, locale, invoiceLocales, operationDescription }): Promise<{ creditSaleId; invoiceSaleId }>`.
  Refuses before anything is written: P11's cases, among them an original that is any link's
  `invoice_sale_id` (`sale.reissue_not_admitted`, reason `already_moved`, beside plan 3's reasons).
  Then, in one transaction: the credit through `recordCorrection` (`wholeInvoice`, `fullInvoice`,
  reason "other", Task 4's `standingCredit`); the new F1 through plan 3's `writeSale` with the standing
  lines un-negated, the credit's VAT split negated, the new customer, and `supply_day` the original's
  day of operation (P8); the `sale_reissues` row.
- The route's `reissued` answer (Task 13). The new F1 goes the chosen way through
  `requestPrintDelivery` / `requestEmailDelivery` (`till-sale-receipt-routes.ts:250-290`); the R4 the
  original's way (`sendFiledCorrective`).

- [ ] **Step 1: failing tests**:
  - `correctives-of.test.ts`: an F1 of 36.30 € with its R4 credit and a link sums 36.30 € (the credit
    left out); a later R1 of −5 € on the new F1 makes it 31.30 €; an R4 "I" with no link still counts;
    the coverage trigger agrees on the same rows.
  - `sale-reissues.test.ts`: the widened trigger admits the full-invoice row and refuses a credit that
    is an R1, one naming another customer, and a new invoice naming nobody; plan 3's receipt rows
    still pass.
  - `customer-change-reissue.test.ts`: a paid F1 to A moved to B gives an R4 "I" −36.30 € naming A and
    an F1 36.30 € to B with the F1's lines and `FechaOperacion` the original's day, no outstanding sale
    and nothing "waiting for payment" (orders list); Give money back opened from the old F1 in Find a
    bill corrects the new F1 and pays back the old F1's tender; after an R1 "S" the credit takes its
    restated figures and the F1 carries what is left; the VAT return over both quarters (Review focus
    3); top sellers count each dish once; moving the new F1 again refuses `already_moved`; an unpaid
    deferred F1 and one that took an advance off refuse with nothing written; a resend files nothing.
- [ ] **Step 2:** `pnpm --filter @waitron/db exec vitest run src/correctives-of.test.ts src/schema/sale-reissues.test.ts` and the core and server files; FAIL.
- [ ] **Step 3:** implement; rebuild; run Task 1 Step 4's schema suites and `scripts/write-path-tables.test.ts`.
- [ ] **Step 4:** PASS, plus `customer-change.test.ts`, reporting's VAT movements tests, `src/orders-list*.test.ts`, `src/find-bill*.test.ts`.
- [ ] **Step 5:** commit.

If it passes about 80 tool calls, split it into the database half (trigger, `correctivesOf`, column)
and the writer and route half.

**Leaves:** (5a) the server fixes a customer's details; (5b) it moves an invoice to another customer.
No till offers either until PR 6.

---

## PR 6 — Change customer in Find a bill (till)

Waits for PR 5b and O5a-0. Risk triggers: none of its own; the owner lands it.

### Task 15: room first, and the button

**Files:** Create `apps/till/src/widgets/ticket-actions.ts`: `screens/till-ticket-view.ts`'s
receipt-actions row (`:1151-1220`) moves there unchanged (lane A's Make it a full invoice adds a button
to the same row; whoever lands second rebases). Move one block out of `till-app.ts` (25,244 of 25,250)
into a new file for the opener. Then the **Change customer** button on a past full invoice the read
offers. Tests: the view's existing suites pass unedited after the move; one new case for the button.

- [ ] Steps: failing button test → run → move (suites green), then add → PASS → commit.

### Task 16: the screen

**Files:** Create `apps/till/src/widgets/customer-change-screen.ts` (`wt-dialog full-screen` with
`wt-full-screen-panel`, as O5a's), on `till-invoice-details-fields`; `apps/till/src/api/customer-change-api.ts`;
`apps/till/src/state/customer-change.ts`; tests `customer-change-screen.test.ts`, `.unsaved.test.ts`,
`.a11y.test.ts`, `state/customer-change.test.ts`.

The top bar "Change customer", Back to the invoice; the block filled with the latest customer and the
delivery offers; under it one line that follows the tax number as typed; the foot's one button. Forms
rules: required marks, errors after the first press under each field, one bottom message, the button
quiet and disabled until a field changes (`draftScopeFor`, `saveActionState`), never disabled by a
server refusal.

- [ ] **Step 1: failing tests**: opening fills the latest customer; the line and the button switch with
  the tax number; errors only after a press; disabled until changed; Back with changes asks; the press
  sends the body the server expects (written literally); axe in both themes.
- [ ] **Step 2–5:** FAIL, implement, PASS, commit.

### Task 17: the press, refusals, end lines, guides, pictures

**Files:** the screen and state; `apps/till/src/i18n/strings.ts`, `codes.ts`; both guides' Find a bill
section (`table-service.md:195` onward and the Spanish twin).

| Key | English | Spanish |
| --- | --- | --- |
| `customer_change.title` | Change customer | Cambiar cliente |
| `customer_change.same` | The customer gets a corrective invoice with these details. The amounts stay the same. | El cliente recibe una factura rectificativa con estos datos. Los importes no cambian. |
| `customer_change.other` | Another tax number: the invoice to {old} is cancelled with a corrective invoice, and a new invoice is issued to this customer. | Otro número fiscal: la factura a {old} se anula con una factura rectificativa y se emite una factura nueva a este cliente. |
| `customer_change.confirm_same` | Issue corrective invoice | Emitir factura rectificativa |
| `customer_change.confirm_other` | Issue new invoice | Emitir factura nueva |
| `customer_change.done_same` | Corrective invoice {number} for {customer} {sent}. | Factura rectificativa {number} para {customer}: {sent}. |
| `customer_change.done_other` | Invoice {number} for {customer} {sent}. Corrective invoice {corrective} cancels {old}. | Factura {number} para {customer}: {sent}. La factura rectificativa {corrective} anula {old}. |
| `customer_change.reopen_first` | This bill is not paid yet, so it is not moved to another customer here. Choose Reopen bill on the table, then choose the new customer there. | Esta cuenta aún no está pagada, así que aquí no se pasa a otro cliente. Elige Reabrir cuenta en la mesa y luego elige allí el cliente nuevo. |
| `customer_change.give_back_open` | Money is still being given back on this invoice. Finish it in Money back under way, then change the customer. | Aún se está devolviendo dinero de esta factura. Termínalo en Devolución en curso y luego cambia el cliente. |
| `customer_change.unpaid_unsupported` | This invoice is not fully paid or took an advance off, so it cannot go to another customer yet. You can still correct this customer's details. | Esta factura no está pagada del todo o descontó un anticipo, así que aún no puede pasar a otro cliente. Sí puedes corregir los datos de este cliente. |

`{sent}` reuses CORRECT-FULL-INVOICE PR 5's "is printing" / "is being emailed to …" / "has been
emailed to …".

- [ ] **Step 1: failing tests**: the PIN step when the person lacks the right; each refusal under its
  field or at the bottom; both end lines; the guides keep their ids.
- [ ] **Step 2–4:** FAIL, implement, PASS. Pictures at **390 × 844 light and dark**, English and Spanish,
  and 1280 × 800: filled, another tax number, an error, the PIN step, both end lines; differences from
  O5a's screen listed. In the PR, never committed.
- [ ] **Step 5:** commit.

**Leaves:** D5's first and third rows for staff.

---

## PR 7 — details and amounts together: one R1 "S" (server and till)

Waits for plan 1 PR 4 (R1 "S" on Give money back), CORRECT-FULL-INVOICE PR 4b and PR 5, and PR 6.
No reset: PR 5b added the column. Risk triggers: fiscal, money. Full path.

### Task 18: the give-back carries a corrected customer, stored with it

**Files:** the give-back press and `fileCorrectionIn`
(`apps/server/src/invoice-corrections.ts`): `customer` taken at the press, refused unless
`sameCustomer` and unless the give-back leaves the invoice above zero, stored when the give-back opens,
read from the row when it files; `RecordCorrectionInput.counterparty` with `fullInvoice` (R1 "S" with
`customerChange`); the till's `widgets/corrective-choice.ts` (a Customer row with Change, opening the
block); both guides' Give money back section. Tests `apps/server/src/give-back-customer.test.ts`,
`record-correction.test.ts`, the till's `give-back-dialog.corrective.test.ts`.

- [ ] **Step 1: failing tests**: goodwill of 5 € with a corrected name files one R1 "S" carrying both;
  filed after a late card answer it still names the corrected customer; the trigger refuses a change of
  the stored customer; another tax number refuses `sale.customer_different` before money moves, its
  words naming Change customer as the next step; a give-back of everything left hides the row; the till
  sends `customer` only when changed.
- [ ] **Step 2–5:** FAIL, implement, PASS, pictures 390 × 844 light and dark, commit.

**Leaves:** D5's second row.

---

## PR 8 — a different customer for an unpaid invoice, or one that took an advance off

**Expand before dispatch.** Follows plan 3's PR 8 (a receipt that took an advance off) and PR 9 (an
unpaid receipt), reusing what they change in the link and the money readers. It lifts P11's third
refusal case by case, with a test per case in `customer-change-reissue.test.ts`, and removes
`customer_change.unpaid_unsupported`'s words when the last case lands. Its tasks are written, and the
plan re-read, once plan 3's are on `main`. Part of this plan by the owner's D8 rule ("make sure it is
part of the plan").

---

## True size

| PR | Tasks | By file (production / test) | Expect | Generated |
| --- | --- | --- | --- | --- |
| PR 0 (library) | 0 | 130 / 360 | 390 / 1,050 | none |
| PR 1 | 1–5 | 170 / 330 | 510 / 800 | core's starting migration, about 20 |
| PR 2 | 6–8 | 120 / 340 | 360 / 980 | none |
| PR 3 | 9–10a | 90 / 200 | 270 / 600 | none |
| PR 4 | 11, 12, 10b | 120 / 240 | 360 / 580 | none |
| PR 5a / 5b | 13 / 14 | 110 / 120; 130 / 260 | 330 / 290; 390 / 620 | core's starting migration, about 40 |
| PR 6 | 15–17 | 160 / 210 | 480 / 780 | none |
| PR 7 | 18 | 60 / 140 | 180 / 340 | none |
| PR 8 | — | expand before dispatch | — | — |

About **2,850 production and 5,150 test lines**, plus the library's. Tasks of 50 to 80 tool calls; an
implementer passing 150 stops at a passing point, commits and hands over.

**Order.** Part A: PR 0 (part A's cases), PR 1, PR 2 (after #4560), PR 3 (after O5a and O5b). Part B:
PR 4 (after plan 1's PRs 1, 2, 4 and PR 0's part B cases), 5a, 5b (after plan 3's PRs 2, 3, 4a, 4b),
6 (after O5a-0), 7 (after CORRECT-FULL-INVOICE PR 4b/5), 8 (after plan 3's PRs 8 and 9). Each leaves
`main` green and working, as its "Leaves" says. Full path with two Codex run-it reviews: PRs 1, 2, 3,
4, 5a, 5b, 7; light path: PR 0, 6. Every PR keeps the fresh plan-vs-spec read and the Codex seat. The
owner lands each.

## What this plan does not do

- A customer change on an invoice AEAT refused for its customer block (A1089, `docs/backlog.md:215`);
  PR 5's route could serve it later.
- Cancel or Reopen of a bill whose receipt plan 3 swapped for a full invoice: refused as plan 3's N9 says.
- Several invoices onto one customer change; one invoice split between customers without reopening.
- An annulment for a full invoice (P2 keeps the corrective).
- Changing the R4 replacement switch (`FULL_INVOICE_REPLACEMENT_ON`, `put-right.ts:24-29`).

## Docs that change with it

CORRECT-FULL-INVOICE's design §7, first and fourth bullets, and its plan's "What this plan does not do"
first bullet get a dated pointer to this plan (PR 2 and PR 5a). `docs/backlog/fiscal.md` loses any
entry PR 2 or PR 6 finishes.
