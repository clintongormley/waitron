# A275: Invoice at the meal, close by transfer

> **Approval and plan update, 2026-10-22 15:55:** Owner: “A275 looks fine”. The revised minimal
> design and pictures are approved; plan authoring, separate fresh-context review and docs-only
> publication are authorised. The [implementation plan](../plans/2026-10-22-a275-final-transfer-close.md)
> has been authored and fresh-context reviewed. Build remains pending under its separate gates.
> RUNNER H2 and public F1/delivery/physical gates remain separate. A1003 has since landed (PR #1973);
> the plan re-pins source and records the other release dependencies. The historical proposal body
> below is retained unchanged, including its then-pending approval and source observations.

**PROPOSED, 2026-10-22. Awaiting full owner approval; no plan or implementation authorised.**
All new behaviour below is proposed. [Synthetic pictures](../../backlog/mockups/a275-final-transfer-close/README.md)
illustrate the policy, not a running application.

## 1. Close the meal without tracking the bank

You finish a €220 meal, issue its F2 and close the bill as **To be paid by transfer**.
That is final in Waitron. The party leaves its table through the normal service-closing checks.
The day's close lists €220 on its own transfer line, with no cash or card movement.
Your accountant exports these invoices and reconciles the bank outside Waitron.

**Owner decision, 2026-10-21 02:40:** keep the 2026-10-17 invoice-at-meal decision for F1/F2;
close the bill and free the table as “to be paid by transfer”, a FINAL state; no awaiting-transfer
balance, later money-received entry, partial receipts, reversals, receivables ledger/module or
unpaid-debt list. Show the amount separately in the day's close and provide a dashboard export
under `report.export`. The accountant reconciles outside Waitron. Questions 2–5 are withdrawn.

This supersedes the [2026-10-20 partial-receipts proposal](2026-10-20-a275-invoice-now-transfer-later-design.md).
Its research, source audits and 40 pictures remain historical. Its question 1's partial-versus-full
receipt choice is also retired: neither later-receipt model is in this scope.

## 2. The final action

In the whole-bill area of Pay, choose **Close by transfer / Cerrar por transferencia**.
Review invoice type, total and the existing invoice-delivery choice, then press
**Issue invoice and close / Emitir factura y cerrar**. For an existing eligible issued invoice,
show **Close bill / Cerrar cuenta** and reuse that invoice. Explain before confirmation:
**Final in Waitron. Your accountant checks the bank outside Waitron.**

This is a whole-bill action with zero tip. Accept a positive, uncorrected ordinary invoice/bill
with no earlier bill payments, settlement, void, substitution, unresolved card/refund outcome,
conflicting edit or unsent changes. Refuse unsupported states before writing or contacting anything.
Retain existing trusted-clock, primary-node, fiscal, invoice-limit and recipient admission checks.
Do not split a large bill, invent recipient details, bypass F1 gates or absorb existing payments.

For seated service, close each eligible bill independently. Keep its party and table open while
another bill or unfinished service prevents release. When every sibling bill is final and the
existing service, revision and editor checks pass, close through the party/service boundary,
retaining historical links and the department's clearing requirement. Tell staff what still needs
finishing without refusing this bill's transfer closure. Counter has no table to release.
Do not use an unpaid-departure row, `sale.void` or a walkout reason.

Keep the invoice's number, dates, issuer, recipient, lines, VAT, fiscal record and outbox facts.
The closed bill takes no further orders or edits; further dishes need a new bill.
Issue once if missing; otherwise settle/classify the original. Proposed internal representation:
one existing `transfer` tender for the full total, zero tip and null cash-tendered, one settlement
at the trusted closure instant, and the normal terminal working-order transition. Here that tender
records **final transfer classification**, not bank receipt. No new tender enum or debt domain.
Keep `settleSale`'s complete-balance contract; add explicit orchestration rather than passing
transfer through today's cash/card collection route. Retain actor, origin, invoice and operation id
in durable closure/replay facts. This is a proposed use of existing storage, not a working API claim.

No cash/card payment, payment-provider row/call, terminal reference, reader attempt, drawer job or change.
There is no bank setup, contact collection, due date, bank reference or transfer-instruction editor.
There is no later receipt, receipt reversal, debt reopening, collection or writeoff action.
Ordinary supported fiscal remedies remain separate; this action adds none, automatically credits
nothing, and offers no cash/card refund of a transfer. A mistaken classification needs separate
operator/accountant handling outside this feature; do not relabel it as a recording reversal.

## 3. Retry and delivery

Keep one operation id and canonical intent across double taps, lost responses and restarts.
The same id and intent return the stored invoice/closure result; changed intent conflicts.
Recheck revisions, authority and finality inside one write transaction. Competing new ids cannot
issue, classify or close the same bill twice. Failure before commit leaves no partial issue/closure;
a committed result survives a lost response. A fresh action against a final bill shows its retained
result and offers no second collection. Replays repeat no document original or hardware effect.

Invoice issuance, transfer classification, terminal bill state and replay facts commit together.
Include party closure in that transaction only when the table-release checks pass; otherwise retain
the open party for its remaining bills/service. Queries on the transaction run in turn. Dispatch documents afterwards through
the retained delivery/queue boundary. Delivery failure keeps the bill closed and invoice issued;
retry delivery of that invoice. A failed refresh is a load failure, not permission to issue again.

Use F2 paper delivery and the existing gated F1 original/copy/retry rules, composing with A555/A739
when released. Do not add a deliver-later exception or assume an F2 email API exists. Copies keep
invoice identity and the final transfer wording. Delivery must not imply that the bank paid.
Printing still requires its own device action and never opens a drawer.

## 4. Close, history and accountant export

Label the bill, Orders detail, Find bill, receipt preview/thermal/A4/PDF and copies explicitly
**To be paid by transfer / A pagar por transferencia**. History is closed, with this classification,
and excluded from unpaid/outstanding/collectable lists. Never show Awaiting transfer, Money received,
Part received, a debt balance, card branding, Paid by card or bank-confirmed status for this action.

In the daily close, show **To be paid by transfer** separately from Cash and Card, by closure
business day using the venue's clock/changeover rules and originating node/device scope.
Include it once in **Bills closed**; never in cash expectation, cash variance or card totals.
Label that total **Bills closed / Cuentas cerradas**, not money received. Update overview and
Sales presentation too, so an aggregate cannot imply bank receipt. Keep invoice/VAT reporting on
the existing issuance rules. Reuse the frozen close's existing by-method transfer line; do not
rewrite prior snapshots, alter the close hash shape or add a parallel debt snapshot.
Refuse a new transfer closure into an already frozen business day, while allowing exact replay.

Propose **Dashboard → Reports → Closed by transfer → Export CSV**, gated by `report.export`;
viewing reports/history keeps the existing `report.view` boundary. This export is new work, not
an existing endpoint. Filter by closure-business-day range and authorised location/node scope.
One row per invoice: invoice id, series/number, F1/F2, issue date, closure instant/business day,
location/node, existing fiscal recipient name/tax id where present, currency, original base/VAT/
gross totals and final classification. F2 stays anonymous; require no extra customer identity.
Use frozen invoice facts, stable ordering and safe CSV quoting/formula handling. No bank-received
date, customer-debt columns, reconciliation flag or hidden bank matching. Include linked fiscal
remedy identifiers if present so the original is not silently erased or treated as a net receipt.

| Worked example                          | Meal day D                                                                                                        | Later days                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| €220 F2, stored €200 base + €20 VAT     | One F2; closed; table released subject to clearing. Transfer line €220; Cash €0; Card €0. Export one €220 row.    | Bank activity has no Waitron entry or status change.                                           |
| €5,000 F1, **future enabled path only** | Same final policy with validated F1 recipient and chosen original delivery. Transfer line €5,000; export one row. | Accountant reconciles outside Waitron. Public F1 remains unavailable until separately enabled. |

## 5. Access, fiscal gates and integration

Recommend existing `sale.take_payment`, with an active signed-in person on an active permitted
device, and a proposed explicit **close-by-transfer** profile action. Add it to profile editing,
validation and server checks; existing profiles do not gain it silently. This needs no new person
permission or receivables role. Apply the existing location/zone admission to every affected bill
and party, rechecking device/profile and person authority at the write. A hidden button is no gate.

Public F1 stays disabled. Preserve A231/A741 qualification, A555/A948 delivery and enablement
gates, physical 58/80 mm/QR checks, manual-remedy approval and applicable B2B delivery work.
The €220 F2 stays within the existing configured limit; €5,000 never uses an F2 workaround.
In-flight A696 (clock), A739 (Pay) and A1003 (fiscal integrity) are future integration dependencies:
retrace their released contracts before build, without treating them as blanket design blockers.

## 6. Fresh source observations, not runtime evidence

**READ ONLY / runtime UNVERIFIED**, inspected 2026-10-22 at base
`b1205498b60170a14204ad688c9ce035eb64d85f`. No app, test, printer, provider or fiscal run.
These are reading anchors, not receipts that the proposed behaviour works.

| Source (`file:line`)                                                                                                                                                                        | Read observation and required consequence                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/working-order.ts:6576`; `packages/core/src/record-sale.ts:164,341,356`                                                                                                     | Deferred issuance uses `recordSale` and the fiscal backend; reuse this writer, not a second invoice implementation.                            |
| `apps/server/src/invoice-selection.ts:35,87`; `apps/server/src/working-order.ts:4044`; `apps/server/src/till-setup.ts:118`                                                                  | Recipient/limit selection and public F1 refusal exist; keep them.                                                                              |
| `packages/core/src/settle-sale.ts:41,76,88,140`; `packages/db/src/schema/sales.ts:44,259,306`; `packages/db/src/classification.ts:19`                                                       | Complete settlement, transfer enum, unique sale settlement and append-only declarations exist; no incremental receipts API is inferred.        |
| `apps/server/src/till-sale.ts:2096,2131,2150`; `apps/server/src/till-api.ts:2655`                                                                                                           | Collection replays final orders, accepts cash/card, then authorises tender/zone use; add a separate explicit transfer branch.                  |
| `apps/server/src/finish-party-service.ts:90`; `apps/server/src/parties.ts:675,707,775`; `apps/server/src/unpaid-departure.ts:77,128,170`                                                    | Both service and party closure check bills; preserve service handling, family links and clearing, without adopting walkout semantics.          |
| `apps/server/src/till-sale.ts:368,414`; `apps/server/src/transaction-receipt.ts:119`; `apps/server/src/receipt-document.ts:391`; `apps/till/src/screens/till-ticket-view.ts:170`            | Receipt projections/renderers have cash/card assumptions. Extend shared document inputs and every renderer explicitly.                         |
| `apps/server/src/orders-list.ts:118,299,887`; `packages/core/src/list-outstanding-sales.ts:28`; `apps/server/src/find-bill-transactions.ts:40,77`                                           | Settlement drives paid/outstanding predicates and transaction discovery; closed transfer needs explicit wording, not another collectable list. |
| `packages/reporting/src/cash-up.ts:18,75`; `packages/reporting/src/business-day.ts:286`; `packages/reporting/src/vat-summary.ts:104`; `packages/reporting/src/record-daily-close.ts:32,172` | Tender-time aggregation and cash-only counts support separate classification; verify end-to-end close presentation and freezing later.         |
| `apps/server/src/report-api.ts:65,282,296`; `apps/dashboard/src/screens/dashboard-sales-screen.ts:659`; `apps/dashboard/src/screens/dashboard-overview-screen.ts:207`                       | Export permission exists, raw method/aggregate consumers need presentation work; no transfer-invoice export is claimed.                        |
| `packages/identity/src/permissions.ts:45,68`; `packages/layouts/src/device-types.ts:18,37`; `apps/server/src/device-session.ts:359,395`                                                     | Person permission exists; listed profile/tender actions have no transfer action. The proposed action must be added, not assumed.               |
| `apps/server/src/invoice-choice-delivery.ts:26,73`; `apps/server/src/invoice-delivery-actions.ts:117`; `apps/server/src/tender-refund-balance.ts:124`                                       | Delivery stages F1 choices; current refund projection skips transfer. Preserve those boundaries.                                               |

## 7. Stored research and attached adviser confirmation

The [stored 2026-10-09 research, §1.10](../../compliance/research/2026-10-09-invoice-timing.md#110-a-bill-paid-later-by-bank-transfer)
calls invoice-now “ANSWERED, lawful”. That is the historical research's wording and the owner's
chosen premise, not fresh law research or confirmation from the venue's adviser. Its debt-related
questions do not require a debt feature here. Keep the original provenance and receipts there.

**Spanish draft, attached only, not sent:**

> ¿Confirma el criterio de emitir y entregar la F1 o F2 al terminar la comida, cerrar la cuenta
> definitivamente en Waitron como «a pagar por transferencia», mostrar ese importe por separado
> del efectivo y la tarjeta en el cierre del día y exportar esas facturas para que la asesoría
> concilie el banco fuera de Waitron, sin registrar después el cobro en la aplicación?

## 8. Later acceptance and the only owner question

After approval, later implementation uses TDD: observe each meaningful new assertion fail for the
expected reason, then pass. Cover F2 and separately enabled F1 issue-once facts; already-issued
reuse; eligibility/permission/device/zone refusals with allowed controls; service/table guards;
two transfer bills where the first closes without releasing the table and the second releases it
only when service checks pass;
same/changed-id intent, racing ids, rollback, restart and lost-response replay; zero provider/card/
cash/drawer effects; explicit transfer wording in every document/history consumer; no second collect;
one daily transfer line, cash/card invariance, frozen-day refusal/replay and CSV scope/fields/totals.
Preserve guards and fiscal invariants. Keep `packages/fiscal-verifactu/src/write-path.e2e.test.ts`
and `packages/fiscal-verifactu/src/inmutabilidad.test.ts` **UNEDITED**. Add assertions rather than
weakening existing numbering, hash, immutable-record, alta, registration or restore checks.
Later check real EN/ES, light/dark, phone/desktop flows and invoice output under the shared UI/forms
contract, update matching guides, and retain the separate physical/F1 gates. These PNGs verify none
of that. This revision runs no product tests and contains no implementation plan.

**Ask only:** “Do you approve this complete final-transfer-close design and its new pictures for
a later implementation plan? For the €220 meal, Waitron issues one F2, closes the bill and releases
the table subject to normal clearing, lists €220 separately from cash/card, and exports the invoice;
any later bank payment is reconciled outside Waitron.” **Recommendation: approve this scope.**
The owner's requirements settle the product choices; no ledger-related questions remain.
