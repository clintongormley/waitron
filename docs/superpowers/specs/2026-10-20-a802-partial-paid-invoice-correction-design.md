# A802: Correct part of a paid invoice

**PROPOSED, 2026-10-20. Full owner approval is required before a plan or build.**
This is a design milestone only. The product rules below are driver proposals except where
explicitly attributed to the owner. Approval of the design does not grant an exception to
Lane E RUNNER H2. Any proposed reach into its protected fiscal invariants needs explicit owner
approval, identifying the exact change, before implementation starts.

## Give back an overcharge and record what changed

You find a paid receipt, choose **Correct invoice**, select the wrong dishes or enter the amount
to return, and review the correction and payment together. A new corrective invoice records the
reduction. The original receipt, sale lines and fiscal record remain frozen.

For a €2.00 overcharge at 10%, the customer gets €2.00 back. The proposed correction records
−€1.82 base and −€0.18 VAT, totalling −€2.00. Base means the price before VAT. This is the owner's
gross-money rule, not a field where staff enter a base and add tax later.

A fiscal correction changes the invoiced amount. A refund records money returned from a payment.
They are separate records, linked by one operation here. An ordinary goodwill refund remains a
money action and does not acquire a fiscal correction merely because its reason resembles one.

## Decisions already made

| Owner decision                                                                                                                          | Effect on A802                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-29, retained in [A802's fiscal entry](../../backlog/fiscal.md)                                                                  | Enter the customer's VAT-inclusive money back. €2.00 at 10% means €1.82 base and €0.18 VAT.                                                                                                         |
| 2026-10-18, A802 queue                                                                                                                  | Start beside Refund on an existing paid receipt in Find bill. Select wrong lines and quantities, or enter an amount. Use `recordCorrection`, by differences, and print the corrective receipt.      |
| 2026-10-18, Q43(e), [A758 D20 and §3.8.1](2026-10-17-a758-adjustment-reasons-design.md#381-they-stay-on-the-bill--what-each-place-says) | Refunding cancelled dishes on a paid bill must issue their partial R5 in the same step once A802 is built. €5.50 at 10% means −€5.00 base and −€0.50 VAT.                                           |
| A758 D13–D15, D24, D26, D28, [§1](2026-10-17-a758-adjustment-reasons-design.md#1-what-the-owner-decided-2026-10-17-to-2026-10-19)       | Money back needs `sale.refund`, personally or by PIN. Keep the reason dropdown and required note, an action-labelled button, no cash-handover switch, and the payment method's device restrictions. |
| [A803 §3.1](2026-10-18-a803-bills-and-tables-design.md#31-one-portion-per-order-line)                                                   | Fit the move to one portion per order line. A displayed group must retain the individual identities underneath; a weighed portion is not cut into portions.                                         |

An R5 is the existing backend's corrective invoice for a simplified F2 invoice. “By differences”
means the new invoice carries just the change, not a replacement total. This proposal follows the
queue's direction to use differences. [Adviser Q31](../../compliance/asesor-questions.md#q31-correcting-an-issued-ticket--by-differences-or-by-substitution-added-2026-09-30)
is the queue's reference for the method choice. The document's [shortened list](../../compliance/asesor-questions.md#the-shortened-list-2026-10-09)
marks Q31 answered and supersedes the earlier detailed question. This milestone performs no new
legal research and adds no adviser gate to the owner's direction. A later change of filing
method would be separate work, not a reason to add substitution here.

## What the checked source says

These are source readings at checkout `7574a8bc5f0702192fe669c02a1dc92c2c624d23`, which matched
local `main` and `origin/main` when inspected. No behavioral tests, provider calls or printer
trials were run for this design. Citations identify the inspected code, not runtime proof.

| Path read                                                                                                                                                                                                                                                                       | Finding and limit                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [core/record-correction.ts:171](../../../packages/core/src/record-correction.ts#L171), [:181](../../../packages/core/src/record-correction.ts#L181), [:207](../../../packages/core/src/record-correction.ts#L207), [:263](../../../packages/core/src/record-correction.ts#L263) | Checks `sale.rectify`, bounds cumulative negative corrections by the original gross total, checks named lines belong to the original, then writes a new sale and calls the backend. Partial inputs need not name every line or distinct lines. It creates no settlement or refund. These checks alone do not establish per-line quantities or remaining VAT. |
| [core/record-sale.ts:126](../../../packages/core/src/record-sale.ts#L126) and [:148](../../../packages/core/src/record-sale.ts#L148)                                                                                                                                            | Partial corrections derive VAT from summed rounded bases per rate. They do not use `lineGross` to derive the tax. The total-equality assertion in this helper is conditional on an input base extending past cents.                                                                                                                                          |
| [fiscal-verifactu/backend.ts:394](../../../packages/fiscal-verifactu/src/backend.ts#L394), [:420](../../../packages/fiscal-verifactu/src/backend.ts#L420), [:450](../../../packages/fiscal-verifactu/src/backend.ts#L450)                                                       | Requires an original F2 record, builds R5 with `TipoRectificativa: "I"` and its original-invoice reference, appends through the existing chain, and inserts a waiting outbox row. F1 and R5 originals are refused.                                                                                                                                           |
| [cancel-credit.ts:44](../../../apps/server/src/cancel-credit.ts#L44), [working-order.ts:6858](../../../apps/server/src/working-order.ts#L6858)                                                                                                                                  | The current product correction caller credits a whole issued invoice and settles it with no tender. The surrounding placed-order cancellation refuses bills holding payments and unresolved collections. This is not a paid-receipt partial refund.                                                                                                          |
| [tender-refund-api.ts:154](../../../apps/server/src/tender-refund-api.ts#L154), [tender-refunds.ts:58](../../../apps/server/src/tender-refunds.ts#L58)                                                                                                                          | Paid-receipt Refund calls `refundSettledTender`. Cash and manually confirmed card refunds complete locally; connected card refunds reserve before provider I/O. Neither path here calls `recordCorrection`.                                                                                                                                                  |
| [tender-refund-sends.ts:128](../../../apps/server/src/tender-refund-sends.ts#L128), [:291](../../../apps/server/src/tender-refund-sends.ts#L291), [payments/store.ts:227](../../../packages/payments/src/store.ts#L227)                                                         | Provider sends follow a committed send stamp. Completion records the payment refund; these payment records do not issue a fiscal invoice. The provider operation and the database commit are separate.                                                                                                                                                       |
| [bill-refunds.ts:236](../../../apps/server/src/bill-refunds.ts#L236), [tender-refund-balance.ts:86](../../../apps/server/src/tender-refund-balance.ts#L86)                                                                                                                      | Pre-invoice bill-payment refunds are another money path. Refundable tender balance also considers those returns and provider returns, accounting for overlapping evidence rather than simply adding all tables.                                                                                                                                              |
| [line-cancel-api.ts:124](../../../apps/server/src/line-cancel-api.ts#L124), [:163](../../../apps/server/src/line-cancel-api.ts#L163), [line-cancel.ts:305](../../../apps/server/src/line-cancel.ts#L305)                                                                        | A773's paid-dish cancellation returns frozen refund-value context and checks `sale.refund` for a refund handoff. Its keep-charge adjustment records zero reduction. The refund handoff does not itself file a partial correction.                                                                                                                            |
| [cancellation-refund-value.ts:21](../../../apps/server/src/cancellation-refund-value.ts#L21)                                                                                                                                                                                    | Its positional working-line to sale-line match checks quantities and parents and returns no value on mismatch. A802 needs an authoritative identity mapping, not an assumption that current display positions always match frozen invoice lines.                                                                                                             |
| [till-ticket-view.ts:903](../../../apps/till/src/screens/till-ticket-view.ts#L903), [till-app.ts:7245](../../../apps/till/src/till-app.ts#L7245), [client.ts:3799](../../../apps/till/src/api/client.ts#L3799)                                                                  | Historical receipts expose Refund a payment, open the retained refund flow, and use the paid-transaction refund endpoints. Find bill also lists corrections and completed refunds separately in [find-bill-transactions.ts:54](../../../apps/server/src/find-bill-transactions.ts#L54).                                                                      |
| [transaction-receipt.ts:149](../../../apps/server/src/transaction-receipt.ts#L149), [receipt-issuer.ts:36](../../../apps/server/src/receipt-issuer.ts#L36)                                                                                                                      | The current receipt projection distinguishes F1/F2 from customer identity. Reusing it alone does not establish correct R5 title, reference or presentation.                                                                                                                                                                                                  |
| [record-correction.ts:236](../../../packages/core/src/record-correction.ts#L236), [backend.ts:596](../../../packages/fiscal-verifactu/src/backend.ts#L596), [envios.ts:50](../../../packages/fiscal-verifactu/src/schema/envios.ts#L50)                                         | Integrity issues are recorded while the core correction proceeds. Submission state lives separately, including waiting, sending, accepted, accepted with errors, rejected, stopped and held. The current writer does not establish the product eligibility policy proposed below.                                                                            |

## The proposed customer action

On **Find bill → Transactions → paid receipt**, show **Correct invoice** beside **Refund a payment**.
The former says “Correct an overcharge and return the difference”; the latter says “Return money
without correcting the invoice”. Labels and explanations are proposals, translated through the
normal string files. A reason alone never decides which path is fiscal.

The correction window has **Items** and **Amount**:

- **Items:** pick the original dishes and how many. Show extras, frozen prices after discounts,
  already corrected amounts and the amount still available. A dish selection includes its priced
  extras in proportion to the selected quantity. An independently wrong extra can be selected
  alone, with its parent visible. Options with no separate price stay descriptive.
- **Amount:** enter a positive amount labelled **Money back, VAT included**. At one VAT rate,
  the remaining original lines are the visible starting scope. At mixed rates, explicitly pick
  the affected original lines before entering the amount. Show the allocation across those lines
  and rates. Staff never type a VAT rate, base, tax amount or arbitrary invoice line.
- **Reason:** use A758's Void-reason dropdown; Other or a reason requiring a note reveals a required
  note. Retain the reason's id and wording at the time, the note, requester and authorizer in the
  operation. The refund's reason keeps A758's text shape. A reason is an operational explanation,
  not permission to select a legal invoice type.
- **Money:** show the total correction, any earlier refund assigned to it, and **Return now**.
  Select original payments for the remaining money. Show only methods this device may return,
  their available amounts, and any amount requiring another payment or device. Tips are separate
  and do not increase the correction. Returning a tip uses the existing refund policy separately.

The review states the original invoice number, selected quantities or amount scope, negative
gross/base/VAT per rate, money already returned and money to return now. The main action is
**Correct and refund €2.00**, or **Record correction** when earlier refunds cover it all.
Pressing it obtains any required PIN and submits one operation. There is no “Ask for approval”
step and no editable draft after the operation has been accepted.

Use shared field primitives, semantic input names, normal draft/close protection and registered
till dialogs. Fields show their own errors, with one localized message above the bottom buttons.
An action waiting for a choice or load is quiet and disabled; a request refusal alone does not
keep it disabled. A successful write followed by a failed refresh shows the saved result and a
refresh failure, not an invitation to issue again. EN/ES guides and the phone, light/dark and
keyboard presentation are part of the later build, not evidence supplied by this document.

## Amounts come from the original invoice

The server calculates the preview and recalculates before acceptance from frozen `sale_lines`,
`sales.vat_breakdown` and earlier linked corrections. It never reads today's catalogue prices or
VAT classes to price a correction. A positive correction, a VAT-only change with no gross refund,
a change of VAT classification and a replacement invoice are outside this money-back scope.
A VAT-only error needs its own workflow, not a zero-money workaround here.

The request supplies identities, choices and quantities or gross money, never authoritative
prices or tax. Reject foreign, duplicate or overlapping selections, including an extra already
included with its parent. Every corrective line names its original invoice line. The preview
also checks provider partial-refund support and usable payment capacity before acceptance;
insufficient permitted capacity sends you to another payment/device without filing anything.

**Driver proposal for allocation:** retain remaining quantity and remaining gross separately per
original sale line. Whole unit quantities use the frozen unit precision. A weighed portion is
selected whole, or gets a price reduction through Amount. With A803, select portions underneath
any grouped display; do not assume A803 has chosen whether fiscal sale lines are grouped. Require
a durable portion-to-invoice allocation before offering a grouped sale line's individual portions.

A quantity reversal takes that quantity's share of the line's remaining gross, after earlier
amount reductions. The last remaining quantity takes the remaining cents. An Amount reduction
changes the available price, not the physical quantity. Display the reduced available value
before a later quantity reversal. Zero-priced dishes remain visible but cannot create a
positive refund. Fully credited value cannot be credited again, even if a quantity remains.

Discounts and comps use the gross actually recorded on each original line, including its share
of any bill discount. Do not refund the list price or give the discount back a second time.
Missing line gross needs a deterministic allocation reconciling to the original stored per-rate
base and VAT, as the receipt reader already does for absent gross
([transaction-receipt.ts:39](../../../apps/server/src/transaction-receipt.ts#L39)). Do not silently
use that display fallback when the source lines and stored breakdown cannot be reconciled.

For Amount, distribute gross proportionally to the selected lines' remaining gross. Assign whole
cents first and then the leftover cents by largest fractional remainder, with original line
number and id breaking ties. Cap each line at its remaining value. Group those allocations by
original rate; never apply the first line's rate to the whole amount. For example, €2.00 allocated
over €11.00 at 10% and €12.10 at 21% gives €0.95 and €1.05 gross respectively. Its proposed base/VAT
split is €0.86/€0.09 and €0.87/€0.18. The credit totals −€2.00, with two rate groups.

Within each rate, derive the base from cumulative credited gross divided by `1 + rate/100`,
rounded to cents with shared exact decimal arithmetic. The new base is that cumulative target
less base already credited. VAT is gross less base. When a correction exhausts a rate group,
take its exact remaining stored base and VAT instead. This retains the original invoice's final
rounding cents. Allocate that rate's base over its affected lines deterministically, keeping the
filed rate total authoritative. Validate remaining gross, base and VAT budgets together; reject
an inconsistent history instead of changing a rate or inventing a balancing taxable line.
These arithmetic examples are design calculations, not a probe of the current writer.

**A concrete build decision remains:** today's partial writer multiplies the rounded base by the
rate. That is not equivalent for every gross amount. By arithmetic, €0.03 at 21% is €0.02 base
and €0.01 VAT when gross is preserved; rounding 21% of €0.02 instead gives €0.00. Changing
`lineGross` alone does not change that calculation. Sources: [record-sale.ts:126–156](../../../packages/core/src/record-sale.ts#L126)
and [money.ts:118–123](../../../packages/shared/src/money.ts#L118).

Exact gross is the owner's requirement. Carry an explicitly validated breakdown through the
**existing** `recordCorrection` path. The plan must first identify the necessary partial-input
contract change and trace every consumer, including whole credits. Obtain any required approval
under RUNNER H2 for that concrete change before building. Do not add a parallel writer, misuse
`wholeInvoice`, pass inconsistent totals, alter hashing or number allocation, or silently refuse
otherwise valid cents to hide rounding. Fiscal validation and exact final-remainder acceptance
must be demonstrated before the implementation can claim the proposed arithmetic works end to end.

## Link one correction to the money, once

**Recommended sequencing, for owner approval:** commit the corrective sale, its fiscal record,
the operation's immutable allocations and its refund reservation(s) in one local transaction.
Complete cash or manually confirmed terminal refunds in that transaction. Send connected-card
refunds only after it commits, using the existing provider refund machinery. Thus the fiscal
credit exists even while a card refund is pending or eventually fails. The customer action is
one correction-and-refund operation; there is no separate “file later” button for A758.

This separates invoiced value from returned money deliberately. It avoids returning money and
then discovering the correction cannot be recorded, but leaves a visible unfinished refund if
the provider does not complete it. The owner must approve that meaning of “in the same step”.
The alternative is to issue on confirmed refund completion; that would require durable
completion evidence and a defined fiscal allocation for each successful leg of a split refund.
It must never leave a successful refund to an optional later manual correction. If the owner
chooses that alternative, revise this sequencing before planning.

A standalone terminal is the exception to that ordering: staff operate it outside Waitron.
Before instructing that action, save a durable preparation id, reviewed allocation and terminal
context, reserving its line/rate and money capacity, without issuing the correction. Authorize
both permissions before this preparation. A competing operation cannot consume its allocation;
release it only after an established non-refund or completion, never on a timer. Staff then
confirm the actual return with the existing
PIN rule. If recording the correction fails afterwards, retain the preparation and terminal
evidence for **Record correction**, never another instruction to return the money. A lost or
unclear terminal outcome stays unresolved until checked on that terminal. This extra local
preparation transaction is deliberate because a database rollback cannot undo its refund.

One operation has one corrective sale and zero or more refund links. Each link records exactly
how much applied money, excluding tip, covers this correction. It can point to an earlier
completed refund or to a new reserved refund. Refunds split over two original payments still
cover one correction. Their completion does not create further fiscal credits.

The arithmetic is separate in each record: the negative correction reduces invoiced revenue
and VAT once; completed refunds reduce money held once; linking them creates neither another
sale reduction nor another cash movement. Reports must present corrected sales, refunds and
net cash/card separately. A758's cancel still records €0.00 off the paid original, with its
refund and correction linked beside it. Do not add both a negative sale and a refund as two
reductions of the same revenue. Reconcile the daily close, VAT reporting, takings and device
cash count against this distinction during the build.

**Earlier money back:** show completed refunds and their still-unassigned applied amounts. A
permitted person can explicitly assign part of one to the new correction; do not infer it from
a matching reason, date or amount. For a €10 original, a previous €3 money-only refund and a €5
correction can mean €3 already returned plus €2 new money, with one −€5 correction. Assigning
only €1 of that earlier refund means €4 new money; its other €2 remains unrelated. A €3 goodwill
refund explicitly left unrelated also stays unrelated. Pending/unknown refunds and tip amounts
cannot be used as completed money. Pre-invoice returns already reflected in final tenders are
not fresh post-invoice refunds to assign again.

Count both existing payment evidence and refund records through the established refundable
balance, without counting the same provider event twice. An imported or unmatched provider
return with no attributable completed refund needs the existing payment-resolution process
before staff can assign it. Previous fiscal corrections always consume fiscal value regardless
of their submission state. If an older correction lacks line/rate allocation that can be
reconciled from its stored facts, block a new partial correction and show that history needs
review. Do not guess a remaining quantity or generate an automatic backfill. Any proposed
manager allocation of ambiguous historical corrections needs a separate approved design.

**No-double-credit rules:** fiscal credit cannot exceed the original's remaining gross, any
selected line/quantity's remaining entitlement, or a rate group's remaining base/VAT. Assigned
earlier-refund money cannot exceed its unassigned completed applied amount. New refunds cannot
exceed either the correction's uncovered money or the original payment's refundable balance.
All of these are re-read inside the acceptance transaction. A rejected or held R5 is not erased
from the credit budget. A failed refund releases only its money reservation, not its correction.
Ordinary Refund, A758, A802 and manager recovery share these reservations. While an A802
operation has unfinished money, a new receipt refund must resume that operation or be refused;
it cannot return the same money independently and leave the operation still asking for it.

## Recover the same operation after an interruption

Persist a client submission id before sending, scoped to this original invoice. The server stores
a canonical request fingerprint covering mode, source lines/portions, quantities, gross amount,
reason, prior-refund allocations and selected new-payment legs. A repeated id with the same
meaning returns the saved operation and corrective number; another meaning is refused. PINs
never enter stored fingerprints or browser storage. A changed authorized person on an identical
retry is not another correction.

Serialize acceptance against other corrections and refund assignments for that original. Two
tills correcting the same last dish cannot both consume it. A stale preview produces a conflict
and a fresh remaining-value read, not a silently smaller correction. A replay of an accepted
operation reads its saved result before any new-allocation checks, subject to current access.
Preserve durable recovery access after reload, another authorized device or operator, and loss
of the HTTP response; browser state is not the only record of an accepted operation.

| Point reached                                     | Proposed recovery                                                                                                                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Acceptance transaction fails                      | No new correction or refund reservation commits. Do not call the provider or open the drawer.                                                                                                                                                                |
| Commit succeeds; response is lost                 | Read/replay the same submission. Return the existing correction and refund ids; do not allocate another number, send new money or queue another automatic print.                                                                                             |
| Connected refund is unsent after restart          | Resume the saved reservation through existing unsent handling. Keep the same correction.                                                                                                                                                                     |
| Send began; provider gives no attributable answer | Remain pending. Retain refund id, capture identity, amount, send stamp/count and existing-refund references. Lookup/reconciliation and existing manager resolution establish the outcome; timeout and a missing lookup match alone do not establish failure. |
| Provider returned money; outcome commit fails     | The committed reservation and send stamp survive. Reconcile that attempt and record its result once; do not create another refund to repair the local failure.                                                                                               |
| Provider establishes failure                      | Show “Correction issued; refund failed” and the amount still to return. A new permitted attempt covers that remaining money under the same correction. No second R5.                                                                                         |
| Several payments cover one correction             | Keep a per-leg result and remaining amount. A completed leg cannot be repeated; a pending leg reserves its amount and bars another attempt for that amount.                                                                                                  |
| Printer fails                                     | Correction and money states remain. Retry/copy the existing corrective document; neither refund nor drawer opening follows a reprint.                                                                                                                        |

Reuse [refundOutcome](../../../apps/server/src/bill-refunds.ts#L162), the
[connected-refund send/lookup policy](../../../apps/server/src/tender-refund-sends.ts#L349),
[durable recovery loop](../../../apps/server/src/tender-refund-recovery.ts#L22) and existing
manager evidence rules. Add the operation linkage to every relevant completion/retry/manager
path, not just the initial HTTP request. A pending refund on the original, its captured payment
or its bill must be resolved before a competing new operation. Unanswered payment attempts,
including captured-but-not-filed money, are resolved through their payment flow before A802 can
admit a paid invoice. This policy is deliberately conservative across the invoice.

## A758 uses this same service

A773's station cancellation can commit before the refund window, as A758 specifies. It does not
itself change the paid original. Abandoning that window leaves the dish cancelled and charged,
with no fiscal credit. Once you submit its refund, the server requires the cancellation ids,
frozen invoice-line/quantity mapping and remaining cancelled value, and runs the common
correction-and-refund service. Its reason and amount arrive filled in. It cannot silently fall
back to the old money-only endpoint if correction validation fails.

For the approved €62.00 example, cancelling and refunding the €5.50 Flan produces one −€5.50 R5,
base −€5.00 and VAT −€0.50, linked to that cancel and its refund. The F2 stays €62.00. Net invoiced
value is €56.50; net money is €56.50 only when the refund completes. Cancelling without Refund
produces no correction. A served-dish overcharge uses Correct invoice deliberately; a served-dish
goodwill return can still use ordinary Refund a payment.

For a later refund from a different till, show any cancelled, still-charged dishes available to
refund and allow an explicit selection. Selected cancellations use A802 and their existing ids;
a free-text reason must not fabricate that link. This extends A758's stated limitation that a
later receipt refund is unlinked, and therefore needs owner approval as part of this design.
Keep the no-cash-device handoff, no cash-handover switch and no customer-presence/cash-owed record.
The proposed unfinished state concerns an issued correction's unresolved electronic refund;
it does not introduce tracking of whether cash physically reached a guest.

## Permissions, eligibility and fiscal readiness

**Driver proposal:** require both `sale.rectify` and `sale.refund` for the combined action,
including assigning earlier money. Keep each existing domain check; a new UI must not bypass
`recordCorrection`'s permission. One approver holding both covers both checks and is recorded.
The current supervisor permission set contains both
([permissions.ts:46](../../../packages/identity/src/permissions.ts#L46)); that is source evidence,
not authority to replace the checks with a role-name test. If future role editing separates
them, offer only approvers meeting both. A758's existing refund-only approval must gain the
additional correction check rather than being treated as fiscal authority automatically.
Carry an already checked approval only for the same operation, subject to current permissions
and the normal wrong-PIN limit; never persist a PIN. A manager attesting a provider outcome
cannot change the approved correction amount, reason or invoice.

Recheck the signed-in person, active device, profile admission and all source-order zones inside
the transaction, following [tender-refund-authorization.ts:91](../../../apps/server/src/tender-refund-authorization.ts#L91).
Keep primary-node/write availability and device payment restrictions. Cash requires `take-cash`,
connected card requires the corresponding reader-card action and manual terminal refunds keep
their confirmation and PIN. A PIN cannot grant the device a forbidden payment method. No cash
fallback for a failed card refund is added here. A refund already completed on an external
terminal is evidence to record, not an operation the database can roll back.

Cash completion queues at most one audited drawer job through the current
[enqueueTenderRefundDrawer](../../../apps/server/src/receipt-print.ts#L618), using this device's
permitted drawer. No allowed drawer means the normal refund can complete without opening one.
Connected-card refunds open none. Preserve existing manual-card behavior; correction creation
and printing add no drawer action. Replays do not dispense again. Printing checks `print-receipt`
and printer scope separately; lacking a printer does not discard a committed correction.

Proposed admission policy, requiring owner approval:

| Source/history state                                                                                      | Offer a new A802 operation?                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settled, positive original F2, local original record and reconcilable frozen lines/breakdown              | Yes, subject to remaining value, payment and permission checks. Scope this first version to the current issuing node; cross-node correction needs its separate adviser qualification.                                                                                            |
| Original waiting or being sent to AEAT, accepted, or accepted with errors                                 | Yes. Show filing status; do not wait for the network. The correction enters the existing outbox. AEAT submission-in-progress is distinct from an unknown card payment/refund.                                                                                                    |
| Original rejected, stopped or held; known missing/divergent fiscal history                                | Refuse a new correction with a route to fiscal-history resolution. This is a proposed A802-specific product gate, not a claim that today's writer enforces it.                                                                                                                   |
| Integrity report contains issues                                                                          | Proposed: refuse new A802 acceptance pending fiscal review. Today's core instead logs and proceeds. This change of product gating requires explicit owner approval and an H2 assessment before planning it. Do not change ordinary-sale or whole-cancel policy as a side effect. |
| Voided invoice, corrective original, full F1, F3 or simplified invoice already replaced by a full invoice | Unavailable with an explanation. Do not infer support from a receipt's F1/F2 display flag.                                                                                                                                                                                       |
| No original record, missing allocation facts, unsettled/part-paid bill or unresolved payment/refund       | Unavailable until its own history/payment process establishes usable facts. Do not mint an original, guess a balance or refund an unknown amount.                                                                                                                                |

Read regime-specific type, source filing state and history facts through the fiscal module's
read contract; generic till/server code must not join `envios` or learn its raw state vocabulary.
A small read-contract extension may be needed. It confers no authority to rewrite or repair
history. After issuance, a rejected correction stays visible and consumes its allocation;
resolve its filing through the existing fiscal process, without automatically generating a
second correction or money return.

[A798 revision 6](2026-10-19-a798-degraded-trading-design.md#48-a-clock-behind-the-last-sale-payments-stop-question-3-pictures-8-and-9)
requires the money/fiscal clock stop to cover refunds and records. When integrated, A802 uses
that readiness boundary before acceptance and before a fresh external money send. A stop that
begins after reservation leaves the same operation recoverable. Reading provider outcomes and
recording evidence of money already returned must remain possible; restarting a money send or
appending a new fiscal record still checks readiness. No timeout is evidence of no refund.
A798's proposal is not described here as implemented. Disk refusal, append-only protections,
trusted-clock validation and primary authority are not bypassed to finish a correction.

## Corrective paper and the data it needs

The new document says **Corrective invoice**, carries its own number/date, the original invoice
reference, selected frozen descriptions, signed gross/base/VAT by original rate, reason and the
existing backend QR data. Its money section distinguishes refunded, pending and remaining;
it never prints an unconfirmed card return as completed. The original keeps its own amounts;
show related corrections/refunds beside it. A refund acknowledgment attached to A802 references
the correction instead of implying that invoiced totals have no corrective record. Ordinary
money-only acknowledgments retain their existing meaning.

Store one durable original-print intent with the correction. Printer unavailability leaves a
recoverable document outcome; a lost response cannot enqueue another original. Explicit copies
show the copy mark and never issue another invoice. Use existing document jobs and receipt
language snapshots. Physical paper delivery is not established by a queue's success state.
The [A739 payment requirements](../../backlog/till.md#a739-paying-hold--pay-and-one-payment-window)
move payment choices into one window and keep a final invoice separate from part-payment slips.
A802 corrects the settled invoice, never one of those slips. Lane F's unlanded A739 plan and
part-payment-slip proposal were read for coordination only; they supply no implemented guarantee.

**A migration is expected in a later approved build.** The current schema stores neither this
operation nor its allocation/linkage. Propose immutable operation facts and allocations, a unique
submission identity, one corrective-sale link, refund-coverage links with applied amounts, and
separate mutable recovery/print state. Record exact original sale/line ids, mode, quantity or
amount allocations, per-rate base/VAT, reason and authorizers at acceptance. Link A758's cancels
rather than editing their append-only adjustments afterwards.

This is core sale/payment coordination, not a new product domain or a new fiscal writer. If
placed in the core migration set, state that ownership reason in the future commit. Classify
immutable facts with `appendOnly()` and mutable recovery state separately; carry declarations
through the migration descriptor and manifest. New ids need declared references/export handling,
and local state needs its node ownership. Generate new migrations only after approval; never
edit shipped migrations or backfill ambiguous historical facts. Reuse any A758 link schema that
has landed by then. Exact table names and schema layout belong to the plan.

Preserve the existing whole-order cancel path and its exact whole-invoice reversal, including
its copied stored VAT breakdown and no-payments restriction. This design does not broaden it to
paid invoices, rewrite a frozen original, add F1 correction, or change fiscal numbering/hash rules.

## Owner questions before a plan

These concern product policy, not a request to repeat the settled gross-money, differences or
A758 same-step decisions:

1. **When a connected refund is pending or fails, may its correction already be issued?** Recommended:
   yes, the proposed commit-before-send sequence, with a visible unfinished refund and no second
   R5 on retry. Otherwise revise to completion-based issuance, including split-payment treatment.
2. **Keep both correction and refund permissions, and permit explicit earlier-refund assignments
   and later cancelled-dish selection?** Recommended: yes. One PIN holder needs both permissions;
   only explicitly assigned completed applied money covers a correction. This adds the fiscal
   check to A758 and replaces its later-unlinked-refund limitation.
3. **Approve the proposed source-state and history gates?** Recommended: allow waiting/sending and
   accepted originals, block rejected/stopped/held or unusable history, and block A802 on integrity
   issues. The latter differs from current log-and-proceed core behavior and requires H2 review.

## Future acceptance, not checks run

- Both entry modes and A758's paid-cancel handoff produce the reviewed delta through
  `recordCorrection`; the frozen original is byte-for-byte unchanged. Full cancellation retains
  its existing behavior; F1/F3, voided and corrective originals cannot enter A802.
- The two owner examples, mixed rates, discounts/comps, separately taxed extras, weighed portions,
  grouped portions, absent gross and repeated final-cent reductions agree across preview, stored
  lines, stored breakdown, real fiscal validation, corrective paper and VAT reports.
- Earlier €3 money back assigned wholly or partly to a €5 correction never returns that money
  again; unrelated goodwill and tips stay separate. Missing prior allocation is refused clearly.
- Two tills, double taps, lost responses and reloads produce one accepted correction and bounded
  refund coverage. Provider success plus local failure, pending/failed split legs, restarts and
  manager resolution recover the same operation without a duplicate credit or money movement.
- Permission/PIN, profile admission, method, source zones, source filing states, integrity and
  A798 readiness each have an allowed case and a refusing case. A cash replay/reprint opens no
  second drawer; a connected-card correction opens none. No provider I/O occurs under the
  local fiscal/refund transaction.
- The correction receipt is recognisably corrective at 58/80 mm, in EN/ES; screen and print states
  distinguish recorded, filing, refunded, pending and print failures. Keyboard and phone-width
  forms work in both themes. Reporting counts each fiscal reduction and each money movement once.

Possible delivery boundaries are allocation/history contracts, the common operation and recovery,
and till/A758/document integration. These are sizing boundaries, not an implementation plan or
permission to publish a partial money workflow. The parent owns review, backlog coordination and
publication; this milestone authorises none of the build.
