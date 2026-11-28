# Make it a full invoice: credit the receipt, then issue a full invoice (TILL-REDESIGN-FISCAL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

Status: written 2026-11-28 for lane A; revised the same day after one fresh-context review and the watcher's read; awaiting the watcher's clearing. FISCAL: the owner lands every
pull request. Lane A builds it. It replaces lane A's `~/waitron-campaign/till-fiscal-f3-plan.md` from
F3-1a on; F3-0 (verifactu#158, merged, every case `Correcto`) needs no undoing.

**Goal:** staff open a past receipt, press **Make it a full invoice**, type the customer, and Waitron
issues, in one transaction, a negative receipt that cancels what the receipt still stands at and an
ordinary full invoice for the same lines naming the customer; the F3 code leaves `main`.

**Architecture:** a new column on `sales` lets the credit carry a negative total, and a new append-only
table ties the receipt, its credit and its full invoice together. Core writes the pair; the Veri\*Factu
backend files the credit as a negative F2 and the full invoice as an F1, both dated with the
receipt's day. The receipt keeps its payments; the credit and the full invoice moved no money.

**Tech Stack:** TypeScript, Drizzle on `node:sqlite`, Hono server routes, Lit till, Vitest,
`@waitron/verifactu` (the library repo `waitron-io/verifactu` for PR 0).

**Spec:** `docs/superpowers/specs/2026-11-28-corrections-by-substitution-design.md`, decisions D6–D10
only. Also the till
redesign spec `docs/superpowers/specs/2026-11-26-till-handheld-redesign-design.md` §7.4, §7.12 item 2,
§13, frames `bf` and `q` 4.

**Base.** `main` at `2bfa7a34e3`. Every line number below is that commit's and was read, not run,
unless a command is named.

**Words.** A *receipt* is a simplified invoice (AEAT's F2). A *full invoice* names the customer (F1).
A *corrective* corrects an earlier invoice (R1, R4, R5). The *credit* is the new negative receipt
(a negative F2) that cancels what the receipt still stands at. The *swap* is the whole act: credit
plus full invoice. The receipt's *standing value* is what it is worth now: its filed figures, or its
replacement's, minus every corrective already filed against it. A *replacement* here always means
the "Put this right" replacement of a receipt AEAT refused (an R5 "S", called Q37 in the code),
never anything this plan adds. *FechaOperacion* is the record's "day the sale happened" field.

---

## 1. Should this exist?

1. **The need.** The owner approved Make it a full invoice on 26 November (till spec §7.12 item 2,
   Status line 7–9) and on 28 November chose this route over the F3: "i like the second route where
   we refund the receipt and replace it with an F1. That is much cleaner. Let's go that way and
   confirm with the adviser." (spec D6), and "leave it in a branch but remove it from main" (D9).
   AEAT's own words support the route: «En el caso de que se realice un abono de la factura
   simplificada (mediante el envío de un registro negativo con clave "F2"), la factura emitida en
   sustitución de esta tendrá que informarse con la clave "F1".» (AEAT procedures FAQ, design §6).
   **Once PR 6 lands** staff can turn one past receipt, including one already partly refunded, into a
   company invoice, by print or email, and later refunds go on that invoice. **Still unavailable**
   until PRs 7–9: receipts that are an advance, that took an advance off, or are still unpaid; and
   for good (D7): one full invoice for several receipts.
   **Simplest alternative:** the accountant issues the invoice by hand, outside Waitron's numbering
   and record chain; it does not meet the ask. Keeping the unused F3 code on `main` costs every
   reader below a second exclusion to maintain, so removing it is the smaller thing.
2. **True size (estimated, not counted).** PRs 1a and 1b remove about 3,100 lines (four whole test files of
   1,886 lines, `wc -l`, and about 800 matching lines in 87 other files, `rg -c`). PRs 2–9 add about 2,400 product lines and 5,000 test lines across roughly 60 files (each
   PR's own estimate is in its heading); PR 2 alone regenerates
   `packages/db/drizzle/0000_baseline.sql` and `meta/0000_snapshot.json` (generated), dropping the
   F3's table and adding the new ones. Later changes to money readers touch one more table
   (`sale_reissues`) than today; the F3's table goes, so the count of such tables does not grow.
3. **Who approved it.** The owner's words above are recorded in the spec's §1 table (session
   waitron-84, 2026-11-28). D2's "Anyone who takes orders (Recommended)" is the owner's
   answer recorded at `~/waitron-campaign/questions.md:691` (2026-11-28 05:42). This plan's own
   decisions in §2 are mine until the watcher clears them; the watcher has not read this plan.

---

## 2. Decisions, each with a default

"Owner" or "adviser" marks who should see it. Everything else is mine, on the default given.

| # | Decision | Default |
| --- | --- | --- |
| **Lane A's D1–D8 under the new route** | | |
| A-D1 | How many receipts per full invoice | One (spec D7). Several receipts would need one FechaOperacion for several days, which the record has one field for |
| A-D2 | Who may | Anyone allowed to take orders, as when choosing a full invoice at payment (`till-working-order-routes.ts:243-247`), plus the zone check. No supervisor PIN: the credit moves no money. Answered by the owner: "Anyone who takes orders (Recommended)" (`~/waitron-campaign/questions.md:691`, the watcher's 2026-11-28 05:42 entry) |
| A-D3 | Which receipts | Any receipt in this venue's records, of any age, from this box or an earlier main box, refused as Task 3.3 lists. A receipt from another box whose record AEAT has not answered waits (A1614's rule); one AEAT refused and that is being put right is refused until it is put right; one still waiting in **this** box's own queue is admitted, because the queue sends in order and the receipt goes ahead of its credit |
| A-D4 (owner) | A receipt with a refund | **Inverted.** Admitted at its standing value. Refused only when nothing is left (every euro given back), while a refund is open or a card refund is still pending |
| A-D5 (adviser) | The sale's date | Both new records carry the receipt's day in FechaOperacion when it is earlier than today (spec D10). Same day: no FechaOperacion on either, as `record-sale.ts:276-281` and `backend.ts:313-316` already decide. Kept because it matches Waitron's existing rule that a sale counts in its real day's VAT period (owner, 2026-11-14, as the plan review cites it; I did not read that record). Against it, AEAT's own worked example of a substitution done as a credit then a new invoice (option 2) leaves the date blank on the credit: «Tipo Factura: F1 / Fecha Operación: dejar en blanco / Fecha expedición: 18/10/2024 / Desglose IVA: se indicará el importe que se rectifica con signo contrario» (AEAT procedures FAQ, option 2, example 1; design §6). The adviser is asked (question 15); PR 0 cannot settle it |
| A-D6 | A refund after the swap | An R1 on the full invoice (R1 "S" once plan 1 lands), the money paid back from the receipt's payments. The F3's "money back with no corrective" path goes |
| A-D7 | Advances | Refused by PRs 3–6; built by PRs 7 and 8 (rules there) |
| A-D8 (adviser) | Series | Full invoice: the full-invoice series. Credit: the receipt series (`standard`), which `recordSale` already requires for a sale naming nobody (`record-sale.ts:250`). Question 15 asks |
| **New** | | |
| N1 | Storage | Option (b), §4: column `sales.credits_sale_id` plus table `sale_reissues`, whose columns name an original, a credit and a full invoice so plan 2 can reuse it (Seams section) |
| N2 (owner) | Money | The receipt keeps its payments and stays the one place a payment, refund or debt is recorded. The credit and the full invoice moved no money: no "owed", "waiting for payment" or outstanding reader lists either. Correctives of the full invoice count against the receipt, as a replacement's do today (`correctives-of.ts:16-21`). §4 works the reason through |
| N3 | Daily reports (sales, VAT summary, top sellers, categories, counts) | Leave both out. They net to zero by construction (the credit is the exact negative of the full invoice), so totals are unchanged, and items are not counted three times. The full invoice's later correctives are counted, as a replacement's are (`business-day.ts:210-217`) |
| N4 | VAT return, corrections list, accountant workbook, tax-office list | Count both, each on the receipt's day (§6). These list every record AEAT holds |
| N5 | Standing lines | From the stored figures: each receipt line (its replacement's, if any) plus every corrective line naming it, **at the receipt's own line numbers** (gaps allowed: `sale_lines_line_no_ck` is only `>= 1`, `sales.ts:321`), so `correctionTargetLines`' pairing by line number (`cancelled-lines.ts:215-226`) holds for the full invoice as it does for a replacement. The money left on each line comes from `readCorrectionAmountHistory` and `remainingLines` (`correction-allocation.ts:189`), the readers refunds already use. **Quantity:** no corrective stores units returned: every real give-back writes the whole line's quantity with the money taken ("an amount correction's quantity is the scope shown, never units returned", `correction-history.ts:446-448`), and the dish cancels `cancelsAndFreeByLine` reads (`cancelled-lines.ts:167`) are not read for a unit count here. So a line keeps its quantity and is charged what is left, printing like a discount; a line with nothing left is left off. After one of two chips is given back, the full invoice prints "2 × chips", list €6.00, charged €3.00. The owner sees that in PR 6's pictures. VAT breakdown: the filed breakdowns summed per rate, passed to `recordSale` explicitly |
| N6 (adviser) | Delivering the credit | Print: the full invoice, then the credit, on the chosen printer's device's receipt printer. Email: the full invoice only; the credit stays printable from Find a bill. Asked whether the customer must be given the credit |
| N7 | What the paper names | Full invoice: «Sustituye a la factura simplificada FS/123 de 30/09/2026» and the sale's day (already printed when it differs, `invoice-typing.ts:63-68`). Credit: «Abono de la factura simplificada FS/123 de 30/09/2026». Where a replacement exists, they name the replacement's number and date, the document AEAT holds in the receipt's place (`correction-target.ts:7-11`) |
| N8 | AEAT refuses the receipt after the swap (it was still queued) | The Fiscal filing page's replacement of that receipt is refused (`sale.correction_not_admitted`, reason `reissued`), and the filing case's wording says the receipt was made a full invoice: the accountant decides. Alternative (refuse every receipt AEAT has not yet answered) was not chosen: A-D3 keeps lane A's cleared rule |
| N9 | Cancel or Reopen the receipt's bill after the swap | Refused, as for a full invoice, until plan 2 (spec D4) builds it: `correctionTargetFor` now answers the full invoice, and a full invoice's whole credit is refused (`correction-eligibility.ts:24-32`) |
| N10 | Correcting the credit itself, and a credit AEAT refuses | Refused everywhere: `recordCorrection`, the correction preview and `recordReplacement` refuse it (`sale.correction_not_admitted`, reason `credit`). `correctionTargetFor` answers the credit itself rather than throwing, so the Fiscal filing page's path (`record-remedy-corrective.ts:160-162`) keeps refusing with its own `fiscal.remedy_invalid`. A credit AEAT refuses gets no fix offered (`put-right.ts`), and its filing case's wording says Waitron cannot put it right and the accountant decides. A negative R5 "S" replacement is never written: nothing has tested one (PR 0's case (e) only reports AEAT's answer) |
| N16 | A full invoice from a swap that AEAT refuses | **Today** `FULL_INVOICE_REPLACEMENT_ON` is `false` (`put-right.ts:29`): the Fiscal filing page offers it whatever it offers any full invoice for that refusal, and where that is nothing (a `1112` refusal, among others), its filing case says, EN: "The tax agency refused full invoice FF/12, made from receipt FS/123. Waitron cannot put it right; your accountant decides what to issue." / ES: «La Agencia Tributaria rechazó la factura FF/12, hecha a partir del tique FS/123. Waitron no puede corregirla; su gestor decide qué emitir.» A refund meanwhile goes as it would on any full invoice refused with nothing Waitron can fix. **Once the switch is on**, its R4 "S" replacement (A1407) stands in its place. `correctionTargetFor` goes receipt → full invoice → its replacement, and `correctivesOf(receipt)` counts the full invoice's correctives except its replacement, plus the replacement's correctives, mirroring its own first two branches |
| N11 | Find a bill | The credit is a new type `receipt-credit`, "Credit of a receipt" / «Abono de factura simplificada», included under the Correctives filter; the full invoice is `full-invoice`, as any F1 |
| N12 | Fiscal regime with no records (`fiscal-none`) | Not offered: `creditAdmissionFor` answers `unsupported`, as its `correctionAdmissionFor` does (`fiscal-none/src/backend.ts:80-82`) |
| N13 | F3 removal scope | Remove everything that issues an F3 or treats a sale as one. Keep the code that reads or repeats AEAT's record shape, F3 included, as the library does: `verifactu_records.facturas_sustituidas` and its round trip (`registro-row.ts:200`, `:446`) and check `verifactu_records_facturas_sustituidas_f3_ck` (`schema/verifactu-records.ts:148-153`); the remedy's copy of it (`record-remedy-http.ts:113`, `:184`, `:206`); returned invoices' typing (`returned-invoices.ts:75`); the put-right reading of a record's type (`put-right.ts:60`); the remedy's list of types (`record-remedy-facts.ts:113`); the Fiscal filing screen's kinds (`dashboard/fiscal-filing-screen.ts:123`, `fiscal_filing.kind.F3` at `dashboard/strings.ts:361`, `:765`); and the doc sentence at `correction-record-type.ts:6`, which stays true. Archive branch `archive/f3-canje` |
| N14 | Customer details on the full invoice | Typed fresh on §7.4's screen; nothing on the receipt names a customer |
| N15 | Receipt facts on the full invoice | Copied from the receipt: guest count, department, trading name and whether it prints (`record-sale.ts:57-62`), and its operation description (`readSaleOperationDescription`) |

---

## 3. What carries over from lane A's F3 plan

**Unchanged:** the till button and its place (lane O's R3 if on `main`, else today's
`till-ticket-view.ts:1150` actions); §7.4's details screen (lane O's O5 fields without O5's save, or
today's `TillInvoiceRecipientDialog`) with the Print or Email choice; the confirmation line ("Full
invoice FF/12 for Acme SL is printing on Office" / "sent to …"); the route frame (preview and write,
`take-orders` plus the zone check, `requireEconomicWrite`, `prepareIssueClock`,
`refuseUntilRecordable`, `checkedInvoiceRecipient`, `requireTaxpayerDomicile`, the live `full`
series); the refusals "not a receipt" and "voided"; AEAT-has-not-accepted (with a refused record
being put right refused, and another box's unanswered record waiting); delivery through the existing
per-sale paths; the repair path for a refused record; the paper line «Sustituye a la factura
simplificada …» and the sale's date; the till guide EN/ES; A556 deleted; pictures beside frames `bf`
and `q` 4 at 390 px, light and dark, then lane P's read, then the owner; the overlap proposal with
lane O; D2 and D3.

**Changed:** the guard that re-derived the VAT breakdown (now N5: passed explicitly, so it cannot
differ); D4 (inverted); D5 (both records dated); D6 (R1 on the full invoice); D7 (refused, built later).

**Dropped:** `recordSubstitution`, `FacturasSustituidas`, `sale_substitutions`, every "leave the F3
out" filter, `readInvoiceTyping` gaining `"F3"`, the four F3 codes, the 05:49 D4 option, and F3-1a's
"copy the receipt's lines and refuse a different breakdown" guard.

---

## 4. Storage, and where the money sits

`sales_total_ck` reads `total >= 0 or corrects_sale_id is not null` (`packages/db/src/schema/sales.ts:171`),
so a negative sale needs a link column. A CHECK cannot read another table.

- **(a) The credit as a corrective of the receipt** (`corrects_sale_id` set). It passes the check and
  `correctivesOf` counts it for free, but every reader that reads `corrects_sale_id` as "R1/R4/R5"
  would mistype it: the tax-office kind (`tax-office-list.ts:63-73`), Find a bill's type
  (`find-bill-transactions.ts:84-89`), the counts (`counts.ts:17-19`), `readInvoiceTyping`
  (`invoice-typing.ts:76-110`), and `correctionAdmissionFor`, which would then admit an R5 against a
  record that is an F2. It also forbids a sale day on it (`sales_supply_day_ck`, `sales.ts:152-155`),
  so D10 could not be filed. A marker column would be needed anyway.
- **(b) Chosen.** `sales.credits_sale_id` (nullable, foreign key to `sales.id`, restrict, unique),
  with `sales_total_ck` widened to `total >= 0 or corrects_sale_id is not null or credits_sale_id is
  not null`, and a new check `sales_credit_ck`: `credits_sale_id is null or (corrects_sale_id is
  null and replaces_original = 0 and counterparty_tax_id is null and total < 0)`. Plus table
  `sale_reissues(id, original_sale_id unique, credit_sale_id unique, invoice_sale_id unique,
  created_at)`, append-only ledger, with a trigger refusing a row whose credit does not credit the
  receipt or whose full invoice names no customer or corrects something. Every reader that follows
  `sale_substitutions` today follows `sale_reissues` instead (§5): a mechanical swap of one join.

**Money (N2), worked.** Receipt FS/123 on 30 September: 1 beer €3.00, 2 chips €6.00, total €9.00 at
10 % (€8.18 + €0.82), paid by card. On 1 October the beer is refunded: R5 −€3.00 (−€2.73, −€0.27);
the receipt stands at €6.00 (€5.45 + €0.55). On 2 October it is made a full invoice:

| Document | Total | Base / VAT | Moves money? |
| --- | --- | --- | --- |
| Credit FS/140 (receipt series), FechaOperacion 30/09 | −€6.00 | −€5.45 / −€0.55 | no |
| Full invoice FF/12, Acme SL, FechaOperacion 30/09: 2 chips | €6.00 | €5.45 / €0.55 | no |

The receipt still owes €9.00 − €3.00 = €6.00 and holds €9.00 paid, €3.00 refunded: unchanged. If the
credit were counted against the receipt, it would owe €0.00 with €6.00 kept, and a reader computing
"refundable" from it would offer the €6.00 back. A refund of one chips on 5 October is an R1 on FF/12,
−€3.00; `correctivesOf(FS/123)` then includes it through the new branch, so the receipt owes €3.00,
exactly as a replacement's correctives work today.

---

## 5. Every reader of `sale_substitutions` today, and its rule now

PRs 1a and 1b remove each F3 clause; PRs 4a–4c add the new one where the right column says so. Lines are `main`'s.

| Reader | Today | After PRs 4a–4c |
| --- | --- | --- |
| `packages/core/src/list-outstanding-sales.ts:55` | leaves an F3 out | leaves out `credits_sale_id is not null` and a full invoice in `sale_reissues` |
| `apps/server/src/orders-list.ts:177-178` (walk-up sales) | same | same as above |
| `packages/reporting/src/business-day.ts:207-208` (`notSubstituteClause`, used `:234`, `:243`) | leaves an F3 out of every daily report | `notReissuedClause`: leaves out both (N3) |
| `packages/reporting/src/vat-movements.ts:159` | leaves an F3 out | no clause: both count, on their FechaOperacion (§6) |
| `apps/server/src/accountant-export.ts:490-496` | leaves an F3 out of a range | no clause: both listed under `saleVatDay` (`:446-454`), the receipt's day |
| `apps/server/src/tax-office-list.ts:72`, `:130-136` | types F3; lists the receipts it replaced | credit typed F2 and the full invoice F1 as today's `KIND` does; one column `reissueOf` names the receipt on both |
| `apps/server/src/find-bill-transactions.ts:36-52`, `:84-89`, `:104-105` | an F3's scope follows its receipts | scope follows `credits_sale_id` and `sale_reissues`; type `receipt-credit`; `listed` true for a credit |
| `apps/server/src/invoice-lookup-api.ts:51`, `:69`, `:105` | leaves an F3 out | no clause: the lookup joins `sales.working_order_id` (`:66-67`), which a full invoice from a swap does not carry, so it is never listed; a test pins that |
| `apps/server/src/orders-detail.ts:447-460` | "substitutes" beside the receipt | a `reissue` block: the full invoice and the credit, numbers, totals, who |
| `apps/server/src/receipt-presentation.ts:18-28` | follows an F3 back to its receipts' card payments | follows a full invoice or credit back to its receipt |
| `apps/server/src/receipt-deferred-payment.ts:24-36` | same, for bank details | same |
| `apps/server/src/deferred-close.ts:275-284` | `substituted` state | `reissued` state, either side |
| `apps/server/src/advance-taken-off.ts:66-76` | an F3 never took an advance off | neither credit nor full invoice is named; PR 8 maps a reissued receipt to its full invoice |
| `apps/server/src/cancel-credit.ts:66-73`, `:100-104` | refuses a cancel of a replaced receipt (`replaced`) | `correctionTargetFor` answers the full invoice, which is refused as a full invoice's whole credit (N9) |
| `packages/core/src/correction-history.ts:182-189`, `correction-eligibility.ts:43-51` | refuses correcting a replaced receipt or an F3 | gone: corrections redirect (`correctionTargetFor`); a credit is refused (N10) |
| `packages/core/src/record-replacement.ts:85-91` | refuses replacing an exchanged receipt | refuses replacing a reissued receipt, reason `reissued` (N8) |
| `packages/fiscal-verifactu/src/handover-return.ts:121`, `:174`, `:238`, `:607`, `:642` | walks and copies F3 rows on a handover return | walks `credits_sale_id` and `sale_reissues`, copies `sale_reissues` rows, conflict key `original_sale_id` |
| `apps/dashboard/src/api/live-queries.ts:167`, `:195`, `:210`, `:230`, `:251`, `:275`; `apps/till/src/api/live-connection.ts:101` | table name in the dependency lists | `sale_reissues` |
| `packages/db/src/correctives-of.ts:16-21` and its copy `packages/db/triggers/core.sql:117-129` | — | two more branches mirroring the first two: the full invoice's correctives except its replacement, and that replacement's correctives (N16) |
| `packages/core/src/correction-target.ts:12-18` | replacement, else itself | receipt → full invoice → its replacement when reissued; else replacement; else itself (a credit answers itself; correcting it is refused elsewhere, N10) |

Readers of a missing `sale_settlements` row also see the pair: `find-bill-transactions.ts:104-105`
(above), `invoice-document.ts:76-79` and `:198` (the paper's payment block: PR 5b makes a full
invoice from a swap print its receipt's payments), `till-sale.ts:227-231` (reads by working order;
the pair has none), `tender-refund-balance.ts:37-39` (by the refunded sale, always the receipt).

---

## 6. Dates across a quarter (D10)

`computeVatReturn` counts a movement that belongs to the period and was made by its last day
(`vat-return.ts:32-35`); a movement made later for an earlier period goes on the corrections list of
the period it was made in (`vat-return.ts:15-18`). An ordinary invoice belongs to
`coalesce(supply_day, issue day)` (`vat-movements.ts:47-50`), and one issued after the period for a
supply day in it is reached by the second seed (`:131-133`). With receipt FS/123 €9.00 on 30 September
and the swap on 2 October:

| | With D10 (both dated 30/09) | Control: credit undated |
| --- | --- | --- |
| Q3 return | €8.18 / €0.82 (the receipt) | same |
| Q4 return | nothing from the swap | **−€8.18 / −€0.82** (the credit belongs to Q4) |
| Q4 corrections list | two rows "Issued after its sale's period", −€8.18/−€0.82 and +€8.18/+€0.82 | one row, +€8.18/+€0.82 |
| Accountant workbook | all three under 30/09 (`saleVatDay`, `accountant-export.ts:446-454`) | credit under 02/10 |

The control column is what PR 4a's test prints when its control builds the credit without a day: it
is the failing case, and it differs from the expected one.

---

## Global Constraints

- FISCAL: the owner lands every PR. Full review ceremony (risk triggers: fiscal invariants,
  migrations, cross-package contract), two Codex run-it angles in `/finish-branch`.
- Only PR 2 rebuilds core's starting migration (`pnpm --filter @waitron/db db:generate`, which runs
  `migration-baseline rebuild --set core`); its first line says "Needs a venue reset". On a rebase
  conflict in the baseline, `git checkout --ours` then rerun.
- After each schema change run, unedited: `scripts/schema-constraints.test.ts`,
  `scripts/append-only-triggers.test.ts`, `scripts/behavioural-triggers.test.ts`,
  `scripts/starting-migrations.test.ts`, `scripts/append-only-migration-sets.test.ts`,
  `scripts/classification-complete.test.ts`, `scripts/two-file-foreign-keys.test.ts`,
  `scripts/id-columns-are-references.test.ts`, `packages/composition/src/composition.test.ts`,
  `packages/fiscal-verifactu/src/inmutabilidad.test.ts`.
- Never edit `packages/fiscal-verifactu/src/inmutabilidad.test.ts` or a golden huella.
- Money in whole cents (`decimalToCents`, `centsToDecimal`); sums in exact `Decimal`.
- One `withTransaction` per request; awaits on it in turn, never `Promise.all`.
- A rejected write's test asserts the domain error code. A name-filtered run needs a bare `--`
  before `-t`.
- `packages/fiscal-verifactu/src/backend.ts` is 957 lines (cap 1,000): new backend code goes in a new
  file. `apps/till/src/screens/till-ticket-view.ts` is 1,246 of its 1,250 cap
  (`scripts/product-file-size-limits.json:36`): the new action goes in a new file.
- New error codes are registered in their package's `errors.ts`, each with English and Spanish till
  wording; English-only code; the box word rules.
- Every commit `git commit -s`; branches `feat/a-full-invoice-<n>-<slug>`.
- `correctivesOf` is on the sale path (`settle-sale.ts:52`): PR 2's body has a line
  "Sale-path read changed: yes", naming the added lookup by `sale_reissues_original_key`.

## Review Focus

1. **Two tills press Make it a full invoice on one receipt at once.** One swap wins; the other is
   refused `sale.reissue_not_admitted` (reason `already_reissued`) with no invoice number used.
   Test in Task 3.3 (the waiting side starts only after the holding side says it holds the lock).
2. **The swap straddles the business-day cutover or midnight.** Both documents carry one instant
   (`prepareIssueClock` freezes one reading, `issue-clock.ts:14-25`), so daily totals never split.
   Test in Task 3.3.
3. **A receipt partly refunded on a shared free item or a divided set menu.** The full invoice's
   lines add up exactly to the standing breakdown at the cent, and its paper prints the reduced
   line. Test in Task 3.2.
4. **A refund pressed on the receipt after the swap.** It files an R1 on the full invoice and pays
   from the receipt's payments; a refund already open when the swap is pressed refuses the swap.
   Tests in Tasks 4.5 and 3.3.
5. **The full invoice reprinted later from Find a bill** shows the receipt's payments, not "owed".
   Test in Task 5.3.

---

## Docs-only change D (with this plan's commit; exempt from the PR ceremony)

Dated pointers, never rewrites, each one line beginning "**2026-11-28:**" and linking this plan:
the till redesign spec §7.12 item 2 (`2026-11-26-till-handheld-redesign-design.md:612-618`, "the
receipt is not cancelled and the new invoice is not a second sale") and its §13 note (`:1323-1328`,
"`recordSubstitution` … has no route yet"); `docs/compliance/verifactu-findings.md` §10.2
(`:739-768`). Branch, `commit -s`, fast-forward `main`, push. Check `pnpm exec prettier --file-info`
reports each path `"ignored": true` before relying on a clean format check.

---

## PR 0 (verifactu repo, about 2 hours): AEAT's answer first

Like F3-0 (verifactu#158, `be5ccf2aab`). Runs in parallel with PR 1.

### Task 0.1: live mode `credit-then-full-invoice`

**Files:** Modify `scripts/live-aeat.mjs` (reuse `submitChainedProbe`, from #158), `scripts/live-aeat.test.mjs`,
`.github/workflows/live-aeat.yml` (the mode list).

- [ ] **Step 1: Write the failing tests** in `scripts/live-aeat.test.mjs`, against the fake as #158's
  do: mode `credit-then-full-invoice` builds, each case in its own installation and chain, one record
  per request:
  - (a) F2 +€9.00 (10 %: €8.18/€0.82) today; F2 −€9.00 (−€8.18/−€0.82) today, no FechaOperacion; F1
    €9.00 today naming a Spanish NIF, no FechaOperacion.
  - (b) F2 +€12.00 at two rates (10 %: €5.00 gross → €4.55/€0.45; 21 %: €7.00 → €5.79/€1.21)
    yesterday; F2 −€12.00 at both rates today with FechaOperacion yesterday; F1 €12.00 today with
    FechaOperacion yesterday.
  - In (a) and (b) the credit and the full invoice carry the **same** `FechaHoraHusoGenRegistro`,
    as the build will send them: both are written with one frozen clock (`issue-clock.ts:22-30`) and
    `backend.ts` files `generadoEn: sale.issuedAt` (`:334`). The test asserts the two values equal.
  - (c) control, reported only: an F2 −€9.00 today with FechaOperacion **tomorrow**, which AEAT is
    expected to refuse; its answer shows the service reads FechaOperacion on these records at all.
  - (d) reported only: (b)'s F1, then an R4 "S" replacing it (same figures, FechaOperacion
    yesterday, `ImporteRectificacion` 0.00): the record N16 would send for a swap's full invoice AEAT
    refused.
  - (e) reported only: (b)'s negative F2, then an R5 "S" replacing it with the same negative figures:
    what putting a refused credit right would send. N10 builds no such path whatever the answer; the
    answer goes to the adviser.
  - Verdict: exit 0 only when every record of (a) and (b) is `Correcto` and the lookup finds each once,
    accepted, with the hash sent; every request of (c) gets a readable answer. A Madrid day change
    between a case's first and last record stops the run, as #158's does.
  - Assert the library's `validate` returns no errors for each record of (a) and (b).
- [ ] **Step 2:** `node --test scripts/live-aeat.test.mjs` — Expected: the new cases FAIL (mode unknown).
- [ ] **Step 3:** Implement the mode.
- [ ] **Step 4:** `node --test scripts/live-aeat.test.mjs && npm run lint && npm run format:check` — all pass.
- [ ] **Step 5:** Commit, PR, merge by the owner, then `gh workflow run live-aeat.yml --repo waitron-io/verifactu --ref main -f mode=credit-then-full-invoice`.

**What it shows, and what it does not.** It shows only whether AEAT's test service accepts these
records. It does not show which quarter AEAT or the adviser puts the credit and the full invoice in:
that is D10's question for the adviser. No PR waits on it (nothing is filed for real before
go-live). A refusal of (a) or (b) goes to the watcher the day the run ends, and PR 6, which makes the
action reachable, waits for the owner's answer. (c), (d) and (e) are recorded in the PR thread
whichever they are.

---

## PR 1a (waitron, FISCAL, half a day; about −300 product lines, −500 test lines): the F3's readers go

Tasks 1.1–1.2c. Code only, no schema change. The archive branch below is pushed before PR 1a.

## PR 1b (FISCAL, half a day; about −400 product lines, −1,900 test lines, four whole files of 1,886 among them): the F3's writer and codes go

Task 1.3, after PR 1a.

### Both

Code only, no schema change and no reset: after it, `sale_substitutions` is still in the schema but
nothing reads or writes it, and PR 2 drops it in its own rebuild.

**First:** `git push origin <main's SHA at branch time>:refs/heads/archive/f3-canje`, then
`git ls-remote origin refs/heads/archive/f3-canje` shows that SHA. Record it in the PR body. The
branch is never deleted by `/land-branch` (it is not the PR's branch). Nothing on `main` calls
`recordSubstitution` outside core and the backends (`rg -n "recordSubstitution\(" -g '!*.test.ts'`
finds `record-substitution.ts`, `backend.ts:706`, `fiscal-none/src/backend.ts:76`,
`fake-backend.ts:243`, the interface `fiscal/src/backend.ts:517` and the gate list
`start-clock-gate.ts:13`), so no remaining code depends on it. The verifactu library's F3 stays.

Leaves: nothing changes for anyone; no box can hold an F3 (no route ever wrote one); A556 is moot,
so Task 1.3 deletes it from `docs/backlog.md:281-283` and `docs/backlog/fiscal.md:1031-1041`, and its
mentions in `docs/backlog/till.md:1960`, `:1990`.

### Task 1.1: package readers lose their F3 clauses

**Files:** Modify `packages/reporting/src/business-day.ts:205-209`, `:232-247`;
`packages/reporting/src/vat-movements.ts:159`; `packages/core/src/list-outstanding-sales.ts:27-28`, `:55`;
`packages/core/src/correction-history.ts:182-189` (and the `replaced` sentence of its doc, `:56-58`);
`packages/core/src/correction-eligibility.ts:34-52` (`requireFullInvoiceOriginal` keeps its corrective
check only); `packages/core/src/record-replacement.ts:85-91`;
`packages/fiscal-verifactu/src/handover-return.ts` (the five sites in §5);
`packages/reporting/test/fixtures.ts:457` and the F3 cases in each package's tests.

- [ ] **Step 1:** Delete the test cases that seed an F3 (they assert the exclusions going away). List
  them by `rg -n "saleSubstitutions|sale_substitutions|recordSubstitution" packages/{reporting,core,fiscal-verifactu}`.
  Every other case stays unedited.
- [ ] **Step 2:** Remove the clauses. `sale.correction_not_admitted`'s reason `replaced` stays until
  Task 1.3.
- [ ] **Step 3:** `pnpm --filter @waitron/reporting --filter @waitron/core --filter @waitron/fiscal-verifactu exec vitest run`
  — read the `Tests` count; all pass.
- [ ] **Step 4:** Commit.

### Task 1.2a: server reports and lists lose their F3 clauses

**Files:** `apps/server/src/{orders-list,tax-office-list,accountant-export,advance-taken-off}.ts`
(sites in §5; `tax-office-list.ts`'s `F3` kind and `substituted` column go, with their i18n keys and
the `tax-office-list.kinds.e2e.test.ts` F3 case), and the F3 cases of their tests.

- [ ] Steps as Task 1.1; verify with `pnpm --filter @waitron/server exec vitest run <each changed test file>`. Commit.

### Task 1.2b: Find a bill, the invoice lookup, the order detail and Cancel

**Files:** `apps/server/src/{find-bill-transactions,invoice-lookup-api,orders-detail,cancel-credit}.ts`
and the F3 cases of their tests (`find-bill-transactions.test.ts`, `zone-core-capabilities.test.ts`,
`transaction-receipt-api.test.ts`).

- [ ] Steps as Task 1.1. Commit.

### Task 1.2c: payment lookups and the live lists

**Files:** `apps/server/src/{receipt-presentation,receipt-deferred-payment,deferred-close}.ts`;
`apps/dashboard/src/api/live-queries.ts` (six entries); `apps/till/src/api/live-connection.ts:101`;
their tests (`receipt-presentation.test.ts`, `receipt-deferred-payment.test.ts`,
`deferred-close-refusal.test.ts`, the three `tender-refund-*` suites, `live-queries.test.ts`).
The server test files that only call `recordSubstitution` (of the 18 that
`rg -l "sale_substitutions|saleSubstitutions|recordSubstitution" apps/server/src -g '*.test.ts'`
lists at `2bfa7a34e3`) are finished in Task 1.3.

- [ ] Steps as Task 1.1, plus `pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts`
  and the till's `live-connection` tests. Commit.

### Task 1.3: the writer and its codes go

**Files:** Delete `packages/core/src/record-substitution.ts`, `record-substitution.test.ts`,
`packages/fiscal-verifactu/src/substitution-path.e2e.test.ts`, `canje-path.e2e.test.ts`. Modify
`packages/core/src/index.ts:26`; `packages/core/src/errors.ts:57`, `:123`, `:138-150`
(`sale.already_substituted`, `sale.substitution_not_admitted`; reason `replaced` at `:33`);
`packages/fiscal/src/backend.ts:510-521`; `packages/fiscal-verifactu/src/backend.ts:693-~800`
(`recordSubstitution`); `packages/fiscal-verifactu/src/errors.ts:329-334`
(`fiscal.substitution_unsupported`; `fiscal.sale_not_recorded` stays, `recordVoid` throws it,
`backend.ts:500-502`); `packages/fiscal-none/src/backend.ts:76-78`;
`packages/fiscal/src/testing/fake-backend.ts:243-~260`; `apps/server/src/start-clock-gate.ts:13`;
`apps/server/src/invoice-correction-legs.ts:29-33` (`replaced`); the till's `replaced` wordings
(`apps/till/src/i18n/codes.ts:1098`, `:1442`); `scripts/alert-codes.test.ts:62`, `:77`;
`scripts/corrective-sums.test.ts:115`; every other test `rg -l "recordSubstitution"` lists. Docs:
A556 deleted (`docs/backlog.md:281-283`, `docs/backlog/fiscal.md:1031-1041`, mentions at
`docs/backlog/till.md:1960`, `:1990`).

- [ ] **Step 1:** Delete and edit as listed.
- [ ] **Step 2:** `rg -n "recordSubstitution|substitution_not_admitted|already_substituted|substitution_unsupported|substitutedSaleIds" packages apps scripts`
  — Expected: no output. `rg -n "F3|[Ss]ustitu" packages apps -g '!*.test.ts'` — Expected: only N13's
  kept lines (list each hit and the N13 entry it belongs to in the PR body; any other hit is
  removed). `rg -n '"replaced"' packages/core/src apps/server/src apps/till/src/i18n`
  — Expected: no reason `replaced` left (a different word's match is read and named in the PR).
- [ ] **Step 3:** Typecheck the changed packages (`pnpm --filter <pkg> typecheck`) and run their
  changed suites, then `pnpm exec vitest run scripts/alert-codes.test.ts scripts/corrective-sums.test.ts
  apps/server/src/clock-unconfirmed-gate.test.ts` (root project).
- [ ] **Step 4:** Commit.

---

## PR 2 (FISCAL, about a day; about +180 product lines and −120 for the F3's table, +400 test lines, plus the regenerated baseline and snapshot): storage — nothing writes it yet

The one venue reset of this plan: the F3's table is dropped and the new column and table added in
one rebuild of core's starting migration.

### Task 2.0: the F3's table goes (in the same rebuild)

**Files:** Modify `packages/db/src/schema/sales.ts:405-426`; `packages/db/src/index.ts:191`;
`packages/db/src/classification.ts:40`; `packages/migrations/migrations.manifest.json:12`;
`scripts/append-only-triggers.test.ts:61`; `scripts/schema-constraints.test.ts:241-242`, `:436`;
the demo fixtures `packages/country-es/test-fixtures/demo/madrid-before-move.{en,es,manifest}.json`
(regenerate them the way their generator says, not by hand); delete
`packages/db/src/schema/sale-substitutions.test.ts`; regenerate the baseline (Task 2.1 regenerates it again; the PR needs one reset).

- [ ] **Step 1:** Edit, then `pnpm --filter @waitron/db db:generate`.
- [ ] **Step 2:** Run the Global Constraints' schema guards and `pnpm --filter @waitron/db exec vitest run`.
- [ ] **Step 3:** `rg -n "sale_substitutions|saleSubstitutions" packages apps scripts` — Expected:
  only historical docs remain (none under `packages`, `apps`, `scripts`).
- [ ] **Step 4:** Commit.

### Task 2.1: the column, the table, their checks

**Files:** Modify `packages/db/src/schema/sales.ts` (column `creditsSaleId: id("credits_sale_id")`
with foreign key `sales_credits_fk` restrict, unique index `sales_one_credit_uq`, `sales_total_ck`
widened and `sales_credit_ck`, both as §4; table `saleReissues` with
`sale_reissues_original_key`, `sale_reissues_credit_key`, `sale_reissues_invoice_key` declared with
`uniqueIndex`, not `unique`, so `indexed by` can name them (SQLite names a UNIQUE constraint's index
itself), and three foreign keys restrict); `packages/db/triggers/core.sql` (trigger `sale_reissues_check_pair` BEFORE INSERT:
refuses unless the credit's `credits_sale_id` = `original_sale_id`, the full invoice has
`counterparty_tax_id` not null and `corrects_sale_id` and `credits_sale_id` null, and the receipt
has `corrects_sale_id` and `counterparty_tax_id` null; message
`'a reissue names a receipt, its credit and a full invoice'`; the receipt is always an original,
`corrects_sale_id` null and `counterparty_tax_id` null: a replacement's swap is recorded against the
receipt it replaces); `packages/db/src/index.ts`;
`packages/db/src/classification.ts` (`appendOnly("sale_reissues", "ledger", LEDGER)`);
`packages/migrations/migrations.manifest.json`; `scripts/write-path-tables.json`
(`"sale_reissues": ["packages/core/src/record-reissue.ts"]`; the file is created in Task 3.3, so this
entry lands with Task 3.3, since the guard requires a visible write in every allowed file,
`write-path-tables.test.ts:219`) and the list in that test's doc. `handover-return.ts` also writes
`sale_reissues`, through `insertRow(tx, table, row)` with a variable table name the guard cannot see
(its hedge 1). It is **left unlisted**, as it is for the other ledger tables it copies, and the
test's doc names it as a writer the guard cannot see; the guard lists of
`scripts/append-only-triggers.test.ts` and `scripts/schema-constraints.test.ts`. Test: create
`packages/db/src/schema/sale-reissues.test.ts`; add cases to `packages/db/src/schema/sales.test.ts`.

**Produces:** `sales.creditsSaleId`; `saleReissues` with `originalSaleId`, `creditSaleId`, `invoiceSaleId`.

- [ ] **Step 1: Failing tests** (each asserts the constraint or trigger name through the shared
  refusal helpers): a negative sale with neither link is refused `sales_total_ck`; a credit naming a
  customer, correcting a sale, or with total ≥ 0 is refused `sales_credit_ck`; a second credit of
  one receipt is refused `sales_one_credit_uq`; a credit with a `supply_day` is accepted; a reissue
  row with a mismatched credit, an F1 with no customer, a second row for one receipt
  (`sale_reissues_original_key`), and a second row naming one full invoice each refused; update and
  delete refused (append-only). A positive control: a well-formed credit and row are accepted.
- [ ] **Step 2:** Run `pnpm --filter @waitron/db exec vitest run src/schema/sale-reissues.test.ts src/schema/sales.test.ts` — FAIL.
- [ ] **Step 3:** Implement, `pnpm --filter @waitron/db db:generate`.
- [ ] **Step 4:** Rerun; then the Global Constraints' schema guards and `scripts/write-path-tables.test.ts`. A
  foreign key is proved by a write (CLAUDE.md §3): the accepted control writes through all four.
- [ ] **Step 5:** Commit. PR first line: "Needs a venue reset".

### Task 2.2: `correctivesOf`, the coverage trigger and `correctionTargetFor`

**Files:** Modify `packages/db/src/correctives-of.ts:16-21` (third and fourth branches, mirroring the
first two for the full invoice: its correctives except its replacement, `corrects_sale_id in (select
ri.invoice_sale_id from sale_reissues ri indexed by sale_reissues_original_key where
ri.original_sale_id = ${saleId}) and replaces_original = 0`; and its replacement's correctives,
`corrects_sale_id in (select r.id from sale_reissues ri indexed by sale_reissues_original_key join
sales r indexed by sales_one_replacement_uq on r.corrects_sale_id = ri.invoice_sale_id and
r.replaces_original = 1 where ri.original_sale_id = ${saleId})`; doc updated);
`packages/db/triggers/core.sql:117-129` (the same two branches); `packages/core/src/correction-target.ts`;
`packages/core/src/correction-eligibility.ts`, `correction-history.ts`, `record-correction.ts`,
`record-replacement.ts` (the credit refusal);
`packages/core/src/errors.ts` (reasons `credit` and `reissued` on `sale.correction_not_admitted`);
`scripts/corrective-sums.test.ts` if a new matching line appears. Tests:
`packages/db/src/correctives-of.test.ts`, `packages/core/src/settle-sale.test.ts`, and
`packages/core/src/correction-target.test.ts` (create it, or extend it if lane L's plan 1 created it
first; whichever plan lands second rebases onto the other's cases).

**Produces:** `correctionTargetFor(tx, saleId): Promise<SaleId>`: when `saleId` is a reissued receipt
or that receipt's replacement, the full invoice's replacement if it has one, else the full invoice;
else the replacement; else `saleId` (a credit answers itself). `refuseCreditCorrection(tx, saleId):
Promise<void>` in `correction-eligibility.ts`, throwing `sale.correction_not_admitted`
`{ reason: "credit" }`, called by `admittedHistory` (`correction-history.ts:174-211`),
`recordCorrection` and `recordReplacement`.

- [ ] **Step 1: Failing tests** (rows seeded directly, as the schema allows): `correctivesOf(receipt)`
  counts an R1 of its full invoice and counts neither the credit nor the full invoice; with a
  replacement and a reissue, it counts the replacement's R5 and the full invoice's R1; with the full
  invoice replaced by an R4 "S", it leaves the R4 out and counts an R1 of the R4. A deferred
  receipt reissued, with an R1 of −€3.00 on its full invoice, settles with tenders of €6.00 and is
  refused `sale.tender_shortfall` (`settle-sale.ts:95-100`, due €6.00) with €9.00; the trigger copy
  is proved separately by inserting the `sale_settlements` row directly with €9.00 of tenders:
  refused `COVERAGE_REFUSAL` (`trigger-refusals.ts:15`), accepted with €6.00.
  `correctionTargetFor` answers FF/12 for FS/123 and for FF/12, the R4 when FF/12 has one, and the
  credit for the credit; `recordCorrection`, the preview and `recordReplacement` of the credit are
  refused with reason `credit`, nothing written.
- [ ] **Step 2–4:** Run, implement, rerun (`pnpm --filter @waitron/db exec vitest run` and the core
  files). Read the emitted SQL with `.toSQL()` for one caller (`list-outstanding-sales.ts`) and paste it
  into the PR. Run `scripts/corrective-sums.test.ts` (root project).
- [ ] **Step 5:** Commit.

Leaves: nothing reachable changes; the database can now hold a swap.

---

## PR 3a (FISCAL, half a day; about +200 product lines, +350 test lines): the regime files a credit

Task 3.1.

## PR 3b (FISCAL, about a day; about +350 product lines, +750 test lines): core writes the swap

Tasks 3.2–3.4, after PR 3a. Nothing calls either yet.

### Task 3.1: the regime files a credit

**Files:** Modify `packages/fiscal/src/backend.ts` (two optional members, below);
create `packages/fiscal-verifactu/src/credit-record.ts`, wired from `backend.ts` in two short
methods; modify `packages/fiscal-none/src/backend.ts`, `packages/fiscal/src/testing/fake-backend.ts`,
`apps/server/src/start-clock-gate.ts:8-14` (`"recordCredit"` joins `GATED`). Tests:
create `packages/fiscal-verifactu/src/credit-record.test.ts`; add to `fiscal-none`'s and the fake's
tests; `apps/server/src/clock-unconfirmed-gate.test.ts` gains the writer.

**Produces:**
```ts
export type CreditAdmission =
  | { eligible: true; original: { number: string; issuedAt: string } }
  | { eligible: false; reason: "unsupported" | "missing" | "voided" | "not_simplified"
      | "filing_versions_unusable" | "original_refused" | "original_unanswered" };
creditAdmissionFor?(tx: Transaction, saleId: SaleId, issuingNodeId: NodeId): Promise<CreditAdmission>;
recordCredit?(tx: Transaction, sale: SaleForFiscalRecord,
  credit: { creditedSaleId: SaleId; operationDate?: string }): Promise<FiscalRecordRef>;
```
Verifactu: `creditAdmissionFor(tx, saleId)` is asked for the sale AEAT holds in the receipt's place
(the replacement when there is one, Task 3.3) and reads that sale's newest alta as
`correctionAdmissionFor` does
(`correction-admission.ts:16-79`): an anulación is `voided`; none `missing`; more than one unfixed
version `filing_versions_unusable`; anything but an F2 or R5 "S" `not_simplified`; then
`currentAltaRefused` (as `recordVoid`, `backend.ts:513-520`) is `original_refused`, and the
`refuseUnansweredElsewhere` query (`backend.ts:166-180`) is `original_unanswered`. A version waiting
in this installation's own queue is eligible (A-D3). `recordCredit` throws plain `Error` unless
`sale.counterparty` is null and `sale.total` is negative, re-runs the admission (throwing a new
`fiscal.credit_not_admitted` `{ saleId, reason }`, registered in `fiscal-verifactu/src/errors.ts`;
core refuses first, so staff should never meet it, and the route maps it to 409 with the same
wording as `sale.reissue_not_admitted`), then
files exactly as `recordSale` does (`backend.ts:292-358`), `operationDate` included. fiscal-none:
admission `unsupported`; `recordCredit` returns its recorded ref. Fake: configurable admission;
`recordCredit` stores like its `recordSale`.

- [ ] **Step 1: Failing tests** in `credit-record.test.ts` (real backend, `useVenueDb`): a credit of an
  F2 queues one alta `TipoFactura` F2, `ImporteTotal` −9.00, `Desglose` −8.18/−0.82, no
  `FacturasRectificadas`, `FechaOperacion` the handed day when earlier, none when the same day; the
  library's `validate` returns no errors; credits of an R5 "S" admitted; refusals: voided, F1,
  R5 "I", refused-and-unfixed, another installation's unanswered version (each asserting its reason
  and that no record and no number were written); a pending version in this queue admitted.
  `inmutabilidad.test.ts` and `write-path.e2e.test.ts` unedited.
- [ ] **Steps 2–4:** run, implement, rerun `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/credit-record.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts`,
  plus fiscal-none's and the fake's suites and the gate test.
- [ ] **Step 5:** Commit.

### Task 3.2: the receipt's standing value

**Files:** Create `packages/core/src/receipt-standing.ts`, test `receipt-standing.test.ts`.

**Produces:**
```ts
export interface ReceiptStanding {
  /** The receipt as AEAT holds it: the receipt, or its replacement. */
  standsAs: SaleId;
  number: string;           // formatInvoiceNumber of standsAs
  issuedAt: string;         // standsAs's issue instant, ISO
  issuedOffsetMinutes: number;
  operationDay: string;     // coalesce(replacement.supply_day, receipt.supply_day, receipt's filed date)
  total: Decimal;           // standsAs total + Σ correctivesOf totals
  vatBreakdown: VatBreakdownLine[]; // Σ per rate of the same rows' stored vat_breakdown
  lines: RecordSaleLine[];  // positive, the receipt's own lineNo kept (gaps allowed), correctsLineId null
}
export async function readReceiptStanding(tx: Transaction, receiptId: SaleId): Promise<ReceiptStanding>;
```
Lines (N5): read `readCorrectionAmountHistory(tx, standsAs)` (`correction-history.ts:221`) and
`remainingLines(history)` (`correction-allocation.ts:189`): each line's gross left. That function
cuts only the gross (`correction-allocation.ts:232-243`), so each line's base left is its `base` less
the `base` of `history.consumed` allocations for that line, the same allocations. Both refuse a
history they cannot read (`sale.correction_history_unusable`). On top, only the quantity rule: gross
left 0, the line is dropped; otherwise it keeps its stored quantity, `unitPrice`, and as `listGross`
its own `listGross`, else its `lineGross`; `lineGross` and `lineTotal` are what is left; its
`setMenuPart` less what corrective lines took of it (`partsTaken`, which `readHistory` builds, `correction-history.ts:379-385`).
Each line keeps its `lineNo`;
`parentLineNo` keeps naming the parent's number, and a child whose parent was dropped keeps it too
(the parent's row is still the receipt's). The credit's lines are the same rows negated, at the same
numbers. `operationDay` uses the same
expression as `saleVatDay` (`accountant-export.ts:446-454`). No check ties the lines to the breakdown: a
receipt's own breakdown may be supplied rather than derived from its lines (`record-sale.ts:84-90`),
and the full invoice copies both as they stand; its total and breakdown equal the standing ones by
construction.

- [ ] **Step 1: Failing tests** (receipts seeded with `recordSale`; every corrective written as the
  real give-back writes it, through `previewCorrectionAmounts` then `recordCorrection` with the
  preview's lines, the calls `fileCorrectionIn` makes, `invoice-corrections.ts:471`, `:482`, never
  hand-built rows): untouched receipt (§4's €9.00: lines and breakdown equal the receipt's); the beer
  refunded whole (2 chips at line 2, no line 1, €6.00, €5.45/€0.55); €3.00 given back on the chips
  line (one of two chips): "2 × chips", list €6.00, charged €3.00, quantity 2;
  €1.00 goodwill on the chips (chips line €6.00 list, €5.00 charged, `lineTotal` €4.54; breakdown
  €7.27/€0.73); a shared free item's share (CLAUDE.md §3, A445) and a divided set menu, each with
  a partial refund, summing exactly; a receipt with a replacement (lines from the replacement, its
  number and day); `operationDay` from a receipt issued the next day for the day before
  (`supply_day`); a receipt given back whole (total €0.00, no lines).
- [ ] **Steps 2–4:** run, implement, rerun `pnpm --filter @waitron/core exec vitest run src/receipt-standing.test.ts`.
- [ ] **Step 5:** Commit.

### Task 3.3: core writes the swap

**Files:** Create `packages/core/src/record-reissue.ts`, test `record-reissue.test.ts`. Modify
`packages/core/src/record-sale.ts` (extract its body into an internal
`writeSale(tx, backend, input, file)` where `file` is the backend call and an optional
`creditsSaleId` is written to the row; `recordSale` passes `backend.recordSale`, behaviour
unchanged), `packages/core/src/index.ts`, `packages/core/src/errors.ts`
(`"sale.reissue_not_admitted": { saleId: string; reason: ReissueRefusal }`),
`scripts/write-path-tables.json` (Task 2.1's entry), `scripts/alert-codes.test.ts` only if it scans
the new file.

**Interfaces:**
- Consumes: Task 3.1's `creditAdmissionFor`/`recordCredit`; Task 3.2's `readReceiptStanding`;
  Task 2.2's `correctionTargetFor`.
- Produces (the admission is asked for `standing.standsAs`, the replacement's record when the
  receipt was replaced, and `recordCredit`'s `creditedSaleId` is that same sale; the row's
  `credits_sale_id` and the link's `original_sale_id` are always the original receipt):
```ts
export type ReissueRefusal =
  | Extract<CreditAdmission, { eligible: false }>["reason"]
  | "already_reissued" | "is_credit" | "nothing_left" | "correction_open" | "refund_pending"
  | "advance" | "takes_off_advance" | "unpaid";
export interface RecordReissueInput {
  origin: SaleOrigin; nodeId: NodeId;
  receiptSaleId: SaleId;
  receiptSeriesId: SeriesId;   // the node's live `standard` series
  fullSeriesId: SeriesId;      // the node's live `full` series
  counterparty: Counterparty; recipientAddress: string;
  operatorId: string; clock: TrustedClock;
  locale: string; invoiceLocales: string[]; operationDescription: string;
}
export async function previewReissue(tx: Transaction, backend: FiscalBackend,
  receiptSaleId: SaleId, issuingNodeId: NodeId): Promise<{ standing: ReceiptStanding }>;
export async function recordReissue(tx: Transaction, backend: FiscalBackend,
  input: RecordReissueInput): Promise<{ creditSaleId: SaleId; invoiceSaleId: SaleId }>;
```
`previewReissue` first maps a replacement to the receipt it replaces, so the swap is always
recorded against the original receipt. It refuses, in this order, before anything is written: not
found (`sale.not_found`);
a credit (`is_credit`); not a receipt: names a customer, is a corrective other than a replacement, or
is a full invoice (`not_simplified`); voided (`voided`); a `sale_reissues` row (`already_reissued`);
an open `invoice_corrections` row for it (`correction_open`); a `pending` refund of its payments
(`refund_pending`); an advance or a deduction line (`advance`, `takes_off_advance`); unpaid: no settlement, or a tender of method
`deferred` (a bill closed as a deferred payment, `deferred-close.ts:161-173`) (`unpaid`); `creditAdmissionFor` ineligible (its reason); standing total €0.00 (`nothing_left`).
`recordReissue` runs `previewReissue`, then in this order: the credit through `writeSale` with
`file = backend.recordCredit`, `creditsSaleId` set, total and breakdown the standing's negated, lines
`reversedLines`' shape with `correctsLineId` null, `settlement: deferred`, `operationDate` the
standing's day, the receipt's facts (N15); the full invoice through `recordSale`, positive, the
customer and address, `settlement: deferred`, the same `operationDate` and facts; then the
`sale_reissues` row, a unique violation translated to `already_reissued`. Both calls use the one
clock the caller passes (`prepareIssueClock`'s), so they carry one instant.

- [ ] **Step 1: Failing tests** (fake backend, `useVenueDb`): §4's example writes credit −€6.00
  (`credits_sale_id` FS/123, `supply_day` 30/09, standard series) and FF/12 €6.00 (full series,
  customer, `supply_day` 30/09) and one row; both `issued_at` equal; each refusal above with its
  reason and no row, number or record written (count `sales` and each series' last number before and
  after); two writers on one receipt: the second, started after the first signals it holds the write
  lock, gets `already_reissued` and no number; a refused admission leaves no number.
  `record-sale.test.ts` unedited.
- [ ] **Steps 2–4:** run, implement, rerun `pnpm --filter @waitron/core exec vitest run src/record-reissue.test.ts src/record-sale.test.ts`.
- [ ] **Step 5:** Commit.

### Task 3.4: end to end through the real regime

**Files:** Create `packages/fiscal-verifactu/src/reissue-path.e2e.test.ts`.

- [ ] **Step 1:** Tests: `recordReissue` against `VerifactuBackend` queues, after the receipt's alta,
  an F2 alta of −€6.00 and an F1 alta of €6.00 with `Destinatarios`, both with `FechaOperacion`
  30/09 when the swap is 02/10 and neither on the same day; both chained after the receipt; the
  library's `validate` empty for both; a receipt refused by AEAT and unfixed writes nothing.
  **A refused full invoice, switch off (N16, today's path):** FF/12 refused `1112`; the put-right
  offers no fix, the filing case carries N16's wording in both languages, and a refund opened from
  FS/123 ends as `give-back-full-invoice.test.ts` asserts for an F1 refused with nothing to fix.
  **Switch on:** FF/12 refused `1112`, then put right by its R4 "S" through the Fiscal filing page's
  path; a refund opened from FS/123 then files
  an R1 naming the R4, and `correctivesOf(FS/123)` counts that R1 and not the R4. **A refused credit
  (N10):** FS/140 refused; the put-right offers no fix, the remedy route refuses `fiscal.remedy_invalid`,
  `recordReplacement` of FS/140 is refused `credit`, and no record is written.
- [ ] **Step 2:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/reissue-path.e2e.test.ts src/inmutabilidad.test.ts` — pass (the path exists since 3.3; this is the cross-package proof, and a proof by deletion: removing `recordCredit`'s admission call makes the refused case fail).
- [ ] **Step 3:** Commit.

Leaves: nothing reachable changes.

---

## PR 4a (FISCAL, half a day; about +40 product lines, +300 test lines): the reports

### Task 4.1: outstanding and daily reports leave the pair out

**Files:** Modify `packages/core/src/list-outstanding-sales.ts`, `packages/reporting/src/business-day.ts`
(`notReissuedClause()`: `s.credits_sale_id is null and not exists (select 1 from sale_reissues ri
indexed by sale_reissues_invoice_key where ri.invoice_sale_id = s.id)`, used where
`notSubstituteClause` was). Tests: `list-outstanding-sales.test.ts`, reporting's sales,
`vat-summary`, `top-sellers`, `category-sales` and `counts` suites (one case each).

- [ ] **Step 1: Failing tests:** after §4's swap on its day, outstanding lists nothing; the day's
  totals, VAT summary, top sellers (2 chips, no beer, nothing extra), categories and counts equal
  the same day without the swap; an R1 of one chips on FF/12 the next day takes €3.00 and one chips
  off that day.
- [ ] **Steps 2–5:** run (FAIL: the pair is listed and counted), implement, rerun, commit.

### Task 4.2: the VAT return and corrections list count both on the receipt's day

**Files:** Tests only, unless they fail: `packages/reporting/src/vat-movements.test.ts`,
`vat-return.test.ts`, `vat-corrections.test.ts`.

- [ ] **Step 1: Tests** (§6): receipt 30/09 €9.00, swap 02/10. Q3 return €8.18/€0.82; Q4 return has
  no line from the swap; Q4 corrections list two `issued_late` rows netting to zero. Same-quarter swap
  (receipt 10/10, swap 12/10): Q4 return €8.18/€0.82. Same day: unchanged. **Control:** the credit
  written with no `operationDate` puts −€8.18/−€0.82 in the Q4 return; the test asserts that number,
  so the expected case and the failing one differ.
- [ ] **Step 2:** Run. Expected PASS for the D10 cases (the seeds already reach a later-issued invoice with
  a supply day, `vat-movements.ts:131-133`) and for the control. If a D10 case fails, fix
  `vat-movements.ts`, never the expectation.
- [ ] **Step 3:** Commit.

Leaves: reports right for a swap no one can yet make.

---

## PR 4b (FISCAL, about a day; about +250 product lines, +600 test lines): server readers

Tasks 4.3a–4.4b.

### Task 4.3a: Find a bill and the invoice lookup

**Files:** Modify `apps/server/src/find-bill-transactions.ts` (scope, type, `listed`, `:116-117`'s
type list, `filtered`'s Correctives), the till's Find a bill types and words EN/ES; test
`invoice-lookup-api.ts`'s behaviour only. Tests: each file's suite.

- [ ] **Step 1: Failing tests:** Find a bill lists FS/123, FS/140 as `receipt-credit` and FF/12 as
  `full-invoice`, all three in the receipt's zones only (a device outside them sees none); a refund
  of FS/123 attaches to FS/123, not to the credit; the invoice lookup does not list FF/12.
- [ ] **Steps 2–5:** run, implement, rerun, commit.

### Task 4.3b: the orders list and payment lookups

**Files:** Modify `apps/server/src/orders-list.ts`, `receipt-presentation.ts`,
`receipt-deferred-payment.ts`, `deferred-close.ts`. Tests: each file's suite.

- [ ] **Step 1: Failing tests:** orders list shows neither as a walk-up sale; the full invoice's card
  payment is the receipt's for practice mode and bank details; deferred-close's state reads
  `reissued` from either side.
- [ ] **Steps 2–5:** run, implement, rerun, commit.

### Task 4.4a: the accountant and the tax office

**Files:** Modify `apps/server/src/accountant-export.ts`, `tax-office-list.ts` (`reissueOf`). Tests:
each suite; `tax-office-list.kinds.e2e.test.ts` gains both kinds.

- [ ] **Step 1: Failing tests:** the Q3 workbook lists FS/123, FS/140 and FF/12 under 30/09 and sums
  €9.00; the Q4 workbook lists none of them; the tax-office list types FS/140 F2 and FF/12 F1, both
  `reissueOf` FS/123.
- [ ] **Steps 2–5:** run, implement, rerun, commit.

### Task 4.4b: the order detail, advances, handovers, live lists

**Files:** Modify `apps/server/src/orders-detail.ts` (a `reissue` block; the dashboard's order detail
shows "Made a full invoice: FF/12 Acme SL · credit FS/140", EN/ES), `advance-taken-off.ts` (neither
named), `packages/fiscal-verifactu/src/handover-return.ts`, `apps/dashboard/src/api/live-queries.ts`,
`apps/till/src/api/live-connection.ts`. Tests: each suite; `handover-return.test.ts` gains a returned
swap (rows copied, a held different row a conflict).

- [ ] **Step 1: Failing tests:** the order detail names both; a handover return carries the row;
  each live list names `sale_reissues`.
- [ ] **Steps 2–5:** run, implement, rerun, commit.

## PR 4c (FISCAL, half a day; about +80 product lines, +450 test lines): corrections after the swap

Task 4.5, after PR 4b.

### Task 4.5: corrections after the swap

**Files:** Tests: create `apps/server/src/reissue-corrections.test.ts`. Modify
`apps/server/src/invoice-corrections.ts` (a swap's full invoice is mapped to its receipt before the
settlement checks at `:136-139` and `:236-240`, so a correction opened from FF/12 is the receipt's,
as one opened from a replacement is); `apps/server/src/cancelled-lines.ts` and
`apps/server/src/give-back-read.ts` (no change expected: `correctionTargetLines`,
`cancelled-lines.ts:215-226`, pairs by line number, used at `give-back-read.ts:355` and
`cancelled-lines.ts:296`; N5 keeps the numbers so it holds, and the test proves it);
`packages/core/src/record-replacement.ts` (`reissued`), the filing-case wording in
`packages/fiscal-verifactu` and the dashboard for it, the till wordings for reasons `credit` and
`reissued` (`apps/till/src/i18n/codes.ts`, EN/ES).

- [ ] **Step 1: Failing tests:** Refund pressed on FS/123 after the swap files an R1 naming FF/12, pays
  from the receipt's card, and leaves FS/123 owing €3.00 (§4); Give back on FS/140 refused `credit`;
  Cancel and Reopen of FS/123's bill refused with the code a full invoice's Cancel gets today, the
  test naming and asserting it (N9); the Fiscal filing
  page's replacement of FS/123 refused `reissued`; a correction opened from FF/12 itself (Find a bill)
  is accepted and files an R1 paid from the receipt's payments; one of two chips given back through
  the real give-back route before the swap, then the swap: FF/12's lines read "2 × chips", charged
  €3.00 (N5); a dish of FS/123 cancelled after the
  swap: its refund goes on the R1 for that dish's line on FF/12 (the cancel paired by line number),
  and the cancel is paid as CORRECT-FULL-INVOICE §5 rules.
- [ ] **Steps 2–5:** run, implement, rerun, commit.

Leaves: every reader is ready; still no route.

---

## PR 5a (FISCAL, about a day; about +300 product lines, +450 test lines): the route

### Task 5.1: preview and write

**Files:** Create `apps/server/src/full-invoice-reissue-api.ts` (registered where the other
transaction routes are), test `full-invoice-reissue-api.test.ts`.

**Interfaces:** `POST /api/transactions/:saleId/full-invoice/preview` → `{ number, total, lines,
operationDay }` or a refusal; `POST /api/transactions/:saleId/full-invoice` with `{ recipient,
delivery, requestKey }` → `{ invoiceSaleId, invoiceNumber, creditSaleId, creditNumber, delivery }`.
Both: `requireSession(…, { action: "take-orders" })`, `gateZones` over the receipt's orders
(`saleScopeInZones`), `refuseUntilRecordable`. The write, in one `withTransaction`:
`requireEconomicWrite`, `prepareIssueClock`, `checkedInvoiceRecipient` (`invoice-selection.ts:48`),
the live `standard` and `full` series (`readLiveSeriesIdTx`), `readSaleOperationDescription` of the
receipt, `recordReissue`; then the delivery inside `optionalDocument` (`optional-document.ts:29-66`):
`delivery` is what `checkedInvoiceChoiceDelivery` accepts (`invoice-choice-delivery.ts:26-65`), with
`invoiceType: "F1"`; receipt paper enqueues FF/12 then FS/140 at the device's receipt printer; A4 or
email reserves FF/12 through `reserveInvoiceDelivery` with `requestKey` `reissue:<invoiceSaleId>`,
and A4 also prints FS/140 at the device's receipt printer (N6). A repeat of one `requestKey` answers
the first result. Status map: `sale.reissue_not_admitted` and `fiscal.credit_not_admitted` 409, `sale.not_found` 404,
`invoice.recipient_invalid` 400, `fiscal.taxpayer_domicile_missing` 409.

- [ ] **Step 1: Failing tests:** one per refusal reason (asserting the code and reason); no
  `take-orders` refused; outside the zones refused; the clock not confirmed refused before any read;
  a success writes the pair and queues both records (a route-to-XML case through the real
  regime); a failed delivery still answers success with `delivery: null`; a repeated `requestKey`
  writes nothing more.
- [ ] **Steps 2–5:** run, implement, rerun, commit.

### Task 5.2: till wording and the adviser's question

**Files:** `apps/till/src/i18n/codes.ts` (every `sale.reissue_not_admitted` reason, and
`fiscal.credit_not_admitted` with the same words, EN/ES, each saying
what happened and what to do: e.g. `refund_pending` "A card refund on this receipt is still waiting
for the card company. Try again once it has finished." / «Una devolución con tarjeta de este tique
aún espera a la entidad. Inténtelo de nuevo cuando termine.»; `original_unanswered` "The tax agency
has not answered this receipt from the previous box yet. Try again later.";
`nothing_left` "Everything on this receipt has been refunded, so there is nothing to invoice.");
`codes.test.ts`. Docs: question 15 of `docs/compliance/2026-11-19-adviser-meeting.md` (written by the
design branch) gains, EN and ES: N6 (must the customer be given the credit?), A-D3 (receipts of any
age), the advance and unpaid rules of PRs 7–9.

- [ ] Steps: failing `codes.test.ts` cases, implement, rerun, commit.

Leaves: the route works; no screen calls it.

---

## PR 5b (FISCAL, about a day; about +200 product lines, +350 test lines): the paper

### Task 5.3: both documents say what they are

**Files:** Modify `packages/orders-sales/src/invoice-typing.ts` (`TypedSale` gains `id` and
`creditsSaleId`; `InvoiceTyping` gains `replaces?: { invoiceNumber; issuedAt; issuedOffsetMinutes }`
on a full invoice in `sale_reissues` and `credits?` with the same shape on a credit, both naming
`standsAs` (N7)); `packages/country-es/src/receipt-labels.ts` (`replacesSimplifiedInvoice` and
`creditsSimplifiedInvoice` in all five languages, beside `replacesInvoiceInFull` at `:42`, `:132`,
`:222`, `:312`, `:402`: EN "Replaces simplified invoice {number} of {date}" / "Credits simplified
invoice {number} of {date}"; ES «Sustituye a la factura simplificada {number} de {date}» / «Abono de
la factura simplificada {number} de {date}»; CA, GL, EU translated, and each translation read by
the owner before landing); the receipt, A4 and email layouts that print `corrects`
(`receipt-document.ts:178-183`, `invoice-layout.ts:274-282`, `invoice-email.ts`);
`apps/server/src/invoice-document.ts:193-199` and `apps/server/src/transaction-receipt.ts:258-264`,
where `readTenderBlock` and `readReceiptPayments` read only the sale's own payments and a swap's full
invoice has none: both read the receipt's for it, settled when the receipt is.

- [ ] **Step 1: Failing tests:** `invoice-typing.test.ts` (F1 with `replaces`, F2 with `credits`,
  each naming the replacement when one exists); the receipt issuer prints both lines and the sale's
  day on 58 mm, 80 mm and A4, English and Spanish; FF/12's paper shows the receipt's card payment and
  no amount owed; the credit prints as a receipt with negative amounts. Look at each with
  `receipt-look.ts` in both themes where it renders HTML.
- [ ] **Steps 2–5:** run, implement, rerun, commit.

---

## PR 6 (till, about a day; about +400 product lines, +500 test lines; the owner lands: it is the fiscal action's only entry)

### Task 6.1: the action and its place

**Files:** Create `apps/till/src/screens/till-receipt-full-invoice.ts` (the button and its state;
till-ticket-view is at its cap); modify `till-ticket-view.ts:1150` to render it, or lane O's R3
screen if that is on `main`; `apps/till/src/api/*` for the two routes. Tests beside it.

- [ ] **Step 1: Failing tests:** **Make it a full invoice**, hint "for a company" / «para una
  empresa», shows only when the preview answers a standing value; a refusal shows its wording with
  nothing pressed.
- [ ] Steps 2–5: run, implement, rerun, commit.

### Task 6.2: the details screen, delivery and the answer

**Files:** use lane O's O5 field block (`docs/superpowers/plans/2026-11-28-o-o5-invoice-details.md`)
without its save, or today's `TillInvoiceRecipientDialog`; Print (one printer dropdown) or Email.
Tests: the request bodies written literally in a new `apps/till/src/full-invoice-reissue-requests.test.ts`
(a later change to them goes to the owner); the answer "Full invoice FF/12 for Acme SL is printing on
Office" / "… has been emailed to …" (D9 of CORRECT-FULL-INVOICE's wording rule for "is being
emailed"); a refused write keeps the typed details; Back asks before losing them (`draftScopeFor`).

- [ ] Steps: failing tests, implement, rerun, commit.

### Task 6.3: guide, pictures

**Files:** `apps/server/src/guide/en/table-service.md` and `es/table-service.md`: replace the sentence
at `:142-143` ("Turning a paid bill into a full invoice would correct an invoice already issued, and
Waitron does not offer that correction yet") with a short section under `{#full-invoice}`: open the
receipt from Find a bill, Make it a full invoice, the customer, Print or Email; refunds after go on
the full invoice. Shared `{#id}`. Pictures beside frames `bf` and `q` 4 at 390 px, light and dark,
including a full invoice made from a receipt with one of two chips given back, which prints
"2 × chips" charged €3.00 (N5), so the owner sees it;
lane P's read says "ready for the owner"; shown to the owner, never committed.

- [ ] Steps: `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts` pass; commit.

Leaves: staff can make a past receipt a full invoice.

---

## PR 7 (FISCAL; about +150 product lines, +300 test lines, to be re-estimated when expanded): a receipt that is an advance

**Expand before dispatch.** PRs 7–9 state their rules and defaults here; their file lists and failing
tests are written out, to Task 3.3's level, by lane A when PR 6 has landed and before any implementer
is dispatched, and the expansion is read by a fresh reader like the rest of this plan.

**Also in PR 7:** the credit and the full invoice carry the advance's lines with their
`advance_role`, and a final invoice's credit carries a `deduction` line with `deducts_sale_id`. Every
reader keyed on `deducts_sale_id` or `advance_role` is listed in the expansion
(`rg -n "deductsSaleId|deducts_sale_id|advanceRole|advance_role" packages apps -g '!*.test.ts'`) and
told how it treats a credit's and a swap's full invoice's lines: `advancesTakenOff` already skips a
corrective, not a credit (`advance-taken-off.ts:63`); `bill-advances.ts` and `find-bill-bills.ts`
read the advance's correctives through `correctivesOf`.

**Rules.** An advance receipt (lines `advance_role = 'payment_on_account'`) is admitted only while no
invoice has taken it off (`advancesTakenOff`, `advance-taken-off.ts:42-86`, answers nothing for it).
The credit and the full invoice copy its lines with their advance role. `bill_advances` keeps naming
the receipt. The final invoice issued later takes the advance off naming the **full invoice's**
number and date on paper, while its deduction line's `deducts_sale_id` keeps the receipt, so every
advance reader keyed on the receipt still works. An advance already taken off is refused `advance`
with "This payment has already been taken off the table's bill." Money back on the advance after the
swap is an R1 on the full invoice. **Default if the adviser disagrees:** leave it refused.

### Task 7.1

**Files:** `packages/core/src/record-reissue.ts` (narrow `advance`), `apps/server/src/receipt-lines.ts`
or wherever the deduction line's number is printed (find with `rg -n "taken_off_by|deductsSaleId" apps/server/src`),
`advance-taken-off.ts`. Tests: a €30 advance made a full invoice, then the table's €120 bill takes off
"Pago a cuenta n.º FF/13, 19/11/2026, −€30.00"; the bill's own record carries only €90; an advance
taken off already is refused; a give-back of the advance after the swap files an R1 of FF/13.

- [ ] Steps: failing tests, implement, rerun, commit.

## PR 8 (FISCAL; about +100 product lines, +250 test lines, to be re-estimated): a receipt that took an advance off

**Expand before dispatch** (as PR 7).

**Rules.** Admitted. The standing value is already net of the advance (the receipt's record carries
only what is left). The credit negates every line, the deduction line included; the full invoice
lists the dishes at their prices and the deduction line naming the advance by its own number and
date, as the receipt did. The advance stays as it is. `advancesTakenOff` names the full invoice as
the invoice that took the advance off once its receipt is reissued (follow `sale_reissues`). **Default
if the adviser disagrees:** leave it refused.

### Task 8.1

**Files:** `record-reissue.ts` (drop `takes_off_advance`), `receipt-standing.ts` (the deduction line
kept), `advance-taken-off.ts`. Tests: the €120 − €30 = €90 receipt made a full invoice: credit −€90
(lines −€120 and +€30), full invoice €90 with the deduction line; the advance's screen says "taken
off by FF/14"; the advance's own give-back is unchanged.

- [ ] Steps: failing tests, implement, rerun, commit.

## PR 9 (FISCAL; about +150 product lines, +300 test lines, to be re-estimated): an unpaid (deferred) receipt

**Expand before dispatch** (as PR 7).

**Rules.** Two kinds, both admitted; in both the debt stays recorded on the receipt, the one
place money is taken. (i) Issued but not settled (an unpaid departure, a printed bill, the day's
close): a later payment settles the receipt (`settleSale`; the coverage trigger already counts the
full invoice's correctives, Task 2.2); outstanding lists the receipt with the full invoice's number
beside it. (ii) Closed as a deferred payment (settled with a `deferred` tender,
`deferred-close.ts:161-173`): the accountant's deferred sheet (`listDeferredPaymentInvoices`,
`deferred-payment-export.ts:37`) keeps the receipt's row and gains a `reissuedAs` column beside
`replacedBy` (`:27-28`) naming the full invoice, so the accountant chases the full invoice's number.
In both, the full invoice's paper prints the receipt's bank details (`receipt-deferred-payment.ts`
follows the link since Task 4.3) and what is owed. **Default if the adviser disagrees:** leave it
refused.

### Task 9.1

**Files:** `record-reissue.ts` (drop `unpaid`), `deferred-payment-export.ts`, the deferred-payments
list and collection lookups (find with `rg -ln "deferred" apps/server/src/*.ts -g '!*.test.ts'`), the paper.
Tests: an issued, unsettled €9.00 receipt made a full invoice, then paid €9.00 in cash, settles the
receipt, and outstanding listed it with FF/15 beside it before; an R1 of −€3.00 on FF/15 first makes
the payment €6.00 (€9.00 refused `sale.tender_shortfall`); a receipt closed as a deferred payment made
a full invoice: the export row names FF/15 in `reissuedAs`, and FF/15's paper prints the bank details.

- [ ] Steps: failing tests, implement, rerun, commit.

---

## Seams with plans 1 and 2

- **Plan 1** (`2026-11-28-substitution-1-correctives.md`, lane L): partial refunds become "S" and the
  filed record names the latest version, while a corrective's row keeps hanging from the original or
  its replacement (spec §3) — the rule `correctionTargetFor` keeps here, extended to receipt → full
  invoice → its replacement. Both plans touch `correction-target.ts` and its test (create or extend:
  whichever lands first creates `packages/core/src/correction-target.test.ts`, the second extends
  it), `correction-history.ts`, and the till's correction wordings; the second to land rebases. A
  refund after the swap needs nothing more from plan 1 than any R1 does.
- **Plan 2** (lane L, its PR 6b / P8): a different customer for a full invoice is an R4 "I" to zero
  naming the old customer, then a new F1 that takes its money from the old F1. **This plan widens the
  link to carry that:** `sale_reissues` names an `original_sale_id` (any credited document), a
  `credit_sale_id` and an `invoice_sale_id`, and every reader in §5 reads it as "the original keeps
  the money; the credit and the new full invoice moved none; the new full invoice's correctives
  count against the original". What plan 2 adds in its own PR: the trigger's admission of an R4 "I"
  as the credit (today it accepts only a negative F2 crediting a receipt, Task 2.1), and a fifth
  `correctivesOf` condition leaving an R4 that is a link's credit out of the original's sum (an R4
  sets `corrects_sale_id`, so the first branch would count it; this plan's credit does not, because
  it uses `credits_sale_id`). Plan 2 does not need a second link table.

## Order, and overlaps

D → PR 0 ∥ archive push + PR 1a → PR 1b → PR 2 → PR 3a → PR 3b → PR 4a ∥ (PR 4b → PR 4c) →
PR 5a ∥ PR 5b → (PR 0's answer) →
PR 6 → PRs 7, 8, 9 in any order. Only PR 2 rebuilds core's baseline.

- **Lane L, plans 1 and 2:** see the section above.
- **CORRECT-FULL-INVOICE** PR 2a (#4448) already files R1 on a full invoice, which Task 4.5 relies on.
- **Lane O:** R3 draws the button and opens PR 6's screen; O5's fields are reused without its save
  (`2026-11-28-o-o5-invoice-details.md:15-19`); PAY-2 and PAY-3 first wherever they are on `main`.
- **The watcher:** lane A's F3 plan file needs its own dated pointer to this plan
  (`~/waitron-campaign/`, not in the repository).
