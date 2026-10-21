# A555: keep a counter full invoice's chosen delivery through payment

**Status: proposal, 2026-10-21. Full-design owner approval required before implementation.**
This is A948 phase 1 design only. The static mockups accompany the proposal; a fresh builder review precedes publication.
The single owner question is below. No product code, tests, hardware checks or gated F1 execution accompany it.
All new behavior below is proposed, except the explicitly attributed settled rules.

## Choose the original before you pay

You have an EUR84 counter bill and the customer wants a full invoice by email. Choosing email
must survive taking cash, charging a separate card machine, using a connected reader and
recovering a lost answer. Paying must not quietly replace that choice with paper.

**Recommendation:** in A739's shared Pay window, save the full-invoice recipient and choose
exactly one original: **Email PDF**, **A4**, or **Receipt printer**. Validate the choice before
accepting payment, then deliver asynchronously. A paid bill stays paid when delivery fails.
For F1, replace the ordinary final-receipt Print/Email/None controls with this invoice group;
do not show two controls that can order two different originals. Keep a saved F1 choice selected.
Without a saved F1 choice, including a switch from F2 None, start with no medium selected and
require an explicit choice before Save. Do not silently choose paper.

An F1 is the full invoice naming the customer; an F2 is the simplified invoice. An original's
delivery attempt is separate from receiving money. A retry uses the same filed invoice, while
a duplicate is a later explicitly requested document under the existing completion rules.

### One owner question for the driver to relay

**For the EUR84 full invoice, approve this complete design and its mockups with A, choosing
the original before payment, or request B, choosing delivery after payment?**

- **A, recommended: choose now.** Full invoice replaces None with an explicit choice of Email
  PDF, A4 or Receipt printer. With no choice, you correct the form before payment. A configured
  destination being temporarily unreachable does not block payment; the original waits or fails
  visibly. This keeps the delivery instruction beside the irreversible payment decision.
- **B: choose later.** After validating the invoice recipient, you may pay with “Choose delivery
  later”. The paid bill retains an original still owed and a visible delivery task. Nothing prints
  or emails automatically. This adds an undelivered-without-destination state and recovery work.

The rest of this proposal specifies A. Choosing A approves this complete design and its mockups.
Choosing B requests a revision, which must be presented before building. Neither option settles
a legal question or authorizes the public F1 switch.

## A worked EUR84 bill

At Harbour Kitchen, Order 41 contains two lunch menus at EUR36 and drinks at EUR12, totaling
EUR84 including VAT. These are illustrative product figures, not a new tax calculation rule.
You open Pay, leave Whole bill selected and choose Full invoice. In the existing recipient
editor, enter North Coast Studio SL, illustrative NIF B12345674, and its complete Spanish postal
address. Choosing Email PDF reveals a required email field; enter billing@example.invalid.
There is no consent checkbox. The customer data is illustrative, not verified identity evidence.

Save returns to Pay with **Full invoice · North Coast Studio SL · Email PDF**, the selected
invoice language and **To pay now EUR84.00**. Do not repeat the email address in that summary.
You can reopen the draft editor before submitting; a changed bill revision requires review.
If you take EUR100 cash, confirmation shows EUR16 change. A connected card charges EUR84 with
the existing tip/offline controls; a separate card machine keeps its existing manual procedure.
The saved invoice and delivery checks happen before you are instructed to charge that machine.

The successful result says **Paid EUR84.00 · Full invoice · Email queued**. It identifies the
issued invoice once known. A739's paid strip returns you to a fresh counter order; its invoice
action opens the completed order's delivery detail. No fiscal receipt or Waitron payment slip
prints for this email selection. A refresh failure says status could not be refreshed; it does
not offer to take EUR84 again. Delivery remains accessible from the existing bill lookup.

**Alternative A4:** choose A4 on the device's permitted invoice printer, for example Office A4.
The confirmation says **Full invoice · A4 · Office A4**. After payment, it says **A4 queued**,
then the transport-reported result. No receipt-printer original or courtesy email accompanies it.
If Office A4 reports an empty tray while holding the job, show the held-job guidance: load
paper and let that job continue. Do not offer a second print while it is still active.

**Offline failure:** the box remains reachable but the internet drops after the email choice is
accepted. Cash still settles locally. Email may wait, fail or have an unknown outcome according
to the existing worker's evidence. Show **Paid EUR84.00** separately from **Invoice email failed**
or **Email outcome unknown**. Reconnecting or reopening reads this order's status. A retry of
delivery never resubmits payment. Internet loss is not a declaration that a card was uncharged;
card uncertainty retains A739's unanswered request and existing recovery controls.

## Compose with A739, without a second payment window

A739 owns Park/Pay, the four amount modes, equipment selection, retained payment submissions,
per-payment non-fiscal slips and the paid strip. Its active Lane F plan and slip spec are
**unfinished, unpublished dependency documents**, read at the paths supplied for this task.
Their checkpoints are not released behavior or verification performed by this author.

The pending integration inputs are `docs/superpowers/plans/2026-10-20-a739-payment-window.md`
and `docs/superpowers/specs/2026-10-20-a739-part-payment-slip-design.md`, read in Lane F's
active checkout, not present on this publication base. Refresh them when they land. A555 may
publish this design now under the queue's overlap waiver.
Its build waits for the shared seams it changes or consumes to land or be explicitly released,
then refreshes their actual contracts. Do not copy unpublished implementation into a competing
window, payment context, F2 email worker, slip renderer or equipment chooser.

The ordinary **Print/Email/None receiptChoice** belongs to A739. It controls generic receipt
delivery and A739's eligible payment slips. The F1 **Email PDF/A4/Receipt printer** choice belongs
to the bill's full-invoice original. An F1 must not enter A739's F2 email reservation path.
Under A, None is unavailable as an F1 original, including when it was selected before F1.
Switching back to F2 before money permits it restores the ordinary choice for explicit review.

F1 Email PDF or A4 supplies a non-paper policy to A739's Waitron-slip handling: no unsolicited
Waitron slip, including on the final part. F1 Receipt printer allows A739's existing Print-slip
eligibility, including its cash rule, reader-owned-paper and manual-card exclusions. The slip
and invoice remain separately named documents with separate status; earlier slips are never
printed again at final settlement. Do not change their layout, eligibility or storage here.
Existing kitchen and collection documents keep their independently required service behavior.

Use device/profile equipment, never a location-wide invoice-printer setting. An F1 paper choice
uses the existing invoice role and its permitted receipt or A4 printer. A739's receipt/slip
equipment remains a separate role; selecting an invoice printer does not silently repoint it
or the drawer. Resolve a receipt original's actual printer too, rather than saving only the
word “receipt” and resolving a different default after payment. Reuse the approved equipment
controls; do not settle A790's separate invoice-sharing choice through this design.
If a saved destination is unavailable, show that saved choice and require an explicit replacement
before a new payment; opening the editor must not silently adopt another printer or medium.

## Every way into payment or issuance

These are proposed requirements across the existing orchestration, not claims of current F1 support.

| Entry                                                          | Required behavior                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fresh, unsent counter basket                                   | A739 persists/reconciles it before Pay. Save recipient, medium and language against that same order; accepting the window takes no money or invoice number. Preserve its existing kitchen-send boundary.                                               |
| Parked or held counter order                                   | Reopen the saved bill choice. Save dirty lines first; pay stored server facts under its edit/revision checks. Do not lose the delivery because no Place action occurs.                                                                                 |
| Sent/placed, uninvoiced counter order                          | Reuse A739's placed-order bridge without reopening or sending dishes again. Review and bind F1 delivery before payment; placement itself does not become invoice-first service.                                                                        |
| Direct cash/manual-card `/api/sales` and integrated `/api/pay` | Extend their canonical request/admission adapters to retain the same F1 selection. They must neither drop delivery nor silently issue F2. Cover any adapters retained after A739, not just the shared-window happy path.                               |
| An amount, equal shares, items, whole bill                     | All use the same F1 choice for the whole bill. A partial records money but issues no fiscal invoice; A739 alone determines any non-fiscal slip.                                                                                                        |
| Final part                                                     | Issue one F1 for the whole bill with all received tenders. Bind the final admitted F1 instruction, not an earlier payer's generic receipt preference.                                                                                                  |
| Zero total / final zero due                                    | Keep the existing whole/zero or already-issued collection path, not a zero bill contribution. Validate and bind delivery before any new issue; if already issued, collect/replay it without another invoice or original.                               |
| A later permitted edit makes a part-paid bill fully paid       | In that issuing transaction bind the valid saved F1 intent under the checked revision. Reuse A739's ownership seam for later-edit issuance; do not guess a last payer or new destination. Refuse before the edit if required invoice facts are absent. |
| Invoice already issued, then collected                         | Treat “invoice-first” as this existing issue-then-collect case, not the retired service style. Type, recipient and original history are already fixed. Collection updates money only and does not apply a new generic choice to the original.          |
| Separate unpaid issue/departure entry                          | Validate/bind delivery before issue using the same existing selector and reservation seams. Preserve that entry's money behavior; do not add a tender or a new unpaid workflow.                                                                        |

You may revise the staged recipient/delivery between completed partial payments while the bill
is unissued and no payment is unanswered, with the existing revision/editor checks. Retain the
existing refusal of F1-to-F2 downgrade after received money. Saving a new choice affects only a
future submission; it never rewrites a completed part's slip or an accepted pending attempt.
An issued F2 cannot be turned into F1 here. That would be F3, which remains outside this design.

## State and transaction boundaries

1. **Editable draft.** Pay and the recipient editor stage one bill's choices. Save them through
   the canonical invoice-choice seam with its revision check. No payment, invoice allocation or
   delivery send happens here. Cancelling keeps the previously saved choice.
2. **Payment admission freezes the submission.** In the transaction accepting a new payment,
   read authoritative bill facts and the expected invoice-choice revision. Validate recipient,
   whole-bill F1 selection, issuer/series prerequisites, locale and complete delivery instruction.
   Check configured email availability or current permitted printer identity, location and role.
   Do not probe SMTP or printer reachability. Under A, missing/malformed/forbidden destinations
   require correction; a configured destination with an external outage can be selected.
   Atomically retain the accepted F1 snapshot alongside A739's durable payment context before
   any connected-reader call. Cash/zero paths retain it in their settlement transaction. For a
   separate card machine, extend preparation/admission to retain that same context before showing
   the instruction to charge externally, then complete it when recording the result. This deliberate
   two-transaction boundary keeps the instruction frozen while the separately operated machine
   acts. Final recording uses those accepted facts. If the external charge happened and recording
   is uncertain or refused, retain that distinction and existing recovery, never invite another charge.
3. **Exact freeze point.** Server acceptance of that transaction freezes invoice type, recipient,
   invoice-choice revision, medium, destination, resolved printer and language for this submission.
   The browser retains the same body and submission identity from its first send until answered.
   Later defaults, another till's edits or a reopened chooser cannot replace those values during
   capture, loop/manager recovery or retry. An established noncharge permits a fresh submission;
   a timeout does not. Matching retries replay; changed accepted choices with the same identity
   are refused through the existing submission-conflict mechanism.
4. **Issue and settle.** The existing issuing transaction records the sale and money and binds its
   one original delivery intent to that sale. For partials, retain the bill intent without issuing;
   for an issue without payment, the checked issuing transaction is the freeze point. Use the
   accepted final payment's instruction, or the checked saved intent for a later-edit/unpaid issue.
   Do not let a missing optional delivery row erase that accepted instruction.
5. **Delivery admission and transport.** Reserve the original once under the existing sale issuance
   identity. Isolate optional reservation/rendering/admission failures from successful money and
   fiscal facts. Preserve a durable pending/failed delivery outcome even if queue admission fails;
   recover a missing reservation from its accepted intent through the existing primary worker
   machinery, without replaying money. A reservation failure must not fall through to paper.
   Recheck current delivery authority before admission; withdrawal records unavailable/failed,
   preserves the accepted target and offers explicit recovery rather than silently substituting.
6. **Read and replay.** After settlement, return the filed invoice and its delivery status. Reads
   enqueue nothing. An identical payment replay creates no charge, invoice, drawer action or new
   original attempt. Missing-admission recovery is the distinct, idempotent document operation.

Extend canonical `InvoiceDeliveryChoice`/staging and A739's accepted context as needed. Reuse
`checkedInvoiceChoiceDelivery`, `selectOrderInvoice`, `reserveInvoiceDelivery` and their status/
action seams. Do not prescribe a second API or speculative wire union. The builder must trace
every request mirror, fingerprint, finalize/recovery and issuance consumer before extending them.
Persist invoice delivery metadata and references, not PDF copies. Preserve the established print
queue's transport payloads. Render invoice facts from the filed immutable snapshots after the read
transaction; A739's non-fiscal slip storage is separate.

## Pending, failed and uncertain are different outcomes

Show money and invoice delivery on separate lines in A739's result/detail surfaces. Pending means
not yet admitted or queued; sending means claimed, not completed. “Sent to mail server” describes
email acceptance, not inbox arrival. “Printer reported complete” does not assert customer handover.
Keep the existing paper handover action separate. If status loading fails, retain the paid facts
and offer a status refresh, not Pay. Order/session identity checks protect late responses.

Preserve the existing one-original history and server-offered actions. Failed or uncertain
original retries are still original; only the existing recorded-completion rules allow a later
document to be designated duplicate. Losing the payment HTTP answer establishes neither delivery
success nor a reason for a duplicate. No automatic retry follows an unknown transport result.
Use the existing known-failure retry policy; an explicit retry keeps its own request identity.

A queued, unclaimed email/A4 original may be explicitly switched through the existing paper-
instead action, atomically ending the earlier attempt. An active send cannot be replaced. After
a failed/unknown original, expose only the actions its current status permits. An A4 held job may
still print: retain the existing check-printer-first warning on uncertainty, with no automatic
second job or new cancellation policy. A later authenticated report follows existing history
reconciliation; this design does not promise exactly-once physical output or repair A557.

Keep A554 unchanged: saved-status responses and paid summaries expose no email destination;
later email entry opens empty. The first draft field necessarily shows what you are typing.
Customer email, name, tax ID and address stay out of logs, alert text and error parameters.
Do not add consent, store invoice PDF bytes, redesign SMTP/IPP, or infer new legal rules. A444
owns operation date; B2B delivery and tax/refund/F3 decisions stay separate. No protected fiscal
writer, hash, allocator or golden test changes are authorized by this design.

## Source audit, not executed verification

Audit base: `77ab2ced8b4b85d8e530f461f01918a30f09815f`. These receipts describe inspected
source only; none establishes a passing test, physical delivery or a public F1 run.

| Source receipt                                                                                                       | Inspected behavior and design consequence                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/till-setup.ts:120`; `till-sale.ts:512`; `working-order.ts:4181`                                     | Setup advertises `fullInvoices: false`; direct F1 requests and saved-F1 payment paths have explicit refusals. Keep those gates during A555.                                                                                                                                        |
| `apps/till/src/till-app.ts:6017`, `:6154`, `:6973`; `api/client.ts:2792`                                             | Counter cash/card pass invoice data; placement explicitly saves invoice choice. The cash client spreads its invoice object, but its declared type omits delivery. Do not rely on incidental extra properties.                                                                      |
| `apps/server/src/till-api.ts:1735`, `:1777`; `till-sale.ts:184`, `:485`, `:2226`                                     | Direct route/service request types and adapter carry no delivery choice. Synchronous pay replays settled orders at `:662`; integrated admission replays at `:1128`.                                                                                                                |
| `apps/server/src/working-order.ts:4198`, `:4238`; `till-api.ts:1983`                                                 | Choice saving checks revision, unissued open/placed state and in-flight payment; normalizes recipient and delivery. Reuse those checks.                                                                                                                                            |
| `apps/server/src/invoice-selection.ts:35`, `:87`; `till-sale.ts:1237`, `:1554`, `:1721`                              | Selector validates recipient and resolves live purpose series; integrated preflight and capture/recovery use it. Delivery must accompany that frozen selection.                                                                                                                    |
| `apps/server/src/bill-payments.ts:1037`, `:644`, `:1247`; `working-order.ts:6516`, `:6712`                           | Bill admission checks choice before reservation; final issue and later-edit/unpaid issue reach common issuance. Current bill issuer requires open status and skips zero totals; A739 owns the placed/zero bridge.                                                                  |
| `apps/server/src/invoice-choice-delivery.ts:26`, `:73`; `receipt-print.ts:255`; `optional-document.ts:16`            | Staged email/A4 reserves under `issuance:<saleId>`; optional failure suppresses paper fallback. Optional savepoint handling preserves outer work, but does not itself create a durable missing-attempt task.                                                                       |
| `apps/server/src/receipt-print.ts:115`; `till-api.ts:2424`; `apps/till/src/api/client.ts:2390`                       | Invoice printing resolves device/profile equipment; canonical delivery choice has receipt/email/A4 branches. Receipt branch lacks a frozen printer id.                                                                                                                             |
| `apps/server/src/invoice-delivery.ts:64`, `:107`, `:143`, `:236`; `invoice-delivery-status.ts:279`                   | Reservation replay, active-attempt exclusion, completion-based designation and unknown claim expiry exist; status offers original retry after failed/unknown without completion.                                                                                                   |
| `apps/server/src/invoice-delivery-actions.ts:154`, `:199`; `invoice-page-print.ts:40`                                | Explicit original email retry, unclaimed switch-to-paper and per-printer A4 claim ownership exist. Reuse rather than bypass them.                                                                                                                                                  |
| `apps/server/src/invoice-email-worker.ts:69`, `:91`; `invoice-email.ts:35`; `boot.ts:1785`; `invoice-document.ts:31` | Worker commits claim before document read/send; boot projects filed sale facts; sender renders transient PDF and distinguishes SMTP refusal from uncertainty. Current projection failure reaches the worker's unknown catch; Lane F proposes a distinct pre-send failure boundary. |

## Static scenes and focused acceptance for the later build

The [static mockup README](../../backlog/mockups/a555-counter-invoice-delivery/README.md)
links recipient/delivery selection for email and A4, payment confirmation, failed email, held A4
and unknown A4 result. The EUR84 example appears in EN/ES, light/dark, at 390 and 1280 px.
The original selector replaces ordinary None; the captions identify this as proposed behavior.
Pictures demonstrate a proposal; they are not screenshots of working or enabled F1 behavior.

Use shared `wt-*` fields, semantic names, required markers, draft protection and quiet unchanged
Save. Follow the Forms contract: field errors and one bottom message, focus on the first bad
field, no top summary, and request failures alone never disable retry. Fit long recipient names
and printer names without hiding amount/actions. Register nested till dialogs and preserve focus.

Later implementation must use observed failing tests before minimal code, followed by passing
focused behavior checks. Retain existing assertions and the protected fiscal pair unedited.
Build the A555 plumbing behind the existing F1 gates, using internal/synthetic fixture paths;
public-path checks must still assert refusal until A948's separately authorized switch.
Require distinct recipients, destinations, printers and languages so substitutions are detectable:

- Direct cash/manual-card, connected card, held/placed, table/bill, zero and already-issued
  collection preserve the chosen F1 original; no F2 email or unsolicited fiscal paper/slip appears.
- Partial/final and later-edit issuance produce one whole-bill F1 with correct tender history;
  earlier slips/preferences do not take ownership. Admission rejects invalid recipient/delivery,
  stale revision and forbidden equipment before a provider call or irreversible new write.
- Lost response, restart between admission/capture/finalization, changed chooser/default and
  concurrent submissions preserve accepted facts, status and exactly one logical original intent.
- Missing queue admission, withdrawn destination, SMTP refusal/timeout, A4 hold/unknown and
  failed refresh keep money successful. Recovery retries delivery alone, without new drawer jobs.
- In an owned disposable copy, delete frozen-context use, submission-conflict checking, non-paper
  suppression and original-completion checks individually. Each must fail its intended assertion,
  alongside a legitimate allowed control; restoring the code must pass. Do not weaken guards.
- Open and inspect the composed UI in both languages/themes at phone/desktop widths; exercise
  real pointer/keyboard actions and accessibility states. Record physical paper/QR checks separately.

A948's order remains A555 design/approval/build, then separate A444 and B2B work, then a separate
public F1 switch after the owner's physical 58/80 mm paper/QR and asesor manual-remedy confirmation.
Approval of this document does not enable F1 or close those gates.
