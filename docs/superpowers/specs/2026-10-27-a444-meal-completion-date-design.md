# A444: date a completed meal by its end

An invoice issued after midnight must retain the day the meal ended. Keep that operation date
separate from the actual issue date, and print both when they differ. Staff never enter, choose
or confirm a date. The owner approved that rule on 27 October, about 07:45 CET, and clarified
about 12:00 CET that **when the bill closes** is the meal-end moment. It supersedes
the confirmation proposal in the [earlier research](../../compliance/research/2026-10-27-a948-operation-date-and-b2b.md),
not its legal qualifications. S4 remains with the adviser; advance payments remain S3/A447.

This document selects an engineering capture rule below. It does **not** claim that Waitron
already records an unambiguous meal end. The owner **GRANTED the exact H2 scope below** about
12:00 CET. Build still waits for released A696/A739 integration and the actual fiscal-branch
slot. This documentation revision authorizes no build or fiscal landing; a receipt-only partial
implementation remains excluded.

## What the source actually records

All receipts below are **source reading, UNVERIFIED**, at
`ad8acbab330034db745b6b7df94dd0f7eb0375d2`. No tests or product experiments were run for this
design. Line numbers identify the inspected tree, not future integration positions.

| Path and receipt                                                                                                                                                                  | Meaning and consequence                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/record-sale.ts:270`, `:275`, `:283`, `:314`, `:355`                                                                                                            | Allocates, reads the issue clock, saves F1 operation date from bill **opening**, or issue day without a bill; F2 saves null. Backend input omits the operation date.                                                                                                                        |
| `apps/server/src/bill-request.ts:29`, `:46`, `:60`, `:79`                                                                                                                         | Bill request is retractable, accepted regardless of money owed, and cleared after payment. It is a signal, not a durable meal-end fact.                                                                                                                                                     |
| `apps/server/src/finish-party-service.ts:118`, `:143`, `:161`; `parties.ts:704`, `:769`                                                                                           | Finish requires no outstanding bill and can still handle unserved dishes or counter collection. `parties.closedAt` is too late and may represent a merge.                                                                                                                                   |
| `packages/db/src/schema/orders.ts:87`, `:107`, `:195`; `schema/parties.ts:41`                                                                                                     | Opening, attempted payment, last fully served line and party closure are different events. None declares that the whole meal ended.                                                                                                                                                         |
| `apps/server/src/bill-payments.ts:655`, `:679`, `:687`, `:725`, `:762`                                                                                                            | Fully paid issuance requires received money, no pending payment/refund and a nonzero matching total; it can fire dishes after filing. Payment completion is not proof that service ended.                                                                                                   |
| `apps/server/src/till-sale.ts:992`, `:1622`, `:1799`                                                                                                                              | Three direct core callers: immediate cash/manual/zero filing, live integrated-card finalization, captured-payment recovery. Their issue clocks do not supply a meal end.                                                                                                                    |
| `apps/server/src/working-order.ts:6706`; `unpaid-departure.ts:81`, `:94`, `:132`                                                                                                  | Fourth server caller issues unpaid invoices on accepted unpaid departure. It checks unfired work, not a saved meal end. Together with bill-payments these are all five server `recordSale` call sites found.                                                                                |
| `apps/server/src/working-order.ts:6593`, `:6633`, `:6761`                                                                                                                         | Place sends/fires an order and marks it placed; it can precede serving. There is no current universal “bill due = meal ended” transition. Selecting F1 at `:4200` edits identity, not service.                                                                                              |
| `apps/server/src/bill-payments.ts:1431`, `:1465`, `:1493`; `bill-payments-loop.ts:144`; `till-sale.ts:1321`, `:1550`, `:1730`                                                     | Reader initiation commits before provider wait; live, loop and attested completion share completion code. Whole-card recovery and stale attempt release are separate. `paymentAttemptAt` is a transient lock, not the accepted service date.                                                |
| `apps/server/src/bill-actions.ts:168`, `:242`, `:285`; `move-bill.ts:136`, `:333`, `:572`                                                                                         | Split creates a new bill, merge abandons a source, transfer moves quantities, and move can change party/zone. Settled counter collection can continue after table Finish. Opening/party timestamps cannot follow these transformations as service evidence.                                 |
| `apps/server/src/working-order.ts:6481`; `adjustments-api.ts:187`, `:237`; `line-cancel-api.ts:227`; `till-api.ts:3600`, `:3639`, `:3776`, `:4016`, `:4132`                       | Draft edits, adjustments/cancellations and send/release actions can call `issueIfFullyPaid`. They need the same retained service fact; the final payer is not always the issuing actor.                                                                                                     |
| `packages/core/src/record-substitution.ts:175`, `:229`; `record-correction.ts:262`, `:305`; fiscal-verifactu `backend.ts:482`                                                     | Separate writers do not inherit operation date. Substitution has no production app caller found; correction is used by `apps/server/src/cancel-credit.ts:64` and currently refuses an original F1 in the backend. A556 owns public F3 replacement; do not manufacture a new meal end there. |
| `apps/server/src/receipt-issuer.ts:13`, `:32`; `invoice-document.ts:118`, `:150`; `transaction-receipt.ts:161`; `receipt-document.ts:229`; till `screens/till-ticket-view.ts:744` | Saved operation date already projects to thermal/A4/email document data and till when different from saved issue day. Reprint must read the sale snapshot, not current service or current zone.                                                                                             |
| `packages/fiscal/src/backend.ts:45`; fiscal-verifactu `backend.ts:282`, `registro-row.ts:137`, `:315`, `drain.ts:1211`                                                            | Fiscal input, stored record mapping and reconstruction do not carry `FechaOperacion`. Changing only `sales.operationDate` cannot file it.                                                                                                                                                   |
| fiscal-verifactu `drain.ts:1639`; `reconcile.ts:222`, `:248`                                                                                                                      | Targeted consultation and reconciliation assume the operation month equals issue month. Month/year boundary cases must change with the new filed field.                                                                                                                                     |

Other core callers found by `rg -n 'recordSale\(' apps packages --glob '!*.test.ts'`:
`packages/provisioning/src/fiscal-readiness-runner.ts:111` files a synthetic F2; server scripts
`record-one-sale.ts:143`, `demo-seed/seed-sales.ts:299`, `modelo-303-demo.ts:495`,
`daily-close-z-demo.ts:182`, `daily-close-demo.ts:168,194` are operator/demo paths. The remaining
hits are test hosts/fixtures, backend implementations, and till API methods calling server
routes. Recheck each caller after integration; do not invent meal completion for synthetic sales.

## Capture automatically when the bill closes

**Owner answer, 27 October about 12:00 CET:** retain the earliest qualifying bill-close event:
whole/final balance payment accepted, first completed-meal F1 issuance committed, a settling
edit accepted, or unpaid departure accepted. Payment acceptance here is the durable server
acceptance of the whole/final payment command before provider work, not the later provider
charge outcome. First F1 issuance captures in its committing transaction. Selecting invoice
identity or a delivery format alone is not issuance. **Bill requested never captures completion,
even when fully served**; preserve its positive signal and replay behavior. There is no new
Record final bill action or mandatory extra step before Pay. The accepted close event declares
completion for automatic dating; it is not a sensor of when diners physically finished eating.

Qualify service from persisted facts, independently of whether a snapshot already exists. Add
`mealServiceState(tx, billId): Promise<"complete" | "continuing">` in the server helper. Resolve
`partyFamily` / `readFamilyBills`, excluding abandoned bills, and require no outstanding draft
quantity from `readBillUnsent` on any family bill. For each top-level retained line, use
`readLineCancellations` and `serviceQuantities(quantity, servedQuantity, cancelledQuantity)` from
`line-service-state.ts`; every `remaining` must be zero. Positive held/unserved work remains
continuing service. Inspect settled family bills too: payment alone does not complete service.
Empty and fully cancelled bills qualify only at their existing explicit zero/unpaid/final command;
opening an empty bill does not capture anything. These existing primitives do not already constitute
a universal meal-end predicate; the new helper composes them and needs the tests in Task 1.

For complete service, preserve an existing valid completion; otherwise capture automatically in
the accepting close command's transaction, before any reader/provider work. A qualifying final payment
or committed issuance therefore works without a prior Bill requested signal. A repeated close
command with a new id still retains the earliest snapshot unless service actually resumed. Replay
returns its recorded result and never captures another reading. Every bill request keeps its
current signal behavior but captures nothing; serving the last dish alone also captures nothing.

Continuing-service/advance payments retain the existing S3/A447 path; missing completion is never
the test for classifying them. Capture at unpaid departure only after the existing unresolved-service
refusal/cancellation decisions have completed. Recovery is a continuation of accepted intent, not
a fresh final-service command. A missing/corrupt snapshot on an accepted completed-meal payment
is a data fault; retain moved money and do not invent an end or charge again. Retain the accepted
close instant and date through provider waits, lost answers and restart; actual invoice issue
day remains a separate fact.

If the physical meal ended before midnight but no qualifying action was recorded until after
midnight, only the later accepted close event is observable. This automatic rule dates that event and
never reconstructs yesterday or asks staff to choose it. That observation limit remains explicit;
it does not introduce a second approval gate or a missing-date refusal before ordinary payment.

## Storage, invalidation and freeze

Add one nullable `working_orders.meal_completion` JSON column through the db vocabulary. Its
shared type is `MealCompletion = { endedAt: string; timeZone: string; operationDate: string;
commandId: string }`: canonical UTC instant, saved venue time-zone name, ISO calendar day, and the
idempotent service command identity. `commandId` is an opaque value, not a foreign key. Store
the same value on each affected unissued bill, including F2 bills, so later splits do not lose provenance.
Keep it separate from the retractable `parties.billRequestedAt` signal. No new table is needed.

Use one trusted server reading and A696's validated venue zone **at capture**, deriving the
calendar date with its actual offset at that instant. Never use the reporting business-day
cutover, process zone, bill opening, browser clock or future issue offset. Reject malformed
snapshots; do not accept a browser-supplied date. The source command and its result commit
atomically, so a lost answer/replay retains the same instant and date.

Capture on an unissued placed bill needs a narrowly added transition: null to validated
completion alone, with no unresolved payment and every other frozen field unchanged. Ordinary
placed-update exceptions preserve the column; settled bills never acquire or change it.
Already-issued replay/collection returns saved facts before requiring new completion.

| Change before issuance                                                                          | Rule                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Withdraw Bill requested; add/resume service, revive a cancelled dish or restore a service draft | Clear completion across the affected family in the same transaction. Clearing the paid signal alone does not clear completion. The next qualifying final action records a fresh end. |
| Pure split within the same completed meal                                                       | Copy the exact snapshot to the new bill; preserve the source, including partial quantities.                                                                                          |
| Merge/transfer bills or move into another party                                                 | Retain only identical complete snapshots. Any missing/different snapshot invalidates all affected unissued meal snapshots; never choose min/max or a surviving opening date.         |
| Move table/zone without adding another party or service                                         | Keep the captured venue date and zone. Location/department change is not new service; preserve existing move restrictions.                                                           |
| Price reduction, refund, note, recipient/language or delivery-only edit                         | Do not recapture. Preserve completion if no service resumes; existing money/permission/invoice rules still apply.                                                                    |
| Issue, copy, collection of an issued invoice, table cleanup                                     | Sale's saved date wins forever; do not rewrite it or acquire another completion clock. Additional service after an issued bill belongs to another bill.                              |

At F1-capable payment acceptance, copy completion into A739's released durable
`order_payment_contexts.meal_completion` (new nullable JSON field), before reader work. It is
server-derived and part of immutable accepted intent, including whole and final-part paths. Capture automatically first when service is complete and no prior snapshot exists.
Do not tie it to slip settings, final Print/Email/None, or a till-only flag. Synchronous cash,
manual-card, zero and unpaid issuance consume the same bill snapshot in their transaction.

While an unresolved payment holds a completed-meal snapshot, refuse service resumption,
invalidation and cross-meal transformations affecting that meal with
`meal.completion_in_flight`; offer Check payment status and Stop. Do not erase evidence to
permit an edit. Known noncharge releases the payment hold but keeps completion until actual
resumption. Received partial money does not freeze service forever; subsequent resumption
invalidates the unissued meal snapshot, and the next qualifying final action establishes the later end.
Never reuse an older partial payment's snapshot to date a later, resumed whole meal.

Live finalization, captured recovery, manager attestation, pending loops and restart consume
the accepted snapshot, never a recovery reading. Keep issue time and actual money time separate.
If accepted completion evidence is missing after money moved, retain the payment and surface a
Waitron data fault; no second charge, fabricated end, fiscal repair or recovery-clock fallback.

Partial service and prepay remain **S3/A447**. Placing, taking an early part, firing, handing
over an order, or requesting F1 identity cannot stamp a whole-meal end. Preserve their existing
issuance behavior pending S3, without describing its provisional date as A444 completion.
Counter F1 expansion remains A555; do not reinterpret collection as consumption. A444 qualifies
completed-meal issuance, not every future advance-payment or replacement policy.

## Why the differing day must reach the fiscal record

| Primary source, checked 27 October 2026                                                                                                                                                              | Source's words                                                                                            | Reading and limit                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [AEAT: content of an alta record](https://www3.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/cuestiones-generales/contenido-registro-facturacion-alta_.html), item 5 | «la fecha en que se hayan efectuado las operaciones»; «si son distintas a la de expedición de la factura» | AEAT lists the operation date when different from issue date as record content. Applying that to this date change calls for the retained field in the filing path, beyond printing it. This source does not define restaurant completion or settle S3/S4. |

The consultation-period dependency has its own primary source, also checked on 27 October:

| Source and provenance                                                                                                                                                                                         | Source's words                                                                         | Reading and limit                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [AEAT web-service description, version 1.0.3, §6.4, page 30](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf), dated 28 July 2025 | «ejercicio/periodo de la fecha de operación o en su defecto de la fecha de expedición» | Consultation selects the operation year/month when present, otherwise the issue year/month. Retaining a different operation day therefore also affects period readers; the synthetic month/year tests below qualify implementation, not live AEAT acceptance. |

## POS representation and the protected fiscal dependency

Extend the trusted core input with optional `operationDate: string`, supplied from completion
for this flow. Validate a real ISO day; do not let public JSON choose it. Core stores it in the
existing `sales.operationDate` and passes it through `SaleForFiscalRecord` for completed-meal
F1. Keep F2 null and existing out-of-scope provisional paths unchanged. Do not backfill any
issued invoice or synthesize completion for an old open bill.

Validate snapshot day against its saved instant/zone and refuse a completion later than issue
day. Fresh requests refuse before money; already moved money remains recorded with a data fault
until resolved. A clock change never authorizes replacing completion with today's date.

For a differing day, the target AEAT representation is `FechaOperacion`, persisted as nullable
`registros_facturacion.fecha_operacion` and round-tripped through `toRegistroRow` /
`fromRegistroRow` before drain. Same-day records omit the wire field; POS retains the day.
The installed `@waitron/verifactu@0.2.1` already exposes `AltaInput.FechaOperacion?: Date`
(`dist/types.d.ts:296`) and formats it with the supplied offset (`dist/records.js:99`), source
reading UNVERIFIED. Convert the stored day to an input instant that formats back to that day
under the **issue** offset; do not send UTC midnight blindly. Do not modify the library builder.

**Exact H2 scope GRANTED by the owner, 27 October about 12:00 CET:** (1) change the trusted completion-day
selection/pass-through in `packages/core/src/record-sale.ts` and the contract in
`packages/fiscal/src/backend.ts`; (2) populate `AltaInput.FechaOperacion` in
`packages/fiscal-verifactu/src/backend.ts`; (3) add nullable `fechaOperacion` to
`src/schema/registros.ts`, its new migration, and both mappings in `src/registro-row.ts`;
(4) consume that retained day in `src/drain.ts` and `src/reconcile.ts` period selection,
including finding an anulación's original operation period. These paths persist/build/read a
protected alta record within this granted exception. No permission is granted for
`computeHuella`, chain code, allocation/numbering, library alta builders, `registerSif`,
`restoreFiscal`, shipped migrations, historical facts or protected tests.
If the scoped exception cannot achieve the wire round-trip, stop with the precise additional
dependency; do not widen it.

Keep F3 substitution and R5/F1 correction behavior unchanged. A556 must eventually carry the
original service provenance, handle multiple source dates explicitly and keep a replacement's
new issue date; A444 grants neither that writer work nor a public replacement route.

## Midnight and recovery acceptance examples

Times below are venue-local, `Europe/Madrid`, after the October DST change (+01:00).

| Recorded events                                                                                     | Required result                                                                                                                                               |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open 27 Oct 23:30; fully served; whole payment accepted 28 Oct 00:40; F1 commits 00:41 | Operation 28 Oct; issue 28 Oct; no extra operation row. |
| Fully served; Bill requested 27 Oct 23:50; whole/final payment accepted and F1 committed 28 Oct 00:05 | Bill requested saves no completion. Operation 28 Oct; issue 28 Oct; no differing date printed. |
| Fully served; Bill requested 27 Oct 23:50; whole/final payment accepted 23:55; reader begins then; provider charge 28 Oct 00:05; F1 commits 00:10 | Capture at payment acceptance on 27 Oct. Operation 27 Oct; issue 28 Oct; thermal/A4/till show both. Actual money time stays 00:05. |
| Whole/final payment accepted 27 Oct 23:55 as above; answer lost; process restarts 29 Oct | Recover the same accepted instant/day, payment and sale identity once. Issue on 29 Oct only if not already issued; an issued replay retains its original issue date. |
| Whole/final payment accepted 27 Oct 23:50; known noncharge; withdraw Bill requested/add dessert; service completes; new final-balance payment accepted 28 Oct 00:15 | Existing invalidation policy clears the old snapshot; capture at the new payment acceptance, operation 28 Oct. Last dish marked served alone records no end. |
| Service complete; unpaid departure accepted and unpaid F1 committed 27 Oct 23:50; collection 30 Oct | Capture at accepted unpaid departure; both original invoice dates remain 27 Oct; collection creates no new invoice/date. |
| Physical meal ends 27 Oct 23:50 with no accepted close event; first completed-meal F1 commits 28 Oct 00:10 | Capture at first F1 commit on 28 Oct; do not reconstruct the unrecorded 27 Oct physical end or offer a date choice. |
| Service complete; price reduction accepted 27 Oct 23:59:59 settles the balance; first F1 commits 28 Oct 00:00:01 | Capture at the settling edit on 27 Oct; operation 27 Oct, issue 28 Oct. No invented tender or last payer. |
| Early EUR10 part-payment accepted on EUR30 while service continues | S3 partial/advance path; no qualifying bill-close event or whole-meal completion. Final delivery choice cannot supply it. |
| Service complete; final-balance payment accepted 31 Dec 23:55; first F1 commits 1 Jan 00:05 | Retain 31 Dec for wire and receipt; consultation/reconciliation select the operation year/month for the alta, while identity/QR keep issue date. |

## Integration and release

Consume the published [A696 design](2026-10-20-a696-startup-zone-validation-design.md) /
[plan](../plans/2026-10-21-a696-startup-zone-validation.md) clock contract and
[A739 approved plan](../plans/2026-10-27-a739-approved-payment-flow.md) payment-context/recovery
contract. Read-only parked A696 `c79b2c03d` still has opening-day core logic; it is not a released
dependency. A739 retained `3e45abdc6` is likewise a reference, not a base to copy wholesale.
F/A739 payment work has precedence. The driver must reorient reservations and obtain released
paths and the single fiscal-branch slot before implementation; do not edit either worktree.

Use the [inline TDD runbook](../plans/2026-10-27-a444-meal-completion-date.md). The exact H2 scope
is granted; later expansion still stops for its precise dependency. Build waits only for released
A696/A739 integration and the actual fiscal-branch slot; this docs revision authorizes no build
or fiscal landing. One complete fiscal PR, one Claude run-it review during finish, normal hook
and current-head CI; the owner lands. Driver owns backlog/research status, not this delegation.
