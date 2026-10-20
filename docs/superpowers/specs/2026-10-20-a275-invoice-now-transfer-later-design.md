# A275: Invoice now, receive a transfer later

**PROPOSED, 2026-10-20. Full owner approval is required before a plan or build.**
This is a documentation milestone. Recommendations below are author proposals unless labelled
**Owner decision**. It authorises no product change or exception to fiscal invariants. Design illustrations accompany the proposal. Fresh builder review resolved one bank-identity
clarification in §6 and reported nothing important left beyond the listed owner decisions.
That is a documentation review, not runtime qualification.

## 1. Give the customer an invoice and keep track of the debt

You finish a €5,000 group meal, issue its full invoice, and give the customer payment
instructions. The invoice exists that day. The bill says **Awaiting transfer · €5,000.00 owed**.
You can finish service and release the dining table without pretending that money arrived.
When you see the transfer in the venue's bank account, you record it against that same invoice
from the dashboard. No second invoice is issued.

**Owner decision, 2026-10-17:** issue the real invoice at the meal and leave the bill awaiting
transfer until money is recorded. Cover full F1 and simplified F2 invoices. Return a design with
one short asesor confirmation question attached, before building. The authority is
[A275's complete backlog entry](../../backlog/fiscal.md#a275-invoice-a-bill-paid-later-by-transfer-full-or-simplified-invoice--design-now-2026-10-17)
and its reference to Q42. Do not reopen the invoice-now choice or offer consumer proforma-first
as an alternative.

The goal is a usable list of debts and an honest separation of invoicing, receiving money,
delivering documents and clearing tables. This is not bank integration, automatic payment
matching, credit scoring, recurring debt collection, deposits, bad-debt VAT recovery or a new
correction mechanism. A customer saying “I sent it” is not evidence for **Money received**.

**Recommended scope choice:** support partial transfers, with a small receipts ledger owned by
a receivables module. A ledger is the retained list of money entries and their later reversals.
A full-balance-only first version is smaller, but cannot record €2,000 arriving today and €3,000
tomorrow on their own dates. This is material extra scope, so question 1 asks the owner to choose.
The rest of this proposal describes the partial-receipts recommendation, not an approved choice.

## 2. What the source actually provides

All code observations below are **UNVERIFIED, observed by reading** at
`dfa3496b728d83b0ca588d83f7928bc9e284a83f`, which matched `HEAD` and `origin/main` when
inspected. No runtime, browser, printer, provider or fiscal experiments were run. Line anchors
identify that reading; future branch changes require a new trace.

| Source                                                                                                                                                                                                                                                                         | Observation and design consequence                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [working-order.ts:6712](../../../apps/server/src/working-order.ts#L6712)                                                                                                                                                                                                       | `issueUnpaidInvoice` selects an invoice, calls `recordSale` with deferred settlement, stores receipt facts and reserves staged delivery. Reuse this orchestration rather than introduce a second invoice writer.                                          |
| [invoice-selection.ts:87](../../../apps/server/src/invoice-selection.ts#L87), [:35](../../../apps/server/src/invoice-selection.ts#L35)                                                                                                                                         | F2 selects the standard series and checks the configured limit; F1 selects the full series and validates Spanish tax id, legal name and postal address. Foreign recipients are refused.                                                                   |
| [record-sale.ts:271](../../../packages/core/src/record-sale.ts#L271), [:305](../../../packages/core/src/record-sale.ts#L305), [:356](../../../packages/core/src/record-sale.ts#L356)                                                                                           | The current writer allocates a number, snapshots issuer/recipient/VAT and calls the fiscal backend in the caller's transaction. F1 operation date currently derives from the order's opening day. A275 does not change that policy.                       |
| [till-setup.ts:105](../../../apps/server/src/till-setup.ts#L105), [working-order.ts:4181](../../../apps/server/src/working-order.ts#L4181), [till-sale.ts:512](../../../apps/server/src/till-sale.ts#L512)                                                                     | Public F1 remains disabled: setup sends `fullInvoices: false`; stored F1 issuance and direct F1 requests are refused. A231 is built with gates, not missing. A275 cannot enable it incidentally.                                                          |
| [unpaid-departure.ts:75](../../../apps/server/src/unpaid-departure.ts#L75), [:127](../../../apps/server/src/unpaid-departure.ts#L127), [:170](../../../apps/server/src/unpaid-departure.ts#L170)                                                                               | Unpaid departure authorises `sale.void`, issues missing invoices, records departure rows and closes the party. An agreed transfer is a different commercial fact. Reuse invoice/party mechanics, not a false walkout record or its permission.            |
| [sale-due.ts:24](../../../apps/server/src/sale-due.ts#L24), [list-outstanding-sales.ts:28](../../../packages/core/src/list-outstanding-sales.ts#L28)                                                                                                                           | Issued amount due is original total plus signed corrections. The outstanding list excludes settled/voided/substituted sales. Neither implements a balance after partial post-invoice receipts or receipt reversals.                                       |
| [till-sale.ts:2057](../../../apps/server/src/till-sale.ts#L2057)                                                                                                                                                                                                               | `collectOrder` replays an already settled order, otherwise accepts cash/card; an existing invoice is settled without another `recordSale`. It refuses bills holding bill payments or an unresolved collection. Transfer must not enter its card fallback. |
| [settle-sale.ts:41](../../../packages/core/src/settle-sale.ts#L41), [:88](../../../packages/core/src/settle-sale.ts#L88), [:140](../../../packages/core/src/settle-sale.ts#L140)                                                                                               | Settlement requires the complete corrected balance plus tips, inserts tenders and one settlement, and refuses a second settlement. It is not an incremental receipts API. Keep its contract.                                                              |
| [sales.ts:44](../../../packages/db/src/schema/sales.ts#L44), [:259](../../../packages/db/src/schema/sales.ts#L259), [:306](../../../packages/db/src/schema/sales.ts#L306), [classification.ts:19](../../../packages/db/src/classification.ts#L19)                              | `transfer` is a tender method. Tenders have amount/time, but no bank reference; tenders are append-only and settlement has a unique sale key. No new tender enum or editable invoice payment flag is needed.                                              |
| [till-sale.ts:349](../../../apps/server/src/till-sale.ts#L349), [:405](../../../apps/server/src/till-sale.ts#L405), [transaction-receipt.ts:149](../../../apps/server/src/transaction-receipt.ts#L149)                                                                         | The tender block treats non-cash as card; bill tender lines also have a card fallback. Historical receipt projection reads these. Transfer needs explicit presentation, never card wording or a fabricated terminal reference.                            |
| [orders-list.ts:118](../../../apps/server/src/orders-list.ts#L118), [:299](../../../apps/server/src/orders-list.ts#L299), [orders-api.ts:202](../../../apps/server/src/orders-api.ts#L202)                                                                                     | Orders derives paid/unpaid from order/settlement state, and Unpaid includes waiting and departed bills. Historical access uses `report.view`. Extend this surface rather than create a separate disconnected debt list.                                   |
| [find-bill-transactions.ts:40](../../../apps/server/src/find-bill-transactions.ts#L40), [:77](../../../apps/server/src/find-bill-transactions.ts#L77)                                                                                                                          | Find bill Transactions derives methods from tenders and includes corrections, F1s and settled ordinary sales. An unpaid F2 is not admitted by that predicate. Debt discovery and transfer receipt history need explicit integration.                      |
| [invoice-choice-delivery.ts:26](../../../apps/server/src/invoice-choice-delivery.ts#L26), [:73](../../../apps/server/src/invoice-choice-delivery.ts#L73), [invoice-delivery-actions.ts:117](../../../apps/server/src/invoice-delivery-actions.ts#L117)                         | F1 has staged email/A4 and original/retry delivery. Current email requires an F1; F2 email must not be promised from this path.                                                                                                                           |
| [receipt-print.ts:255](../../../apps/server/src/receipt-print.ts#L255), [:312](../../../apps/server/src/receipt-print.ts#L312), [till-api.ts:2545](../../../apps/server/src/till-api.ts#L2545), [orders-invoice-pdf.ts:11](../../../apps/server/src/orders-invoice-pdf.ts#L11) | Original receipt policy, reprints, document-only routes and audited PDF copies already exist. Receipt policy may skip automatic F2 paper. A275 needs an explicit issuance delivery choice; later payment is not another original.                         |
| [cash-up.ts:18](../../../packages/reporting/src/cash-up.ts#L18), [vat-summary.ts:104](../../../packages/reporting/src/vat-summary.ts#L104), [business-day.ts:286](../../../packages/reporting/src/business-day.ts#L286)                                                        | Cash-up selects tenders by settlement time, plus received bill payments and completed refunds. VAT selects issued sales. Reusing both transfer receipts and mirrored tenders unchanged would double-count money.                                          |
| [record-daily-close.ts:32](../../../packages/reporting/src/record-daily-close.ts#L32), [:172](../../../packages/reporting/src/record-daily-close.ts#L172)                                                                                                                      | Daily close freezes a chained snapshot; only physical cash lines require drawer counts. A transfer must not create a cash shortage or rewrite an old close.                                                                                               |
| [permissions.ts:45](../../../packages/identity/src/permissions.ts#L45), [:108](../../../packages/identity/src/permissions.ts#L108), [till-api.ts:2639](../../../apps/server/src/till-api.ts#L2639)                                                                             | Every role holds `sale.take_payment`; module permissions can have their own role floor. Collection also checks device tender capability and zones. Reconciliation needs a separate proposed permission.                                                   |
| [tender-refund-balance.ts:123](../../../apps/server/src/tender-refund-balance.ts#L123), [backend.ts:394](../../../packages/fiscal-verifactu/src/backend.ts#L394)                                                                                                               | Current refundable-tender projection skips transfer. The current correction backend admits original F2, not F1. Neither generic Refund nor A802 can silently become transfer repayment or an F1 remedy.                                                   |

The historical Q42 body and A275 backlog tail say F1 still needs building. The current
[A231 entry](../../backlog/fiscal.md#a231-full-invoices-at-the-till--gated-implementation-landed-2026-10-06)
and the source above supersede that software description. They do not establish that public F1
can be enabled. Its physical-paper, manual-remedy, delivery and public-path qualification gates
remain separate. The €5,000 example below is a target F1 scenario after those gates, not an
available operation on today's main.

## 3. Three independent states

| Concern      | Proposed meaning                                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invoice      | Issued once, with its number, issue/operation dates, lines, recipient and fiscal record retained. Later money never changes those facts.                                                     |
| Money        | Awaiting transfer; Part received; Paid; or Payment entry reversed. Overdue is a date badge, not a new fiscal status. Written off describes collection policy and remains distinct from paid. |
| Dining table | Occupied until staff finish service. Finishing releases the table and retains its historical party/bill links. A debt must survive the next guests using the same table.                     |

The bill is frozen for further ordering once issued. Additional dishes go on a new bill. The
working order may remain `placed` while it owes money; that must not keep a finished party
occupying its table. **Issue invoice, await transfer** does not itself finish the table. The
normal Finish table action may accept a bill whose debt has an authorised transfer arrangement,
provided every other bill is paid or similarly accounted for and existing service/edit checks
pass. Use venue-service's closing boundary; do not set party/table fields from the receipts module.
Do not insert `unpaid_departures` for an agreed transfer or change walkout policy.

For a managed transfer invoice, show:

**Still owed = original invoice + linked fiscal corrections − net receipts applied.**

Net receipts are positive receipt entries less explicit recording reversals and actual money
returned. Tips are excluded. A positive excess after a later correction is **Customer credit**,
not negative debt silently clamped away. Writeoff never enters this equation. The module owns
this current balance; an old `sale_settlements` row alone cannot answer whether a reversed
transfer is currently paid.

F2 remains available through the existing configured limit, including exactly €3,000 in this
Veri\*Factu configuration. €3,000.01 and €5,000 require the existing F1 path once enabled. F1
may also be requested below the limit. Keep current Spanish-recipient checks, series separation,
taxpayer domicile, language and operation-date policy. Never split a large bill to evade the
limit, invent a recipient, lift A741 or rewrite a filed F2 into F1. If F1 is unavailable, explain
that before acceptance; no transfer invoice is issued through an alternative fiscal path.

## 4. Offer transfer at the meal

Proposed entry: the shared Pay window's whole-bill area offers **Pay later by transfer** as a
separate action. It does not sit beside Cash/Card as though money were being taken. On an already
issued, unpaid bill, the same action records the arrangement against its existing invoice.
Counter and handheld use the same service. No new reader or Equipment choice is introduced.

The review shows invoice type and amount, customer/contact, due date, destination bank account,
delivery choice and the sentence **No money is being recorded**. The final button says
**Issue invoice, await transfer**, or **Arrange transfer for this invoice** when already issued.
Do not offer it while a payment/refund outcome is unknown, a bill holds pre-invoice payments,
another editor owns conflicting changes, or an invoice is already managed by another arrangement.
First-version mixed cash/card-before-invoice plus deferred transfer is excluded; resolve those
payments through their existing flow rather than absorb them into this ledger.

Proposed required information:

- **Contact name and one contact route**, email or phone, for chasing payment. F1 may suggest its
  legal name, but a delivery/contact person need not be the fiscal recipient. F2 contact remains
  private operational data and does not turn the invoice into an identified F1. Do not require
  a consumer tax id merely to arrange an F2 transfer.
- **Due date**, an explicit venue-local calendar date. Recommend a visible default seven calendar
  days after issue, editable to today or later; label it as payment terms, not a legal deadline.
  The next local day after that date is overdue. Do not send automatic reminders or add interest.
- **Payment reference**, generated once from the issued series/number plus a short venue/location
  discriminator. Preserve it on retries; never rely on customer names or a table number as the key.
  This requested reference is separate from the bank's actual transaction identifier.
- **Venue bank details**, one configured receiving account per location for the first version:
  beneficiary name and IBAN, with BIC optional. An authorised manager reviews the displayed account
  before enabling transfer terms. Validate syntax; do not claim ownership or bank verification.
  Staff cannot type a substitute account into a bill. Keep the account version used by each
  arrangement, so a later account change cannot redirect old instructions silently.

Missing bank configuration, required contact or F1 recipient details blocks this new arrangement
before issuance, with a route to fix the missing information. It does not suppress any independent
obligation or existing path to issue an invoice for a completed meal. A phone-only contact is
valid with paper delivery. Customer data uses autocomplete off on shared machines.

Permission proposal: `receivables.arrange`, granted from supervisor, with an existing PIN override
pattern for staff. Record requester and authoriser. The device must also admit the person, allow
`take-orders` and the order's zone, because this action commits the bill without taking money.
The declared [profile actions](../../../packages/layouts/src/device-types.ts#L38) distinguish
`take-cash`, `hand-keyed-card-payment` and `integrated-card-payment`; none is a transfer action.
Do not require or impersonate those methods for this arrangement. The owner approves the role
floor in question 2. Printing additionally requires `print-receipt` and eligible equipment.

## 5. Deliver the invoice and instructions separately

At acceptance, commit one invoice if needed and one transfer arrangement. Offer the actual
invoice now, with a separate **Payment instructions · not an invoice** companion containing
the invoice reference, original amount, due date, beneficiary and bank details. Keeping the
companion separate avoids altering frozen invoice facts when debt or bank details change.

F1 reuses its approved original receipt/A4/email-PDF workflow, recipient validation, delivery
status, original retry and duplicate rules. Confirm the email addressee explicitly; do not assume
the legal entity's contact is its consenting delivery recipient. Include instructions in that
chosen delivery, as a clearly separate attachment or message, not a second fiscal invoice. F2
uses paper through the explicit Print choice in this first version. Its contact email is for
reconciliation only; this proposal does not bypass the current F1-only email guard. A739's future
F2 email can be adopted only after its contract is landed and rechecked.

If no eligible paper destination or available F1 email route exists, ask for another delivery
choice before acceptance. A privileged **Deliver later** exception is proposed for an unavailable
destination: require a reason, preserve contact and an outstanding delivery task, and show
**Invoice issued · delivery pending**. It is a product exception, not a conclusion that legal
delivery requirements are satisfied. Question 3 asks the owner to accept or refuse it.

A printer/email failure after commit leaves the invoice and debt intact. Show delivery failed
and retry the same document attempt; never offer Issue again. Queued, transport done, emailed and
handed to customer are distinct evidence. Follow A231's original/duplicate/handover rules rather
than labelling a transport acknowledgement as customer receipt. No printer/provider call occurs
inside the invoice transaction, and none determines whether the sale exists.

Copies retain original invoice identity, amounts, dates, fiscal QR and recipient. Show current
debt in a separately labelled account-status companion, with its own as-of time, never by
replacing the original invoice total with the outstanding amount. Historical instruction copies
keep their saved account. Explicitly issuing updated instructions creates a new dated version
and warns that old instructions exist. Later receipt recording may offer a non-fiscal payment
acknowledgement; it neither reissues nor automatically reprints the invoice. Every transfer
document, retry and reprint opens **no cash drawer**.

## 6. Reconcile from Orders on the dashboard

Recommend **Orders → Unpaid → Awaiting transfer**, with overdue first and an All dates default
within that filter. Show invoice number/type, issue date, contact name, due date, original total,
received, still owed, credit/reversal/writeoff badge and delivery status. Keep walkouts and
ordinary unpaid bills distinct. Search invoice/payment reference; do not search customer data
outside the person's authorised location scope. Detail retains every receipt/reversal and the
original document links. The till's Find bill can find the same invoice and show its balance;
it does not gain a bank-reconciliation button.

Propose `receivables.view` from supervisor for the cross-day debt/contact list; the servicing
staff can see their authorised bill's debt and deliver its documents without seeing the whole
contact list. Propose `receivables.receive` and `receivables.reverse` from manager, only in an
authenticated dashboard session, alongside `sale.take_payment` for receipt recording. No
device-profile workaround applies to a genuine dashboard session. A request using device
credentials must not reach this manager route. A module export requires `report.export` and
the corresponding debt-view permission. These are new product access choices, not today's
role grants or a broad redesign of existing Orders permissions.

**Record money received** asks for positive euro amount, the bank's received date, bank reference
or transaction id, and an optional short note. Show the receiving account, invoice and current
balance. Default the amount to still owed. Require an explicit acknowledgement that the entry
comes from bank evidence; no upload of a full bank statement is required. Record operator,
server recording instant, location, account version and the factual received date separately.
No bank API, connected reader, manual-card provider row or cash drawer is involved.
Use existing trusted-write/primary admission for issuance and money recording. A275 adds no
clock, offline, fiscal-integrity or submission-status policy of its own, including no gate copied
from A802's unapproved proposal. Store the bank date without inventing a precise bank timestamp.

Partial receipts reduce the debt immediately and retain their own dates/references. For the first
version, one entry applies to one invoice, up to its current balance, with zero tip. No automatic
allocation across invoices. Overpayments are refused as invoice allocations; show the excess and
tell the manager to reconcile it outside this invoice, rather than treat it as tip or revenue.
This version is not a complete bank-statement ledger and has no unapplied-money wallet. Show that
limitation where entering an excess, without hiding the fact that the bank received more.

An actual duplicate bank payment is distinct from a duplicate request. The former is excess
money needing reconciliation; it cannot reduce the same debt twice. The latter replays the same
stored result. Require a bank transaction identifier where available. Retain one identity for that account/id,
with at most one active invoice allocation. An ordinary request cannot allocate it again, even
while an earlier recording is reversed. **Correct recording** may reuse it only by explicitly
naming that entry and its replacement: one transaction appends any required reversal and the
replacement receipt, updates the active-allocation projection and retains the same bank-event
identity. Require the expected entry/event revision and manager authority. A prior full reversal
can be the named source; concurrent replacements cannot both claim it. Changing amount, bank date
or invoice records corrected evidence and a reason without editing old entries. A bank event
reused through this linked replacement is not a newly received transfer. Its money adjustment is
the reversal/replacement net on the posting day; ordinary duplicate prevention remains in force. For a statement with no unique id, require a reference and
show a same-account/date/amount/reference duplicate warning with manager confirmation and reason.
That warning is not proof that two similar transfers are the same bank event.

**Reverse recording** appends the full negative counterpart of a selected receipt, with a required
reason and reference to it; it never deletes a tender or says money was returned. A wrong amount,
date or invoice is corrected by reversing and entering the right receipt, with the two linked.
Permit one reversal per entry, up to the still-active amount, and no reversal of a reversal.
If actual repayment has already consumed some of it, use a supervised accounting-resolution
state instead of manufacturing a full reversal. Recheck every allocation and balance inside the
transaction. The first version records no actual transfer repayments: show **Bank repayment
requires separate reconciliation** and retain any customer credit. Existing cash/card Refund
must not offer a transfer tender as a card.

## 7. Records, transactions and integration boundaries

**Proposed module:** `@waitron/receivables`, composed through the normal module and dashboard
contribution lists. It owns bank settings, transfer arrangements, contact/due-date revisions,
immutable instruction versions, receipt/reversal entries, writeoff events and its permissions.
This is a new business domain, so those tables do not enter the core migration set. Generic
server/reporting/UI code consumes declared contracts and host services, never imports the module
by name or imports a fiscal regime. The module uses `FiscalBackend` through host issuance; it
does not write fiscal tables or duplicate invoice allocation.

Each arrangement references exactly one ordinary issued sale and its working order, location
and originating node. Money entries have their own id, operation key, exact amount, actual bank
date, posting instant/day, account/reference, actor and reversal link. Ledger entries and issued
instruction versions are `appendOnly`; editable configuration/projections are `state`. Declare
foreign keys, uniqueness, classification, migration dependencies and transfer/export references
in their owning descriptors and schemas. Contacts are operational state with an edit audit, not
additional immutable fiscal recipient fields. Bank settings may be transferred as reviewed
configuration; customer/debt/receipt history is not a configuration-import payload.

**One logical local write, one transaction:** issuance plus arrangement, receipt plus projection
plus any first settlement, and reversal plus projection each commit atomically. Helpers accept
`tx`, queries on it run in turn, and no provider/bank operation occurs under the write lock.
PIN secret checks run ahead, followed by authorisation rechecks inside the transaction. Optional
document dispatch uses the existing durable delivery/queue boundary; a document failure must not
undo committed fiscal or money facts.

Use exact `Decimal` above rows and dot-decimal wire strings. Convert to recorded whole cents
only at the row, using the shared converters, including raw-SQL text reads. Do not infer money
from binary floating point, current prices, VAT changes or a screenshot of a customer transfer.

### Preserve complete settlement without pretending it supports instalments

The receipts ledger is the authority for A275 money. Before first full payment, append receipts
there without inserting partial core tenders. On the first transition to exactly zero owed,
call existing `settleSale` once with all currently active receipt amounts as transfer tenders,
their trusted original recording instants and zero tips. The separate bank date remains factual
evidence rather than an invented timestamp. Each core tender is linked to the receipt it
mirrors through module-owned unique mappings. Then move the working order to settled through
the host boundary. No new fiscal record is created. Normal non-transfer settlement is unchanged.

Before first settlement, a fully reversed receipt contributes no tender. A correction that leaves
zero due with no receipts may use the existing no-tender settlement. A correction that makes net
receipts exceed the corrected invoice leaves a customer credit in the module; do not force those
amounts through `settleSale` or alter them to fit. All managed-invoice status readers must show
that credit even if no core settlement exists. This design does not authorise a fiscal correction
caller to act merely because its amount would fit this equation.

If a receipt is later reversed, retain that settlement and its tenders as historical records.
The module balance reopens the debt; it does not delete the settlement, reopen dining service or
call `settleSale` again. Replacement receipts live in the module ledger. This deliberate limit
requires **every current-paid, owed, receipt and reporting consumer for managed invoices** to
use the contributed balance. An unmodified “settlement means paid forever” consumer would be a
defect. This is a substantial integration cost, explicitly included in question 1.

The host needs new generic contribution contracts for current receivable balances, money-report
entries and first-settlement orchestration. These contracts are proposed, not existing module
seats. No silent dependency on a finished balance hook is assumed. Their disabled-module rule
must retain readable outstanding history and refuse new money actions; disabling/removing the
module with open debts or unresolved customer credits is refused until they are resolved.
Core historical exports must
include the module ledger to explain its mirrored tenders and reversals. Historical balance and
report contributions remain installed/readable even when new arrangements are disabled, including
when all debts are paid. Removing that code or its ledger while managed history remains is refused;
otherwise old mirrored tenders could reappear in reports or reversed debt disappear.

The later implementation must trace and integrate at least `sale-due`, core outstanding-sales
callers, `collectOrder` and its integrated-card/recovery siblings, bill-payment admission,
Orders status/Still owed, Find bill's Bills/Transactions and transaction receipt, receipt/payment
blocks, refunds/cancellation, venue-service Finish table, cash-up, frozen closes and reporting
exports. Managed invoices reject ordinary collect/card/refund paths before any provider send;
otherwise a partial receipt could be collected twice. Reuse those paths only through an explicit
future approved method-switch operation, which is outside this proposal. Do not change a shared
sentinel or settlement meaning without tracing its other consumers.

**Migration decision:** yes, new module schema and host contracts are expected. The design does
not promise a migration-free button. Generate migrations only after full approval and a check of
other lanes' reservations. Follow preproduction reset policy rather than add compatibility or
backfill code. Do not edit shipped migrations, core immutable rows or protected fiscal algorithms.
An existing contract that cannot represent a proposed path is a blocker to report with its call
chain, not permission to modify a protected invariant.

### Other lanes keep their decisions

- **A739:** the unlanded payment-window plan and the 2026-10-20 part-payment-slip design were read
  in `waitron-feat-a739-payment-window`. Its explicit receipt contexts, paper/slip ownership,
  F2-delivery work and retained request ids remain its responsibility. A275 adds a separate
  deferred-invoice intent after coordination with that window. A739's ordinary pre-invoice
  part-payment slips do not become transfer instructions or justify delaying A275's invoice.
  Recheck its final APIs after landing; its partial checkpoints are not main behavior.
- **[A796 Revision 4](2026-10-19-a796-handheld-payments-design.md):** reuse its shared window,
  one Equipment receipt setting, explicit reader choice and unresolved-payment behavior. This
  design does not replace its reader/printer memory, NFC/QR or takeover decisions. Transfer
  arrangement takes no reader; reconciliation stays on dashboard. Its ordinary “final payment
  issues invoice” wording applies outside A275's already-issued-invoice path.
  Its pending implementation plan was also read in `waitron-feat-a796-handheld-payments`:
  Revision 5 retains A773's one per-bill unanswered-payment hold. A275 respects that hold and
  does not create a separate escape from an uncertain card attempt.
- **[A802](2026-10-20-a802-partial-paid-invoice-correction-design.md):** published design only,
  awaiting full approval. It proposes a paid-F2 correction/refund coupling, integrity eligibility
  and reservations; A275 inherits none of those policies automatically. A275 consumes legitimately
  recorded corrections, without invoking or broadening A802. F1 remedies and transfer repayments
  remain outside both assumed capabilities.

## 8. What each day reports

Recommend two visible sections: **Invoices issued** and **Money recorded**, with **Still owed**
as a separate operational balance. Do not present invoices minus drawer cash as a cash shortage.

| Event                                    | Invoices/VAT                                            | Money and daily close                                                                         | Debt                     |
| ---------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------ |
| Issue an unpaid €5,000 F1 on day D       | One €5,000 invoice on D, using its stored VAT breakdown | €0 transfer received; €0 added to drawer expectation                                          | €5,000 awaiting transfer |
| Record €2,000 on D+2                     | No new invoice or VAT                                   | €2,000 Transfer on its posting day                                                            | €3,000 remains           |
| Record final €3,000 on D+3               | No new invoice or VAT                                   | €3,000 Transfer; first core settlement mirrors €5,000 in total and contributes no extra money | €0, Paid                 |
| Reverse the mistaken €3,000 entry on D+4 | Original invoice unchanged                              | −€3,000 recording adjustment on D+4, explicitly not a bank refund                             | €3,000 reopened          |
| Receive/record replacement €3,000 on D+5 | Original invoice unchanged                              | +€3,000 Transfer; no second core settlement                                                   | €0, Paid                 |

For module-managed invoices, cash-up reads signed module money entries and excludes their mirrored
core transfer tenders. Every entry counts once, including receipts before full settlement and
replacements afterwards. Attribute reconciliation to **Dashboard / Transfer**, with the actual
manager and invoice location/node, not to cash taken by the issuing till. The existing cash-up
query derives tender origin from the sale, so this is a required report contribution, not behavior
obtained merely by passing `method: transfer`.

Use the venue's business-day clock, including its changeover history. The bank received date is
factual evidence; posting instant is the trusted server instant when you record the entry. Recommend
posting to the current open business day. A late-entered receipt retains its earlier bank date
but appears as a late entry in today's Money recorded, never silently in an already frozen close.
If the current day is already closed, refuse with an instruction to record in the next open day;
do not auto-reopen or choose another date. No backdated editing of frozen close rows or hashes.
Bank-date reconciliation exports show both dates and explain differences from close totals.

Show today's new transfer debts, transfer entries/adjustments and the as-of outstanding balance in
the operational close view and its retained companion snapshot. Keep that companion separate from
the existing fiscal/VAT close hash payload; do not quietly change the close hash contract. A frozen
companion retains what was known at close. Later live Orders can differ, with their as-of time.
Sales/VAT reports stay on existing issuance/correction rules. Money reports and exports use the
canonical ledger. No receipt or reversal increases sales, changes VAT or creates a cash-count row.

**Never paid:** retain the invoice and overdue debt. Propose a manager-only **Stop chasing / Write
off operationally** event with reason, actor and date, reversible by a later event. Default lists
hide it only when you choose the active-collection filter; totals disclose written-off debt
separately. It creates no payment, fiscal correction, VAT recovery or deleted history. A later
receipt is still recordable and reported as collection of written-off debt. Actual bad-debt
accounting or fiscal remedies go to the asesor's existing S6 process.

## 9. Worked boundaries and failures

- **€5,000 F1:** after F1 enablement, Harbour Kitchen issues one F1 for a Spanish customer's meal,
  sends its chosen original and instructions, and releases the table when service finishes. A
  €5,000 receipt later clears it with one core transfer tender and one settlement, no new sale,
  number, fiscal record, VAT or drawer job. Today A741 prevents the public issuance step.
- **€220 F2:** one anonymous fiscal F2, with contact Alex and a phone number held separately.
  Issue and hand over paper plus instructions. At a stored 10% breakdown of €200 base/€20 VAT,
  D counts those invoice figures; a €220 transfer on D+2 counts money only. Reprint retains
  €220, the same invoice number and no invented F1 recipient or card details.
- **Partial and excess:** €2,000 then €3,000 against €5,000 follows §8. Trying to apply €3,100
  when €3,000 remains refuses the allocation and identifies €100 excess. Do not round it away,
  convert it to tip or issue another invoice. Two €110 receipts can settle the €220 F2.
- **Wrong invoice/date/amount:** reverse the mistaken entry and record the correct one, linking
  the operations. Reversing €220 on an already-paid F2 reopens €220 operationally while its old
  settlement/tender remain immutable. Correct re-entry clears it through the ledger, not a
  second `settleSale`. Both close adjustments and the operator remain visible.
- **Correction/refund:** a legitimate €20 correction to an unpaid €220 F2 makes €200 due. If
  €220 has already been recorded, show €20 customer credit and the related correction. Do not
  fabricate a €20 return, auto-credit VAT for non-payment or invoke A802's proposed coupling.
  Ordinary Refund cannot return a transfer. Cancellation/void cannot erase a managed debt or
  its receipts; route genuine invoice errors to the supported fiscal remedy, and refuse the
  unsupported F1 case with a clear explanation.
- **Missing details or delivery:** missing account/contact/recipient stops arrangement before
  acceptance; delivery later follows the explicit exception choice. Equipment/email failure
  after issuance retains the invoice and a recoverable delivery task. A payment acknowledged
  but followed by a failed list refresh remains saved; report a load failure.
- **Bad authority or changed access:** reject unauthenticated, wrong-location, expired-session,
  forbidden-profile/zone and wrong-PIN attempts before any issuance or ledger write. Recheck
  active person and permissions inside the accepted write. A stale preview grants no authority.
- **Double tap, retry, restart or race:** retain one operation id across unanswered requests.
  Store the canonical body and result durably with unique operation and bank-allocation keys.
  Same id/body replays; changed body conflicts. Two new operations race against the same current
  revision/balance inside the transaction, so both cannot consume the last €220. A lookup of
  an unknown outcome returns stored state; do not start a new receipt or invoice to discover it.
  Failure before commit leaves no partial arrangement/receipt/settlement. A lost response after
  commit returns the committed result on replay, without another document original or drawer.

Privacy proposal: expose only name and debt on the permitted list; contact details and bank
references appear in authorised detail. No customer bank account, login credential, full statement
or transfer screenshot is required. Do not log contact/reference text or put it in URLs, fiscal
hashes, kitchen tickets or general analytics. No public payment-link endpoint is introduced.
Retain receipt/account audit facts through the venue's existing backup/export controls; define
customer-contact retention/anonymisation with the owner's privacy policy before build, separately
from retention of invoice records. Do not invent a statutory duration or make contact deletion
erase the invoice, debt or money trail.

## 10. Research premise and the attached asesor question

This design uses the owner's chosen premise from the repository research. On 2026-10-20, the
driver re-read the BOE consolidation's article 11.1 and checked the stored quotation below;
that bounded text check does not verify the wider tax treatment or provide fresh legal advice. “Answered” in that research is not evidence that the
venue's asesor gave advice or approved this product. The shortened questionnaire says no enquiry
had been sent when recorded. Old research language about current software is not current evidence.

| Provenance                                                                                                                                                                                                                                                  | Recorded words                                                                                          | Bounded use here                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Q42 mapping, Word §1.10](../../compliance/asesor-questions.md#what-happened-to-each-question-sent-on-6-october) and [research §1.10](../../compliance/research/2026-10-09-invoice-timing.md#110-a-bill-paid-later-by-bank-transfer), researched 2026-10-09 | “Invoice now, paid later: ANSWERED, lawful”                                                             | Design premise selected by the owner on 2026-10-17; not fresh legal confirmation. The mapping assigns deposits to S8 and unpaid debts to S6.                                                                                                                                                             |
| [Research §1.1](../../compliance/research/2026-10-09-invoice-timing.md#11-when-to-issue-the-invoice), stored quotation attributed to RD 1619/2012 art. 11.1                                                                                                 | “Las facturas deberán ser expedidas en el momento de realizarse la operación.”                          | Historical source basis for invoice-now; the driver re-read [BOE article 11](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696#a11) on 2026-10-20 (consolidation last updated 31/03/2026). The following paragraph has a different business-recipient deadline. No wider tax conclusion was checked. |
| [Research §1.10](../../compliance/research/2026-10-09-invoice-timing.md#110-a-bill-paid-later-by-bank-transfer) and [shortened list](../../compliance/asesor-questions.md#the-shortened-list-2026-10-09)                                                    | “Simplified invoice paid later; record the debtor? NARROWED.”; “Cash report for unpaid invoices: OPEN.” | The later mapping drops the internal-report question; neither text is adviser approval of our contact fields, reporting labels or writeoff flow. Those are explicit product proposals.                                                                                                                   |

**One short Spanish confirmation question, attached only, not sent:**

> ¿Confirma que podemos entregar la F1 o F2 al terminar la comida y registrar después su cobro
> por transferencia, conservando la factura impagada sin rectificarla automáticamente?

English meaning: Do you confirm that we can deliver the F1 or F2 when the meal ends and record
its bank-transfer payment later, retaining an unpaid invoice without automatically correcting it?

This confirms the selected path; it does not ask the asesor to choose software roles, approve
proforma-first, or silently settle S6/S8, F1 remedies, operation-date or B2B delivery questions.
Record any actual reply separately with its date and provenance.

## 11. Ordered owner questions

The parent posts **only the first unanswered question**, with its recommendation and pictures.
Answers settle policy; none alone is full-design approval.

1. **Should the first version record partial transfers and reverse recording mistakes, as proposed,
   or accept only one complete-balance receipt?** Recommend partial receipts plus the ledger and
   compensating reversals above, because actual receipt dates and reopened debt stay explainable.
   The smaller alternative cannot claim instalment/reversal support; if chosen, revise the design
   and its reporting examples before approval. Do not merely hide a partial-payment button.
2. **May supervisors authorise transfer terms and see the cross-day debt list, while only managers
   record/reverse bank receipts in the dashboard?** Recommend that split, with PIN authorisation
   for a staff-arranged bill and no till reconciliation button.
3. **May an authorised supervisor issue with delivery pending when no destination works?** Recommend
   yes, with contact, reason and a retained delivery task, rather than implying an issued invoice
   failed. This is subject to the existing delivery gates and the attached asesor confirmation.
4. **Are the proposed terms and limits acceptable: seven-day editable due date, one venue receiving
   account per location, required name plus email/phone, no excess allocation, no mixed pre-invoice
   payments and no transfer repayments in this version?** Recommend these limits; any rejected
   limit changes the reviewed scope rather than becoming an undocumented workaround.
5. **May a manager stop chasing a debt without marking it paid or changing its fiscal invoice?**
   Recommend an audited, reversible operational writeoff with separate totals and no automatic
   VAT relief. Confirm the contact-retention policy alongside this choice.
6. **Do you approve the complete revised design and its pictures for a later implementation plan?**
   This remains required after policy answers, the fresh builder check and any revisions. Public
   F1 enablement still follows A231's own gates; this approval is no fiscal-invariant exception.

The [picture guide](../../backlog/mockups/a275-invoice-now-transfer-later/README.md) describes the
five drawn boards in English/Spanish, light/dark, phone/desktop. They must show proposed behavior, the F1
gate, phone review, unpaid list, receipt/reversal and daily-close distinctions, not masquerade as
screenshots or runtime evidence.

## 12. Future acceptance, not verification performed

Build only after full design approval. Apply TDD: watch each new behavior assertion fail for its
intended reason, then implement and watch it pass. Use the real venue database and real Chromium
under the [testing guide](../../developers/testing-guide.md). Retain existing behavioral assertions.

- Check public F1 paths remain refused while disabled; after separately approved enablement,
  €5,000 F1 and €220 F2 issue exactly one ordinary sale, their correct series/number/recipient,
  stored lines/VAT, one fiscal record and waiting outbox evidence. No transfer receipt, retry,
  reversal or document copy changes those rows, fiscal bytes or series counter.
- Pin €3,000/€3,000.01, foreign/incomplete F1 recipient, missing account/contact/due date,
  already-issued arrangement, zero corrected debt and pre-invoice-payment refusals. Assert domain
  error codes and no partial writes, not just that an exception occurred.
- For €2,000/€3,000 receipts, assert module rows, per-day report amounts, still owed and exactly
  one complete core settlement with linked transfer tenders. Assert zero card-provider rows,
  provider calls and drawer jobs. Reversal after settlement reopens the contributed balance;
  replacement receipt adds no second core settlement or fiscal invoice. Assert all affected views
  agree, including core outstanding-sales callers and receipt/payment blocks.
- Check same-id replay, changed-body conflict, actual duplicate bank event, similar legitimate
  events, linked correction reusing the same bank identity, competing replacements, concurrent
  last-balance receipts, two reversals, crash/rollback and lost-response
  recovery. No test may prove idempotency using two indistinguishable fixture identities.
- Assert denied person, PIN, device/profile/zone, location, disabled module and manager-only routes
  with allowed controls. Trace all ordinary collect/pay/refund/recovery routes: managed-debt
  refusal occurs before external sends, and no cash/card fallback can consume the debt again.
- Assert issue-day VAT from frozen breakdown, partial receipt posting days, late entry after
  frozen close, negative recording adjustment, no mirrored-tender double count, dashboard
  attribution, no added cash variance and unchanged frozen-close bytes/hash. Test retained
  companion snapshots separately from live balances and bank-date exports.
- Assert correction-reduced debt, post-receipt customer credit, unsupported transfer repayment/F1
  remedy, operational writeoff and later recovery. Never interpret missing money as a correction
  or writeoff as payment. Fiscal correction tests use supported recorded history, not an assumed
  A802 implementation or an edited invoice fixture.
- Qualify original/copy/retry invoice delivery, distinct instructions, failures and recovered
  delivery without another issue or payment. Check F2 never reaches current F1-only email through
  a workaround. Render transfer wording explicitly; no card brand, change or terminal reference.
- Run fiscal golden/regression suites with
  `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `src/inmutabilidad.test.ts` **UNEDITED**.
  Approval grants no change to hashes, numbering, immutable fiscal records, alta builders,
  registration or restore behavior.
- Open and look at actual till/dashboard flows in EN/ES, light/dark, phone/desktop, with keyboard
  focus, long names/IBANs/references, validation, unsaved drafts and access refusals. Follow the
  [shared forms contract](../../developers/design-system.md#forms): shared primitives/tokens,
  semantic names, required markers, field messages, one bottom summary and recoverable requests.
  Update matching EN/ES guides. Inspect real rendered PDF/A4 and 58/80 mm raster documents for
  wrapping/QR/copy wording; perform physical printer qualification where A231 requires it.
  Drawn mockups, green string tests or a queued job do not establish visible or physical output.
