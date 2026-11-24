# GIVE-MONEY-BACK-ONE-BUTTON: one "Give money back" on a past receipt, and Waitron picks the route

Status: plan, written 2026-11-24 on `docs/give-money-back-plan` at `cc4fc8a1b7`. No product code
yet. Every `file:line` below was read on this branch; every result marked "run" came from the
command named beside it. Nobody has approved this plan as a whole; section 0 says who decided each
part.

Words used below, once:

- A **corrective invoice** (Spanish *factura rectificativa*) is a new invoice with negative amounts
  that reduces one already issued. Waitron files it with AEAT, the tax agency. Today staff make one
  with **Correct invoice** on a past receipt. In code it is a **correction** (`invoice_corrections`).
- A **plain refund** is money given back with no corrective invoice: today's **Refund a payment**
  (`refunds`, `apps/server/src/tender-refund-reservation.ts`). Since #4192 a plain refund may give
  back only: what dishes cancelled with **Cancel and refund** or **Finish table** are still owed, the
  extra paid on top of the bill (stored as a tip, section 3), and money on a receipt Correct invoice
  can never correct.
- A **give-back** is one press of the new button. Behind it Waitron makes one or more plain refunds
  and at most one correction.
- A **leg** is one refund that is part of a correction (cash or one card).
- A **card reader** is a card machine Waitron drives; a **separate terminal** is one it does not,
  where staff key the refund themselves and then confirm it in Waitron (`manual` in code).
- A **part payment with its own ticket** (an *advance*) is money paid towards a table's bill that
  got a ticket of its own; the table's receipt takes it off.
- The **watcher** is the session that supervises the campaign lanes and makes day-to-day calls the
  owner can overrule.

## 0. Who decided what

**The ask (owner, 2026-11-24, on #4192):** "waiters won't know about correctives. how do we make it
clear when to use which? can we not combine the flow somehow?" The owner then chose one button that
asks what the money is for, with Waitron routing through #4192's rules behind the scenes; staff
never see "Correct invoice" or "corrective"; nothing is refused for choosing the wrong option; both
till guides change (queue entry `~/waitron-campaign-l/queue.md:78-80`).

**The owner on the mock-ups** (relayed by the watcher, `~/waitron-campaign-l/questions.md`, entry
"WATCHER 2026-11-24 11:21 — OWNER on the "Give money back" mock-ups"):

- Screens: "yes".
- The switch for food money and the extra together: "yes", but "I'm not crazy about the wording
  "give back the tip". we shouldn't assume the excess is tip. instead we should refer to it as the
  excess or change or something similar". Section 3 says what the stored tip really is; O2 proposes
  the words.
- The "Some of this has to wait" screen: "that screen is really confusing and i don't understand
  why we need it. why is it blocked because it hasn't been filed with AEAT yet? We can keep
  functioning regardless". The watcher found the mock's words wrong (a correction is admitted while
  the receipt is queued or being sent; it waits only when AEAT refused it). **This plan does not
  build that screen.** Section 4 lists every case where a give-back waits or is refused, with
  evidence; what staff see is question O1.
- A full invoice naming a business customer: allow it with no correction for now and list it for
  the accountant. The watcher is queueing "correct a full invoice" separately (CORRECT-FULL-INVOICE,
  `queue.md:82-83`).

**The mock-up maker's defaults** (`~/waitron-campaign-l/receipts/give-money-back/notes.md`) are
theirs, not the owner's, except where the owner's "yes" to the screens covers what is drawn. Where
this plan departs from a drawn screen it says so (D11).

**Every decision below marked "mine" is the plan writer's.** The watcher may clear or overrule each.

## 1. Should this exist?

**Need:** the owner's words above. Today a past receipt shows two buttons side by side
(`apps/till/src/screens/till-ticket-view.ts:1051-1066`), and choosing the wrong one is refused with a
message telling staff to use the other (`tender.refund_needs_correction`, `apps/till/src/i18n/codes.ts:660-661`).

**Simplest thing that meets it:** one button and one window that asks what the money is for, and one
server route that takes the request, decides the route with #4192's own functions and calls the
existing write paths. No rule about what is filed changes: the server makes the same plain refunds
and corrections it makes today, chosen by the same checks (`correctableNow`,
`apps/server/src/invoice-corrections.ts:192-229`; `plainRefundLimit`,
`apps/server/src/tender-refund-reservation.ts:163-183`).

**The alternative considered: a till-only router** over today's routes (the till reads the limits,
then calls Open correction, Give cash, or Refund a payment in turn). Rejected (mine):

- a cash give-back of a dish plus the extra would be two or three requests, each with its own PIN
  check and drawer opening, and a failure part-way leaves some money back and some not;
- the till would route on a read another till can change before the writes, so the server would
  refuse with today's "choose Correct invoice" codes, which the till would then have to translate;
- a give-back needing both refund and correction rights would ask for two PINs.

A server route avoids all three: one request, one PIN, one drawer opening, all in one transaction for
cash, and the routing decided where the rules already live. The server stays the last word because
each existing write path keeps its own checks.

**True size** (estimates from the files each task names, not from a build): server about 500
production lines added and about 1,100 test lines (PR 1). Till about 900 production lines added, 300
changed, about 1,400 test lines added or rewritten, about 120 lines of guide text changed in each
language (PR 2). PR 3 deletes the two old windows and their tests: about 6,700 lines removed
(`wc -l` of the eight files, run). No generated file, no migration, no schema change, no new table.

**Approval:** section 0. Owner: the button, the screens, the switch, the full-invoice answer. The
watcher: the mock's wait words are wrong. Everything else is mine and waits for the watcher.

## 2. What people will see when it lands

- **A past receipt** shows **Give money back** (Spanish **Devolver dinero**), full width, above
  Reprint and Open drawer. **Refund a payment** and **Correct invoice** are gone from it.
- **The window** asks **What is it for?** with three rows: **A dish**, **Goodwill or a complaint**,
  and the extra paid on top of the bill (words: O2). Each leads to one short form: the amount, a
  **Reason**, **How it goes back** (one payment, "up to €X"), a summary box saying what happens to
  the money, and **Give back €X**. A dish and goodwill have the switch for the extra too.
- **A supervisor's PIN** is asked once, only when the person lacks a right the route needs, and the
  list of approvers shows only people who hold every right needed (D8).
- **A separate terminal**: the "refund it on the terminal, then confirm" step appears only after
  Waitron has checked that it will record the refund (D13).
- **The end** says, for cash, "€24.50 given back in cash. Give it to the customer." and the drawer
  opens once; for a card reader, "€10.00 is back on card ···4242"; if the card company has not
  answered, "€10.00 is waiting for the card company" with **Check again**.
- **A give-back still under way** (a card refund waiting, or money left to give back on an open
  correction) opens straight onto what is left to do, in staff words (D14). Find a bill's
  **Corrections under way** becomes **Money back under way** (D18).
- **After Cancel and refund or Finish table**, the window opens on **A dish** with the cancelled
  dishes ticked and their amount filled in, as Refund a payment opens filled in today (Task 9).
- **The Pay window's Refund** beside a part payment with its own ticket opens Give money back on that
  ticket, not Correct invoice (Task 9).
- **Messages** that name Refund a payment, Correct invoice or a correction are reworded (Task 10).
- **The accountant's spreadsheet** sheet "Refunds, no corrective invoice" gains a column naming the
  customer on the invoice, so a full invoice given back without a correction stands out (Task 5).
- **What is filed does not change.** The same plain refunds and corrective invoices as today.

## 3. What the stored "tip" really is (for the owner's wording question)

Traced, not run. The tip lives on the payment: `bill_payments.tip` before the invoice
(`packages/db/src/schema/bill-payments.ts:46`) and `tenders.tip_amount` after it, described in the
schema as "the payer's affirmed gratuity, non-taxable and on no invoice … the tip is a part of [the
charge], never on top" (`packages/db/src/schema/sales.ts:326-329`). It is **everything a payment
took above the money that went to the bill, less any change handed back**. It gets there five ways:

1. **Card: the till's "Tip on the card (optional)"** field (`apps/till/src/i18n/strings.ts:1940`),
   the request's `addedTip`.
2. **Card: paying more than is left of the bill.** A card contribution or item payment larger than
   what is left keeps the excess as tip by rule (`packages/orders-sales/src/bill-allocation.ts:168`:
   `ruleTip = due − applied` for a card).
3. **Items costing more than is left**, when staff choose "Pay {amount} with a {tip} tip"
   (`full_with_tip`, `bill-allocation.ts:178-179`; words at `strings.ts:2012`), cash or card.
4. **Cash: change the waiter marks "Leave as a tip"** — "Nothing: give it all as change", "All of
   the change" or "An amount" (`strings.ts:1956-1963`). Change handed back is **not** stored: it is
   worked out as `tendered − applied − tip` (`bill-payments.ts:28`).
5. **Card reader charged more than asked**: when the card company's captured amount is above the
   money applied to the bill, the difference becomes the tip (`apps/server/src/bill-payments.ts:2339`).

A venue that takes no tips stores none (`bill.tip_not_allowed`, `bill-allocation.ts:129-133`). The
printed receipt calls it "Propina" (`packages/country-es/src/receipt-labels.ts`), and the till's
payment window calls it "Tip". So the owner is right: ways 2, 3 and 5 are money paid over the bill
that nobody chose as a tip.

**Proposed words (O2, mine, open for the owner):**

| Where | English | Spanish |
| --- | --- | --- |
| Third choice (replaces "Just the tip") | **Extra paid on top of the bill** | **Lo pagado de más** |
| Its hint | Give back some or all of the {amount} paid on top of the bill, and nothing else. The receipt shows it as Tip. | Devuelve una parte o todos los {amount} pagados de más sobre la cuenta, y nada más. En el ticket figura como Propina. |
| The switch (replaces "Give back the tip too") | **Give back the extra paid on top too ({amount})** | **Devolver también lo pagado de más ({amount})** |
| The amount field | **Extra to give back** | **Pagado de más a devolver** |

"Cuenta" and "propina" are the words the till's Spanish already uses for the bill and the tip
(`strings.ts:4255-4269`). The receipt's printed "Propina" and the payment window's "Tip" are not
changed by this plan (outside the ask; say if they should be).

## 4. Every case where a give-back waits or is refused today (for the owner's question O1)

Each row is what today's routes do, which the new route inherits. "Run" rows were run on this branch
with `env -u CLAUDECODE -u AI_AGENT pnpm exec vitest run <file> -t "<name>"` in `apps/server` (or
`packages/fiscal-verifactu`); every one passed: 28 cases in `invoice-correction-api.test.ts`, 14 in
`clock-unconfirmed-gate.test.ts` and `tender-refund-api.test.ts`, 27 in `correction-admission.test.ts`,
4 in `tender-refund-links.test.ts`, `advance-corrections.test.ts` and `tender-refund-reservation.test.ts`.

**Not a wait — the owner's point.** A receipt AEAT has not answered yet (queued or being sent) is
corrected at once: `correction-admission.ts:10-15` maps `pendiente` and `enviando` to admitted;
run: "admits a replacement … as it admits an F2" (answers `queued`) and "first rechazado, fix
pendiente" (a fixed receipt whose fix is still queued is admitted).

**Waits (nothing moves; the same press works later):**

| # | When | What waits | What still goes back | Evidence |
| --- | --- | --- | --- | --- |
| W1 | AEAT **refused** the receipt, or the box holds it behind an earlier refused record, or set it aside (`rechazado`, `detenido`, `retenido`) | dish and goodwill money (the correction), and a plain refund of that money | money still owed for cancelled dishes, and the extra paid on top | run: "waits while the tax agency has refused the ticket's filing" (`sale.correction_not_admitted`, reason `filing_refused`); a throwaway probe added to that file, then removed: with the filing refused, €0.50 of the extra alone answered 200 completed, and €1.00 of payment money answered 409 `filing_refused` |
| W1 ends | when an administrator sends the fix from **Fiscal filing** on the dashboard (`apps/server/src/guide/en/fiscal-filing.md:32-47`); the fixed receipt is then admitted while its fix is queued | | | run: "first rechazado, fix pendiente" |
| W2 | another refund on this receipt is still **waiting for the card company** | dish and goodwill money, and a plain refund of it | cancelled-dish money and the extra, from another payment | run: "answers invoice_correction.refund_pending with 409", "waits while another payment's refund is pending" |
| W3 | a refund of **the same payment** is still waiting | everything from that payment, the extra included | other payments | run: "refuses a capture already reserved by another tender's pending row", "refuses a pending pre-invoice refund on the same capture" (`tender.refund_in_progress`) |
| W4 | a give-back on this receipt is **under way** (an open correction) | every other refund on the receipt, the extra included | nothing outside it; the new button opens what is under way instead (D14) | run: "refuses a refund with 409 while the ticket has an unfinished correction" (`invoice_correction.already_open`) |
| W5 | the box's **time is not confirmed** after a start | everything | nothing | run: "a new cash tender refund", "a new connected card tender refund", "a correction's cash leg", "a correction's File now": each refuses `clock.unconfirmed` |
| W6 | the box **cannot trade** (its time zone is missing or needs a restart), or its disk is full | everything, as for a sale | nothing | read: `requireEconomicWrite` (`apps/server/src/trading-admission.ts:26-33`, `venue.time_zone_not_ready`); full disk: the till's existing strip |
| W7 | the card company cannot refund yet (no partial refunds, unreachable) | that card | another payment | read: `tender.refund_unavailable` (`tender-refunds.ts:104-112`) |
| W8 | a part payment's own ticket, once the table's receipt took it off and that receipt still has money to give back | the part payment's money | the table's receipt's money, from that receipt | run: "refuses a plain refund of the advance while Correct invoice on the rest's invoice can still give money back" (`advance.taken_off_final_invoice`) |

**After the money moved:**

| # | When | What happens |
| --- | --- | --- |
| W9 | a card or separate-terminal leg finished but the corrective invoice could not be filed by itself | the give-back stays under way with the money back; a manager alert `invoice_correction.filing_refused` is raised (`invoice-correction-alerts.ts:159-219`); the under-way screen offers **Finish** |

**Never a wait — money goes back with no correction, staff see nothing different** (#4192's lasting
list, `refusesForGood`, `invoice-corrections.ts:170-182`): receipt filed by another box (run:
"takes it where Correct invoice refuses the ticket for good (wrong_node)"), no filing record (run:
"(missing)"), cancelled receipt (run: "(voided)"), replaced by a full invoice (run: "takes it on a
ticket a full invoice replaced"), a full invoice naming a customer (run: "is taken on an invoice
naming a customer"), records that need checking (run: "still gives money back through Refund a
payment while the invoice records need checking").

**O1 for the owner: what should staff see in W1–W8?** This plan builds only the window's ordinary
bottom message (the form contract: one message above the buttons, nothing moves) with one plain
sentence per row above, and changes nothing else. The choices for the owner, none built:

- (a) as built: the window opens as normal; pressing **Give back** shows the sentence, and nothing
  moves. Staff may try another choice (the extra, a cancelled dish) themselves;
- (b) the same sentence, shown as soon as the choice screen opens, before staff type anything;
- (c) give back now whatever can go (the cancelled dishes' money and the extra) and say the rest must
  wait. That changes no filing rule but splits one press into two outcomes.

The house rule on refusals (never send the person to somebody else, `docs/developers/conventions-ui.md:8-20`)
applies to W1's sentence: it names the page (**Fiscal filing**, on the dashboard), not a person.
Proposed W1 sentence (mine): EN "The tax agency refused this receipt, so money for dishes or
goodwill cannot go back until the receipt is fixed in Fiscal filing, on the dashboard. Money owed for
cancelled dishes and the extra paid on top can still go back." ES "La Agencia Tributaria rechazó
este ticket, así que el dinero de platos o por cortesía no se puede devolver hasta que se corrija en
Presentación fiscal, en el panel. El dinero de platos cancelados y lo pagado de más sí se pueden
devolver." (Task 10 checks the dashboard page's real Spanish name before using it.)

## 5. Design

### 5.1 D5 (mine): one read, one preview, one write, on the server

All three in a new `apps/server/src/give-back.ts` (logic) and `apps/server/src/give-back-api.ts`
(routes, mounted beside `mountInvoiceCorrectionApi`).

**`GET /api/transactions/:saleId/give-back`** — what the window lists:

```ts
{
  lines: { id: string; descriptions: Record<string, string>; quantity: string; gross: string;
           /** what is left to give back for it: Correct invoice's `left` where it can read the
            *  receipt, else `gross` */
           left: string;
           cancelled: { quantity: string; owed: string } | null;  // cancels with Refund ticked
           givenFree: boolean }[];
  payments: { tenderId: string; method: "cash" | "card"; last4: string | null; manual: boolean;
              moneyLeft: string; extraLeft: string; pendingRefundId: string | null;
              allowedHere: boolean }[];
  underWay: InvoiceCorrectionView | null;  // the open correction, if any
}
```

`cancelled` comes from the cancels still owed (`readCancelsStillOwed`,
`packages/adjustments/src/refund-links.ts:92-104`) mapped to the receipt's lines through the
portion bindings that `apps/server/src/cancellation-refund-value.ts:195-215` already reads
(`readPortionBindings`). `givenFree` uses the same test as the corrections workbook
(`apps/server/src/free-items.ts:45`). `moneyLeft`/`extraLeft` are `appliedRemaining`/`tipRemaining`
from `readRefundableTenders`. `allowedHere` is `refundMethodAllowed` against this device's profile,
as the till works it out today (`apps/till/src/till-app.ts:9625-9627`), moved to the server.

**`POST /api/transactions/:saleId/give-back/preview`** — what pressing would do, writing nothing:

```ts
// request
{ purpose: "dishes" | "goodwill" | "extra"; lineIds?: string[]; amount: string;
  extra: string; tenderId: string }
// answer
{ parts: { kind: "refund" | "extra" | "correction"; amount: string }[];
  needs: ("sale.refund" | "sale.rectify")[];   // rights the route needs that this person lacks
  manual: boolean }
```

A wait (section 4) answers with its own code, as today.

**`POST /api/transactions/:saleId/give-back`** — the same body plus
`{ reasonId, note, submissionIds: { refund, extra, correction, leg }, expected: parts,
manualConfirmed?, override? }`. It refuses the new `give_back.changed` (409) when the parts it works
out now differ from `expected` (what the preview showed staff). It answers:

```ts
{ parts: { kind; amount; state: "completed" | "pending" | "not_started";
           refundId?: string; correctionId?: string }[];
  underWay: InvoiceCorrectionView | null;
  rest: null | { purpose; lineIds?; amount; extra; tenderId } }  // what is still to send
```

**The old routes stay** (D17, mine): `POST …/refunds`, `…/corrections`, `/cash`, `/file`, `/close`
are the building blocks the new route calls and the fixtures of hundreds of tests. The till stops
calling `…/corrections` and the plain-refund form of `…/refunds` for new give-backs; the under-way
screen keeps using `/cash`, the correction-leg form of `…/refunds`, `/file` and `/close`.

### 5.2 D6 (mine): the routing, which is #4192's rules applied in order

For one give-back from one payment (D10):

1. **Cancelled dishes** (purpose `dishes`): for the ticked lines with `cancelled`, the plain-refund
   part is `min(amount, what their cancels still owe)`, naming those cancels (`cancellationIds`), so
   the links are exact. #4192's limit admits it with no correction (`plainRefundLimit` returns at
   once when the refund is within what the named cancels owe, `tender-refund-reservation.ts:171`).
2. **The extra** (purpose `extra`, or the switch on): a plain refund of the extra alone (applied
   0, tip = extra). #4192: a tip alone needs no correction (`tenderRefundAmountsFit`, `:277-284`).
3. **The rest** of the amount (served dishes, goodwill, more than the ticked dishes): a correction.
   For `dishes`, its `lineIds` are the ticked lines that are not wholly cancelled-and-owed; with
   none left (only cancelled dishes ticked), it names no lines, so the amount is shared over the
   receipt by menu price (#4192's O1). For `goodwill` it names no lines.
4. **Where Correct invoice can never act** (`correctableNow` answers `correctable: 0` through
   `refusesForGood`), the rest goes as a plain refund instead, as Refund a payment does today.
5. **Where Correct invoice would only wait** (`correctableNow` throws: W1, W2, the clock), the
   route refuses with that code. Parts 1 and 2 do not wait on it: they never reach
   `correctableNow` (run: section 4, W1 probe).
6. **More than the correction can take now** (`correctable` below the rest): the excess goes as a
   plain refund only where `plainRefundLimit` already allows it; otherwise the route refuses with
   `invoice_correction.money_short`, as Open correction does today.

Order on the wire is always 1, 2, then 3: a plain refund is refused while a correction is open
(`tender-refund-reservation.ts:373`), and a correction cannot open while a refund is pending
(`invoice-corrections.ts:155-159`).

A partly cancelled line (2 croquetas, 1 cancelled with Refund ticked) gives part 1 for the cancelled
one and puts the line in part 3's `lineIds`. Part 3 can then take the line's whole `left`, the
cancelled portion included, because `left` does not know about plain refunds. Correct invoice with
that line ticked does the same today (read: `readCorrectableLines`, `packages/core/src/correction-history.ts:77-93`),
so this is no change; it is stated so the reader does not take it for one.

### 5.3 D7 (mine): which writes share a transaction

- **Cash:** every part in **one transaction**: plain refunds reserved and completed
  (`reserveTenderRefund`, `completeRefundReservation`), then `openInvoiceCorrection`, then
  `giveCorrectionCash` (`apps/server/src/invoice-correction-cash.ts:64`), which files the corrective
  invoice in that same transaction once all its money is back. A refused filing undoes the whole
  give-back, as it undoes the cash today. **The drawer opens once** (D7a, mine): only the last cash
  write enqueues a drawer job; the others pass no `openDrawer`. CLAUDE.md §5's "cash enqueues a
  separate audited drawer job" still holds: one job, linked to that refund.
- **Separate terminal:** staff have already refunded the total on the terminal. Every part's refund
  is written and completed in one transaction (manual refunds complete at once,
  `tender-refund-completion.ts:51-66`), then committed; the corrective invoice is filed **after**,
  by `fileCorrectionAutomatically`, as `refundSettledTender` does today
  (`apps/server/src/tender-refunds.ts:142-152`). Filing inside the transaction would undo the record
  of money that has already left the terminal.
- **Card reader:** the card company is asked between parts, so the parts run **in sequence, each in
  its own transaction**, each through today's `refundSettledTender` path (one card company request
  per part, answered within the request in the usual case, `tender-refunds.ts:155-176`). When a part
  comes back completed the route goes on to the next; when one stays pending it stops and answers
  `rest`. **This split across transactions is a commented decision** (CLAUDE.md §3: "Splitting one
  logical change across transactions is a commented decision, never a default"), stated at the
  function: a database transaction must not stay open across a card company's answer.
  A refusal of a later part after an earlier one completed answers what went back and the refusal
  for the rest; nothing is undone.

Why two refunds rather than one on a card reader (D20, mine): a correction's leg may not carry a tip
(`invoice-correction-legs.ts:147`), and a plain refund may carry a tip only with all the payment's
money (`refundAmountsFit`, `tender-refund-reservation.ts:271-273`). Relaxing either is a money rule
nobody has asked for; question W4 offers it.

### 5.4 D8 (mine): one PIN

The route works out the rights its parts need: `sale.refund` for any plain refund not covered by the
cancel's approval (D9) and for every leg; `sale.rectify` to open a correction. It checks an
approver's PIN once, ahead of the transaction (`overrideToCheck` with `checkedAnyway = true`,
`withPinCheckAhead`, `apps/server/src/pin-check-ahead.ts:55-74`), then authorizes each right inside
the transaction with that one check (`withCheck`). The device checks are today's, as `withTenderRefundAuthorization` makes them
(`apps/server/src/tender-refund-authorization.ts:129-155`): the person still signed in on this
device, not a kitchen screen, admitted to the device's profile, the receipt's zones, and the
profile taking that kind of payment (`assertTakesTender`). Task 3 moves those lines into one
function both routes call, leaving the existing refund tests unchanged and passing.
A missing right refuses `authorization.not_permitted` naming the first one missing, as today; the
preview's `needs` tells the till all of them. `GET /api/adjustment-approvers` (`apps/server/src/adjustments-api.ts:311-320`)
accepts `permission` more than once and answers the people who hold **all** of them.

A separate terminal always asks for a fresh PIN to confirm the terminal refund, as today
(`confirmManualRefundAuthority`, `tender-refund-authorization.ts:89-110`).

### 5.5 D9 (mine, for the watcher): a cancelled dish's money is covered by the cancel's approval

Today the cancel's approval covers a refund only from the window that opens filled in after Cancel
and refund; a refund typed later from the receipt asks for refund rights or a PIN (guide,
`apps/server/src/guide/en/table-service.md:375-385`). Because the new route always names the ticked
cancelled dishes' cancels (5.2 step 1), `reserveTenderRefund`'s existing rule
(`covered = allocation !== undefined && tipAmount === 0 && appliedAmount <= allocation.canStillTake`,
`tender-refund-reservation.ts:487-488`) covers it whenever only cancelled dishes are given back, up to
what they owe, with no extra. The money was approved to go back when the dish was cancelled, by
someone holding refund rights or their PIN. This loosens who may press, so it is question W1 for the
watcher; the alternative keeps today's rule by passing the cover only on the filled window.

### 5.6 The till

- **One new window**, `apps/till/src/widgets/give-back-dialog.ts`, with its state in
  `apps/till/src/state/give-back.ts` (the saved attempt: the request, its submission ids and any
  `rest`, kept like `apps/till/src/state/tender-refund.ts` keeps a refund's, so a lost answer is sent
  again with the same ids). It has three steps: the choice (`wt-choice-row`), the form, and the
  outcome. The under-way view is a fourth state of the same window.
- **The form** follows design-system.md → Forms: required fields marked; inline errors; one bottom
  message; **Give back** disabled until valid. The amount is capped at the chosen payment's money
  (plus its extra with the switch on) with the hint "Up to €X can go back"; the reason list is the
  one Correct invoice uses today; **How it goes back** is native radios, as `bill-refund-dialog.ts`
  uses. On each change of dishes, amount, switch or payment the window asks the preview; the summary
  box and the PIN line come from its answer.
- **Labels on the dishes (D11, mine):** "Cancelled, not served" (ES "Cancelado, no servido") where a
  cancel with Refund ticked still owes money, and "Given free" (no switch). Other dishes carry no
  label: the drawn "Served" would be a guess, since a bill can be paid with dishes not marked served
  (**Print anyway**, `table-service.md:694-699`). This departs from the screens the owner approved;
  question W3.
- **The VAT split** Correct invoice shows today is not shown (D16, mine, the mock's default). The
  server no longer needs the till to echo it: `expected` parts take its place as the check that what
  staff saw is what happens.
- **The under-way view (D14, mine)** replaces Correct invoice's carry-on view
  (`apps/till/src/widgets/invoice-correction-dialog.ts:746-891`), using the same requests
  (`InvoiceCorrectionSession`, `apps/till/src/state/invoice-correction.ts`). Words:

| Today | New, English | New, Spanish |
| --- | --- | --- |
| Correct invoice (title) | Money back under way | Devolución en curso |
| Give back €X in cash | Give back €X in cash (unchanged) | Devolver X € en efectivo (unchanged) |
| Refund to card | Give back €X to card ···4242 (sends the leg from this window, with the terminal step when the card was keyed on a separate terminal) | Devolver X € a la tarjeta ···4242 |
| Record correction / Close keeping the refunds | **Finish** — hint "Records the €X given back." (the till sends `/file` when the read offers a filing, `/close` when it says filing can never happen; the server refuses the wrong one, `still_correctable`) | **Terminar** — "Registra los X € devueltos." |
| Finish now | **Stop here** — "Keeps the €X already given back; gives no more back." | **Terminar aquí** — "Se quedan los X € ya devueltos; no se devuelve más." |
| Discard | **Cancel this money back** — "Nothing has gone back yet." | **Anular esta devolución** — "Aún no se ha devuelto nada." |

  Closing the window ends nothing by itself (mine; the mock note proposed discarding on close).
- **A two-step card give-back (D7):** when the answer has a `rest`, the outcome says "€X is back.
  €Y follows when the card company answers." with **Check again**, which reads the pending refund
  (`GET /api/tender-refunds/:id`) and, once it completed, asks the preview for the rest and sends it
  with the saved ids. Opening Give money back on the receipt later opens this same state.
- **Paper (D15, mine):** unchanged. A cash correction prints its corrective receipt as today
  (`fileCorrectionIn`'s `print`, `invoice-corrections.ts:416-484`); a card one does not, and the
  outcome says it can be printed from Find a bill. The mock's uniform **Print** (note 12) is not
  built.
- **One payment per give-back (D10, mine):** the mock's note 8 (fill from other payments) is not
  built. To give back more than one payment holds, staff give back twice, choosing the other
  payment the second time; that files two corrective invoices instead of one. Question W2.
- **A part payment's ticket (D19, mine):** when the table's receipt must go first (W8), the message
  names that receipt's number; the mock note 9's "open it" button is not built.
- **A dish not served yet on a seated table** (mock note 5): not built. Void… on the table stays the
  way to stop the kitchen; ticking such a dish gives its money back as a dish.

### 5.7 D3 (owner's): a full invoice naming a customer

The route sends its money back as a plain refund with no correction (5.2 step 4: `not_simplified`
refuses for good, run: "is taken on an invoice naming a customer"). **Listed for the accountant**
(mine, the smallest form of the owner's "list it"): the accountant spreadsheet's sheet "Refunds, no
corrective invoice" (`apps/server/src/accountant-export.ts:413`, columns at
`apps/server/src/i18n/accountant-export.ts:32-46`) gains one column, **Customer on the invoice**
(ES **Cliente de la factura**): the customer's name and tax number from the sale, empty for a
simplified ticket. Read from the immutable sale at export time; nothing is stored. CORRECT-FULL-INVOICE
replaces this when it lands.

## 6. Fiscal boundary, and the checks every task runs

**What is filed does not change.** The route calls `recordCorrection` only through today's
`fileCorrectionIn`, with the same amounts and lines the old buttons would have sent for the same
money. `computeHuella`, the chain, numbering, series, the records table and its triggers are not
touched. No migration, schema change or new table: the till keeps the two-step `rest`, and the
existing `refunds.submission_id` and `invoice_corrections.submission_id` make every part replay-safe.

Every PR 1 task runs, unedited and passing, and reads the Tests count:

```sh
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
```

## 7. Test checks expected to change

**Server (PR 1): no existing assertion changes.** The new routes are additions. Additions to guard
lists, each a new row, not a changed one:

- `apps/server/src/till-api.profile-actions.test.ts` and `till-api.profile-zones.test.ts`: the three
  new routes' refusing cases and inventory rows (CLAUDE.md §3).
- `apps/server/src/till-api.session-person.test.ts`: the two POST routes in `BODIES`.
- `apps/server/src/adjustments-api.test.ts` (or wherever `/api/adjustment-approvers` is tested): a
  case for two permissions.
- `apps/server/src/accountant-export.test.ts`: the refunds sheet's header and rows gain the column
  (a changed check: the sheet's column list is pinned).

**Till (PR 2), each with the decision behind it:**

- `apps/till/src/screens/till-ticket-view.test.ts`: the `data-tender-refund` and
  `data-invoice-correction` buttons become one `data-give-back` (D1, owner's).
- `apps/till/src/till-app-adjustments.test.ts:4088-4789`, `till-app.test.ts:26182`, `:28060`,
  `till-app-parties.test.ts:14275`: cases that emit `tender-refund-open` or
  `invoice-correction-open` now emit `give-back-open` and drive the new window. **Their behavioural
  assertions are kept** (CLAUDE.md: preserve behavioural assertions): the filled-in refund after a
  cancel sends the cancel's ids and needs no PIN; a device that does not take that payment says so;
  a lost answer is sent again with the same id; a pending refund offers Check again.
- `apps/till/src/i18n/codes.test.ts`, `refund-wording.test.ts`: messages naming the old buttons
  (Task 10's list).
- `apps/till/src/help-guide.test.ts`, `scripts/guide-links.test.ts`,
  `apps/server/src/guide-content.test.ts`, `apps/server/src/guide-pages.test.ts:110`: the guide
  anchors (`correct-invoice`, `refund-receipt` → `give-money-back`; `separate-terminal` kept).
- Find a bill's tests that read "Corrections under way" or "Corrective" (D18).

**PR 3:** the deleted windows' own test files go with them; before deleting, Task 12 lists every
behavioural case in them and names the give-back test that now holds it (CLAUDE.md §4, "Re-run
deletion controls after restructuring").

## 8. Tasks

**Risk triggers:** money given back on the sale path, the choice between a corrective invoice and a
plain refund, and permissions and PINs. So the full path: per-task review, and `/finish-branch` with
two Codex run-it reviews side by side on each PR. The owner lands every PR (fiscal).

**Each task:** the failing test first, watched failing, then the change; then
`pnpm exec prettier --check <changed files>` and, in PR 1, the section 6 command. Till suites run real
headless Chromium: check `memory_pressure | grep free` first (CLAUDE.md §2). Run Vitest with
`env -u CLAUDECODE -u AI_AGENT` to see a passing test's output, and read both the "Test Files" and
"Tests" counts: a misspelt file name is skipped and the run still passes. Use
`pnpm exec vitest run <file> -t "<name>"`, never `pnpm test <file> -t` (it drops the `-t`). Every
existing file named below was checked with `ls` on this branch. Each task is sized for one implementer
well under 100 tool calls; one that passes about 150 stops at a passing point, commits and hands over.

### PR 1 — server: the give-back read, preview and write (Tasks 1–5)

#### Task 1: the read — about 50 calls

Files: new `apps/server/src/give-back.ts`, `apps/server/src/give-back.test.ts`.

1. Tests first, on a real venue (`useVenueDb`), each asserting the read's lines and payments:
   - a receipt with five dishes, one cancelled with Refund ticked (owed 18.50): that line's
     `cancelled` is `{ quantity: "1.000", owed: "18.50" }`, the others `null`;
   - 2 croquetas with 1 cancelled: `cancelled.quantity` is 1;
   - a cancel without Refund ticked (charge kept): `cancelled` is `null`;
   - a cancel already paid back in full: `cancelled` is `null`;
   - a dish given free: `givenFree: true`;
   - a cash payment with a 3.00 tip: `moneyLeft`, `extraLeft: "3.00"`; after a 1.00 refund of the
     extra, `extraLeft: "2.00"`;
   - a hand-keyed card: `manual: true`; a device whose profile takes no cards: `allowedHere: false`;
   - a receipt filed by another box: lines still listed, `left` equals `gross`;
   - an open correction: `underWay` is that correction's view.
   Run, watch them fail (no module).
2. Write `readGiveBack(tx, backend, cfg, saleId)` from `readRefundableTenders`,
   `readCancelsStillOwed` + `readCancelsForRefund`, the portion bindings
   (`cancellation-refund-value.ts:195-215`), `readCorrectableLines` (catching a lasting refusal to
   fall back to `gross`), `openCorrectionOf` + `readInvoiceCorrection`, and `refundMethodAllowed`.
3. `pnpm --filter @waitron/server exec vitest run src/give-back.test.ts`

#### Task 2: the routing and the preview — about 70 calls

Files: `apps/server/src/give-back.ts`, `give-back.test.ts`.

1. Tests first, for `planGiveBack(tx, backend, cfg, reading, saleId, ask)`, each asserting `parts`
   and `needs`, and that nothing was written:
   - paella (cancelled, owed 18.50) and cheesecake (6.00) ticked, 24.50: `refund 18.50`,
     `correction 6.00`;
   - paella alone, 18.50: `refund 18.50`; 20.00: `refund 18.50`, `correction 1.50` (no lines);
   - paella alone, 10.00: `refund 10.00`;
   - goodwill 10.00: `correction 10.00`; with the switch and a 3.00 extra: `extra 3.00` first;
   - extra 2.00: `extra 2.00`; extra 4.00 of 3.00: refused `tender.refund_exceeds_payment`;
   - goodwill on a receipt filed by another box, on a full invoice naming a customer, and with the
     records needing checking: `refund 10.00`, no correction;
   - goodwill with AEAT's refusal (`refusedByAeat`, as `invoice-correction-api.test.ts:1305-1312`
     builds it): refused `sale.correction_not_admitted` reason `filing_refused`; the extra alone on
     the same receipt: `extra`; paella alone: `refund`;
   - goodwill while another payment's refund is pending: refused `invoice_correction.refund_pending`;
   - anything while a correction is open: refused `invoice_correction.already_open`;
   - an amount above the chosen payment's money: refused `invalid("amount")`;
   - `needs`: a person with refund rights only, for goodwill: `["sale.rectify"]`; for paella alone
     within what it owes: `[]` (D9); with the extra too: `["sale.refund"]` for a person with neither.
   Run, watch them fail.
2. Write `planGiveBack` (section 5.2), calling `correctableNow` with a `stillRefused` that says
   whether the rest would otherwise be refused, and `allocateToCancels` for the cancelled part.
3. Mount `POST /api/transactions/:saleId/give-back/preview` and the read in new
   `give-back-api.ts`, with `requireSession` (`passive: true` for the read) and `checkAccess`, as
   `invoice-correction-api.ts:73-101` does; route tests for 200, a 409 wait, and a till outside the
   receipt's zone.
4. ```sh
   pnpm --filter @waitron/server exec vitest run src/give-back.test.ts src/give-back-api.test.ts
   ```

#### Task 3: the write for cash and a separate terminal — about 80 calls

Files: `give-back.ts`, `give-back-api.ts`, their tests; `apps/server/src/errors.ts`.

1. Tests first, through the route, each refusal asserting its code **and** that no `refunds` row, no
   `invoice_corrections` row and no drawer job was written:
   - cash, paella + cheesecake, 24.50: one plain refund of 18.50 linked to the paella's cancel, one
     correction of 6.00 filed with its corrective invoice, **one** drawer job, all in the answer as
     `completed`; the cash drawer entry totals −24.50;
   - cash goodwill 10.00 with the switch (3.00): plain refund of the extra alone, then the correction
     filed; one drawer job;
   - cash goodwill where filing the corrective is refused inside the transaction (spy on
     `recordCorrection` throwing): nothing written at all, the extra included;
   - `expected` that differs from the parts now (another till gave back the paella in between):
     `give_back.changed`, nothing written;
   - a replay with the same submission ids answers the first result and writes nothing more; the
     same ids with a different amount: `submission.id_reused`;
   - separate terminal, goodwill 10.00, `manualConfirmed: true`, supervisor PIN: the leg completed,
     then the corrective invoice filed after commit; with `fileCorrectionAutomatically` refused (spy),
     the leg stays completed and the answer's `underWay` shows the open correction (W9);
   - separate terminal without `manualConfirmed`: `invalid("manualConfirmed")`, nothing written;
   - PIN: a waiter with refund rights only, goodwill, no override: `authorization.not_permitted`
     naming `sale.rectify`; with a supervisor holding both: done, one PIN check (spy
     `withPinCheckAhead` called once); a supervisor holding only `sale.refund`: refused;
   - D9: a waiter without refund rights, paella alone within what it owes: done with no PIN, the
     refund's `authorized_by` the cancel's approver; paella plus the extra: asks for the PIN;
   - clock not confirmed: `clock.unconfirmed`, nothing written.
   Run, watch them fail.
2. Write `giveBack` for cash and separate terminals (section 5.3), the one-PIN authorization (5.4),
   `give_back.changed` in `errors.ts` with 409 in the route's boundary. Calls only existing write
   functions, so `scripts/write-path-tables.json` needs no change (check by running it).
3. ```sh
   pnpm --filter @waitron/server exec vitest run src/give-back.test.ts src/give-back-api.test.ts src/invoice-correction-api.test.ts src/tender-refund-api.test.ts
   pnpm exec vitest run scripts/errors-reachable.test.ts scripts/write-path-tables.test.ts
   ```

#### Task 4: the write for a card reader — about 60 calls

Files: `give-back.ts`, `give-back.test.ts`.

1. Tests first, with the simulated card provider the tender refund tests use
   (`tender-refund-api.test.ts`'s reader sales):
   - reader, goodwill 10.00 with the extra 3.00: two provider refunds in order (extra, then the leg),
     the corrective invoice filed, both `completed`, `rest: null`;
   - the same with the first refund left pending by the provider: answer `extra pending`,
     `correction not_started`, `rest` = the goodwill part; nothing else written; after the provider
     completes it, sending `rest` with the saved ids finishes the give-back;
   - a refusal of the second part after the first completed (the clock stops between them, as
     `clock-unconfirmed-gate.test.ts:1216-1260` stages it): the first stays completed, the answer
     names the refusal for the rest;
   - reader, paella + cheesecake: refund then correction leg, in order.
   Run, watch them fail.
2. Write the card-reader sequence with the comment that states the split across transactions
   (5.3). Each part goes through `refundSettledTender`; the correction opens in its own transaction
   just before its leg.
3. The Task 3 command.

#### Task 5: approvers for two rights, inventories, the accountant column — about 45 calls

Files: `apps/server/src/adjustments-api.ts`, `apps/server/src/accountant-export.ts`,
`apps/server/src/i18n/accountant-export.ts`, the three guard suites of section 7, their tests.

1. Tests first: `GET /api/adjustment-approvers?permission=sale.refund&permission=sale.rectify`
   answers only people holding both, and one `permission` behaves as today; the accountant sheet's
   new column holds the customer's name and tax number for a full invoice's refund and is empty for
   a simplified ticket's; the inventory and session-person rows for the three new routes.
   Run, watch them fail.
2. Make the changes. The column's English and Spanish headings go in the export's i18n file.
3. ```sh
   pnpm --filter @waitron/server exec vitest run src/adjustments-api.test.ts src/accountant-export.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts src/till-api.session-person.test.ts
   ```

### PR 2 — till: the window, the receipt button, the under-way view, messages and guides (Tasks 6–11)

Depends on PR 1 on `main`.

#### Task 6: the window's choice and forms, without sending — about 80 calls

Files: new `apps/till/src/widgets/give-back-dialog.ts`, `.test.ts`, `.a11y.test.ts`,
`.unsaved.test.ts`; `apps/till/src/i18n/strings.ts`; `apps/till/src/api/client.ts` (the read and
the preview).

1. Tests first: the three choices, the extra's row showing its amount and absent when no payment has
   an extra; **A dish** lists the lines with D11's labels and the given-free one without a switch;
   ticking sets the amount to the ticked lines' `left`, and editing it keeps the edit; the amount's
   inline error above the chosen payment's money; the switch adds the extra and its words (O2); the
   summary box shows what the preview answered, and the PIN line only when `needs` is not empty;
   **Give back** disabled until valid; English and Spanish; axe in both themes for each step;
   leaving with a typed amount asks first (`*.unsaved.test.ts`, as `tender-refund-dialog.unsaved.test.ts`).
   Run, watch them fail.
2. Write the window and the client methods. All words in `strings.ts`, English and Spanish, under
   `give_back.*`; Spanish starts from the mock's (pictures `*-es-*`), with section 3's words for the
   extra.
3. ```sh
   pnpm --filter @waitron/till exec vitest run src/widgets/give-back-dialog.test.ts src/widgets/give-back-dialog.a11y.test.ts src/widgets/give-back-dialog.unsaved.test.ts src/i18n/strings.test.ts
   ```

#### Task 7: sending, the PIN, the separate terminal and the outcome — about 85 calls

Files: new `apps/till/src/state/give-back.ts` and test; `give-back-dialog.ts`; `apps/till/src/till-app.ts`;
`client.ts`.

1. Tests first: the saved attempt keeps the request and four submission ids; a lost answer is sent
   again with the same ids (as `apps/till/src/state/tender-refund.test.ts` does for a refund); the
   approvers list asks for every right in `needs`; a wrong PIN shows its error in place; a hand-keyed
   payment shows the terminal step (tick and words of picture g) only after the preview answered,
   and sends `manualConfirmed`; the outcome words for cash, card, pending and `rest` (D7);
   `give_back.changed` shows its message and the new preview; each wait code of section 4 shows its
   sentence at the bottom and nothing else changes (O1 (a)).
   Run, watch them fail.
2. Write the state, the send, the approver step (`till-supervisor-override-dialog`, as
   `till-app.ts:10071-10100` uses it) and the outcome. Add `give_back.changed` and the wait sentences
   to `codes.ts`.
3. ```sh
   pnpm --filter @waitron/till exec vitest run src/state/give-back.test.ts src/widgets/give-back-dialog.test.ts src/i18n/codes.test.ts
   ```

#### Task 8: the under-way view — about 60 calls

Files: `give-back-dialog.ts` and its tests; `apps/till/src/state/invoice-correction.ts` (reused).

1. Tests first, moving the behavioural cases of `invoice-correction-dialog.test.ts`'s carry-on view
   (back so far, left, pending, Check again, give cash, card leg refused or changed, end refusals,
   Send again) to the new view with D14's words: **Finish** sends `/file` when the read offers a
   filing and `/close` when it says filing can never happen; **Stop here** sends `/file` with money
   left; **Cancel this money back** appears only with nothing back or pending; the card leg sends from
   this window, with the terminal step for a hand-keyed card.
   Run, watch them fail.
2. Write the view.
3. ```sh
   pnpm --filter @waitron/till exec vitest run src/widgets/give-back-dialog.test.ts src/state/invoice-correction.test.ts
   ```

#### Task 9: the receipt button, Find a bill, the filled window and the part payment — about 90 calls

Files: `apps/till/src/screens/till-ticket-view.ts` and test; `apps/till/src/till-app.ts`;
`till-app-adjustments.test.ts`, `till-app.test.ts`, `till-app-parties.test.ts`; `strings.ts`.

1. Tests first: the receipt shows one **Give money back** (`data-give-back`) where it showed the two
   buttons; it opens the choice, or the under-way view when `underWay` is set, or the two-step state
   when a `rest` is saved; Find a bill's row under **Money back under way** opens the under-way view;
   after Cancel and refund (and Finish table's per-receipt Refund) the window opens on **A dish** with
   the cancelled lines ticked, the amount they owe and the cancel's reason, and sends with no PIN
   (D9); the Pay window's **Refund** beside a part payment with its own ticket opens Give money back
   on that ticket (`till-app.ts:23913-23946`); Find a bill's words (D18). The existing cases of
   section 7 are rewritten here, keeping their behavioural assertions.
   Run, watch them fail.
2. Make the changes. `#openTenderRefund` and `#openInvoiceCorrection` stop being reached from the
   receipt, Find a bill and the Pay window; leave them in place for PR 3.
3. ```sh
   pnpm --filter @waitron/till exec vitest run src/screens/till-ticket-view.test.ts src/till-app-adjustments.test.ts src/till-app.test.ts src/till-app-parties.test.ts
   ```

#### Task 10: messages that name the old buttons — about 45 calls

Files: `apps/till/src/i18n/codes.ts`, `strings.ts`, `help-strings.ts`, their tests.

1. Tests first in `codes.test.ts` / `refund-wording.test.ts`: no English message names "Correct
   invoice", "Refund a payment" or "corrective", and no Spanish one names "Rectificar factura" or
   "Devolver un pago", except the printed paper's "Factura rectificativa" and messages shown only on
   the dashboard. Run, watch it fail.
2. Reword, in staff words, every message the grep finds (`git grep -n -i -E 'correct invoice|refund a
   payment|corrective|correction' -- apps/till/src/i18n/`): the `invoice_correction.*` codes
   (`codes.ts:480-557`), `tender.refund_needs_correction`, the part-payment messages (`:669-681`,
   `:1141-1171`), the free-item messages (`:1105`, `:1127`; `strings.ts:106`), "Refund the payment at
   a till" (`strings.ts:98`), the not-served notes (`codes.ts:617`, `strings.ts:1878`), and
   `CORRECTION_NOT_ADMITTED` (`codes.ts:1063-1095`) with W1's sentence. The help bubble
   (`help-strings.ts:15`, `:84`) becomes "Give money back to a guest: for a dish, as goodwill, or
   the extra paid on top. Waitron records it the right way." and its Spanish twin.
3. `pnpm --filter @waitron/till exec vitest run src/i18n/`

#### Task 11: both till guides — about 40 calls

Files: `apps/server/src/guide/en/table-service.md`, `apps/server/src/guide/es/table-service.md`,
`apps/till/src/help-guide.ts`.

1. Replace **Refund a payment on a receipt** `{#refund-receipt}` and **Correct an invoice**
   `{#correct-invoice}` (`en/table-service.md:353-432`, `es/…:372-…`) with one **Give money back**
   `{#give-money-back}` section in each language: the three choices, the switch, How it goes back,
   one PIN, the separate terminal, the under-way view's three buttons. Per the house rule, only what
   changes what staff do: no routing explanation. Change the one-line mentions in **Refund all or part
   of a payment** (`:266-267`), **Cancel a dish on a paid bill** (`:321-323`), **Finish a paid
   table** (`:338-344`) and the not-served paragraph (`:697-699`). Point `help-guide.ts`'s link at
   `give-money-back`.
2. ```sh
   pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts src/guide-box-word.test.ts
   pnpm --filter @waitron/till exec vitest run src/help-guide.test.ts
   pnpm exec vitest run scripts/guide-links.test.ts
   ```

### PR 3 — till: remove the two old windows (Task 12)

#### Task 12: delete Refund a payment and Correct invoice from the till — about 60 calls

1. List every behavioural case in `tender-refund-dialog*.test.ts` and `invoice-correction-dialog*.test.ts`
   and name the give-back test that holds it; add any missing one to the give-back tests first, and
   watch it fail with the case's code path removed (proof by deletion).
2. Delete `apps/till/src/widgets/tender-refund-dialog*.ts`, `invoice-correction-dialog*.ts`, the
   till-app code that only they reach (`#openTenderRefund`, `#openInvoiceCorrection`,
   `#renderTenderRefund`, `#renderInvoiceCorrection`, `tenderRefunding`, `invoiceCorrecting`), the
   strings only they used (`tender_refund.*`, `invoice_correction.*` keys no longer read; the
   strings guard finds unused ones), and `apps/till/src/state/tender-refund.ts` if nothing else
   reads it.
3. ```sh
   pnpm --filter @waitron/till exec vitest run src/widgets/give-back-dialog.test.ts src/till-app-adjustments.test.ts src/till-app.test.ts src/i18n/
   pnpm --filter @waitron/till typecheck
   ```

**Docs, in the PR whose change makes them stale:** `docs/backlog/till.md` and `docs/backlog/fiscal.md`
entries naming the two buttons (PR 2); a dated pointer in the A802 design and in question 14 of the
adviser sheet (`docs/compliance/2026-11-19-adviser-meeting.md`) saying the buttons became one (PR 2);
`docs/developers/design-system.md`'s notes on the two windows (PR 3). Delete the queue's backlog
entry when PR 3 lands.

## 9. Size and order

| PR | Tasks | Production lines | Test lines | Risk |
| --- | --- | --- | --- | --- |
| 1 server | 1–5 | ~500 added | ~1,100 added | money, correctives, PINs |
| 2 till | 6–11 | ~900 added, ~300 changed | ~1,400 added or rewritten | money, PINs |
| 3 till | 12 | ~3,000 removed | ~3,700 removed | none new |

PR 1 lands first; PR 2 needs its routes. PR 2 is large because the till must stay consistent: the
receipt, the filled window, the messages and the guides all change together. A1564 (custom item) is
editing `apps/till/src/till-app.ts` in lane L; expect rebases there. No open pull request touches
the other files (`gh pr list`, run).

## 10. Open questions

**For the owner:**

- **O1** — what staff see when a give-back must wait (section 4). Built meanwhile: option (a).
- **O2** — the words for the extra paid on top (section 3).

**For the watcher:**

- **W1** — D9: let the cancel's approval cover a cancelled dish's money whenever it is ticked, not
  only from the filled window. Default: yes.
- **W2** — D10: one payment per give-back. Default: yes; the mock's "fill from the others" later.
- **W3** — D11: no "Served" label (the drawn screen has one). Default: no label.
- **W4** — D20: on a card reader, a dish and the extra go as two card refunds in sequence (one press
  in the usual case). The alternative lets one refund carry the extra with part of the payment's
  money, a money rule change. Default: two refunds.
- **W5** — D15: paper unchanged (the mock's uniform **Print** not built). Default: unchanged.

## 11. Not established

- Whether two completed manual refunds against the same hand-keyed capture in one transaction pass
  `recordManualRefund` (Task 3's separate-terminal case will show it).
- The Spanish name of the dashboard's Fiscal filing page for W1's sentence (Task 10 reads it).
- How often a card reader leaves a refund pending in practice; the two-step state exists for it.
