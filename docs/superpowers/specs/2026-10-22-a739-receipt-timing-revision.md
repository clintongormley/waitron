# 2026-10-27 approved precedence

The [authoritative approved addendum](2026-10-22-a739-owner-payment-and-receipt-flow.md)
and [implementation plan](../plans/2026-10-27-a739-approved-payment-flow.md) supersede the
questions and proposals below. The owner approved payment first, next tender after each part,
and Receipt / Full invoice / None after settlement or a settling edit, with separate Print/Email.
Dismissal means None, with no durable pending choice, recovery item, timer or zone fallback.
The reader setting **Prints its own slip automatically** defaults false; true excludes a Waitron
slip, false offers its initially unticked payment checkbox. Cash/manual card have no Waitron slip.
There is no provider print control or qualification gate. Build after A948 #2122 lands and preserve
F1 in every environment. F2-to-F3 replacement remains A556; delivery of an issued F1 stays available.
Approval is already given, with inline execution by the driver. All text below remains verbatim
history, including superseded approval questions and F1-off/pending/native-control proposals.

---

# 2026-10-27 precedence: owner flow and reader-checkbox answer

The [current A739 amendment](2026-10-22-a739-owner-payment-and-receipt-flow.md) takes precedence.
Timing A is answered: next tender after each part, immediate Receipt / Full invoice / None after
settlement/issuance or a settling edit, then separate Print and Email. The edit owns its new
choice. No cash slips remains answered. The owner's 2026-10-26 ~07:00 YES requires the native-reader
checkbox initially unticked; ticking requests the reader's slip. An effective control requires
proved adapter and hardware behaviour. Current adapter probes did not forward that choice, and
physical paper remains unverified. The target native checkbox is therefore disabled pending proof.

The capability fallback is a new, unapproved owner subquestion. Durable pending choice with no
timer or zone fallback and complete revision approval are separate, unapproved questions in the
current amendment. No rebuild before agreement; A556 and the public F1/F3 gates remain separate.
All four journeys remain. The complete old body follows unchanged as history, including its former
questions and estimate.

---

# A739: when you choose the final receipt

**2026-10-22 proposed revision, awaiting owner review. Neither timing is approved.**

You should be able to take money without asking each guest how to deliver the whole bill's
receipt. The remaining choice is when to ask: **A, immediately after settlement**, or **B, when
you press Finish on an already-paid bill**. Settlement means the bill is confirmed paid in full;
Finish closes the service visit or completes the counter workflow. They are separate events.

**Author recommendation: A.** Ask while you are still with the guest. It also gives an edit that
settles the bill a natural place to ask. B lets you finish payment with fewer questions, but the
guest may have left by Finish, and the counter needs a new explicit Finish bill action.

The owner's ~07:40 answer still stands: the **settling edit owns a NEW Print / Email / None
decision**. Never inherit the most recent partial payer's choice. The ~07:50 and ~07:55 directions
request this comparison, not implementation. Owner G5 and the cash-part answer still require
eligible cash and reader payment slips, with their exclusions. The slip-choice replacement below
is proposed, not an agreed amendment.

## Compare the pictures

Each board contains the current unpublished Pay arrangement, then **A1–A3 and B1–B3** with the
payment or edit before settlement, the paid state, and the final receipt question. The phone
boards stack the screens at 390 px; desktop boards place A beside B at 1440 px. These are static
design drawings, not running product screens. “Issued” in the examples assumes successful local
issuance; it is not a status measured in this task.

| Language | Theme  | Desktop                                                           | Phone                                                                    |
| -------- | ------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| English  | Light  | [Six cases](2026-10-22-a739-receipt-timing/en-light-desktop.svg)  | [Six stacked cases](2026-10-22-a739-receipt-timing/en-light-phone.svg)   |
| English  | Dark   | [Six cases](2026-10-22-a739-receipt-timing/en-dark-desktop.svg)   | [Six stacked cases](2026-10-22-a739-receipt-timing/en-dark-phone.svg)    |
| Español  | Claro  | [Seis casos](2026-10-22-a739-receipt-timing/es-light-desktop.svg) | [Seis casos apilados](2026-10-22-a739-receipt-timing/es-light-phone.svg) |
| Español  | Oscuro | [Seis casos](2026-10-22-a739-receipt-timing/es-dark-desktop.svg)  | [Seis casos apilados](2026-10-22-a739-receipt-timing/es-dark-phone.svg)  |

The drawings use the repository's light/dark colour and type tokens. Receipt language and paper
printer are delivery choices; invoice identity remains in Bill details before issuance. Email
reveals a required Email address field, with a field error and a bottom correction message on
invalid confirmation. Print reveals the permitted printer and delivery language. Nothing is
selected for a new final decision; Confirm starts quiet and disabled until you choose. None is an
explicit decision, not the meaning of closing the question. Phone choices and actions stack.

## What moves out of Pay

The source at the reference SHA renders Print / Email / None, email address, delivery language
and Full invoice inside Pay [S1]. Its default choice is Print [S2]. A payment's accepted choice
also controls its non-fiscal slip [S5]; it is not only a final-receipt preference.

Both proposals leave amount mode, To pay now, reader selection, cash/change and card outcome in
Pay. Final delivery medium, address and delivery-language controls move to the later receipt
question. Full invoice and required customer identity remain available **before issuance**,
including before a settling edit is saved. Keep the A741 visibility gate and existing guarded
full-invoice delivery path; this proposal does not redesign that path or allow a late F1 choice.

You lose the ability to preselect final delivery for a future settlement, and a partial payer
loses Print / Email / None on Pay, its printer/language choice and its paper opt-out. An earlier
partial Email choice currently does not send that guest an individual emailed slip [S5–S6].
Neither proposal adds one. The replacement must preserve the ability to request eligible paper
and decline it; simply deleting these controls would change G5's contract.

## The six journeys

All examples use a new simplified sale. Identity is already resolved, payments are confirmed,
and the normal local issuance path succeeds before the final delivery question appears.

| Case                                     | Before settlement, common to A and B                                                                                                                                | A: immediately afterwards                                                                                                                                                                                                                     | B: only on Finish                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. One counter payer**                 | EUR30 bill. Pay shows Whole bill, EUR30 to pay, Cash / Card. For EUR50 cash, show EUR20 change. No final delivery question.                                         | **A1.** Counter operator sees Paid EUR30, EUR0 due and the new receipt question for EUR30. After confirming or explicitly choosing Later, return to the new basket with the old bill's status.                                                | **B1.** Counter operator sees Paid EUR30, EUR20 change if applicable, Receipt choice pending, and a new **Finish bill** action. Only that action opens the EUR30 receipt question. Starting the next basket does not count as Finish.                                       |
| **2. Last of three guests at a table**   | EUR30 bill, EUR10 each. Guests 1 and 2 pay EUR10, leaving EUR20 then EUR10. Their eligible slips record those historical balances. Guest 3 sees EUR10 to pay.       | **A2.** The operator who takes guest 3's confirmed payment, on a handheld or at the counter, sees the final EUR30 receipt question. The table remains open until its separate Finish table action.                                            | **B2.** After guest 3 pays, show Paid EUR30, EUR0 due, Receipt choice pending. The person who later presses **Finish table**, possibly on another device, answers for this bill. They do not become its payer.                                                              |
| **3. An edit settles without new money** | EUR30 bill; EUR10 already received, EUR20 still due. Another operator removes or discounts EUR20. Save the edit; the revised EUR10 total equals the EUR10 received. | **A3.** After the save and issuance succeed, the editing operator sees a NEW final EUR10 receipt question. At a handheld/counter it opens there; an active dashboard editor gets it beside the successful edit result. No Cash / Card action. | **B3.** The settling edit creates its own NEW pending decision. Show Revised total EUR10, EUR10 received, EUR0 due. Present that decision when staff press Finish bill/table. This defers the edit-owned question; it never assigns ownership to the earlier EUR10 payment. |

For A, a lost response or an unattended/background edit cannot display a question. For B, nobody
may ever press Finish. **Author recommendation for both: retain pending, print/send nothing
automatically, and expose recovery. Do not apply the zone rule after a timer.** A fallback could
choose paper the guest would have declined. This no-finisher policy has not been agreed.

For B, if Finish would settle a bill through cancellation of unserved dishes, do not open this
question until that operation establishes a paid bill and issuance has completed. Unpaid
departure, refunds, overpayments and dish-resolution permissions keep their existing workflows.
Where a party has several bills, Finish presents each bill's still-pending decision with its
own amount; it does not combine their fiscal documents.

## Keep each payer's slip without restoring final receipt controls to Pay

**Author's proposed replacement, part of the owner decision:** after each confirmed positive
payment, offer a small **Payment slip: Print / No paper** result row. It describes only that
payment, with its amount, bill reference, balance at payment time and “Not an invoice”. It has no
whole-bill Email/None medium, invoice identity or future receipt preference. Default to no
automatic paper; leaving the row records no paper. There is no new persistent venue setting.

Print opens the permitted slip-printer and slip-language choice and confirms one original for
that received payment. This is after payment, including for the final payer; it is not a second
Pay submission. Freeze amount and balance when money is confirmed; freeze the selected slip
printer and rendering language when Print is accepted. Never recalculate the historical balance
from the bill's later state or subtract another pending reservation. A final payer can request
their EUR10 slip and the EUR30 final receipt.
The receipt question must label these as two documents so one action never prints both by surprise.
The final receipt's Print does not silently opt earlier payers into paper.

| Payment result                                         | Proposed slip result                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Confirmed cash EUR10, EUR20 remains                    | Print can request the G5 cash slip; No paper produces none.                                                        |
| Confirmed eligible reader EUR10, EUR10 or EUR0 remains | Print can request that part's Waitron slip only when the reader is known not to provide one.                       |
| Reader supplies its own slip                           | Retain reader paper; no duplicate Waitron slip or enabled Print action.                                            |
| Reader paper capability unknown                        | Explain that Waitron slip printing is unavailable; do not guess that the reader prints nothing.                    |
| Manual card on another machine                         | No Waitron payment slip. Preserve the manual-card exclusion.                                                       |
| Pending, unknown, declined or established noncharge    | No success slip. Unknown is resolved through the existing payment recovery, never by another charge for a receipt. |

Earlier explicit slip requests remain historical facts. Choosing Email or None for the final
receipt produces no unsolicited Waitron paper; neither choice triggers a slip. Reader paper is
separate. You decline a payment slip with No paper; final None declines only the final document.
An explicit slip Print followed by final Email/None produces only the separately requested slip.
Cash/manual-card drawer rules remain independent of every document action.

This replacement changes the earlier automatic “Print choice at Pay” interaction into an explicit
request on the received-payment result. It therefore needs the owner's slip-choice subdecision.
It preserves eligible documents and opt-out, but loses pre-payment slip selection and automatic
paper on success. If the owner wants those retained, this replacement must be revised before build.

## Pending means a decision is missing, not money is missing

**Proposed state contract:** record a pending final-delivery decision as part of successful
settlement/issuance orchestration, with stable bill/sale identity, settlement cause (payment,
edit or zero-total completion) and initiating operator if known. An edit has its own cause id;
do not manufacture a payment or mutate an earlier payer's context. Keep the pending decision
separate from payment outcome, issued-document identity and table closure. Existing payment
context states cannot simply be renamed to mean this new state [S3].

On acceptance, save the answering operator, choice, destination or printer, delivery language
and request id once, then admit delivery independently. A pending record suppresses automatic
zone-policy final delivery for the affected workflow; otherwise the source's context-free path
can already print before the later question [S4]. Preserve collection-number tickets separately.
No receipt choice, failed delivery or absent operator may delay fiscal issuance. No H2 invariant
change is authorised: fiscal builders, hash chain, allocation and records remain outside scope.

**Author's recovery recommendation:** show “Receipt choice pending / Elegir ticket pendiente”
on the paid strip and bill detail, with **Choose receipt / Elegir ticket**. Add a pending-choice
filter to the existing Orders view, including closed bills, so starting another order or closing
a table cannot hide the task. A may offer Later; B may offer Later and finish. Both retain the
pending record and clear it only on an explicit Print, Email or None acceptance. There is no
silent expiry and no automatic zone fallback. No operator means pending, not implicit None.

An active dashboard editor answers in that session after a successful save under A. Under B it
sees pending and can explicitly open the same recovery action without pretending to finish a
table remotely. With no active editor, another authorised operator picks up that same decision;
record both the edit's initiator and the eventual answerer. Dashboard presentation and permission
wiring are proposed work; the traced till edit routes do not establish that integration exists [S7].

Two devices may open a question. Accept only one original choice per sale using the current
decision revision and a stable request id. Repeating the identical request returns its saved
result; a different concurrent answer reloads the accepted choice. A lost response to acceptance
means read/retry that request, not take payment again. After acceptance, closing or refreshing
does not offer a fresh original choice. Later delivery changes use explicit audited retry/copy
workflows; they cannot overwrite the accepted history.

Printer missing/withdrawn: keep the bill paid and explain unavailable, without switching printer.
Check the answering person's permissions and the current device/zone and printer-role access at
acceptance and admission. Dashboard recovery must use an authorised printer selection, not a
fabricated till identity. Receipt and payment-slip roles are checked separately; an unavailable
slip shows a clear warning and leaves its money received.
Queued, printing and transport-completed are distinct; transport completion does not prove
handover. Email rendering failure or confirmed refusal can offer a delivery-only retry. A lost
email acknowledgement is unknown; do not automatically resend it. Warn that an explicit further
send or paper retry after an uncertain physical outcome can duplicate delivery. Copies are marked
and audited; they do not reopen the drawer, charge, reissue or alter the original attempt [S8–S9].

## Issuance and special paths keep their own meaning

- **New sale:** resolve full-invoice selection and every required recipient detail before issuing,
  whether a payment or edit triggers it. A delivery email is not the taxpayer's identity. Changing
  the time of delivery selection does not move identity, document type or filed language snapshots
  past issuance [S13]. A later delivery-language rendering uses recorded facts; it does not rewrite them. Keep the pre-issuance document/content language in Bill details; the later delivery language selects a rendering of recorded facts. The build plan must distinguish these controls and test both boundaries.
- **Already-issued collection:** collect against the existing sale. Do not issue again or label it
  newly issued. If its original receipt choice/delivery already exists, show that history and the
  appropriate retry/copy action. Only a genuinely missing decision can be recovered as pending;
  collection does not replace it with the collector's preferences [S10].
- **Zero total:** use the existing no-tender completion path, with no invented zero payment or
  payment slip. After successful completion, A asks; B records pending until Finish/recovery.
  A EUR0 balance caused by a reservation or unknown card outcome is not this case [S11].
- **Unknown money or issuance failure:** do not show “Paid and issued” or start a fresh final choice.
  Keep payment/issuance recovery visible. Once recovery establishes settlement and the issued sale,
  expose the single pending decision, even if the originating device has left. No new charge.

## What can be reused, and what moves

This is an **unmeasured effort estimate from source reading**, not a runtime or completion claim.
For either timing, allow roughly **4–7 focused implementation days plus branch review/CI**;
B adds roughly **1–2 days** for the counter Finish action, multi-bill Finish and cancellation
integration. These ranges include new tests and pending recovery UI; they are not a schedule.

| Concrete component                                                                             | Reuse or proposed move                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bill-pay-dialog.ts`, `till-app.ts`, client request/state mirrors                              | Reuse four modes, equipment, cash/change, card outcomes and retained payment request ids. Move final medium/address/language controls and their field validation into a shared post-settlement question. Keep pre-issuance identity entry. Add the slip-only result row.                                                      |
| `payment-receipt-context.ts`, `order-payment-contexts.ts`, bill/whole/zero/collection adapters | Substantial contract change: separate payment/slip facts from a sale-owned pending/accepted final decision. Current immutable payment fingerprints include receipt choice; do not weaken or repurpose them in place. Decide the new storage/API contract after timing approval.                                               |
| `bill-payments.ts`, edit callers, `till-sale.ts`, `receipt-print.ts`                           | Keep money and issuance orchestration. Create pending during success, suppress final auto-delivery until acceptance, and admit the accepted original afterwards. Trace every context-free edit caller as well as live-card, restart and manager recovery.                                                                     |
| `payment-slip-print.ts`, slip renderer/status/copy paths                                       | Reuse historical amount/balance snapshots, exclusions, printer checks, stable original keys and copy audit. Split slip intent from final medium, and allow explicit original admission after known receipt of money. This changes selection timing and related expectations.                                                  |
| `invoice-delivery.ts`, email worker/PDF, original receipt/status/retry/copy paths              | Reuse document rendering, transport outcomes and original/copy history. Adapt their current payment-context lookups and the recovery loop's payment joins to the new final-decision ownership. A saved choice and delivery recovery still matter; they move after settlement.                                                 |
| Paid strip, table paid/detail views, dashboard Orders                                          | Add durable pending display/recovery. A opens the question at success; B additionally gates presentation through Finish and adds counter Finish bill. Both preserve table/dish closure checks.                                                                                                                                |
| Receipt-choice/replay tests and acceptance work                                                | Retain money, identity, fiscal, drawer, permission and historical-delivery assertions. Replace expectations specifically requiring final choice before Pay with tests at the chosen boundary; add all six journeys, missing operator/finisher, races and lost responses. Carry every existing changed-test inventory forward. |

The unpublished plan and its dated checkpoints remain untouched. They are located on branch
`feat/a739-payment-window`, SHA `3e45abdc69c0305100304d4501ca96812ba87a0b`, path
`docs/superpowers/plans/2026-10-20-a739-payment-window.md` (Task 5 at lines 414–432; Task 6 at
843–850). That plan is not present on this documentation branch, so this is an identifier, not
a repository link. No product code, tests, configuration, schema or campaign state changes here.
No tests, product build, runtime payment experiment or physical printing were performed.

## One owner decision

**Recommended package to approve or amend:** choose **A, ask immediately after confirmed
settlement**, with the separate **post-success slip Print / No paper** interaction above; retain
pending with explicit recovery and **no zone fallback** when nobody answers. This also proposes
a small post-payment receipt question in place of the earlier “no receipt screen” requirement.
It never puts final delivery back into Pay. Choosing B instead means accepting the extra counter
Finish bill action and the possibility that receipt delivery waits after the guest has left.

Until that decision, keep A739's implementation and acceptance work open. Neither the earlier
edit-owner answer nor these drawings authorise rebuilding the payment window or changing H2.

## Reference receipts: source read, not measured runtime

All source locations below refer to the **clean unpublished SHA
`3e45abdc69c0305100304d4501ca96812ba87a0b`**, read in
`/Users/clintongormley/workspace/worktrees/waitron-feat-a739-payment-window`.
`git status --porcelain=v1` returned no entries and `git rev-parse HEAD` returned that SHA.
The `nl -ba`/`rg` reads below establish source structure only; no cited test was run.

| Ref | File:line at that SHA                                                                                                                                  | Observation from the read                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | `apps/till/src/widgets/bill-pay-dialog.ts:2486–2593`                                                                                                   | Full-invoice entry, medium, conditional email validation and delivery-language fields.                                                                                                        |
| S2  | `apps/till/src/till-app.ts:17015–17022,17759–17789,18132–18163`                                                                                        | Pay initialises Print; counter success creates a new order and paid notice; handheld paid presentation is distinct.                                                                           |
| S3  | `apps/server/src/payment-receipt-context.ts:139–203,243–279`; `bill-payments.ts:1126–1151`                                                             | Choice/fingerprint/equipment are reserved per payment submission; received context links a sale with uniqueness checks.                                                                       |
| S4  | `apps/server/src/bill-payments.ts:701–779,848–864,1339–1353,1463–1470`; `receipt-print.ts:360–410`                                                     | Issuance precedes receipt queueing. Payment completion supplies its submission; edit wrapper lacks that option. Missing context reaches zone policy; accepted context takes a separate route. |
| S5  | `apps/server/src/payment-slip-print.ts:243–325`                                                                                                        | Received-money snapshot and stable slip key; medium excludes paper; manual/reader-paper/unknown capability and printer paths are distinct.                                                    |
| S6  | `apps/server/src/bill-payments-loop.ts:264–370`; `invoice-delivery.ts:64–104`                                                                          | F2 email admission requires a received sale-linked context; paper recovery joins its matching bill payment. This is not a per-part email-slip path.                                           |
| S7  | `apps/server/src/adjustments-api.ts:196–227`; `line-cancel-api.ts:218`; `working-order.ts:6365–6368`; `till-api.ts:1860–1895,3479,3514,3638,3874,3986` | Adjustment, cancellation, save and send-related callers can invoke context-free issuance. The observed adjustment/save routes require till sessions; dashboard presentation is proposed.      |
| S8  | `apps/server/src/invoice-delivery.ts:107–135,182–240,313–321,368–417`; `invoice-email.ts:34–82`                                                        | Request replay, active attempts, generations, original/duplicate designation and unknown transport outcomes are explicit.                                                                     |
| S9  | `apps/server/src/receipt-print.ts:392–410,438–470,700–717`; `receipt-email-document.ts:10–37`                                                          | Selected original admission, copy path, independent drawer job and context-bound email projection are separate seams.                                                                         |
| S10 | `apps/server/src/till-sale.ts:2445–2544`                                                                                                               | Settled replay returns the existing ticket; collection settles an outstanding existing sale and links its delivery context.                                                                   |
| S11 | `apps/server/src/bill-payments.ts:718–730`; `till-sale.ts:1124–1127`                                                                                   | Pending payment/refund blocks bill issuance; zero total has a separate no-tender path.                                                                                                        |
| S12 | `apps/till/src/till-app.ts:14845–14883`; `apps/server/src/till-api.ts:2788–2841`; `finish-party-service.ts:55–102,142–150`                             | Finish table is a separate request with party/edit and unserved-dish checks. No receipt decision is supplied in the traced client call.                                                       |
| S13 | `apps/server/src/invoice-selection.ts:87–146`; `bill-payments.ts:757–779`                                                                              | Selection reads stored invoice type/recipient, checks the full-invoice recipient and passes those facts to `recordSale` before delivery.                                                      |

Owner provenance, read as instructions rather than runtime evidence:
`/Users/clintongormley/waitron-campaign-f/questions.md:2524` (G5), `:2583` (cash yes), and the
~07:40/~07:50/~07:55 entries of 2026-10-22 in its final 40 lines. Local campaign paths identify
the source for the parent; they are not publishable repository links or new campaign edits.
