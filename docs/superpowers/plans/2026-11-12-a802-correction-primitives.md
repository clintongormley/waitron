# A802: one correction step, or a few simpler pieces? (note for the owner, 2026-11-12)

**Status: for the owner's decision.** It answers the owner's two questions about #2867 (relayed by the watcher,
2026-11-12 01:59). #2867 is held and slice 5, the till screen, waits on the answer. No code changed.

**Words.** A **simplified invoice** is the ticket a guest gets. A **corrective invoice** (type R5) is a new,
negative invoice that takes value off an earlier one; once filed with AEAT (the Spanish tax agency) it cannot
be undone. A **transaction** is one all-or-nothing database step: on any failure nothing in it is saved. A
**leg** is one return of money to one of the original payments. **Glue** is code that only joins pieces for one
case. **Line numbers are at #2867's head `49f2d5687a`** (merge base `19ed358163`); every one was checked there.

## 1. What in #2867 is a building block and what is glue

Counted with `git diff --numstat 19ed358163 49f2d5687a`: production code is 14 files, +595 −50 (tests,
generated migration files and docs left out). I split the files by line range, by hand:

| Part | Lines | Where | Kind |
| --- | ---: | --- | --- |
| Finishing a refund moved into one shared helper: refuse while the clock is behind, mark cash returned, open the drawer, report hours | +75 −44 | `tender-refund-completion.ts:15–51`; `tender-refunds.ts` | Building block, already used by Refund a payment |
| Small reuse changes: the PIN check passed on, three helpers exported, one money check tightened | +13 −6 | `tender-refund-authorization.ts`, `tender-refund-api.ts`, `bill-payments-api.ts:34` | Building block |
| Issue the corrective: reason, invoice paid, split unchanged, record chain sound, file the R5 | 47 | `invoice-corrections.ts:142–150`, `:164–167`, `:178–211` | Building block |
| Preview: what a correction would file | 22 | `invoice-corrections.ts:69–90` | Building block (its cash total, `:81–88`, is cash-only) |
| Checking the request | 52 | `invoice-corrections.ts:260–311` | Building block |
| Recognising a repeated request | 51 | `invoice-corrections.ts:91–141` | Needed in any shape; written for one row per leg |
| The two routes | 134 | `invoice-correction-api.ts` | Preview route general; the other borrows the refund's PIN check through the first cash payment (`:77–97`, glue) |
| Refusing anything not all-cash | 23 | `invoice-corrections.ts:151–163`, `:168–177` | Glue |
| Splitting the money over the cash payments, one drawer opening, one row per leg | 48 | `invoice-corrections.ts:212–259` | Glue |
| The new `invoice_corrections` table, one row per cash leg | 44 | `packages/db/src/schema/invoice-corrections.ts`, `classification.ts`, two export lines | Glue |
| Error codes (three are cash-only) | 12 | `errors.ts:655–666` | Mostly building block |
| Imports, types, mounting, an allowlist entry | 74 | `invoice-corrections.ts:1–68`, `till-api.ts`, `english-only.ts` | Wiring |

In round numbers: **about 240 lines are building blocks any shape keeps, about 140 are glue for "all-cash, in
one step"** (the four glue rows plus three error codes), and about 220 are wiring, the routes and the repeat
check, which any shape needs but would rewrite. The all-cash limit is real: a ticket paid part card is refused
(lane M's run, `~/waitron-campaign-m/reports/a802-slice4.md:78–82`, `invoice_correction.not_cash`).

## 2. Your shape: a correction run like a bill in reverse

**The forward model already works this way.** Each bill payment is its own transaction, and the payment that
leaves the bill fully paid issues the invoice in that same transaction (`apps/server/src/bill-payments.ts:1243–1244`,
`issueWhenFullyPaid` at `:685`). A card that finishes later issues it when its result is recorded (`:1411–1414`).

**Mirrored for a correction, as three simple steps** (a design, read, not run):

1. **Open** a correction on a paid invoice: amount, dishes, reason, PIN; the preview shows the split. One new
   row, unique on (invoice, request id), holds that value so no second correction can take it. Nothing is
   filed and no money moves.
2. **Give money back** through the existing Refund a payment (`POST /api/transactions/:saleId/refunds`,
   `tender-refund-api.ts:146`), cash or card, as many legs as needed, each naming the open correction. The
   refund already takes such a link for cancelled dishes (`cancellationIds`, `tender-refund-reservation.ts:40`,
   linked at `:256` in `adjustment_refunds`, "How much of one refund paid back one cancel",
   `packages/db/src/schema/adjustments/refund-links.ts:7`).
3. **Issue the corrective when the legs add up**, inside the transaction that finishes the last leg: the shared
   helper above for cash and hand-keyed card, and the one place a connected card's result is recorded
   (`recordOutcomeIn`, `tender-refund-sends.ts:144`, used by the live attempt, the recovery loop and the
   manager's attestation, `:229`). Plus **Finish now for what has gone back**, to close a correction whose
   customer left early, and an open correction listed in Find bill like an open bill.

**Worked example.** €40.00 at 10% (base €36.36, VAT €3.64), paid €20 cash + €20 card; correct €25.00 (base
−€22.73, VAT −€2.27). Open: nothing filed. Leg 1: €15 cash, drawer opens. Leg 2: €10 back to the card; when the
card company confirms, that transaction files the R5 for −€25.00. Today #2867 refuses this invoice outright.

**Between legs, money has gone back with no corrective yet.** The day's close shows the €15 cash out
(`packages/reporting/src/cash-up.ts:58–60`) while sales and VAT still show the full €40 (`packages/reporting/src/vat-summary.ts:24`
reads only invoices). I ran the existing test that pins exactly this state for an ordinary refund, on main
`dc8074643f`: `pnpm exec vitest run src/report-api.tender-refunds.test.ts -t "publishes a named negative"` →
1 passed (main's `report-api.tender-refunds.test.ts:177–227`: the refund day shows −107.25 taken and no VAT; the
period's VAT stays 17.36). The drawer count is right, because the cash really left. AEAT sees only the original
invoice. Until the R5 is filed, the invoices show €2.27 more VAT than the venue will finally owe. **Time limit:**
the repo's research records "a corrective invoice must be issued within four years (art. 15.3)"
(`docs/compliance/verifactu-findings.md:1321–1322`) and, of a wrong date, "as soon as the error is known and within four
years" (`docs/compliance/2026-11-06-adviser-questions.md:123–124`). Those are the repo's summaries; I found no quotation of
the article itself there. Which quarter's return the R5 reduces when it lands in a later quarter is not settled
in what I read (the nearest open adviser question, S12, `asesor-questions.md:371–373`, is about cancellations).

**On a crash** each leg is whole or absent, as each bill payment is: there is no half state, only "open, with
some legs done". **The rules of CLAUDE.md §5 apply per leg with no new code:** a cash leg is refused while the
clock reads behind the latest fiscal record (`tender-refund-completion.ts:26`); the card recovery loop records
nothing while it does (`tender-refund-recovery.ts:31–37`); and the R5 filed at the end takes the issue clock
(`invoice-corrections.ts:193`). Because the R5 rides inside the last leg's transaction, it pauses with the loop.

**What one transaction protects, and whether your shape keeps it.** #2867 guarantees, for all-cash invoices,
never cash out without its R5 and never an R5 without its cash. Your shape keeps that wherever the last leg is
cash or hand-keyed card: if the R5 is refused (say the record chain fails its check), that leg's cash is refused
with it. Two cases lose it: the gap between legs, above, and a connected card the card company has already paid
back when the R5 is refused. A sale has that same case and files anyway (`bill-payments.ts:722`).

**It reverses one decision you made.** On 2026-10-21 you approved filing the corrective *before* a card refund
(design `docs/superpowers/specs/2026-10-20-a802-partial-paid-invoice-correction-design.md:3–5`, `:182–187`); the
design named your new order as the alternative and asked that a refund never be left "to an optional later manual
correction" (`:192–194`). Automatic filing on the last leg, plus Finish now, meets that. The other order leaves
the opposite gap: an R5 filed for money not yet returned, so declared VAT is lower than on the money held. I have
not established which gap the law prefers; that is arithmetic, not law.

**Rough cost** (estimated from the comparable code above, not measured): the correction row and its link table
about 60 lines; open, Finish now and listing about 120; the refund taking the link about 50; filing on the last
leg in the two completion places about 70. About 300 new production lines, about 140 of #2867's glue deleted:
roughly **750 production lines against #2867's 595, but covering card and mixed payments**, which #2867 does not.

## 3. How it fits A1308's merge of the refund tables

A1308 plans one `refunds` table for money back before and after the invoice, "in its own slice after the rest of
this area" (`docs/superpowers/specs/2026-11-02-rationalisation/tables-ordersales.md:176–177`); no date is set.
Lane M's Proposal 2 asks for "one correction row with a unique key, and its cash legs point at it"
(`a802-slice4.md:163–170`). Your shape is that proposal, done now rather than at the merge, and it also closes lane
M's Minor 5: the database itself, not only the code, then refuses a second correction for one request (`:139–143`).
The link names a refund id; the merge renames it as it already plans for cancels
(`tables-fiscal.md:802`, "`adjustment_refunds.tender_refund_id` becomes `refund_id`"). Nothing waits on A1308.

## 4. Recommendation: land #2867, reshape before slice 5

**Your shape is better.** It is the bill path run backwards, it reuses Refund a payment for every kind of
money instead of a cash-only copy, and it is the only shape that reaches card and mixed payments without a
second complex action. #2867's one transaction protects something real, but your shape keeps that protection for
the leg that completes a correction; the gaps it adds are the gaps a part-paid bill already has.

| Option | Production lines | Pull requests before staff use it | What staff get |
| --- | --- | --- | --- |
| Land as is, reshape later | 0 now; ~300 later, plus a second screen | 3 (#2867, 5a, 5b) | All-cash only; the screen is rebuilt when card arrives |
| **Land #2867, reshape before 5** | ~300 new, ~140 deleted | 4 (#2867, reshape, 5a, 5b) | Cash, card and mixed, from slice 5b |
| Wait for A1308's refund merge | the same ~300, later | unknown | Nothing until A1308's last slice |

Landing #2867 first (its AEAT test run passed on 2026-11-11, run 43110422275) keeps its reviewed fiscal core, the ~240 building-block
lines; before go-live, replacing its table costs a venue reset, which #2867 already requires. Slice 5's window
then shrinks to amount, dishes and reason, because the money goes back through the existing refund window (not
measured on the till side). **One question for you:** file the corrective when the money is all back (your shape,
reversing 2026-10-21 for cards), or at opening (the approved order)? I recommend when the money is all back.
