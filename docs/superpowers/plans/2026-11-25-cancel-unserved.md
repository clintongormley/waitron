# CANCEL-UNSERVED: a receipt for a bill nobody was served and nobody paid is cancelled at AEAT

Status: cleared 2026-11-25 by the watcher (16:41, five changes) and, for PR 2, by the owner (16:43, relayed).
PR 1 landed as #4356; PR 2 landed as #4377; PR 3 is built on branch `feat/cancel-unserved-void`.
FISCAL: the owner lands every pull request (PR). Base: `main` at `bb1389b737`. "Run": a throwaway change in a detached
worktree for this revision (server halves only; not the till, not the other-box refusal); "run (earlier)": a previous one.
**Words.** *Receipt*: the simplified invoice (F2). *Cancellation*: the record telling AEAT the receipt should never have
existed (`recordVoid`). *Corrective*: the negative invoice (R5). *Printed bill*: its receipt is issued and unpaid
(`placed`). *Set aside*: a record never sent. *1112*: AEAT refusing a receipt as dated in the future.

## 1. Should this exist?

Yes: the owner's "yes" (25 Nov, relayed, lane L `questions.md` 11:19), replacing C126 when nothing was served and nothing
paid (adviser answer 1.7, `docs/compliance/2026-11-15-adviser-answers.md` B3; AEAT developer FAQ v1.3 §17 case 2.d). Food
served and not paid: the receipt is not undone. Paid then refunded: the corrective, as today. It is today's menu entry,
window and route, the writer that exists, and the readers that would print, charge or sum a cancelled receipt wrongly.

**AEAT has accepted one:** on 22 October its test service answered a cancellation `Correcto`, and a lookup after its repeat
`Anulado` (`docs/compliance/verifactu-findings.md` §19, run 39721604913, red only because the repeat was accepted too). It
was the library's record, not Waitron's; no new run (watcher).

## 2. The rule

The table menu's **Cancel and credit** (`till-table-order-screen.ts:7051`), on a printed bill that holds no payment and names
no customer. Same route and body, one transaction: `POST /api/working-orders/:id/cancel`, `{ reason, override? }`.

| The bill's receipt | Filed | Permission |
| --- | --- | --- |
| never paid (`holdsPayment`: one given back counts), no corrective or replacement, names no customer | **cancellation**, with today's typed Reason | `sale.void` |
| anything else, as today | corrective | `sale.rectify` |

The till reaches the second row with a 1112 receipt that was replaced and never paid: its bill meets the entry's conditions
(the bills answer, run), gets its corrective (200, run), and the bills read that follows names it (`["R/2"]`, run), so
"Corrective invoice {number} issued" stays.

| Refused | Answer |
| --- | --- |
| a dish, extra or drink served, or a dish cancelled with its charge kept | `bill.served_dishes`, naming them |
| a payment on its way; time not confirmed; box handed over | today's codes |
| a receipt **another box's chain** issued and AEAT has not answered | `fiscal.original_unanswered` |

- **Served:** any line's `served_quantity`, or a `line_service_cancellations` row (keeping a served dish's charge puts its
  mark back to 0, run), except rows Record unpaid departure wrote for dishes it stopped: those with `cancelled_at` at or
  after its `recorded_at` (`unpaid-departure.ts:142`, then `:151`).
- **Other box:** a cancellation of another chain's *held* receipt stopped every later record here (five passes, 100 hours,
  run (earlier)); a waiting one can become held. Thrown in Veri\*Factu's `recordVoid`, no seat method: one expected failure
  of 330 fiscal tests, 451 of 451 server ones (run (earlier)). Only after a box switch. On the box's own chain a waiting,
  refused or held receipt needs nothing (run (earlier)).
- **After** (run): the bill is abandoned, a seated party gets a fresh one, Orders says **Voided**. If AEAT refuses the
  cancellation: the usual **Refused** case, no resend. Staff's answer decides: Print anyway leaves dishes unmarked, so no
  mark proves nothing, and a wrong answer takes a real sale out of AEAT for good.

## 3. PR 1. A voided receipt is read as voided (nothing reaches it yet)

Every task: the named test red first, then the code, then that package's typecheck and `pnpm exec prettier --check` on
the changed files. Commands run as `pnpm --filter @waitron/<package> exec vitest run src/<file>`.

**Task 1, fiscal-verifactu:** `void-issue-clock`, `record-remedy`, `backend`, `void-path.e2e`, `inmutabilidad` (the golden
`huella` unedited); server: `zone-core-capabilities`.

- *First:* `void-issue-clock.test.ts`'s annulments on a plain `backend()` at offset 0 expect the venue's offset. *Code:*
  `backend.ts:496` reads `prepareIssueClock(tx, { nodeId: issuingNodeId }, this.clock)`. Under `TZ=UTC` the cancellation
  says 0 beside its receipt's 60; with it, 60 (run). Delete `prepareFiscalVoidClock`, which only tests call, and two of
  its cases: the unfiled sale (`backend.test.ts:313` holds it) and the helper's own node check.
- *First:* `record-remedy.test.ts`: a description fix on a voided sale whose cancellation is set aside refuses
  `fiscal.remedy_invalid`. Today it is applied (run), putting a voided receipt live at AEAT. *Code:* one `sale_voids`
  condition in `record-remedy.ts`'s list. No case-view flag. The replacement refuses already (`record-replacement.ts:81`).
  *Built instead* (watcher, 25 Nov 19:35): refused only while `release-held-cancellation` is not enabled, its default on
  every box (review, 25 Nov: and while its cancellation is not on this box). With it enabled, today's path stays:
  correct, AEAT accepts, release, AEAT ends at `Anulado`.

  34 fiscal files, 1,002 of 1,002, with both (run).

**Task 2, server:** `owed-receipts`, `orders-reprint`, `receipt-payments`, `find-bill-bills`, `bill-payments-api`.

- *First:* `orders-reprint.test.ts:226`: the voided copy has no "Pendiente" line, a live unpaid one has. Today it prints
  **Pendiente 18,00 €**; with the change that line alone goes (run). *Code:* `readIssuedSales` (`sale-due.ts`) joins
  `sale_voids` by its unique `sale_id` and answers 0.00. `Sale-path read changed:` yes, that join.
- *First:* `owed-receipts.test.ts`: a given-up original, and a sale with no original job, owed before the void and not
  after. Run: 1 then 0, both. *Code:* one `notExists(sale_voids)` in `stillOwed` (`owed-receipts.ts:55`).

**Task 3, server:** `accountant-export`, `old-box-data-invoices`, `report-api`.

- *First:* two cases. One period: the bases add up to modelo 303's (run: 50.00). Two: the sale stays in its period, the
  minus row goes in the one it was voided in, as a corrective's does. *Code:* a second query in `readAccountantInvoices`'
  **range** branch, by the void's day in the sale's offset (`vat-movements.ts:185`), listed last: kind **Voided /
  «Anulada»**, amounts negated, the receipt's number, the receipt as its original. The id-list branch, the old-box
  workbook's, is untouched (13 of 13, run). The notes heading's "voids flagged, not netted" / «se indican, no se restan»
  becomes "voids listed again as minus rows under the day this column gives" / «las anulaciones figuran además como filas
  en negativo, en el día que indica esta columna» (review, 25 Nov: the row's notes cell gives that day, "Listed under
  {day}" / «Figura en el día {day}»).

Dropped (watcher): VOIDED on copies; refusing a resend, email or A4; ending a placed bill whose void returns from another
box (it then takes no payment, where today €1.00 is taken; Finish and unpaid departure refuse it; run).

## 4. PR 2. Reopen bill can let go of dishes that never came

**Task 4, server:** `split-after-print`, `split-after-print.money`, `pay-for-items.printed`.

- *First:* partly served with and without the flag; nothing served; only a kept charge; a held group; a set menu. *Code:*
  new `served-dishes.ts`, section 2's **Served** read, used by PR 3 too; the split route takes `{ stopUnserved: true }`,
  honoured only when that read finds something; today's refusal gains whether it can be. Pay for items unchanged.
- Run with the refusal off, one steak and one served beer: Reopen 200 and its R5; Print on the new bill 409
  `meal_end.unserved_dishes`; a waiter takes the steak off with no PIN; the new receipt is 3.00. Only that bill was run.

**Task 5, till:** `widgets/cancel-credit-dialog` (with a11y and unsaved), `till-app-parties-closing`,
`widgets/bill-pay-dialog`; guides in both languages.

- **Stop these dishes and reopen** / «Parar estos platos y reabrir» in the not-served list, when offered. Words:
  `split.scope`, `bill_pay.items_own_bill_printed` "This takes the receipt back and reopens the bill." / «Esto retira el
  ticket y reabre la cuenta.»; `split.done` "Receipt taken back. Take off any dish that never came, move each guest's
  dishes to their own bill, then print each one." / «Ticket retirado. Quita los platos que no llegaron, pasa los platos de
  cada cliente a su propia cuenta y después imprime cada una.»; `split.credited_elsewhere` "already taken back" / «ya se
  había retirado». (Owner, 25 Nov 18:19: Reopen keeps "This cancels the existing receipt and reopens the bill."; its
  other lines follow those words.)

*As built (PR 2):* the press takes off the dishes the kitchen had not started (watcher 17:48, point 1); a started or
ready dish is stopped and keeps its charge on the reopened bill (watcher 22:42), and an extra of it the kitchen had
not started comes off; on the till, that dish's sent-dish window offers only Close, as for any dish cancelled with
its charge kept, so it cannot be comped there (the server's Comp with a reason does take it off) (2026-11-26: A1599 offers **Comp…** there); the stop is not offered on a bill
holding a payment; the words follow the owner's 18:19 answer: `split.done` "Receipt cancelled and the bill reopened.
Move each guest's dishes to their own bill, then print each one."

## 5. PR 3. Nothing was served

On PR 2's branch; the server half can start now, but it lands after PR 2 (a partly served bill is refused by both, run)
and after Give money back PR 3, which rewords neighbouring strings.

**Task 6, server:** `cancel-invoiced-order`, `cancel-placed-order.kitchen`; fiscal `backend`, `drain.cases`;
`scripts/corrective-sums.test.ts` (one allowed line; red without it, run).

- *First:* one case a row of section 2's tables, plus a served extra and a departure's own rows. *Code:* in
  `cancelPlacedOrder` (`working-order-counter.ts:175`) the permission is read ahead of the PIN check and again inside;
  `authorize` with `attempts` stays before the money checks (`recordVoid` counts no wrong PIN, `record-void.ts:41`).

**Tasks 7a, 7b, existing checks.** Of 28 server files, 26 checks of `cancel-invoiced-order.test.ts` and 8 of six others
went red with Task 6 in place (run). Void mechanics stay in `record-void.test.ts`.

| Checks | What happens |
| --- | --- |
| `cancel-invoiced-order`: credits the whole invoice; list prices; two rates; names each line; three-pick extra; Mosto; Zumo | **moved** to `cancel-credit.test.ts` on `creditWholeInvoice` (Reopen's too); two rates and names each line merged; set-up shared, not copied |
| four stored-invoice 409s | **removed**: `record-correction.test.ts` holds each code |
| no live series; two live; not permitted before a series is looked for | **removed**: `reserved-identity.test.ts:220`, `:262`; the last has nothing to look for |
| not permitted; second cancel; left unpaid; two at once; a later write fails; four PIN cases; key outside the lock; declined card; party's bills; counter list | **re-pointed** once each, to the cancellation and `sale.void` |
| the other 35 | unchanged; the replaced bill is the route's new corrective case |
| `split-after-print`: "still needs sale.rectify"; waiting for its time; comped dish | **removed** (as not permitted); asserts `clock.unconfirmed`; left unserved |
| `orders-list` (2), `orders-api` | Voided, no corrective |
| `clock-unconfirmed-gate`; `clock-behind-stop.records` | grows `records` only; backend built on the 2001 clock, which dates a cancellation |
| `fingerprint-refusal.implicit` credit refusal | **removed**: its fault is in the invoice builder; `fingerprint-refusal.test.ts:126` holds a void's |

**Task 8, till:** `widgets/cancel-credit-dialog` (with a11y and unsaved), `till-app-parties-closing`,
`screens/till-table-order-screen.table-menu`, `i18n/codes`.

- Today's window, Reason and buttons, new words. `bill.served_dishes` is listed as the not-served list is, with no Mark
  served. The approver list follows the permission the refusal names (`refusalOf` carries it): `sale.void`'s is
  `/api/unpaid-departure-authorizers`. Done is the corrective's text when the bills read names one, else the receipt's.
  `till-app.ts` has 58 lines left under its cap.

| Where | English | Spanish |
| --- | --- | --- |
| Menu, title, confirm | Nothing was served | No se sirvió nada |
| Window | Only when nothing was served. If the receipt printed, take it back. | Solo si no se sirvió nada. Si el ticket se ha impreso, recupéralo. |
| Approval | If you cannot void sales yourself, someone who can approves it with their PIN next. | Si tú no puedes anular ventas, a continuación lo aprueba alguien que pueda con su PIN. |
| Served | These dishes were served or charged, so the receipt can't be cancelled. Take payment, or use Reopen bill where it is offered. | Estos platos se sirvieron o se cobran, así que el ticket no se puede anular. Cobra la cuenta o, si se ofrece, usa Reabrir cuenta. |
| Payment held | This bill holds a payment, so its receipt cannot be cancelled. | Esta cuenta tiene un pago, así que no se puede anular su ticket. |
| Approver can't | The person who approved this cannot do it. Choose someone who can. | La persona que lo ha aprobado no puede hacerlo. Elige a alguien que pueda. |
| Other box | The other box has not finished sending its receipts. Try again later. | El otro servidor aún no ha terminado de enviar sus tickets. Inténtalo más tarde. |
| Done (no number) | Receipt {number} cancelled. (The receipt is cancelled.) | Ticket {number} anulado. (El ticket queda anulado.) |

**Task 9, words:** both `table-service.md` guides; the dashboard help of both permissions; `conventions-ui.md:630`,
`design-system.md:1231`, `backlog.md`; dated pointers in `fiscal.md` C126, `asesor-questions.md` Q32, adviser answers B3.

## 6. Size by file, and pictures

| | Production | Test |
| --- | --- | --- |
| PR 1, tasks 1–3 | 75, about 35 removed | 250 |
| PR 2, tasks 4–5 | 60 | 220 |
| PR 3, tasks 6, 7a, 7b, 8, 9 | 165 | 550, plus about 300 moved and 200 removed |

PRs 1 and 3: 240 / 800, estimates; earlier plans in this lane came out near three times by-file. No migration, venue reset,
generated file or new route. Each task is one dispatch under 80 calls; each PR leaves `main` green. Two Codex reviews each.

**Pictures for the owner,** phone and tablet, English and Spanish, before the till code. PR 3: the ⋮ menu; the window; the
window refusing with its dishes; the PIN step; done. PR 2: Reopen's list with the new button; its new words; done. PR 1: none.

## Cleared 2026-11-25 16:41

Changes 1–5 are applied above. Answers: 1 a one-bill table recorded "left without paying" (B3's example): not here, the
owner is told. 2 Reopen: yes, the owner (16:43). 3 cancel while guests hold the paper: yes. 4 no Reason field: no, it
stays. 5 kitchen-ready dishes: no. 6 menu name: yes, mock-up; Reopen's words only in PR 2. 7 "Void sales" PIN: yes.
8 VOIDED on copies: no. 9 minus row: yes, two tests. 10 the other box's unanswered receipt waits: yes. 11 new AEAT run: no.

## Found while applying (for the watcher)

1. **Record unpaid departure writes the same rows as a kept charge** for dishes it stops, so the rule as cleared refuses a
   bill whose guests left before eating (409, run), naming dishes nobody had. Section 2 leaves those rows out (200, run).
2. **A kept charge with nothing marked served had no way out:** Cancel refuses the charge, Reopen the unserved dishes (run).
   PR 2's flag and PR 3's refusal now use one read, "served, or charge kept", slightly wider than the owner's words. (The
   first read's 400 for "keep the charge" on a printed bill is not a rule: with a reason it answers 200, run.)
3. **The fix refusal must read `sale_voids`,** not "any cancellation": `record-remedy-held.test.ts` corrects an original
   whose seeded cancellation is set aside.
4. **False words:** the sheet's notes ("not netted", changed in PR 1) and the dashboard's help ("Authorise
   issuing a corrective receipt or invoice, including cancelling an invoiced order", as #4344 words it; PR 3).
5. **The test changes reach seven files,** not one.
