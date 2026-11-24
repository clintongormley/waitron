# GIVE-MONEY-BACK-ONE-BUTTON: one "Give money back" on a past receipt, and Waitron picks the route

Status: plan, written 2026-11-24 on `docs/give-money-back-plan` at `cc4fc8a1b7`, revised the same
day after one fresh-context read (`~/waitron-campaign-l/receipts/give-money-back-plan-read-1.md`:
1 Critical, 10 Important, 11 Minor; section 11 says what was done with each). PR 1 (Tasks 1–6) built on `feat/give-money-back-server`;
PRs 2 and 3 not started.
Every `file:line` below was read on this branch; every result marked "run" came from the command
named beside it. Nobody has approved this plan as a whole; section 0 says who decided each part. Cleared by the
watcher 2026-11-24 12:28 with every default; the owner said yes to O2's words (12:36, "yes to 1
and 2"), and O1 is settled (section 4, the watcher's 13:06 note on the owner's 12:0x "Keep the
rule, no warning screen").
The queue entry asked for "a plan (one page)"; the driver's brief asked for the full task format,
which is what this is.

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
- A **leg** is one refund that is part of a correction (cash, or one card).
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
till guides change (queue entry `~/waitron-campaign-l/queue.md:78-80`, written by the watcher).

**The owner on the mock-ups**, relayed by the watcher (`~/waitron-campaign-l/questions.md:1713-1717`,
entry "WATCHER 2026-11-24 11:21 — OWNER on the "Give money back" mock-ups"; the owner's words reach
this plan only through that relay):

- Screens: "yes".
- The switch for food money and the extra together: "yes", but "I'm not crazy about the wording
  "give back the tip". we shouldn't assume the excess is tip. instead we should refer to it as the
  excess or change or something similar". Section 3 says what the stored tip really is; O2 proposes
  the words.
- The "Some of this has to wait" screen: "that screen is really confusing and i don't understand
  why we need it. why is it blocked because it hasn't been filed with AEAT yet? We can keep
  functioning regardless". **This plan does not build that screen.** Section 4 lists every case
  where a give-back waits or is refused, answers the "why", and leaves what staff see to the owner
  (O1).
- A full invoice naming a business customer: allow it with no correction for now and list it for
  the accountant. The watcher is queueing "correct a full invoice" separately (CORRECT-FULL-INVOICE,
  `queue.md:82-83`).

**The mock-up maker's defaults** (`~/waitron-campaign-l/receipts/give-money-back/notes.md`) are
theirs, not the owner's, except where the owner's "yes" to the screens covers what is drawn.

**Decisions.** "Owner's" means the relay above; "watcher's" means the watcher's own call in the same
entry; "mine" means the plan writer's, open for the watcher to clear or overrule.

| # | Decision | Whose | Where |
| --- | --- | --- | --- |
| D1 | One **Give money back** replaces Refund a payment and Correct invoice on a past receipt; screens as drawn | owner's | 5.6 |
| D2 | The switch for the extra, under A dish and Goodwill, with new words | owner's (words: mine, O2) | 3, 5.6 |
| D3 | A full invoice naming a customer: money back with no correction; listed for the accountant | owner's (the column: mine) | 5.7 |
| D4 | No "has to wait" screen; the wait cases listed; what staff see is the owner's (O1) | owner's; the mock's words wrong: watcher's | 4 |
| D5 | One server read, preview and write; not a till-only router | mine | 1, 5.1 |
| D6 | The routing is #4192's rules applied in order; goodwill first pays cancelled dishes still owed | mine | 5.2 |
| D7 | Cash parts in one transaction; separate terminal written then filed; card reader parts in sequence | mine | 5.3 |
| D8 | One PIN, from someone holding every right the route needs | mine | 5.4 |
| D9 | A cancel's approval covers its money only from the window that opens filled in after the cancel, as today | mine | 5.5 |
| D10 | One corrective invoice per give-back, as today: the chosen payment goes first, any rest stays under way for the other payments | mine | 5.2 |
| D11 | Dishes are labelled only with what Waitron knows: no "Served" label | mine (departs from the drawn screen, Q1) | 5.6 |
| D12 | Under-way view words; Record and Close-keeping become one **Finish**; closing ends nothing | mine | 5.6 |
| D13 | The separate-terminal step appears only after the preview accepted the route | mine (the mock's note 10) | 5.6 |
| D14 | Paper unchanged | mine (Q4) | 5.6 |
| D15 | The VAT split is no longer shown; the route supplies the split it works out | mine (the mock's default) | 5.6 |
| D16 | The old server routes stay; the till's two old windows are deleted | mine | 5.1, Task 15 |
| D17 | Find a bill's words | mine (Q5) | 5.6 |
| D18 | A part payment's ticket: Refund in the Pay window opens Give money back on it | mine | 5.6 |

## 1. Should this exist?

**Need:** the owner's words above. Today a past receipt shows two buttons side by side
(`apps/till/src/screens/till-ticket-view.ts:1051-1066`), and choosing the wrong one is refused with a
message telling staff to use the other (`tender.refund_needs_correction`, `apps/till/src/i18n/codes.ts:660-661`).

**Simplest thing that meets it:** one button and one window that asks what the money is for, and one
server route that decides the route with #4192's own functions and calls the existing write paths.
No rule about what is filed changes: the same plain refunds and corrections as today, chosen by the
same checks (`correctableNow`, `apps/server/src/invoice-corrections.ts:192-229`; `plainRefundLimit`,
`apps/server/src/tender-refund-reservation.ts:163-183`).

**The alternative considered: a till-only router** over today's routes. Rejected (D5, mine):

- a cash give-back of a dish plus the extra would be two or three requests, each with its own PIN
  check and drawer opening, and a failure part-way leaves some money back and some not;
- the till would route on a read another till can change before the writes, so the server would
  refuse with today's "choose Correct invoice" codes, which the till would have to translate;
- a give-back needing both refund and correction rights would ask for two PINs.

The server route gives one request, one PIN, one drawer opening, one transaction for cash, and the
routing decided where the rules live. Each existing write path keeps its own checks, so the server
stays the last word.

**Cost of D16:** the old write routes stay, so a later refund or correction rule must hold in the new
route too. That is mitigated by the new route calling the same functions, not copying their rules.

**True size** (estimates from the files each task names, not from a build): PR 1 about 550 server
production lines added and 1,300 test lines (as built: about 2,400 production and 3,100 test lines
added, `git diff --numstat`). PR 2 about 950 till production lines added, 300
changed, 1,600 test lines added or rewritten, about 120 guide lines per language, and the dashboard's
two correction alerts reworded. PR 3 about 5,000 lines removed (the two old windows and their tests,
`wc -l`, run) plus the `till-app.ts` code only they reach. No generated file, migration, schema
change or new table.

## 2. What people will see when it lands

- **A past receipt** shows **Give money back** (Spanish **Devolver dinero**), full width, above
  Reprint and Open drawer. Refund a payment and Correct invoice are gone from it.
- **The window** asks **What is it for?**: **A dish**, **Goodwill or a complaint**, and the extra
  paid on top of the bill (words: O2). Each leads to one short form: the amount, a **Reason**, **How
  it goes back** ("Cash · up to €X", or a card "up to €Y"), a summary box, and **Give back €X**. The
  amount may go up to all the money left on the receipt, as screen d shows ("Up to €47.00 can go
  back"). A dish and goodwill have the switch for the extra.
- **A supervisor's PIN** is asked once, only when the person lacks a right the route needs; the list
  shows only people who hold every right needed.
- **A separate terminal**: the "refund it on the terminal, then confirm" step appears only once
  Waitron has checked it will record the refund.
- **The end**: for cash, "€24.50 given back in cash. Give it to the customer.", the drawer opening
  once; for a card reader, "€10.00 is back on card ···4242"; if the card company has not answered,
  "€10.00 is waiting for the card company" with **Check again**. When more than the chosen payment
  holds was asked for, the window moves to **Money back under way** with a step for each other
  payment.
- **A give-back still under way** opens straight onto what is left to do, in staff words (D12).
  Find a bill's **Corrections under way** becomes **Money back under way** (D17).
- **After Cancel and refund or Finish table**, the window opens on **A dish** with the cancelled
  dishes ticked and their amount filled in, needing no new PIN, as Refund a payment opens filled in
  today.
- **The Pay window's Refund** beside a part payment with its own ticket opens Give money back on that
  ticket, not Correct invoice or Refund a payment (D18).
- **Messages** on the till and the dashboard's two correction alerts that name the old buttons are
  reworded.
- **The accountant's spreadsheet** sheet "Refunds, no corrective invoice" gains a column naming the
  customer on the invoice (D3).
- **What is filed does not change** (section 6).

## 3. What the stored "tip" really is (for O2)

Traced, not run. The tip lives on the payment: `bill_payments.tip` before the invoice
(`packages/db/src/schema/bill-payments.ts:46`) and `tenders.tip_amount` after it, described in the
schema as "the payer's affirmed gratuity, non-taxable and on no invoice … the tip is a part of [the
charge], never on top" (`packages/db/src/schema/sales.ts:326-329`). It is **everything a payment
took above the money that went to the bill, less any change handed back**. It gets there five ways:

1. **Card: the till's "Tip on the card (optional)"** (`apps/till/src/i18n/strings.ts:1940`).
2. **Card: paying more than is left of the bill.** A card contribution or item payment larger than
   what is left keeps the excess as tip by rule (`packages/orders-sales/src/bill-allocation.ts:168`).
3. **Items costing more than is left**, when staff choose "Pay {amount} with a {tip} tip"
   (`full_with_tip`, `bill-allocation.ts:178-179`; words at `strings.ts:2012`), cash or card.
4. **Cash: change the waiter marks "Leave as a tip"** — "Nothing: give it all as change", "All of
   the change" or "An amount" (`strings.ts:1956-1963`). Change handed back is not stored: it is
   `tendered − applied − tip` (`bill-payments.ts:28`).
5. **Card reader charged more than asked**: the captured amount above the money applied becomes the
   tip (`apps/server/src/bill-payments.ts:2339`).

A venue that takes no tips stores none (`bill.tip_not_allowed`, `bill-allocation.ts:129-133`). The
printed receipt calls it "Propina" and the payment window "Tip". So the owner is right: in ways 2 and
5 nobody chose it as a tip, and in ways 3 and 4 staff chose the word, not necessarily the guest.

**O2's words (proposed by the plan writer; the owner said yes, 2026-11-24 12:36):**

| Where | English | Spanish |
| --- | --- | --- |
| Third choice (replaces "Just the tip") | **Extra paid on top of the bill** | **Lo pagado de más** |
| Its hint | Give back some or all of the {amount} paid on top of the bill, and nothing else. The receipt shows it as Tip. | Devuelve una parte o todos los {amount} pagados de más sobre la cuenta, y nada más. En el ticket figura como Propina. |
| The switch (replaces "Give back the tip too") | **Give back the extra paid on top too ({amount})** | **Devolver también lo pagado de más ({amount})** |
| The amount field | **Extra to give back** | **Pagado de más a devolver** |

"Cuenta" and "propina" are the till's Spanish words for the bill and the tip (`strings.ts:4255-4269`).
The receipt's printed "Propina" and the payment window's "Tip" are not changed (outside the ask; say
if they should be).

## 4. Every case where a give-back waits or is refused today (for O1)

The new route inherits these from today's write paths. "Run" rows were run on this branch with
`env -u CLAUDECODE -u AI_AGENT pnpm exec vitest run <file> -t "<name>"` in `apps/server` (or
`packages/fiscal-verifactu`), and passed: 28 cases in `invoice-correction-api.test.ts`; 14 in
`clock-unconfirmed-gate.test.ts` and `tender-refund-api.test.ts`; all 27 in
`correction-admission.test.ts`; 4 in `tender-refund-links.test.ts`, `advance-corrections.test.ts` and
`tender-refund-reservation.test.ts`. Each asserts the refusal's code, so a missing refusal would fail.

**Not a wait — the owner's point.** A receipt AEAT has not answered yet (queued or being sent) is
corrected at once: `packages/fiscal-verifactu/src/correction-admission.ts:10-15` admits `pendiente`
and `enviando`; run: "admits a replacement … as it admits an F2" (answers `queued`) and "first
rechazado, fix pendiente" (a fixed receipt whose fix is still queued is admitted).

**Waits (nothing moves; the same press works later):**

| Case | When | What waits | What still goes back | Evidence |
| --- | --- | --- | --- | --- |
| 1 | AEAT **refused** the receipt, or the box holds it behind an earlier refused record, or set it aside (`rechazado`, `detenido`, `retenido`) | dish and goodwill money (the correction), and a plain refund of that money | money still owed for cancelled dishes, and the extra | run: "waits while the tax agency has refused the ticket's filing" (`sale.correction_not_admitted`, reason `filing_refused`); a throwaway probe added to that file, then removed (clean `git status`): with the filing refused, €0.50 of the extra alone answered 200 completed, and €1.00 of payment money 409 `filing_refused` |
| 1 ends | when an administrator sends the fix from the dashboard's **Fiscal filing** page (ES **Remisión a la AEAT**, `packages/fiscal-verifactu/src/dashboard/strings.ts:539`; guide `apps/server/src/guide/en/fiscal-filing.md:32-47`) | | | run: "first rechazado, fix pendiente" |
| 2 | another refund on this receipt is **waiting for the card company** | dish and goodwill money, and a plain refund of it | cancelled-dish money and the extra, from another payment | run: "answers invoice_correction.refund_pending with 409", "waits while another payment's refund is pending" |
| 3 | a refund of **the same payment** is waiting | everything from that payment, the extra included | other payments | run: "refuses a capture already reserved by another tender's pending row", "refuses a pending pre-invoice refund on the same capture" (`tender.refund_in_progress`) |
| 4 | a give-back on this receipt is **under way** (an open correction) | every other refund on the receipt, the extra included | nothing outside it; the button opens what is under way instead | run: "refuses a refund with 409 while the ticket has an unfinished correction" (`invoice_correction.already_open`) |
| 5 | the box's **time is not confirmed** after a start | everything | nothing | run: "a new cash tender refund", "a new connected card tender refund", "a correction's cash leg", "a correction's File now", each refusing `clock.unconfirmed` |
| 6 | the box is in a **fiscal conflict with another box** | everything | nothing | read: `refuseNewRefund` in `refuseUntilRefundable` (`apps/server/src/tender-refund-completion.ts:16-23`, `sif.allocation_invalid`) |
| 7 | the box **cannot trade** (time zone missing or needing a restart), or its disk is full | everything, as for a sale | nothing | read: `requireEconomicWrite` (`apps/server/src/trading-admission.ts:26-33`, `venue.time_zone_not_ready`); full disk: the till's existing strip |
| 8 | the card company **cannot refund** (no partial refunds, unreachable) | that card | another payment | read: `tender.refund_unavailable` (`apps/server/src/tender-refunds.ts:104-112`) |
| 9 | a part payment's own ticket, once the table's receipt took it off and that receipt still has money to give back | that ticket's payment money | the table's receipt's money, from that receipt | run: "refuses a plain refund of the advance while Correct invoice on the rest's invoice can still give money back" (`advance.taken_off_final_invoice`) |
| 10 | a part payment's own ticket **before** the table's receipt exists | a plain refund of its payment money (only a corrective may act) | its correction, and the extra | read: `tender.refund_of_advance` (`refusePlainRefundOfAdvance`, `tender-refund-reservation.ts:379`); Task 2 tests it through the route |

**After the money moved:**

| Case | When | What happens |
| --- | --- | --- |
| 11 | a card or separate-terminal leg finished but the corrective invoice could not be filed by itself | the give-back stays under way with the money back; the manager alert `invoice_correction.filing_refused` is raised (`apps/server/src/invoice-correction-alerts.ts:159-219`); the under-way view offers **Finish** |

**Never a wait — money goes back with no correction, staff see nothing different:**
`refusesForGood` (`invoice-corrections.ts:170-182`) covers a receipt filed by another box (run:
"takes it where Correct invoice refuses the ticket for good (wrong_node)"), no filing record (run:
"(missing)"), replaced by a full invoice (run: "takes it on a ticket a full invoice replaced"), a full
invoice naming a customer (run: "is taken on an invoice naming a customer"), filed figures that
cannot be read or compared (`filing_versions_unusable`, `filed_figures_unreadable`,
`filed_figures_changed`), earlier corrections that cannot be read
(`sale.correction_history_unusable`), a venue that cannot correct (`sale.correction_unsupported`)
and a receipt not settled. Records that need checking reach the same outcome by another path:
`correctableNow` answers nothing correctable when `checkIntegrity` finds issues (`:224-226`; run:
"still gives money back through Refund a payment while the invoice records need checking"). A
cancelled receipt: the "voided" run above uses a stand-in; #4192 records that a real cancelled
ticket answers `tender.refund_unavailable`, so nothing goes back from it.

**Why case 1 waits (the owner's question).** Waitron sends records in order, so a corrective sent
after a receipt that is only queued reaches AEAT after it. A refused receipt is different: AEAT's
developer FAQ, quoted at `docs/compliance/2026-11-06-adviser-questions.md:226-227`, says such a
record «no figuraría jamás en los sistemas de la AEAT (aunque constaría un rechazo)» — it never
appears in AEAT's records, though the refusal does. A corrective invoice names the invoice it
corrects, so until the receipt is fixed there is nothing at AEAT for it to correct. The money also
waits because #4192 made a plain refund wait wherever Correct invoice only waits (the watcher's O7,
#4192's description), so goodwill never goes back without a corrective. The code that refuses is
`correction-admission.ts:58-59`; no source found says what AEAT does with a corrective of a refused
record, so "it would be refused" is a reading, not a receipt.

**O1, settled (watcher 2026-11-24 13:06, on the owner's 12:0x "Keep the rule, no warning screen"):
in the window, a choice that must wait is shown unavailable with one plain line saying why; every
other choice works at once.** In case 1 that means **Goodwill** is unavailable, and under **A dish**
only lines with money still owed for a cancel can be ticked (up to that money); the extra stays
available. Cases 5–7 make all three choices unavailable with the same line. The read carries this
(5.1, `choices` and each line's `available`); the till draws it (Task 7). The bottom message stays
for a refusal only the write can find (a change since the read, a wrong PIN). The options the
owner was shown, kept for the record:

- (a) as built: the window opens as normal; pressing **Give back** shows the sentence, nothing moves;
- (b) the same sentence as soon as the window opens, before staff type anything;
- (c) give back now whatever can go (the cancelled dishes' money, the extra) and say the rest waits:
  no filing rule changes, but one press gives two outcomes;
- (d) in case 1, give the goodwill money back now with no corrective, as for a receipt that can never
  be corrected: changes #4192's O7, and that money then never gets a corrective;
- (e) in case 1, give the money back now and file the corrective by itself once the receipt is fixed:
  a new kind of open correction, a change to what Waitron files and when, needing the adviser.

Under the house rule on refusals (`docs/developers/conventions-ui.md:8-20`: never send the person to
somebody else), case 1's sentence names the page, not a person. Proposed (mine): EN "The tax agency
refused this receipt, so money for dishes or goodwill cannot go back until the receipt is fixed in
Fiscal filing, on the dashboard. Money owed for cancelled dishes and the extra paid on top can still
go back." ES "La Agencia Tributaria rechazó este ticket, así que el dinero de platos o por cortesía no
se puede devolver hasta que se corrija en Remisión a la AEAT, en el panel. El dinero de platos
cancelados y lo pagado de más sí se pueden devolver."

## 5. Design

### 5.1 D5: one read, one preview, one write

In `apps/server/src/give-back-read.ts` (the read), `give-back-plan.ts` (routing and preview),
`give-back.ts` (the write), `give-back-press.ts` (parsing, resends, the answer) and
`give-back-reader.ts` (the card-reader sequence); routes in `give-back-api.ts` (mounted beside
`mountInvoiceCorrectionApi`).

**`GET /api/transactions/:saleId/give-back`** — what the window lists:

```ts
{
  lines: { id: string; descriptions: Record<string, string>; quantity: string; gross: string;
           /** Correct invoice's `left` where it can read the receipt (any refusal: `gross`), less
            *  `cancelled.back`; never below 0 */
           left: string;
           /** cancels on this line with Refund ticked */
           cancelled: { quantity: string; owed: string; back: string } | null;
           /** a cancelled dish's extra: the dish's line it is given back with */
           partOf: string | null;
           givenFree: boolean }[];
  /** "cash" is every cash payment together, as Correct invoice gives cash back today */
  ways: { way: "cash" | string /* tenderId of a card */; last4: string | null; manual: boolean;
          moneyLeft: string; extraLeft: string; pending: boolean; allowedHere: boolean }[];
  underWay: InvoiceCorrectionView | null;
  /** O1 (watcher 13:06): whether each choice can be used now and, when not, why */
  choices: Record<"dishes" | "goodwill" | "extra", { available: boolean; reason: WaitReason | null }>;
}
/** the code (and params) the write would answer, from section 4's cases */
type WaitReason = { code: ErrorCode; params?: Record<string, unknown> };
```

Each line also carries `available: boolean` and `reason: WaitReason | null`; `ways` each carry
`reason` too (case 3's `tender.refund_in_progress`, case 8's `tender.refund_unavailable`).
`choices` and the lines' `available` are worked out by the same functions the preview and the write
call (`readCorrectableNow`, `refuseUntilRefundable`, the pending-refund reads, `requireEconomicWrite`'s
check, `assertTakesTender`), never a second copy of the rules: an unavailable choice is exactly one
whose preview would answer that code. A payment this device's profile does not take counts as held,
with the code the preview answers (`device.cash_not_allowed`, `device.forbidden_action`); a
correction may still leave money under way on it for another device. `dishes` is available when at least one line is; in cases 1 and 2 a line is
available only while its cancel still owes money, and only up to `owed`. A choice with nothing left
to give back (no extra paid, every line's `left` 0) is `available: false` with `reason: null`; the
till shows it quiet with no sentence. Case 4 (`invoice_correction.already_open`) makes all three
unavailable; the button opens the under-way view instead.

`cancelled` comes from the order's cancels with Refund ticked (`readCancelsForRefund`,
`packages/adjustments/src/refund-links.ts:54-89`; `owed = refundValue − linked`, `back = linked`),
mapped to the receipt's lines through the portion bindings that
`apps/server/src/cancellation-refund-value.ts:195-215` reads. A cancel paid back in full keeps its
row (`owed: "0.00"`), so the dish still shows its money is back. A cancel's money is owed for the
dish and its priced extras together (`refundValue` and `linked` are per cancel), so they are one
selection: the dish's line carries the family's `cancelled` and `left`, and each extra's line
carries `partOf: <the dish's line id>`, `left: "0.00"` and `cancelled: null`, is never available
itself, and a correction of the ticked dish names the family's lines. `left` subtracts `back` because
Correct invoice's `left` counts only earlier correctives (`packages/core/src/correction-history.ts:262-283`),
never plain refunds: without it a dish whose cancel was paid back would offer its money again (the
read's C1). `givenFree` uses `isFree` (`apps/server/src/cancellation-refund-value.ts`): a line charged €0 whose
menu price is above €0.
`allowedHere` is the server's own tender-kind check (`assertTakesTender`) against this device's
profile. A refusal from `readCorrectableLines` (a refused filing included, `correction-history.ts:113-114`)
falls back to `gross`, so the window opens in case 1 (the read's I3).

**`POST /api/transactions/:saleId/give-back/preview`** — what pressing would do, writing nothing:

```ts
// request
{ purpose: "dishes" | "goodwill" | "extra"; lineIds?: string[]; amount: string; extra: string;
  way: string; fromCancel?: string[] }
// answer
{ parts: { kind: "refund" | "extra" | "correction"; amount: string; way: string }[];
  /** what the chosen way cannot hold, left on the correction for the other payments */
  leftUnderWay: string;
  needs: ("sale.refund" | "sale.rectify")[];   // rights this person lacks
  manual: boolean }
```

A wait (section 4) answers with its own code. The window asks for a preview on the same triggers
Correct invoice's window uses today, once the form is valid.

**`POST /api/transactions/:saleId/give-back`** — the preview's body plus
`{ reasonId, note, submissionIds: { refund, extra, correction, leg }, expected: parts,
manualConfirmed?, override? }`. In this order:

1. `requireSession`, `assertRequestDevice`, `requireEconomicWrite`, as both old write routes
   (`invoice-correction-api.ts:102-127`, `tender-refund-api.ts:187-201`).
2. **A resend answers, never re-routes:** if any of the submission ids already has a `refunds` or
   `invoice_corrections` row on this sale, the route answers from the stored rows (checking each
   row's fingerprint, as today's replays do) and writes nothing. It is authorized from the same body and
   the rows its first send wrote, as Refund a payment authorizes a resend, so it can ask for a right
   its first send did not (`resendRights`). The rows keep the reason only as text, so the resend's reason is
   checked against that text, never against today's settings: a reason renamed since still matches
   an identical resend, but once no reason bears the stored name, which reason the resend names is
   not checked (the note still is).
3. Otherwise it plans again and refuses `give_back.changed` (409) when the parts differ from
   `expected` (what the preview showed). Then it writes (5.3).

It answers:

```ts
{ parts: { kind; amount; state: "completed" | "pending" | "failed" | "not_started";
           refundId?: string; correctionId?: string }[];
  refusal: { code: string; params: object } | null;   // a later part refused after an earlier one moved money
  underWay: InvoiceCorrectionView | null;
  rest: null | { purpose; lineIds?; amount; extra; way } }  // not sent yet; needs fresh ids
```

A card refund the card company did not make answers `refusal` with `give_back.refund_failed`.

**D16: the old routes stay**: `POST …/refunds`, `…/corrections`, `/cash`, `/file`, `/close` are the
building blocks the new route calls, the under-way view's steps, and the fixtures of hundreds of
tests. The till stops calling `…/corrections` and the plain form of `…/refunds`.

### 5.2 D6 and D10: the routing, #4192's rules applied in order

1. **Cancelled dishes** (purpose `dishes`): for the ticked lines with money still owed on their
   cancels, a plain refund of `min(amount, owed)`, naming those cancels (`cancellationIds`) so the
   links are exact. #4192's limit admits it with no correction (`plainRefundLimit` returns at once
   within what the named cancels owe, `tender-refund-reservation.ts:171`).
2. **Goodwill first pays cancelled dishes still owed** (mine): with purpose `goodwill`, money still
   owed on any cancel of the receipt goes first, as step 1, up to the amount. A plain refund naming no
   dishes already does this (#4192's O8); without it, goodwill would be filed as a corrective while
   the cancel kept offering its money (the read's C1).
3. **The extra** (purpose `extra`, or the switch on): a plain refund of the extra alone (payment
   money 0). #4192: a tip alone needs no correction (`tenderRefundAmountsFit`, `:277-284`).
4. **The rest** (served dishes, goodwill, more than the ticked dishes): one correction. For
   `dishes`, it names the ticked lines with money beyond what their cancels owe, and each ticked
   cancelled dish's extras' lines that Correct invoice still holds money on. When the rest is more
   than those lines hold beyond what their cancels owe, or no such line is ticked, it names **no** lines: Correct invoice refuses more
   than the named lines hold (`packages/core/src/correction-allocation.ts:66-70`; the read's probe:
   ticked lines with too much answered `sale.correction_amount_invalid`, unticked answered none), and
   with none named it shares the amount over the receipt by menu price (#4192's O1). For `goodwill`
   it names no lines.
5. **Where Correct invoice can never act** (`readCorrectableNow` answers nothing correctable), the rest
   goes as a plain refund instead, as Refund a payment does today.
6. **Where Correct invoice would only wait** (`readCorrectableNow` answers `waiting`: cases 1, 2, the
   clock), the route refuses with that code. Steps 1–3 never reach `readCorrectableNow` (case 1's probe).
7. **More than one payment holds (D10):** steps 1–3 come from the chosen way only (cash: every cash
   payment, oldest first, as `giveCorrectionCash` takes it, `invoice-correction-cash.ts:50-56`); if
   they need more, the preview refuses on the amount field; the till shows what that way holds from the read's `ways`. The correction
   is opened for the whole rest; its leg gives what the chosen way holds; what is left stays on the
   open correction (`leftUnderWay`), and the window moves to the under-way view with a step for each
   other payment. So a €45 give-back over €30 cash and €17 card is still **one** corrective invoice,
   filed once all of it is back or staff choose **Stop here**, exactly as Correct invoice does today.

Order on the wire is 1–2, 3, then 4: a plain refund is refused while a correction is open
(`tender-refund-reservation.ts:373`), and a correction cannot open while a refund is pending
(`invoice-corrections.ts:155-159`).

The route supplies the correction's VAT split itself, from `previewCorrectionAmounts`, as
`expectedSplit` (`openInvoiceCorrection` requires it and puts it in its resend fingerprint,
`invoice-corrections.ts:273-279`). D15: the check that "the split staff saw is the split filed" goes;
`expected` parts take its place.

### 5.3 D7: which writes share a transaction

- **Cash:** every part in **one transaction**: plain refunds through `reserveTenderRefund` and
  `carryNewTenderRefund` (which runs the clock and fiscal-conflict stop, `tender-refund-completion.ts:16-42`;
  not `completeRefundReservation`, which skips them), then `openInvoiceCorrection`, then
  `giveCorrectionCash` (`invoice-correction-cash.ts:64`), which files the corrective invoice in that
  transaction once all its money is back. A refused filing undoes the whole give-back, as it undoes
  the cash today. **The drawer opens once:** only the last cash write passes `openDrawer`; CLAUDE.md
  §5's audited drawer job still holds, one job linked to that refund.
- **Separate terminal:** staff have already refunded the total on the terminal. Every part's refund is
  written and completed in one transaction (manual refunds complete at once,
  `tender-refund-completion.ts:51-66`), then committed; the corrective invoice is filed **after**, by
  `fileCorrectionAutomatically`, as `refundSettledTender` does (`apps/server/src/tender-refunds.ts:142-152`).
  Filing inside would undo the record of money already gone from the terminal.
- **Card reader:** the card company is asked between parts, so parts run **in sequence, each in its
  own transaction**, each followed by the card company's answer as `settleTenderRefund` waits for it
  (`tender-refunds.ts:155-176`). A correction is opened **in the same transaction as its leg's
  reservation**, and discarded by the route (`closeInvoiceCorrection` with nothing back) if that leg
  fails, so a card refund declined while the route waits leaves no correction open; one left pending
  and later failed by the background recovery, or whose discard is refused, stays open under way
  (section 11, I5). When a part comes back
  completed the route goes on; when one stays pending it stops and answers `rest`. **This split
  across transactions is a commented decision** (CLAUDE.md §3), stated at the function: no
  transaction stays open across a card company's answer. A later part refused after an earlier one
  completed answers what went back and `refusal`; nothing is undone.
- **A resend** never calls a completion step: `reserveTenderRefund` answering `replayed: true` returns
  the stored row, as `beginSettledTenderRefund` does today (`tender-refunds.ts:94-98`), so no second
  drawer entry is written. A separate terminal's resend still asks `fileCorrectionAutomatically` to
  file a correction left open by a refused filing after commit, as `refundSettledTender` does on a
  resend of Correct invoice's separate-terminal leg (it files the corrective and writes no refund).

**`rest` lives only on the till that sent it** (in its saved attempt, like a refund attempt today,
`apps/till/src/state/tender-refund.ts`). If that till is lost, the rest was simply not given back:
the outcome said "€Y has not gone back yet", and anyone can give it back with a new press. Keeping it
on the server would need a new table; the rest is rare (a card company that did not answer at once).

Why two refunds rather than one on a card reader: a correction's leg may not carry a tip
(`invoice-correction-legs.ts:147`), and a plain refund may carry a tip only with all the payment's
money (`refundAmountsFit`, `tender-refund-reservation.ts:271-273`). Relaxing either is a money rule
nobody asked for (Q3).

### 5.4 D8: one PIN

The route works out the rights its parts need: `sale.refund` for any plain refund not covered by the
cancel's approval (D9) and for every leg, `sale.rectify` to open a correction. For cash and a
separate terminal it checks an approver's PIN once, ahead of the transaction (`overrideToCheck` with
`checkedAnyway = true` and `withPinCheckAhead`, `apps/server/src/pin-check-ahead.ts:55-74`), then
authorizes each right inside with that check (`withCheck`). On a card reader the PIN is typed and
checked once, ahead of the first transaction; each part's own transaction then authorizes its rights
again from the person's roles and session as they are then, reusing that PIN check (no second PIN). The device checks are
today's, as `withTenderRefundAuthorization` makes them (`apps/server/src/tender-refund-authorization.ts:129-155`):
still signed in on this device, not a kitchen screen, admitted to the device's profile, the receipt's
zones, the profile taking that kind of payment. Task 4 moves those lines into one function both
routes call, leaving the existing refund tests unchanged and passing. A missing right refuses
`authorization.not_permitted` naming the first one missing, as today; the preview's `needs` names
all. `GET /api/adjustment-approvers` (`apps/server/src/adjustments-api.ts:311-320`) accepts
`permission` more than once and answers the people who hold all of them. A separate terminal always
asks a fresh PIN to confirm the terminal refund (`confirmManualRefundAuthority`, `:89-110`).

### 5.5 D9: a cancel's approval covers its money only from the filled window, as today

Today the cancel's approval covers a refund only from the window that opens filled in after Cancel
and refund or Finish table (guide, `apps/server/src/guide/en/table-service.md:375-385`). The filled
window sends `fromCancel` (the cancel ids it was opened with); the route covers the plain part with
the cancel's approver only when `fromCancel` equals the cancels it names and there is no extra, using
`reserveTenderRefund`'s existing rule (`covered = …`, `tender-refund-reservation.ts:487-488`).
Without `fromCancel` it passes no cover, so a later give-back of a cancelled dish asks for refund
rights or a PIN, as Refund a payment does today. A resend is authorized from the same body and the
stored rows, so it may need more than its first send (`resendRights`, `apps/server/src/give-back.ts`).

### 5.6 The till

- **One new window**, `apps/till/src/widgets/give-back-dialog.ts`, its state in
  `apps/till/src/state/give-back.ts` (the saved attempt: the request, its submission ids and any
  `rest`, kept as `state/tender-refund.ts` keeps a refund's, so a lost answer is sent again with the
  same ids; a `rest` gets fresh ids when first sent). Steps: the choice (`wt-choice-row`), the form,
  the outcome; the under-way view is a fourth state. A line with `partOf` is drawn under its dish,
  never tickable; a cancelled dish's `left` counts its extras, so it can exceed its own `gross`.
- **The form** follows design-system.md → Forms: required fields marked; inline errors; one bottom
  message; **Give back** disabled until valid. The amount starts at the ticked lines' `left` (a
  cancelled line's starts at its `owed`) and may be raised up to all the money left on the receipt;
  the reason list is Correct invoice's; **How it goes back** is native radios, as
  `bill-refund-dialog.ts` uses. The summary box and the PIN line come from the preview.
- **D11, labels:** "Cancelled, not served" (ES "Cancelado, no servido") while a cancel with Refund
  ticked still owes money; "Cancelled, money given back" (ES "Cancelado, dinero devuelto") once it
  owes none; "Given free" (no switch, as today's rule that a free dish comes back only with the last
  paid one). No "Served" label: a bill can be paid with dishes not marked served (**Print anyway**,
  `table-service.md:694-699`), so it would be a guess. This departs from the approved screen (Q1).
- **D15:** the VAT split Correct invoice shows today is not shown.
- **D12, the under-way view** replaces Correct invoice's carry-on view
  (`apps/till/src/widgets/invoice-correction-dialog.ts:746-891`), with the same requests
  (`InvoiceCorrectionSession`, `apps/till/src/state/invoice-correction.ts`):

| Today | English | Spanish |
| --- | --- | --- |
| Correct invoice (title) | Money back under way | Devolución en curso |
| Give back €X in cash | unchanged | unchanged |
| Refund to card (opened Refund a payment) | Give back €X to card ···4242, sent from this window, with the terminal step for a separate terminal | Devolver X € a la tarjeta ···4242 |
| Record correction / Close keeping the refunds | **Finish** — "Records the €X given back." The till sends `/file` when the read offers a filing and `/close` when it says filing can never happen; the server refuses the wrong one (`still_correctable`) | **Terminar** — "Registra los X € devueltos." |
| Finish now | **Stop here** — "Keeps the €X already given back; gives no more back." | **Terminar aquí** — "Se quedan los X € ya devueltos; no se devuelve más." |
| Discard | **Cancel this money back** — "Nothing has gone back yet." | **Anular esta devolución** — "Aún no se ha devuelto nada." |

  Closing the window ends nothing by itself (mine; the mock proposed discarding on close).
- **A two-step card give-back:** with a `rest`, the outcome says "€X is back. €Y has not gone back
  yet: it follows when the card company answers." with **Check again**, which reads the pending refund
  (`GET /api/tender-refunds/:id`) and, once completed, previews the rest and sends it with fresh ids.
  Opening Give money back on the receipt later on that till opens this state.
- **D14, paper unchanged:** a cash correction prints its corrective receipt as today
  (`fileCorrectionIn`'s `print`, `invoice-corrections.ts:416-484`); a card one does not, and the
  outcome says it can be printed from Find a bill. The mock's uniform **Print** (note 12) is not built.
- **D17, Find a bill:** "Corrections under way" → **Money back under way** / **Devoluciones en curso**;
  the type "Corrective" → **Money back receipt** / **Ticket de devolución**; "Replacement corrective"
  → **Replacement receipt** / **Ticket de sustitución**. A plain refund's type stays "Refund" /
  "Devolución". The printed paper keeps "Factura rectificativa" (Q5).
- **D18, a part payment's ticket:** the Pay window's **Refund** opens Give money back on that ticket
  (`till-app.ts:23913-23946`). In case 9 the message names the table's receipt number; the mock's
  "open it" button (note 9) is not built.
- **A dish not served yet on a seated table** (mock note 5): not built. Void… on the table stays the
  way to stop the kitchen.

### 5.7 D3: a full invoice naming a customer

The route sends its money back as a plain refund with no correction (5.2 step 5; run: "is taken on an
invoice naming a customer"). **Listed for the accountant** (the column is mine): the sheet "Refunds,
no corrective invoice" (`apps/server/src/accountant-export.ts:413`, columns at
`apps/server/src/i18n/accountant-export.ts:32-46`) names each refund's invoice number but not whether
that invoice named a customer, so the accountant would have to cross-check every refund against the
invoices sheet. It gains two columns with the invoices sheet's headings, **Customer** and **Customer
tax number** (ES **Cliente** and **NIF del cliente**): the customer's name and tax number from the
sale, each empty where the sale has none (both, for a simplified ticket), read at export time from
the immutable sale. CORRECT-FULL-INVOICE replaces this when it lands.

## 6. Fiscal boundary, and the checks every task runs

**What is filed does not change.** For the same money, the route makes the same plain refunds and the
same one corrective invoice the two old buttons would, through today's `fileCorrectionIn`.
`computeHuella`, the chain, numbering, series, the records table and its triggers are not touched. Two
differences in which lines a corrective names, both already reachable today by choosing them in
Correct invoice: an amount above the ticked dishes names no lines (5.2 step 4), and goodwill pays
cancelled dishes still owed before the corrective (step 2). No migration, schema change or new table:
`refunds.submission_id` and `invoice_corrections.submission_id` make every part safe to resend.

Every PR 1 task runs, unedited and passing, and reads the Tests count:

```sh
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
```

## 7. Test checks expected to change

**Server (PR 1): no existing assertion changes;** the new routes are additions. New rows in guard
lists: `apps/server/src/till-api.profile-actions.test.ts` and `till-api.profile-zones.test.ts` (the
three routes' refusing cases and inventory rows, CLAUDE.md §3); `till-api.session-person.test.ts`
(the three routes in `NAMED_REFUSED`; none needs a `BODIES` entry, since each reads the sign-in
before its body); `adjustments-api.test.ts` (two permissions). One changed check:
`accountant-export.test.ts` pins the refunds sheet's columns, which gain two.

**Till and dashboard (PR 2), each with its decision:**

- `apps/till/src/screens/till-ticket-view.test.ts`: two buttons become one `data-give-back` (D1).
- Cases that emit `tender-refund-open` or `invoice-correction-open`, or open those windows from the
  Pay window, rewritten to drive the new window (D1, D18), **keeping their behavioural assertions**
  (the filled window sends the cancel's ids and needs no PIN; a device that does not take that payment
  says so; a lost answer is sent again with the same id; a pending refund offers Check again):
  `till-app-adjustments.test.ts:4088-4789`; `till-app.test.ts:26182`, `:27200`, `:28060`;
  `till-app-parties-closing.test.ts` (Finish table group); `till-app-bill-payments.test.ts:4461`, `:8364`,
  `:10012-10055`.
- `apps/till/src/i18n/codes.test.ts`, `refund-wording.test.ts`: messages naming the old buttons.
- `apps/dashboard/src/i18n/alert-messages.ts:458-465` and `apps/dashboard/src/i18n/alerts.test.ts:1048-1051`:
  the two correction alerts name "Corrections under way", "Record correction", "Finish now" and
  "Close keeping the refunds" (D12, D17).
- `apps/till/src/help-guide.test.ts`, `scripts/guide-links.test.ts`,
  `apps/server/src/guide-content.test.ts`, `apps/server/src/guide-pages.test.ts:110`: the anchors
  (`correct-invoice`, `refund-receipt` → `give-money-back`; `separate-terminal` kept).
- Find a bill's tests reading "Corrections under way" or "Corrective" (D17).

**PR 3:** `apps/till/src/widgets/recovery-refusal.test.ts:155` (reads an old window's code); the
deleted windows' own tests, whose behavioural cases Task 15 first re-homes.

## 8. Tasks

**Risk triggers:** money given back on the sale path, the choice between a corrective invoice and a
plain refund, and permissions and PINs. Full path: per-task review, and `/finish-branch` with two
Codex run-it reviews side by side on each PR. The owner lands every PR (fiscal).

**Each task:** the failing test first, watched failing, then the change; then
`pnpm exec prettier --check <changed files>` and, in PR 1, section 6's command. Till suites run real
headless Chromium: check `memory_pressure | grep free` first. Run Vitest with
`env -u CLAUDECODE -u AI_AGENT` to see a passing test's output, and read the "Test Files" and "Tests"
counts. Use `pnpm exec vitest run <file> -t "<name>"`, never `pnpm test <file> -t` (it drops the
`-t`). Every existing file named was checked with `ls` on this branch. Each task is sized for one
implementer well under 100 tool calls; one that passes about 150 stops at a passing point, commits and
hands over.

**Open questions:** none; O1 and O2 are answered (sections 3 and 4) and the watcher cleared Q1–Q5
with their defaults (12:28).

### PR 1 — server (Tasks 1–6)

#### Task 1: the read — about 55 calls

Files: new `apps/server/src/give-back.ts`, `give-back.test.ts`.

1. Tests first, on a real venue (`useVenueDb`):
   - five dishes, the paella cancelled with Refund ticked (18.50 owed): its `cancelled` is
     `{ quantity: "1.000", owed: "18.50", back: "0.00" }`, the others `null`;
   - the same after 8.50 of the paella's money went back: `owed: "10.00"`, `back: "8.50"`, and its
     `left` is 10.00; after all of it: `owed: "0.00"`, `left: "0.00"` (C1);
   - 2 croquetas with 1 cancelled: `cancelled.quantity` is 1;
   - a cancel without Refund ticked: `cancelled` is `null`;
   - a dish given free: `givenFree: true`;
   - two cash payments and a card: one `cash` way with both payments' money; a 3.00 tip shows as
     `extraLeft`, and after 1.00 of it goes back, 2.00;
   - a hand-keyed card: `manual: true`; a device whose profile takes no cards: `allowedHere: false`;
   - a receipt filed by another box, and one AEAT refused (`refusedByAeat` as
     `invoice-correction-api.test.ts:1305-1312` builds it): lines listed with `left` from `gross` (I3);
   - an open correction: `underWay` is its view, and all three `choices` unavailable with
     `invoice_correction.already_open`;
   - O1's availability (watcher 13:06): on the AEAT-refused receipt `goodwill` is unavailable with
     `sale.correction_not_admitted` (reason `filing_refused`), the paella (owing 18.50) is available
     and the cheesecake is not, and `extra` is available; with another payment's refund pending,
     `goodwill` is unavailable with `invoice_correction.refund_pending` and that way's `reason` names
     it; with the box's time unconfirmed, all three unavailable with `clock.unconfirmed`; no tip paid:
     `extra` unavailable with `reason: null`. For each unavailable choice, a preview of it answers
     the same code (one assertion per case, so the two cannot drift).
   Run, watch them fail (no module).
2. Write `readGiveBack` from `readRefundableTenders`, `readCancelsForRefund`, the portion bindings,
   `readCorrectableLines` (any `AppError` → `gross`), `openCorrectionOf` + `readInvoiceCorrection`,
   and the device profile's tender kinds.
3. `pnpm --filter @waitron/server exec vitest run src/give-back.test.ts`

#### Task 2: the routing and the preview — about 75 calls

Files: `give-back.ts`, new `give-back-api.ts`, their tests.

1. Tests first, for `planGiveBack`, each asserting `parts`, `leftUnderWay` and `needs`, and that
   nothing was written:
   - paella (owes 18.50) and cheesecake (6.00) ticked, 24.50: `refund 18.50`, `correction 6.00`;
     30.00: `refund 18.50`, `correction 11.50` naming no lines (I2);
   - paella alone, 18.50: `refund 18.50`; 10.00: `refund 10.00`; paella fully paid back and ticked
     with 5.00 typed: `correction 5.00`, no lines;
   - goodwill 10.00 with no cancels owed: `correction 10.00`; goodwill 25.00 with the paella owing
     18.50: `refund 18.50`, `correction 6.50` (step 2); with the switch and a 3.00 extra: `extra 3.00`
     after the refund, before the correction;
   - extra 2.00: `extra 2.00`; 4.00 of 3.00: refused `tender.refund_exceeds_payment`;
   - goodwill on a receipt filed by another box, on a full invoice naming a customer, and with the
     records needing checking: `refund 10.00`, no correction;
   - goodwill on a receipt AEAT refused: `sale.correction_not_admitted` reason `filing_refused`; the
     extra alone and the paella alone on it: `extra`, `refund`;
   - goodwill with another payment's refund pending: `invoice_correction.refund_pending`;
   - anything with a correction open: `invoice_correction.already_open`;
   - goodwill 45.00 over cash 30.00 and card 17.00, cash chosen: `correction 45.00`, `leftUnderWay 15.00`;
     the paella's 18.50 from a card holding 17.00: refused `invalid("amount")`;
   - a part payment's ticket before the table's receipt exists: goodwill gives `correction`; after
     the table's receipt took it off with money left there: `advance.taken_off_final_invoice`;
   - `needs`: refund rights only, goodwill: `["sale.rectify"]`; neither right, paella alone with
     `fromCancel`: `[]`; the same without `fromCancel`: `["sale.refund"]` (D9).
   Run, watch them fail.
2. Write `planGiveBack` (5.2), calling `readCorrectableNow` and `allocateToCancels`.
3. Mount the read and `POST …/give-back/preview` in `give-back-api.ts` (`requireSession`, `passive:
   true` for the read, `checkAccess`, as `invoice-correction-api.ts:73-101`); route tests for 200, a
   409 wait, and a till outside the receipt's zone.
4. `pnpm --filter @waitron/server exec vitest run src/give-back.test.ts src/give-back-api.test.ts`

#### Task 3: the write for cash, and resends — about 70 calls

Files: `give-back.ts`, `give-back-api.ts`, their tests; `apps/server/src/errors.ts`.

1. Tests first, through the route; each refusal asserts its code **and** that no `refunds` row, no
   `invoice_corrections` row and no drawer job was written:
   - paella + cheesecake, 24.50, cash: a plain refund of 18.50 linked to the paella's cancel, a
     correction of 6.00 filed with its corrective invoice, **one** drawer job, drawer entries totalling
     −24.50, every part `completed`;
   - goodwill 10.00 with the switch (3.00): the extra alone, then the correction filed; one drawer job;
   - goodwill 45.00 over cash 30.00 and card 17.00: cash leg 30.00, the correction open with 15.00 left
     (`underWay`), nothing filed yet;
   - filing refused inside the transaction (spy on `recordCorrection` throwing): nothing written, the
     extra included;
   - `expected` differing from the parts now: `give_back.changed`, nothing written;
   - a resend with the same ids after success answers the first result, writes nothing and opens no
     drawer (I1); the same ids with another amount: `submission.id_reused`;
   - the clock not confirmed, on a **dish-only** give-back (only plain refunds): `clock.unconfirmed`,
     nothing written (I4);
   - a request from another device than the session's: refused as `assertRequestDevice` refuses.
   Run, watch them fail.
2. Write the cash write (5.3) and the resend lookup (5.1 step 2); `give_back.changed` in `errors.ts`,
   409 in the route. Calls only existing write functions, so `scripts/write-path-tables.json` needs no
   change (run its test to show it).
3. ```sh
   pnpm --filter @waitron/server exec vitest run src/give-back.test.ts src/give-back-api.test.ts src/invoice-correction-api.test.ts src/tender-refund-api.test.ts
   pnpm exec vitest run scripts/errors-reachable.test.ts scripts/write-path-tables.test.ts
   ```

#### Task 4: the separate terminal and the one PIN — about 70 calls

Files: `give-back.ts`, `give-back-api.ts`, `apps/server/src/tender-refund-authorization.ts`, tests.

1. Tests first:
   - separate terminal, goodwill 10.00, `manualConfirmed`, supervisor PIN: the leg completed, the
     corrective filed after commit; with `fileCorrectionAutomatically` refused (spy), the leg stays
     completed and `underWay` shows the correction (case 11);
   - separate terminal, paella + cheesecake: two completed refunds on the same capture in one
     transaction (settles section 10's first point);
   - without `manualConfirmed`: `invalid("manualConfirmed")`, nothing written;
   - refund rights only, goodwill, no PIN: `authorization.not_permitted` naming `sale.rectify`; a
     supervisor holding both: done, the PIN checked once (spy `withPinCheckAhead`); holding only
     `sale.refund`: refused;
   - D9: neither right, paella alone with `fromCancel`: done, no PIN, `authorized_by` the cancel's
     approver; without `fromCancel`: asks the PIN; resent without `fromCancel` by that person:
     refused like its first send;
   - a kitchen screen, a device outside the receipt's zone, a profile taking no cash: refused as Refund
     a payment refuses them today.
   Run, watch them fail.
2. Move `withTenderRefundAuthorization`'s device checks (`:129-155`) into one function both routes
   call; the existing refund suites stay unchanged and green. Write the one-PIN authorization (5.4),
   D9's `fromCancel` and the separate-terminal write (5.3).
3. The Task 3 command, plus `src/tender-refund-authorization.test.ts`.

#### Task 5: the write for a card reader — about 65 calls

Files: `give-back.ts`, `give-back.test.ts`.

1. Tests first, with the simulated card provider the tender refund tests use:
   - goodwill 10.00 with the extra 3.00: two provider refunds in order (extra, then the leg), the
     corrective filed, both `completed`, `rest: null`;
   - the first refund left pending: `extra pending`, `correction not_started`, `rest` = the goodwill
     part; no correction row; after the provider completes it, sending `rest` with fresh ids finishes;
   - the leg declined by the provider: the correction discarded, nothing open, `refusal` names why (I5);
   - the clock stopping between the parts (staged as `clock-unconfirmed-gate.test.ts:1216-1260`): the
     first stays completed, `refusal` is `clock.unconfirmed`;
   - a resend while the first part is pending answers its state and starts nothing (I1).
   Run, watch them fail.
2. Write the sequence, with the comment stating the split across transactions (5.3).
3. The Task 3 command.

#### Task 6: approvers for two rights, the guard rows, the accountant column — about 45 calls

Files: `apps/server/src/adjustments-api.ts`, `accountant-export.ts`, `i18n/accountant-export.ts`, the
guard suites of section 7, tests.

1. Tests first: `GET /api/adjustment-approvers?permission=sale.refund&permission=sale.rectify` answers
   only people holding both, and one `permission` behaves as today; the accountant column holds the
   customer's name and tax number for a full invoice's refund and is empty for a simplified ticket's;
   the inventory and session-person rows for the three routes. Run, watch them fail.
2. Make the changes; the column's headings in English and Spanish in the export's i18n file.
3. ```sh
   pnpm --filter @waitron/server exec vitest run src/adjustments-api.test.ts src/accountant-export.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts src/till-api.session-person.test.ts
   ```

### PR 2 — till and dashboard words (Tasks 7–14)

Depends on PR 1 on `main`.

#### Task 7: the window's choice and forms, without sending — about 80 calls

Files: new `apps/till/src/widgets/give-back-dialog.ts`, `.test.ts`, `.a11y.test.ts`,
`.unsaved.test.ts`; `apps/till/src/i18n/strings.ts`; `apps/till/src/api/client.ts` (read, preview).

1. Tests first: the three choices, the extra's row showing its amount and absent with no extra; **A
   dish** lists the lines with D11's labels, the given-free one without a switch; ticking sets the
   amount from `left` (a cancelled line from `owed`), and an edit is kept; raising it up to the
   receipt's money left is accepted; an unavailable choice or line (the read's `choices`, a line's
   `available`) cannot be chosen and shows its one plain line from `codes.ts`, the others work at
   once (O1); a choice with nothing to give back is quiet with no line; the switch and O2's words; the summary box and the PIN line from
   the preview; **Give back** disabled until valid; English and Spanish; axe in both themes for each
   step; leaving with a typed amount asks first (as `tender-refund-dialog.unsaved.test.ts`).
   Run, watch them fail.
2. Write the window and client methods; words under `give_back.*` in English and Spanish (Spanish from
   the mock's `*-es-*` pictures, with section 3's words).
3. ```sh
   pnpm --filter @waitron/till exec vitest run src/widgets/give-back-dialog.test.ts src/widgets/give-back-dialog.a11y.test.ts src/widgets/give-back-dialog.unsaved.test.ts src/i18n/strings.test.ts
   ```

#### Task 8: sending, the PIN, the separate terminal and the outcome — about 85 calls

Files: new `apps/till/src/state/give-back.ts` and test; `give-back-dialog.ts`; `apps/till/src/till-app.ts`;
`client.ts`; `apps/till/src/i18n/codes.ts`.

1. Tests first: the saved attempt keeps the request and its ids; a lost answer is sent again with the
   same ids (as `state/tender-refund.test.ts` does); a `rest` is sent with fresh ids; the approvers
   list asks for every right in `needs`; a wrong PIN shows its error in place; a hand-keyed payment
   shows the terminal step (picture g) only after the preview answered, and sends `manualConfirmed`;
   the outcome for cash, card, pending, `rest`, `refusal` and `leftUnderWay` (moving to the under-way
   view); `give_back.changed` shows its message and the new preview; a case of section 4 that the
   read did not show (the state changed after the window opened) shows its sentence at the bottom
   and nothing moves. Run, watch them fail.
2. Write the state, the send, the approver step (`till-supervisor-override-dialog`, as
   `till-app.ts:10071-10100` uses it) and the outcome; `give_back.changed` and the case sentences in
   `codes.ts`.
3. ```sh
   pnpm --filter @waitron/till exec vitest run src/state/give-back.test.ts src/widgets/give-back-dialog.test.ts src/i18n/codes.test.ts
   ```

#### Task 9: the under-way view — about 60 calls

Files: `give-back-dialog.ts` and tests; `apps/till/src/state/invoice-correction.ts` (reused).

1. Tests first, moving the behavioural cases of `invoice-correction-dialog.test.ts`'s carry-on view
   (back so far, left, pending, Check again, give cash, a card step refused or changed, end refusals,
   Send again) to the new view with D12's words: **Finish** sends `/file` when the read offers a
   filing and `/close` when it says filing can never happen; **Stop here** sends `/file` with money
   left; **Cancel this money back** only with nothing back or pending; the card step sends from this
   window, with the terminal step for a hand-keyed card. Run, watch them fail.
2. Write the view.
3. `pnpm --filter @waitron/till exec vitest run src/widgets/give-back-dialog.test.ts src/state/invoice-correction.test.ts`

#### Task 10: the receipt button and Find a bill — about 60 calls

Files: `apps/till/src/screens/till-ticket-view.ts` and test; `till-app.ts`; `strings.ts`;
`till-app.test.ts`.

1. Tests first: the receipt shows one **Give money back** (`data-give-back`) where it showed two
   buttons; it opens the choice, the under-way view when `underWay` is set, or the two-step state when
   a `rest` is saved; Find a bill's row under **Money back under way** opens the under-way view; D17's
   words. Rewrite `till-app.test.ts:26182`, `:27200`, `:28060` keeping their assertions. Run, watch
   them fail.
2. Make the changes.
3. `pnpm --filter @waitron/till exec vitest run src/screens/till-ticket-view.test.ts src/till-app.test.ts`

#### Task 11: the filled window after Cancel and refund and Finish table — about 75 calls

Files: `till-app.ts`; `till-app-adjustments.test.ts`, `till-app-parties-closing.test.ts`.

1. Tests first: after Cancel and refund, and from Finish table's per-receipt Refund, the window opens
   on **A dish** with the cancelled lines ticked, their owed amount, the cancel's reason and the only
   payment this device can use chosen, and sends `fromCancel` with no PIN; a device that cannot take
   that payment says so. Rewrite `till-app-adjustments.test.ts:4088-4789` and
   the Finish table group in `till-app-parties-closing.test.ts` keeping their assertions. Run, watch them fail.
2. Make the changes; `#openTenderRefund`'s fill path is no longer reached (left for PR 3).
3. `pnpm --filter @waitron/till exec vitest run src/till-app-adjustments.test.ts src/till-app-parties.test.ts src/till-app-parties-closing.test.ts`

#### Task 12: the Pay window's Refund on a part payment — about 40 calls

Files: `till-app.ts` (`:23913-23946`); `till-app-bill-payments.test.ts`.

1. Tests first: Refund beside a part payment with its own ticket opens Give money back on that ticket,
   before and after the table's receipt took it off; rewrite `till-app-bill-payments.test.ts:4461`,
   `:8364`, `:10012-10055` keeping their assertions. Run, watch them fail.
2. Make the change.
3. `pnpm --filter @waitron/till exec vitest run src/till-app-bill-payments.test.ts`

#### Task 13: messages that name the old buttons, till and dashboard — about 50 calls

Files: `apps/till/src/i18n/codes.ts`, `strings.ts`, `help-strings.ts`;
`apps/dashboard/src/i18n/alert-messages.ts`; their tests.

1. Tests first in `codes.test.ts` / `refund-wording.test.ts`: no English till message names "Correct
   invoice", "Refund a payment" or "corrective", and no Spanish one "Rectificar factura" or "Devolver
   un pago", except the printed "Factura rectificativa"; `apps/dashboard/src/i18n/alerts.test.ts:1048-1051` with the new words.
   Run, watch them fail.
2. Reword every message `git grep -n -i -E 'correct invoice|refund a payment|corrective|correction' --
   apps/till/src/i18n/` finds: the `invoice_correction.*` codes (`codes.ts:480-557`),
   `tender.refund_needs_correction`, the part-payment messages (`:669-681`, `:1141-1171`; case 9 names
   the table's receipt), the free-item ones (`:1105`, `:1127`; `strings.ts:106`), "Refund the payment
   at a till" (`strings.ts:98`), the not-served notes (`codes.ts:617`, `strings.ts:1878`),
   `CORRECTION_NOT_ADMITTED` (`codes.ts:1063-1095`, case 1's sentence); the help bubble
   (`help-strings.ts:15`, `:84`): "Give money back to a guest: for a dish, as goodwill, or the extra
   paid on top. Waitron records it the right way." and its Spanish twin; the dashboard's two alerts
   (`alert-messages.ts:458-465`) with D12 and D17's words.
3. ```sh
   pnpm --filter @waitron/till exec vitest run src/i18n/
   pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts
   ```

#### Task 14: both till guides — about 40 calls

Files: `apps/server/src/guide/en/table-service.md`, `apps/server/src/guide/es/table-service.md`,
`apps/till/src/help-guide.ts`.

1. Replace **Refund a payment on a receipt** `{#refund-receipt}` and **Correct an invoice**
   `{#correct-invoice}` (`en/table-service.md:353-432`; Spanish from `es/table-service.md:372`) with
   one **Give money back** `{#give-money-back}` section per language: the three choices, the switch,
   How it goes back, one PIN, the separate terminal, the under-way view's buttons. Only what changes
   what staff do (CLAUDE.md §3). Change the one-line mentions in **Refund all or part of a payment**
   (`:266-267`), **Cancel a dish on a paid bill** (`:321-323`), **Finish a paid table** (`:338-344`)
   and the not-served paragraph (`:697-699`). Point `help-guide.ts`'s link at `give-money-back`.
2. ```sh
   pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts src/guide-box-word.test.ts
   pnpm --filter @waitron/till exec vitest run src/help-guide.test.ts
   pnpm exec vitest run scripts/guide-links.test.ts
   ```

**Docs in PR 2:** `docs/backlog/till.md` and `docs/backlog/fiscal.md` entries naming the two buttons;
a dated pointer in the A802 design and beside question 14 of the adviser sheet
(`docs/compliance/2026-11-19-adviser-meeting.md`) saying the buttons became one.

### PR 3 — till: remove the two old windows (Task 15)

#### Task 15: delete Refund a payment and Correct invoice from the till — about 60 calls

1. List every behavioural case in `tender-refund-dialog*.test.ts` and `invoice-correction-dialog*.test.ts`
   and name the give-back test that holds it; add any missing one first, and watch it fail with that
   code path removed (proof by deletion).
2. Delete `apps/till/src/widgets/tender-refund-dialog*.ts` and `invoice-correction-dialog*.ts`, the
   `till-app.ts` code only they reach (`#openTenderRefund`, `#openInvoiceCorrection`,
   `#renderTenderRefund`, `#renderInvoiceCorrection`, `tenderRefunding`, `invoiceCorrecting`), the
   strings only they read, and `apps/till/src/state/tender-refund.ts` if nothing else reads it. Update
   `widgets/recovery-refusal.test.ts:155` and `docs/developers/design-system.md`'s notes on the two
   windows (`:3390-3396`).
3. ```sh
   pnpm --filter @waitron/till exec vitest run src/widgets/give-back-dialog.test.ts src/widgets/recovery-refusal.test.ts src/till-app-adjustments.test.ts src/till-app.test.ts src/i18n/
   pnpm --filter @waitron/till typecheck
   ```

Delete the queue's backlog entry when PR 3 lands.

## 9. Size, order and open questions

| PR | Tasks | Production lines | Test lines | Risk |
| --- | --- | --- | --- | --- |
| 1 server | 1–6 | ~550 added (built: ~2,400) | ~1,300 added (built: ~3,100) | money, correctives, PINs |
| 2 till, dashboard words | 7–14 | ~950 added, ~300 changed | ~1,600 added or rewritten | money, PINs |
| 3 till | 15 | ~2,000 removed | ~3,000 removed | none new |

PR 1 lands first. PR 2 is large because the till must stay consistent: the receipt, the filled
window, the messages and the guides change together. A1564 (custom item) edits
`apps/till/src/till-app.ts` in lane L; expect rebases. No open pull request touches the other files
(`gh pr list`, run).

**For the owner:** none open. O1 settled (section 4); O2's words approved (12:36).

**For the watcher** (each has a default the plan builds):

- **Q1** — D11: no "Served" label, a departure from the approved screen. Default: no label.
- **Q2** — D9: keep today's rule that a cancel's approval covers its money only from the filled
  window. Default: keep (the read's I10; the earlier draft loosened it).
- **Q3** — on a card reader, a dish and the extra go as two card refunds in sequence. The alternative
  lets one refund carry the extra with part of the payment's money, a money rule change. Default: two.
- **Q4** — D14: paper unchanged. Default: unchanged.
- **Q5** — D17's words for Find a bill. Default: as written.

## 10. Not established

- Whether two completed manual refunds against one hand-keyed capture in one transaction pass
  `recordManualRefund` (Task 4's second case shows it).
- How often a card reader leaves a refund pending; the two-step state exists for it.
- What AEAT does with a corrective of a refused record (section 4's "why").

## 11. The fresh read, and what was done

`~/waitron-campaign-l/receipts/give-money-back-plan-read-1.md`. Folded in:

- **C1** (a cancelled dish's money offered twice): the read's `cancelled.back` and `left` less it
  (5.1); the amount starts from `owed`; labels for paid-back cancels; goodwill pays cancels owed first
  (5.2 step 2); Tasks 1, 2.
- **I1** (resends): look up stored rows first, never re-route, no completion on a replay, fresh ids
  for `rest` (5.1, 5.3); Tasks 3, 5.
- **I2** (more than the ticked dishes was refused): name no lines then (5.2 step 4); Task 2.
- **I3** (the window could not open on a refused receipt): any refusal falls back to `gross`; Task 1.
- **I4**: `carryNewTenderRefund`, `requireEconomicWrite`, `assertRequestDevice`; dish-only clock test.
- **I5**: a correction opens in the same transaction as its leg and is discarded if the leg fails;
  `rest` stated as kept on one till (5.3); Task 5. Limit: a leg the card company leaves pending and
  the background recovery later marks failed leaves its correction open, as Correct invoice does.
- **I6** (D10 broke "what is filed does not change"): one correction, the rest under way (5.2 step 7).
- **I7**: section 7 and the task files gained the listed tests and the dashboard alerts.
- **I8**: cases 6 and 10 added; the never-a-wait list completed; the voided row's stand-in noted; the
  "why" and options (d), (e) added to O1.
- **I9**: Task 3 split into Tasks 3 and 4; the old Task 9 into Tasks 10, 11, 12.
- **I10**: D9 now keeps today's rule (Q2).
- **Minor:** decisions numbered in one table; section 4's rows are "Case n" and the watcher's
  questions "Qn"; the Spanish page name; `allowedHere` from the server's own check; cash as one way;
  `refusal` in the answer; one PIN, checked once, on a card reader too (5.4); the route supplies `expectedSplit`; the
  checking-records path; section 3's way 3; why the accountant column; previews on the old triggers.

Not folded: none. The read's size note on PR 3 is taken (about 5,000 lines in the two windows and
their tests, `wc -l`, run, plus till-app code).
