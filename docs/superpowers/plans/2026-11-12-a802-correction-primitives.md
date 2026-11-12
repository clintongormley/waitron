# A802: one correction step, or a few simpler pieces? (note for the owner, 2026-11-12)

**Status: for the owner's decision; revised the same day after lane M's second read**
(`~/waitron-campaign-m/reports/a802-correction-primitives.md`). It answers the owner's two questions about #2867
(relayed by the watcher, 2026-11-12 01:59). #2867 is held and slice 5, the till screen, waits on the answer. No
code changed.

**Words.** A **simplified invoice** is the ticket a guest gets. A **corrective invoice** (type R5) is a new,
negative invoice that takes value off an earlier one; once filed with AEAT (the Spanish tax agency) it cannot
be undone. A **transaction** is one all-or-nothing database step: on any failure nothing in it is saved. A
**leg** is one return of money to one of the original payments. A **connected card** is a reader Waitron talks
to; a **hand-keyed card** is a separate terminal staff work by hand and then tell Waitron about. The
**background check** is the loop that asks the card company about refunds whose result is not yet known.
**Glue** is code that only joins pieces for one case. **Line numbers are at #2867's head `49f2d5687a`** (merge
base `19ed358163`) unless a path says otherwise; every one was read there.

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
| Refusing anything not all-cash; the cash left must cover the correction | 23 | `invoice-corrections.ts:151–163`; `:168–177` | Glue; but the cover check (`:168–177`) is needed at opening in any shape, for every kind of payment |
| Spreading the money over the cash payments, one drawer opening, one row per leg | 48 | `invoice-corrections.ts:212–259` | Glue; kept as a helper (§2, default 2) |
| The new `invoice_corrections` table, one row per cash leg | 44 | `packages/db/src/schema/invoice-corrections.ts`, `classification.ts`, two export lines | Glue |
| Error codes (three are cash-only) | 12 | `errors.ts:655–666` | Mostly building block |
| Imports, types, mounting, an allowlist entry | 74 | `invoice-corrections.ts:1–68`, `till-api.ts`, `english-only.ts` | Wiring |

The rows add to 595. In round numbers, **about 230 lines are building blocks any shape keeps, about 130 are
glue for "all-cash, in one step"**, and about 235 are wiring, the routes and the repeat check, which any shape
needs but would rewrite. (The first version said 240 / 140 / 220; lane M recounted from the same rows, and the
cover check moves from glue to building block.) The all-cash limit is real: a ticket paid part card is refused
(lane M's run, `~/waitron-campaign-m/reports/a802-slice4.md:78–82`, `invoice_correction.not_cash`).

## 2. Your shape: a correction run like a bill in reverse

**The forward model already works this way.** Each bill payment is its own transaction, and the payment that
leaves the bill fully paid issues the invoice in that same transaction (`apps/server/src/bill-payments.ts:1243–1244`,
`issueWhenFullyPaid` at `:685`). A card that finishes later issues it when its result is recorded (`:1411–1414`).

**Mirrored for a correction** (a design, read, not built):

1. **Open** a correction on a paid invoice: amount, dishes, reason, PIN. Opening runs every check the filing
   will run (permission, invoice still correctable, record chain sound, enough money left to return), so a
   refusal comes before any money moves. Nothing is filed and no money moves.
2. **Give money back** through the existing Refund a payment (`POST /api/transactions/:saleId/refunds`,
   `tender-refund-api.ts:146`), as many legs as needed, each naming the open correction. The refund already
   takes such a link for cancelled dishes (`cancellationIds`, `tender-refund-reservation.ts:40`, linked at
   `:256` in `adjustment_refunds`, `packages/db/src/schema/adjustments/refund-links.ts:7`); the correction's
   link is built to the same pattern.
3. **File the corrective when the legs add up.** A **cash** last leg files it in the same transaction: if the
   R5 is refused the leg is undone and no drawer opens (lane M's run, case X1). A **card** last leg, connected
   or hand-keyed, is recorded first and always; the R5 is then tried in its own step (the holes below say why).
4. **Ways out:** Finish now for what has gone back (customer left early); Discard, when nothing has gone back;
   Close keeping the refunds, when the R5 can never be filed (the invoice's filing was refused by AEAT, or
   another box took over, `packages/fiscal-verifactu/src/correction-admission.ts:53`, `:56–57`). Open
   corrections are listed in Find bill like open bills.

**Settled by the watcher (2026-11-12 03:39), unless you say otherwise:**

1. **One open correction per ticket.** A second is refused with "finish or discard the open correction first".
   The first version said the open row "holds that value"; it would not: the code that works out what is left
   to correct counts only filed correctives (`packages/core/src/correction-history.ts:109`, `:161–172`), and
   lane M's preview of the whole €40 went through with €15 already back. One open correction per ticket needs
   no change there.
2. **Cash stays one pot.** "€25 cash" back over two cash payments stays one action, one PIN, one drawer
   opening, spread oldest first (`invoice-corrections.ts:212–257`), kept as a helper the refund uses.
3. **One tap on the till for the all-cash case.** The till sends the opening and the cash leg back to back from
   one confirmation. A stop between the two leaves an open correction with nothing back, which can be discarded.

**Worked example.** €40.00 at 10% (base €36.36, VAT €3.64), paid €20 cash + €20 card; correct €25.00 (base
−€22.73, VAT −€2.27). Open: nothing filed. Leg 1: €15 cash, drawer opens. Leg 2: €10 back to the card; when the
card company confirms, the refund is recorded and the R5 for −€25.00 is filed (if nobody is signed in by
then, see Hole 1). Today #2867 refuses this invoice.

**Between legs, money has gone back with no corrective yet.** The day's close shows the €15 cash out
(`packages/reporting/src/cash-up.ts:58–60`) while sales and VAT still show the full €40
(`packages/reporting/src/vat-summary.ts:24` reads only invoices). I ran the existing test that pins this state
for an ordinary refund, on main `dc8074643f`: `pnpm exec vitest run src/report-api.tender-refunds.test.ts -t
"publishes a named negative"` → 1 passed. Until the R5 is filed the invoices show €2.27 more VAT than the venue
will finally owe. Find bill lists every completed refund the same way (`find-bill-transactions.ts:75–87`), so
the plan adds an alert when a correction has had money back for over an hour without its R5, like a pending card
refund's (`tender-refund-recovery.ts:17`, `:93–99`). **Time limit:** the repo's research records "a corrective
invoice must be issued within four years (art. 15.3)" (`docs/compliance/verifactu-findings.md:1321–1322`); that
is a summary, not the article. Which quarter a late R5 reduces is not settled in what I read.

## 3. Three holes for cards, and their fixes

The first version said this shape keeps #2867's "never cash out without its R5" whenever the last leg is cash
or hand-keyed card. Lane M showed that holds for cash only.

**Hole 1: nobody signed in when a card refund is confirmed.** Filing an R5 requires an open staff or
management session holding `sale.rectify` (`packages/core/src/record-correction.ts:195–205`, inside the
protected fiscal core); the background check holds none (`tender-refund-recovery.ts:24–30`,
`tender-refund-sends.ts:144–151`). Lane M filed an R5 after the manager signed out: `refused session.not_open`.
Two options, from lane M's report: **(a)** the approval given at opening counts for the filing whenever it
happens: automatic, but a change to the protected fiscal core, which needs your own approval (design
`docs/superpowers/specs/2026-10-20-a802-partial-paid-invoice-correction-design.md:8`); **(b)** Waitron records
the refund, raises an alert, and a manager presses **Record correction** later: no fiscal-core change, but it
depends on someone acting, and the design asks that a refund never be left "to an optional later manual
correction" (`:194`). Lane M recommends (a), with (b) whenever the filing is refused for any other reason.
**This is your choice; the note does not make it.**

**Hole 2: a refused R5 must not hide a refund the card company has paid.** Filed inside the step that records
the card's result, any refusal undoes that step. Lane M's run, with a stand-in for the refusal: the refund stayed
"awaiting confirmation"; a retry, the background check and a manager's "it went through" were all refused; a
second refund to that card was refused; no alert after two hours. (The first version said "a sale has that same
case and files anyway (`bill-payments.ts:722`)". It does not: that line waives one check, a dish since gone off
sale, `bill-payments.ts:722–726`; every other refusal still stops a sale's invoice.) **Fix:** record the refund
first, in its own transaction; then try the R5; on refusal, mark the correction "money back, corrective
waiting", raise an alert, and offer **Record correction**. The unresolved-refund alert this path leans on is
also skipped when recording throws (`tender-refund-recovery.ts:93–99`); that is being fixed separately, on
`fix/tender-refund-unresolved-alert`.

**Hole 3: a hand-keyed card has paid before Waitron is told.** The till says "Return this amount on the original
terminal, then confirm below" (`apps/till/src/i18n/strings.ts:126–127`), and the server refuses the leg without
that tick (`tender-refund-reservation.ts:160`). Filed in one transaction with the leg, a refused R5 undoes
Waitron's record of money the terminal has already paid (lane M's case X1: €25 gone, €15 shown). **Fix:** the
opening's up-front checks make a refusal unlikely before staff touch the terminal; once staff confirm, the leg is
always recorded and a refused R5 waits with an alert, as in Hole 2. That is the approved design's own rule for
the terminal: "If recording the correction fails afterwards, retain the preparation and terminal evidence for
**Record correction**, never another instruction to return the money" (design `:203–204`).

**It changes one decision you made, less than the first version said.** On 2026-10-21 you approved filing the
corrective *before* a connected-card refund (design `:3–5`, `:182–187`). The same design already files *after*
the money for a hand-keyed terminal (`:197–206`). Your shape makes that exception the rule; the change is for
connected cards only. The other order leaves the opposite gap, and an R5 cannot be withdrawn if the card refund
then fails.

## 4. How it fits A1308's merge of the refund tables

A1308 plans one `refunds` table for money back before and after the invoice, "in its own slice after the rest of
this area" (`docs/superpowers/specs/2026-11-02-rationalisation/tables-ordersales.md:176–177`); no date is set.
Lane M's earlier Proposal 2 asked for "one correction row with a unique key, and its cash legs point at it"
(`a802-slice4.md:163–170`); your shape is that, done now. The link names a refund id, which the merge renames as
it already plans for cancels (`tables-fiscal.md:802`). Whether the two link tables become one is for that merge.
Nothing waits on A1308.

## 5. Recommendation: land #2867, reshape before slice 5

**Still your shape, with the holes written into the plan.** It is the bill path run backwards, reuses Refund a
payment for every kind of money instead of a cash-only copy (stretching #2867 to cards would copy the card half
of the refund, `tender-refunds.ts:100–119`, `:136–146`), and is the one shape that reaches card and mixed
payments with one way of working. What changed since the first version: the one-transaction protection survives
for cash only; cards need "money back, corrective waiting" with an alert and Record correction; the reshaping is
larger; and there are two questions for you, not one.

**The reshaping PR, recounted** (estimates by comparison with #2867's own code: its two routes are 134 lines,
its spreading 48, its table 44; not measured; till screens left out):

| Piece | New lines |
| --- | ---: |
| Correction row (one open per ticket) and its link table | ~60 |
| Open with every filing check up front; Finish now, Discard, Close keeping the refunds; the open list | ~170 |
| Refund a payment taking the link; cash spreading as a helper | ~70 |
| Filing on the last leg: cash in its transaction, card in the step after | ~70 |
| "Corrective waiting", Record correction route, alert on refusal and after an hour | ~100 |
| **Total** | **~470 new, ~90 deleted** |

The ~90 deleted is #2867's glue less the spreading and the cover check, which stay. Hole 1's option (a) adds
about 40 lines in the fiscal core, best in a PR of its own with its protected-code approval. That makes about
975 production lines in all (595 + 470 − 90) against the first version's 750.

| Option | Pull requests before staff use it | What staff get |
| --- | --- | --- |
| Land as is, reshape later | 3 (#2867, 5a, 5b), then the reshape and a second screen | All-cash only; the screen is rebuilt when card arrives |
| **Land #2867, reshape before 5** | 4 (#2867, reshape, 5a, 5b); 5 if you choose (a) | Cash, card and mixed, from slice 5b |
| Wait for A1308's refund merge | unknown | Nothing until A1308's last slice |

Landing #2867 first (its AEAT test run passed on 2026-11-11, run 43110422275) keeps its reviewed fiscal core;
before go-live, replacing its table costs a venue reset, which #2867 already requires. **Two questions for you:**
(1) file the corrective when the money is all back (your shape; I recommend it), or at opening (the approved
order)? (2) For Hole 1, (a) the opening's approval counts for a later filing, or (b) a manager presses Record
correction?
