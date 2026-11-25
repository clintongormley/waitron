# CANCEL-UNSERVED: a receipt for a bill nobody was served and nobody paid is cancelled at AEAT

Status: plan, revised 2026-11-25 after one fresh read (`~/waitron-campaign-l/receipts/cancel-unserved/plan-read-1.md`).
Not started; nobody has approved it. FISCAL: the owner lands every pull request (PR). Base `main` at `3b672aee5a`.
"Run" = a throwaway test in a detached worktree, removed afterwards: by this revision unless it says "(draft)" or
"(read 1)". "Read" = only read.

**Words.** A *receipt* is the simplified invoice (AEAT's F2). A *cancellation* is the record telling AEAT the receipt
should never have existed (*registro de anulación*; `recordVoid`, `sale_voids`). A *corrective* is the negative invoice
(R5) that takes a receipt back to zero. A *printed bill* has its receipt issued and unpaid (order status `placed`). *Set
aside* (`retenido`) is a record that is never sent and holds nothing behind it.

## 1. Should this exist?

**The ask:** the owner's "yes" (25 Nov, relayed, lane L `questions.md` "11:19") to "Should Waitron send a cancellation
when nothing was served and nothing was paid?", replacing C126 there; adviser answer 1.7
(`docs/compliance/2026-11-15-adviser-answers.md`, B3). Food served and not paid: the receipt is not undone. Paid then
refunded: the corrective, as today. The `queue.md` runner line adds "reports, reprints and the accountant's files with a
voided receipt, what happens when AEAT refuses it". **Simplest alternative:** nothing, since today's corrective already
takes the VAT back to zero; that is not what the adviser answered. **This plan** is today's menu entry and route, one
question, the writer that exists, and the readers that would print, charge or sum a cancelled receipt wrongly.

**Sources.** Developer FAQ v1.3 §17 case 2.d (pinned PDF, run (draft)): a whole invoice that «no debería haberse emitido»
«se podrá "anular"»; «Estos casos deberían ser MUY POCO FRECUENTES»; invoices for «operaciones realmente efectuadas … no
pueden anularse»; not having handed it over «favorecería» cancelling. AEAT's taxpayer FAQ on an invoice «emitida por
error … (ej. operación inexistente)»: «se dará de baja mediante un registro de facturación de anulación», with no
condition on the paper (run (draft)).

## 2. What reaches it, and the rule

Only a table's receipt is issued before payment: Print the bill, Record unpaid departure, close of day (four callers of
`issueUnpaidInvoice`, run (read 1); the fourth, deferred close, settles at once). What undoes one today: the table menu's
**Cancel and credit**, on a printed bill that never took a payment and names no customer (**this changes**); **Reopen
bill** (the watcher's note of the owner's words, `questions.md` 11:53 and 11:55: kept, with its corrective). Give money back needs a paid receipt. An order
with no receipt files nothing and is unchanged.

**"Nothing was served"** is staff's answer. Waitron contradicts it only where it knows better: a dish, extra or drink
marked served, or a dish cancelled with its charge kept (that lowers the served mark, `line-service-cancel.ts:147`, read).
"Not marked served" proves nothing: **Print anyway** prints with dishes unmarked.

1. ⋮ → **Nothing was served** (today's **Cancel and credit** place and conditions).
2. One window, one tap: **Nothing was served** / **Some was served** / **Keep the bill**. It lists the dishes the kitchen
   has marked ready, which the till already has (`CurrentOrderRow.kitchen.state`). It does not show the receipt's age: the
   till does not have it (`PartyBill` holds no issue time, read). No Reason field: the reason stored is the fixed text
   `Nothing was served`, as Reopen stores its own.
3. **Nothing was served** → the cancellation is filed, the bill abandoned, the kitchen told VOID as today; a PIN when the
   person lacks `sale.void` (supervisor and manager hold it), from the existing `/api/unpaid-departure-authorizers` list.
4. **Some was served** → nothing happens. The window offers **Take payment**, **Reopen bill**, **Record unpaid
   departure**, **Keep the bill** (a bill already recorded as left unpaid: only Take payment and Keep the bill).
5. With any dish marked served the window opens on step 4, naming what is marked; it never suggests taking a mark back.
   **Every dish served:** the same step, and Reopen bill works there (run: 200). **Partly served:** Reopen refuses today
   until every dish is marked served (run: 409 `bill.unserved_dishes`), so a dish that is never coming has no truthful way
   out; PR 2 gives it one, and PR 3 does not land before it.

**Server**, same route `POST /api/working-orders/:id/cancel`, `{ nothingServed: true }`, one transaction. A bill that ever
took a payment, or holds a corrective, a replacement or a full invoice keeps today's code; no till screen reaches that
(`!bill.hasPayments`, read), so no words are built for it.

| Refused | Answer | The window |
| --- | --- | --- |
| an issued bill without `nothingServed: true` | `management.request_invalid` | never sent by the till |
| a dish marked served, or a kept charge | `bill.served_dishes` with the dishes | becomes step 4 |
| a payment on its way; time not confirmed; box handed over | today's codes | as today |
| receipt issued by **another box's chain** and not yet answered by AEAT | `fiscal.original_unanswered` | "The other box has not finished sending its receipts. Try again later." |

**Why that one refusal (run).** A cancellation of another chain's *held* receipt stopped every later record of this box:
five passes over 100 hours, nothing sent. A queued one can become held, so "not yet answered" is the line. It is thrown
inside Veri*Factu's `recordVoid`, so no new seat method: with a throwaway check there, 17 fiscal files gave 1 failure of
330 (`backend.test.ts`, another box's unanswered sale) and 15 server files 451 of 451. *What happens then:* only after a
box switch. This box sends the old box's queued receipts itself (run), so the next passes usually clear it; until then
the bill stays, can be paid, and **Move this bill** (offered on it, read) frees the table.
**Dropped, not needed (run).** Own chain, receipt **queued**: sent first, the cancellation next pass. **Refused**: the
cancellation is set aside and later records go. **Held**: the cancellation waits behind it, as every later record does.

**The written zone (run).** With the box on `TZ=UTC` the receipt says +60 minutes and its cancellation +0; with
`prepareIssueClock` inside Veri*Factu's `recordVoid`, both +60. Same instant, and no golden `huella` changes: 11 fiscal
files 257 of 257, and `write-path.e2e` (the golden), `void-path.e2e` and `inmutabilidad` 25 of 25.

**When AEAT refuses.** *The receipt, after the cancel:* set aside, alert and case «Cancellation set aside» (words exist).
AEAT holds neither, which is the truth. Both cases stay open, as a refused receipt's does today for every code but two;
nothing is built to close them. *The cancellation:* the usual **Refused** case; later records go; Waitron counts the
receipt as voided and AEAT does not. A resend is not built until one is seen. *Wrong answer:* a real sale leaves AEAT for
good; staff ring it again under a new number.

## 3. PR 1. A voided receipt is read as voided (nothing reaches it yet)

Readers already right (run (draft), part re-run (read 1)): daily close, category sales, modelo 303, VAT corrections,
tax-office list, Find a bill, owed lists, settle, second cancel, Orders status **Voided / «Anulada»**. Wrong:

1. **Zone.** The one line above; delete `prepareFiscalVoidClock` (called only by tests), its cases moved onto `recordVoid`.
   First: `TZ=UTC`, offset is the venue's; golden test unchanged.
2. **A voided receipt owes nothing, and a returned void ends its bill.** Real (run): the actual return
   (`receiveReturnedOriginals`) of a void against a placed bill answers complete and leaves it `placed`; on such a bill a
   €1.00 payment is **taken**, and Cancel and Reopen refuse, so the money can never settle. Smallest fix, both halves
   needed (run): `readIssuedSales` answers 0.00 for a voided sale (payment then 409 `bill.nothing_outstanding`; alone it
   leaves **Finish** refused, `party.bill_outstanding`), and the return abandons the void's placed bill when it holds no
   payment. First: a returned void, then payment, Finish; a live bill still payable. A bill this box had already taken
   part payment on stays, owing nothing, until the money is given back.
3. **Nothing owed on paper.** `stillOwed`, retry, resend, email and A4 refuse a voided sale. Today a given-up original is
   retried by itself, and the till's retry answers 200 (run (read 1)). First: those two, email; a live receipt still
   prints.
4. **Copies** of a voided receipt, ticket and A4, gain one line, "ANULADA" / "VOIDED", beside DUPLICADO.
   `orders-reprint.test.ts:226` keeps allowing the copy. First: the ticket text.
5. **Accountant's spreadsheet.** A second row, kind **Voided / «Anulada»**, dated the day it was voided, minus amounts, as
   a corrective's row is. Today (run (draft)) its columns sum too high against the modelo 303 report. First: one period,
   and two. The old-box workbook keys the same list by invoice id, so it must not gain the row
   (`old-box-data-workbook.ts:263`).
6. **Fiscal filing** offers no replacement and no description fix for a refused receipt whose sale is voided (a flag on
   the case view, one condition in `putRightFor`). Without it the replacement always refuses (`record-replacement.ts:78`)
   and the description fix can put a voided receipt live at AEAT. First: `put-right.test.ts`, the route's view.

**`Sale-path read changed:`** yes, one `sale_voids` lookup by its unique `sale_id` in `readIssuedSales`, read by payment.

## 4. PR 2. Reopen bill can let go of dishes that never came (if the watcher says yes)

7. Server: `split-after-print` takes `stopUnserved: true`, honoured only when some dish is marked served (an entirely
   unserved bill is cancelled, not corrected); without it, today's refusal. `pay-for-items` unchanged. First: partly
   served with and without the flag, nothing served, part paid, a held group, a set menu.
8. Till: Reopen's not-served list gains **Stop these dishes and reopen** / «Parar estos platos y reabrir».

Run, with the refusal switched off, on one steak and one served beer: Reopen 200 and its R5; Print on the new bill still
lists the steak (409 `meal_end.unserved_dishes`); an ordinary waiter takes it off with no PIN; the new receipt is 3.00.
Only that two-dish bill was run. The kitchen's VOID slip is `abandonPlacedOrder`'s (read).
**If no:** a partly served bill keeps only Take payment then Give money back for the dish, or waiting for it.

## 5. PR 3. The question

9. Server, new `cancel-unserved.ts`: the rule above; every line read, not only top ones. The PIN's permission is chosen
   ahead (`sale.void`, or `sale.rectify` on today's path); inside, `authorize` runs with `attempts` before the money
   checks and before `recordVoid`, which counts no wrong PIN itself (`record-void.ts:41`, read); if the path changed
   meanwhile, the ordinary conflict. It ends a waiting original, email or A4 (`receipt.voided`, beside `PRINT_JOB_MOVED`;
   also `ENDED_NOT_FAILED`, `printers-screen.ts:270`, the till's `codes.ts`): today a queued original stays queued (run
   (read 1)). First: each row of the table; no waiting paper afterwards. Two dispatches.
10. 11. 12. `cancel-invoiced-order.test.ts` (2,089 lines), three dispatches: corrective-content cases move onto a bill paid
    and given back, assertions unchanged; permission and PIN cases also run on the new path; "left without paying" becomes
    a cancellation on an open table.
13. Till: the window (mode `cancel` of `cancel-credit-dialog.ts`, Reason and its field removed), ready dishes, step 4's
    choices; `till-app.ts` has 39 lines left, so logic goes in the window and a helper. EN, ES, phone, tablet, a11y,
    unsaved.
14. Words and guides: `table-service.md` in both languages, `fiscal.md` C126, `backlog.md`, `asesor-questions.md` Q32, B3,
    `conventions-ui.md:630`; and Reopen's words, which also say "cancels the receipt" / «anula el ticket» while filing a
    corrective (`split.scope`, `split.done`, `split.credited_elsewhere`, `bill_pay.items_own_bill_printed`): "This takes
    the receipt back and reopens the bill." / «Esto retira el ticket y reabre la cuenta.»

| Where | English | Spanish |
| --- | --- | --- |
| Menu, title, answer | Nothing was served | No se sirvió nada |
| Other answer | Some was served | Se sirvió algo |
| Window | If the receipt printed, take it back. | Si el ticket se ha impreso, recupéralo. |
| Ready | Ready in the kitchen: {dishes} | Listo en cocina: {dishes} |
| Step 4 | The receipt can't be cancelled. | El ticket no se puede anular. |
| Step 4, marked | Marked served: {dishes} | Marcado como servido: {dishes} |
| Other box | The other box has not finished sending its receipts. Try again later. | El otro servidor aún no ha terminado de enviar sus tickets. Inténtalo más tarde. |
| Done | Receipt {number} cancelled. | Ticket {number} anulado. |

**AEAT, before landing PR 3.** A cancellation was accepted there on 22 October (run 39721604913, original and cancellation
`Correcto`, lookup `Anulado`; `docs/compliance/verifactu-findings.md` §19; the run is red for another stage) and on 1
November (run 41328471424, green, its log "anulación, and final consulta succeeded", run). Neither was Waitron's own
record. One more dispatch, its log in the PR:
`gh workflow run live-aeat.yml --repo waitron-io/verifactu --ref main -f mode=submit`.

## True size

By file, then three times that (Give money back's built against estimated, `2026-11-25-correct-full-invoice.md`).

| | Tasks | By file (production / test) | Expect |
| --- | --- | --- | --- |
| PR 1 | 1–6 | 170 / 700 | 500 / 2,100 |
| PR 2 | 7–8 | 60 / 220 | 180 / 650 |
| PR 3 | 9–14, eight dispatches | 350 / 1,600 | 1,050 / 4,800 |

Each dispatch is meant to stay under 80 calls; split one that passes 60 unfinished. No generated file, migration, reset or new
route; about 40 guide lines per language. All three full path, two Codex reviews. Order: Give money back PR 3 first (it
rewords the same till strings), then PR 1, 2, 3; each leaves `main` green and working.

## What this plan does not do

Cancel a full invoice, a deferred bill, or a receipt that ever took money; a closed table's departure (question 1);
"Send the cancellation" on Fiscal filing, or closing a set-aside case; resend a cancellation AEAT refused; who, when and
why on the order page; a screen listing cancellations (Orders filters **Voided**).

## For the watcher

Each needs a yes; the recommended answer follows the dash.

1. **A one-bill table recorded as "left without paying" by mistake** is closed by that, so no screen can cancel it. It is
   the adviser paper's own example (B3), and the server would take it — not in this item, unless the owner wants it: once
   PR 3 is in, the same window on Find a bill, about 60 + 200 lines estimated, 180 + 600 expected, and a mock-up.
2. **PR 2:** let Reopen bill go on when some dishes were served and others never came; the kitchen is told to stop and
   staff take them off the reopened bill. The watcher's 11:53 note keeps Reopen as it is, so ask —
   yes. Without it staff's easiest way out is a false mark.
3. **Guests still hold the printed receipt:** cancel anyway, telling staff to take it back — yes. AEAT says not having
   handed it over helps; its other FAQ and the adviser set no such condition.
4. **No Reason field** (staff type one today); the two answers are the question — yes. Other way: keep it, one more step.
5. **The question shows the kitchen's ready dishes but not how old the receipt is**, which the till does not have — yes;
   adding it is one more column on the bill the till reads.
6. **The menu entry becomes "Nothing was served"** instead of "Cancel and credit", and **Reopen's lines stop saying
   "cancels the receipt"** — yes to both: otherwise staff meet "Anular" for two different things.
7. **The approver's PIN** is now for "Void sales" instead of "Correct invoices"; supervisors and managers hold
   both by default, so it differs only where a venue changed its roles — yes.
8. **A copy of a voided receipt says VOIDED / ANULADA** — yes. Other way: leave copies as they are.
9. **The accountant's spreadsheet gains a minus row for a voided receipt**, so its columns add up — yes. Other
   way: one row with its "Voided at" date.
10. **A receipt the other box issued and AEAT has not answered waits** ("Try again later") — yes. Other way: today's
    corrective, for that rare bill only.
11. **One AEAT test run in `submit` mode counts as the proof**, though the record is the library's, not Waitron's — yes.

**Mock-ups to the owner, phone and tablet, English and Spanish:** before PR 3, the question with its ready dishes, step 4
(with and without marked dishes), done. Before PR 2, Reopen's list with the new button. Before PR 1, a copy headed
ANULADA and the spreadsheet's two rows.
