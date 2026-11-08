# Fiscal records, invoices and the asesor — detail

> **2026-10-10, receipt presentation:** A366 slice 7 supersedes the F1 location-address
> exclusions below. Thermal and till receipts follow the global current-address switch,
> independently of filed domicile; A4 omits the optional current-address block. Filed domicile
> remains. Follow [the slice 7 plan](../superpowers/plans/2026-10-08-a366-slice-7-receipts-per-department.md).

The open entries are listed in [the backlog](../backlog.md), under "Fiscal records, invoices and the asesor". This file holds
their full text.

## A444. A full invoice for a meal past midnight should carry the day the meal ends

A231's provisional rule uses the day the bill was opened. On 27 October the owner approved
the meal-end date with no staff date choice or confirmation, then clarified about 12:00 CET:
**when the bill closes**, at the earliest qualifying whole/final balance payment acceptance,
first completed-meal F1 issuance commit, accepted settling edit or accepted unpaid departure.
Bill requested never captures, even when fully served; its signal/replay behavior remains. The
[implementation design](../superpowers/specs/2026-10-27-a444-meal-completion-date-design.md) and
[plan](../superpowers/plans/2026-10-27-a444-meal-completion-date.md) retain the accepted close instant/day
through provider waits, lost answers and restart, separately from actual issue day. Fully served
Bill requested 27 Oct 23:50, payment accepted and F1 committed 28 Oct 00:05 means operation/issue
28 Oct with no differing date printed; payment accepted 27 Oct 23:55 before a 28 Oct charge wait
keeps operation 27 Oct. The owner granted the exact H2 scope recorded in the design/plan: trusted
completion day through core/fiscal input, AltaInput.FechaOperacion, new nullable registro field
and migration, both row mappings and saved-day consultation periods including cancellation's
original period. The grant excludes hash/chain/allocation/numbering, library alta builders,
registerSif/restoreFiscal, shipped migrations, historical facts and protected tests; later expansion
still stops. Implementation remains open, waiting for A739 integration. This docs revision
authorizes no build or fiscal landing. No mandatory
extra Bill requested action is introduced. The unrecorded physical-end limit is explicit; the restaurant
analogy remains [S4](../compliance/asesor-questions.md#the-shortened-list-2026-10-09) for the adviser.
Service-complete qualification, resumption invalidation, S3/A447 advance payments, F2/F3 and
counter limits remain as designed. Earlier issued dates stay saved; the eventual fiscal PR is for
the owner to land.

## Structured B2B invoices before the applicable 2027 or 2028 date

The [27 October source check](../compliance/research/2026-10-27-a948-operation-date-and-b2b.md#b2b-delivery-the-rules-exist-their-mandatory-application-is-later)
separates current paper/agreed-electronic delivery qualification from future structured B2B
integration. The general mandate applies from 6 October 2027 above the issuer's EUR8 million
threshold, or 6 October 2028 otherwise. Establish scope and design exchange, public-solution
copies and required state/payment reporting before the applicable date. No connector is built
or qualified by this research; current delivery and preservation checks remain open.

## A445. A free item on a bill with mixed VAT rates should take a share of the price paid

Allocate by value instead of setting the item to €0 (V0555-17, binding). Only bills mixing rates
are affected (the deli's 4%, 10% and 21%). A table given everything free may be self-supply taxed at
cost (V2347-24). Asked as
[S10](../compliance/asesor-questions.md#the-shortened-list-2026-10-09); decide before going live.
Fiscal: the owner lands it.

## A446. Build the pre-bill: each printed pre-bill is stored as printed and linked to the invoice that follows

**Owner, 2026-11-04: build it now to the strict reading, without waiting for S2.** Today a table
cannot get a printed bill before paying: "bill requested" only marks the floor plan. If S2 says a
precuenta does not count, the stored copies are merely unnecessary. S1 (when the invoice must be
issued) could still change this, so read its answer before landing if it has arrived. The design is
A803 §3.9. It lists a pre-bill's dishes by order line id, not portion id: A1308 makes the line the
dish's identity (owner, 2026-11-04), so a pre-bill built first needs no rework. Those ids take no
foreign key, because a cancelled dish's line is deleted. Printing it never fires held food and never
marks a line sent (Q21).

AEAT's FAQ calls a system without that link «susceptible de sanción»,
and the pre-bill carries no tax QR code. Whether a precuenta counts is asked as [S2](../compliance/asesor-questions.md#the-shortened-list-2026-10-09).

## A447. A guest's part-payment taken before the table is fully served may need its own advance-payment invoice

See LIVA 75.Dos, RD 1619/2012 art. 2.1. The server (#721) holds such money with no invoice until the
bill is paid. Asked as
[S3](../compliance/asesor-questions.md#the-shortened-list-2026-10-09); no change until answered.

## The till offers no way back to a simplified invoice for a bill already saved as a full one

Left open by A741 (#1774). The bill still shows its Full invoice line and payment refuses it; the
server accepts a change back (`setOrderInvoiceChoice`), but nothing on the till sends one.

## Adviser confirmation: supplier invoice numbers by issue year

Confirm the owner's A981
rule in [Q18(b)](../compliance/asesor-questions.md): the same supplier's number is refused within
one issue year and accepted in another with a warning. The receipt date still sets the VAT
reporting period.

## A554. Should any screen show the address an invoice email went to?

An owner question, open
point 1 of the [A231q plan](../superpowers/plans/2026-10-12-a231q-invoice-delivery-part-2.md). Until
it is answered none does: the delivery status the till and the dashboard read carries no address,
and both email forms open empty. Left open by A231q.

## A557. A success reported after an attempt had ended is not shown

The delivery status marks
such an attempt `lateSuccess` (`apps/server/src/invoice-delivery-status.ts`), but neither the till
nor the dashboard shows it, so staff see only the attempt's earlier outcome. Left open by A231q.

## A558. The `invoice_delivery.*` refusals other than `.active` end without a full stop

A wording decision left open by A231q, in the till and the dashboard, in English and Spanish
(`apps/till/src/i18n/codes.ts`, `apps/dashboard/src/i18n/codes.ts`).

## The reconcile sweep may raise a second "accepted with errors" warning

This can happen when it corrects a record the drain is still sending
(`packages/fiscal-verifactu/src/reconcile.ts`);
only one case opens, as cases are one per record. Found by reading in #1596's review, not run;
nothing runs the sweep yet, so check it when the sweep is scheduled.

## Should `packages/fiscal-verifactu` have a mutation floor?

It has no Stryker config, so the
minute-name rules A947 slice 4a added are covered by tests and hand-run deletions only (the
plan's Mutation section lists them). Decide whether it joins the mutation-tested packages.

## Walk-up invoice dates follow the server process time zone

**1 November landing update:** A696 landed in [#2369](https://github.com/clintongormley/waitron/pull/2369).
New invoice dates and record offsets use the writing node's saved venue zone; the
[coverage ledger](../superpowers/plans/2026-10-21-a696-startup-zone-validation.md#task-20-coverage-ledger)
records the qualification. The 15 October observations below describe the earlier process-zone
behavior. Wider A166 and A444 remain open.

Found during A693's test-only fix (2026-10-15). In an installed disposable copy,
`transactional-series.test.ts` issued real walk-up invoices with the venue's stored
`time_zone` fixed to `Europe/Madrid`. At `2026-10-14T23:30:00Z`, the stored
`fecha_expedicion_factura` was `2026-10-14` under process `TZ=UTC` or
`TZ=America/New_York`, and `2026-10-15` under `TZ=Europe/Madrid` or `TZ=Asia/Tokyo`.
At noon UTC all four stored `2026-10-14`.

`apps/server/src/till-backend.ts`'s `systemClock` takes the offset from the process's
`getTimezoneOffset()`; `git blame -L 14,25` attributes it to `d49e2e986` (2026-08-05).
A693 changes no production code. Deployment's runtime ENV and compose app settings do not
set `TZ` or mount a local-time file; a local `node:26.11.1-slim` process reported `UTC`.
That probe does not measure an operator's configured appliance.

**A696 audit/design, 2026-10-15:** the
[audit and design proposal](../superpowers/specs/2026-10-15-a696-invoice-time-zone-design.md)
traces every discovered issuing, replay, resend, import and seed path. Driver probes extend the
process-zone observation to held orders, unpaid invoices, table payments, reader capture/recovery,
public unpaid departure and cancellation credits, core F1/F3 and R5, and emergency series.
An annulment retains the original invoice date. Next-day Tokyo outbox sends retain the stored
fiscal payloads and rows; real AEAT acceptance, lost-response/restart and restore are not measured.
No product fix is built.

**Decision update, 2026-10-15:** the owner chose the saved venue zone, including DST, for every
new invoice date and record offset, ordinary receipt and till, independently of the process zone.
Old records stay unchanged. See the [recorded decision](#decisions-and-deliberate-limits) and
the [spec's dated answer](../superpowers/specs/2026-10-15-a696-invoice-time-zone-design.md#owner-decision-recorded-2026-10-15-the-venues-saved-time-zone).

**Current direction, updated 2026-10-20:** the owner's 2026-10-15 ~22:25 answer supersedes the
17:20 mid-payment repair proposal. Check the saved zone at startup and every application writer;
admit no sale, payment or invoice while it is bad. Keep manager login and zone confirmation
reachable with `venue.configure`, only for a missing/invalid zone. Valid-to-valid settings locks
remain. The [startup redesign](../superpowers/specs/2026-10-20-a696-startup-zone-validation-design.md)
proposes repair-only authenticated serving followed by restart, and identifies A166's country-pack
dependency. The dropped post-capture state, resume action
and reporting consequence remain only in the historical guided proposal and decision below.
A444's operation/service-date decision stays separate. The audit also found a
source-only F2 presentation gap: `readReceiptIssuer` supplies the stored offset only for a named
recipient, leaving ordinary receipt views to their runtime zone. The approved behavior includes
consistent ordinary receipt and till dates; passing the saved offset remains a proposed mechanism.
Existing settings history locks are retained; this decision authorizes no repair bypass.
No stored fiscal row is to be rewritten.

## Owner decision 2026-09-24: a void counts on the day it is made, not the day of the sale

- Found by #601 (`packages/reporting`). **Owner decision 2026-09-24: a void counts on the day it
  is made, not the day of the sale** (built in #605 for the daily close's VAT, the period VAT
  summary and top sellers). The quarterly _modelo 303_ keeps its old behaviour, pinned by a test in
  `vat-return.test.ts`, until the asesor answers `docs/compliance/asesor-questions.md` Q25 (which
  VAT period a later annulment lands in). No till screen or server route calls `recordVoid` yet.
  `stableStringify` (`src/daily-close-hash.ts`) throws on a `null`, and a key holding `undefined`
  hashes differently from the row the database stores (the column drops the key); its comment now
  states the precondition, and nothing enforces it for callers. Not fixable in a comments-only
  change: test titles still say "jsonb" (`verify-daily-close-chain.test.ts:70`), "tenant"
  (`top-sellers.test.ts:501`, `overdue-orders.test.ts:252`, `vat-summary.test.ts:233`,
  `vat-summary-period.test.ts:128`), "design §3" (`overdue-orders.test.ts:194`), "spec §12"
  (`top-sellers.test.ts:307`) and "DrizzleQueryError-style" (`record-daily-close.test.ts:342`, not
  checked). `toDr303Record` (`src/dr303.ts`) does not cross-check a monthly total against a
  quarterly period code such as "4T"; a test pins that and the one route that builds the file
  takes both from the same code, so it looks deliberate — worth the owner's eye because it is a
  tax file. The top-sellers fixtures give most lines no kitchen name, where CLAUDE.md §3 asks all
  three names to differ (top-sellers never reads that name).
  `record-daily-close.concurrency.test.ts:60` says "nothing but the write queue keeps the second
  out"; a reviewer, reading only, thinks the one-close-per-day unique constraint refuses it — not
  checked. `packages/core/src/errors.ts` names `scripts/errors-reachable.test.ts` without the hedge
  #601 gave reporting's (the guard matches text).

## Two SQL comments inside a `sql` string in `packages/fiscal/src/testing/fake-backend.ts` are code, not comments

- Found by #592 (`packages/fiscal`), not fixable in a comments-only change or outside the
  package. Two SQL comments inside a `sql` string in `packages/fiscal/src/testing/fake-backend.ts`
  are code, not comments: one points at `packages/fiscal/src/backend.ts:72` for `total: Decimal`
  (it is at line 50) and names "Task 14", and one says the breakdown column is NULL only for a
  void, while the fake's corrections and substitutions leave it NULL too.
  `FiscalBackend.pendingCount` has no caller outside the backends and their tests, yet
  `packages/db/src/schema/sales.ts:29` says it is how the count is read.
  `packages/fiscal-verifactu/src/slot.ts:51`
  says `validate` runs BEFORE `provisionVenue`, which #592 narrowed in `contribution.ts` to an
  instruction to the caller, because `apps/server/scripts/cloud-integration-fixture.ts` calls
  `provisionVenue` without it. `packages/fiscal-verifactu/src/no-regime-scope.test.ts:7` says
  `packages/fiscal`'s guard forbids ENGLISH regime terms; its list is half Spanish.
  `no-hardcoded-margin.test.ts` scans only the files directly in `packages/fiscal/src`, not
  `src/testing/`, and does not say so.

## `packages/fiscal-verifactu` code

- `packages/fiscal-verifactu` code, found by #562; not changed unless marked:
  - The inner try/catch around the log call in `aeat-transport.ts`'s `closeAll` is dead: with it
    removed, the "LOGGER fails" case still passed, because `Promise.allSettled` absorbs the
    rejection.
  - Removing `appendToChain`'s nested `tx.transaction` makes no test fail (`chain.test.ts`'s
    header says so); the protection it gives a losing attempt has no test holding it.
  - `write-path.e2e.test.ts` (lines 414 and 418) points at `test/fixtures.ts:249-256` for a
    receipt of one basket hashing differently filed 16th and filed standalone, and at
    `test/write-path-fixtures.ts:37-44` for `steadyClock`. The receipt is now at
    `test/fixtures.ts:285-289` and `steadyClock` at `test/write-path-fixtures.ts:27-39`. Correct
    them only in a change allowed to touch that file.

## Reporting — the fiscal remainder (parked)

Two pre-filing caveats a human must clear before the first
LIVE 303 filing: validate the DR303 file once against the real AEAT "por fichero" uploader (we
omit página 2, régimen simplificado); and an asesor must confirm the **prorrata** treatment
(`computeInputVat` scales only the cuota by `deductible_proportion`). Deferred build slices:
rectificativas de facturas recibidas (casilla 40/41, needs a `corrects_purchase_invoice_id`
self-FK); bienes-de-inversión regularización (43); the prorrata rule (44, asesor-driven);
intra-community and import boxes (32–39); a libro-registro / Pre303 export.

## `packages/fiscal-verifactu` restates rules the validator owns

- `venue-fields.ts` repeats the venue-field patterns and caps, kept honest by drift guards
  (`record-limits.test.ts` compares the recipient
  name cap with the validator's verdict). `backend.ts`'s simplified-invoice limit no longer restates
  the validator's rule: it is the owner's €3,000 (A741), and `record-limits.test.ts` checks our
  verdict against the validator's at six totals.
  Exporting the patterns from the library instead was DEFERRED on purpose (owner, 2026-09-12) — it
  widens an audited fiscal library's public surface and the drift guard already closes the risk.
  Revisit when something else needs those patterns.

<a id="a1e-simplified-and-full-invoices-use-separate-series--built-public-f1-disabled-2026-10-06"></a>

## A1e. Simplified and full invoices use separate series

A231 [#1256](https://github.com/clintongormley/waitron/pull/1256) adds the `full` purpose beside
`standard` and `rectificative`, provisions its series, and makes core require it for F1 and F3.
Table bill payments and unpaid departures can issue F1; no route calls `recordSubstitution`. The separate-series
basis is recorded in [verifactu-findings.md §10.1](../compliance/verifactu-findings.md).
**Next action:** complete A231's remaining paths and qualification below. Asesor Q5(d) remains open for F3 and R5.

<a id="a231-full-invoices-at-the-till--gated-implementation-landed-2026-10-06"></a>

<a id="no-sale-over-3000-can-be-made-at-all"></a>

## A231. Full invoices at the till

The owner authorised the gated implementation, which landed as
[#1256](https://github.com/clintongormley/waitron/pull/1256), squash `2d972685530676fbe7c182760f0d96f461214e47`.
Existing preproduction venues require a reset for that schema change. A948 enables the prepared
F1 paths in every environment, with no environment switch. The [design](../superpowers/specs/2026-10-03-full-invoices-at-till-design.md) and
[implementation plan](../superpowers/plans/2026-10-03-full-invoices-at-till.md) retain the decisions
and dated implementation receipts.

The build covers a Spanish recipient's saved tax ID, name and address, a separate full-invoice
series, taxpayer domicile, filed receipt data and replay, original/duplicate printing, delivery
status and retry, staff handover confirmation, invoice lookup, and reporting. Paper and till
omit the venue address when an F1 shows its filed taxpayer domicile; phone/email and the
F2/absent-domicile controls remain. Automatic F1 credit/refund/cancellation is refused.
The operation day is the owner's provisional service-start rule, awaiting asesor confirmation.

The owner approved the historical-export fixture's current artifact
refusal, including its could-not-open operator advice; provenance, HTTP400/domain-error,
unchanged-database and empty-staging checks remain. This is preproduction format rejection,
with no backward-compatibility implementation.

The till offers **Full invoice**. A saved Spanish recipient can be invoiced through table bill
payments or an unpaid departure. Email and A4 originals use the existing delivery queue. Direct
counter cash/manual-card sales (`POST /api/sales`), integrated-card payment (`POST /api/pay`) and
unissued counter collection still refuse F1 with `sale.full_invoice_unavailable` until A555.
The shared Full invoice control and automatic recipient prompt are visible at the counter;
payment still refuses that choice. A555 must complete that path. Placing a ticket-then-pay order saves it without issuing an invoice. The retired invoice-first
zone setting creates no separate public issuance route. Zero-total F1 counter requests retain
the same refusal. A saved F1 choice still permits the bill to grow above the simplified ceiling;
the existing recipient checks and F1 series selection remain in place.

**Next action:** complete A555, A444, the physical 58/80 mm paper and QR checks, the asesor's
manual-remedy confirmation and current business-invoice delivery qualification as separate work.
Future structured B2B integration has its own entry above. F3 conversion, F1's
R1–R4 correction path and foreign-recipient `IDOtro`/`IDType` remain separate decisions.

<a id="a555-counter-full-invoice-delivery-through-payment--design-proposed-2026-10-21"></a>

## A555. Counter full-invoice delivery through payment — DESIGN APPROVED (2026-10-21)

The [proposed design](../superpowers/specs/2026-10-21-a555-counter-invoice-delivery-design.md)
and static pictures (removed from the repository on 2026-11-02) cover retaining Email PDF,
A4 or receipt-printer delivery through Counter payment. The source audit records the current
request/staging gap against `77ab2ced8`; it is not an executed public-F1 result.

The owner chose “A, choose before paying” on 2026-10-21: a full invoice's original-delivery
choice before payment, in A739's shared payment window. Delivery failure keeps payment complete; retained payment requests and
invoice delivery retries have separate identities. Earlier partial-payment preferences cannot
replace the final invoice's selected original. None remains an ordinary F2 receipt choice.

**Next action:** plan/build against the released
A739 seams. A444, B2B delivery, physical 58/80 mm paper/QR checks and the adviser's
manual-remedy confirmation remain separate work; the owner removed them as switch prerequisites
on 2026-10-27.
This design does not close A554's saved-email-address question, change the consent decision or
add invoice PDF storage.

## When the business e-invoicing regime starts

Found by A231d's research. [Orden HAC/1028/2026](https://www.boe.es/buscar/doc.php?id=BOE-A-2026-20587) (BOE núm. 247, 5 October 2026) «entrará en vigor el día siguiente al de su publicación en el «Boletín Oficial del Estado», dándose inicio al cómputo de los plazos» of [RD 238/2026](https://www.boe.es/buscar/act.php?id=BOE-A-2026-7295)'s fourth final provision: «Doce meses después» for businesses whose turnover is over €8 million, and «Veinticuatro meses después, para el resto de los empresarios y profesionales». So from about October 2027, or October 2028 for smaller businesses, an invoice to a Spanish business must be a structured message, and a PDF alone is not enough (the design's register, RD 238/2026 art. 7.1). The exact end day of each period, and whether a restaurant's F1s to businesses fall inside the regime, are asked as [Q45](../compliance/asesor-questions.md#q45-when-does-structured-business-invoicing-reach-a-restaurants-full-invoices-added-2026-10-07). Researched 2026-10-07 in the watcher session; the fetched texts were not kept in the repository.

## A275. Invoice a bill paid later by transfer (full or simplified invoice) — DESIGN NOW (2026-10-17)

**Design approved; reviewed plan published, build pending (2026-10-22).** Owner, 2026-10-22 15:55:
“A275 looks fine”. This approves the revised minimal design and authorises plan authoring,
fresh-context review and docs-only publication. The build retains its separate gates.

The [approved design](../superpowers/specs/2026-10-22-a275-final-transfer-close-design.md),
16 synthetic pictures (removed from the repository on 2026-11-02) and
[implementation plan](../superpowers/plans/2026-10-22-a275-final-transfer-close.md) retain the
owner's 2026-10-21 02:40 policy: invoice at the meal, then close the whole eligible bill finally
as “to be paid by transfer”. Preserve split bills and release the party/table only through the
normal all-bills/service/editor checks and clearing requirement. The transfer tender is final
classification, not bank receipt. No awaiting-transfer balance, later receipt, reversal, debt list
or receivables module. A separate daily-close transfer line and dashboard invoice CSV under
`report.export` let the accountant reconcile outside Waitron.

The plan's source observations are **READ ONLY / runtime UNVERIFIED** at
`db7cddeb2d38984b284b23e8e391e7ebd7cb9156`. New orchestration/storage/export interfaces are
proposals; no product test, renderer, fiscal or legal verification was run. A1003 is now landed
(PR #1973); preserve its refusal/rollback boundary. Recheck released A696 clock, F/A739 Pay,
A555/A948 delivery and A947 minute-allocation contracts before their dependent build steps.
A948 enables existing table-payment and unpaid-departure F1 paths; transfer closure remains
unbuilt. Physical/manual-remedy/B2B qualification remains separate. The €5,000 transfer example
is still a future path; €220 F2 stays within existing limits. The plan places a precise
RUNNER H2 approval gate before later work reaches protected fiscal behavior, and keeps golden
huella/inmutabilidad unedited. Design approval does not waive that gate.

The [partial-receipts proposal](../superpowers/specs/2026-10-20-a275-invoice-now-transfer-later-design.md),
historical research/source receipts and pictures remain unchanged. Old question 1 is retired;
questions 2–5 are withdrawn. The revised Spanish adviser confirmation remains attached, not sent.
A275 stays open pending build and acceptance. The reviewed plan includes an explicit recovery read,
party completion before its retained result, live Bills exclusion, separate delivery/closing actors
and bounded implementation checkpoints.

## A679's internet time reading came back unavailable against pre-production in each of four runs on 2026-10-23

`observeInternetHourClock` asks the submission host, which answered a certificate-less request with
a redirect to another site and no `Date` header, and the reading follows only same-origin
redirects (A798-B slice 9 plan, P1 and P2; production not tried). Found while planning A798-B
slice 9.

## Protected write-path test policy quotation

W41s-7's two run-it reviews found the header of
`packages/fiscal-verifactu/src/write-path.e2e.test.ts` still quoting “no fiscal condition blocks a
sale”. The owner-approved local conflict stop is narrower than that old quotation. The protected
file and all its assertions remain unchanged; reconcile its explanatory header when that protected
file's edit scope is authorised. The live procedure is documented in
[hour recovery](../operations/hour-recovery.md#switch-a-running-box-after-an-invoice-identity-conflict).

## W41s. Fiscal prevention and offline recovery — DESIGN AND REVISED PLAN APPROVED (2026-10-04)

Filing investigation (W41s-9), signed witnesses and fencing (W41s-10b), and the complete
old-backup/new-hardware exercise (W41s-11) remain queued. Keep their authority, recovery and
public fiscal-enablement gates. W41s-10a's remaining qualification work follows.

### Qualify reconciliation against live AEAT

Exercise the startup/daily lookup through the real AEAT service. Retain the taxpayer, node and
environment scope; incomplete or failed lookup remains unknown. Do not treat a lookup result as
freshness, allocation authority or evidence that an old writer stopped. W41s-10b owns signed
witnesses and fencing.

### Qualify offline recovery through production TLS

Extend W41s-11's old-backup/new-hardware exercise to the production HTTPS connection and fresh
device pairing. Keep the administrator approval, cookie admission, recovered-series and retired
counter checks. The loopback HTTP qualification in #2449 is not a production TLS result.

### Take a till payment through a booted restored server

In W41s-11, restore both archive and stream backups without enrolled devices or internet time,
start the recovered server, pair a fresh till and take a payment through its API. Check the
recovered series, one invoice and one tender, original records, retired counters and replay.
Keep optional browser receipt observations separate from recovery authority; missing storage or
an unlisted invoice number is not proof that a number was unused.

### Account for history before the oldest known month

W41s-10a's monthly starting point can omit a wholly missing earlier period. Carry that uncertainty
into W41s-10b's evidence/fencing design and W41s-11's exercise. Name the evidence required before
claiming completeness; querying later months or showing retained receipt observations alone does
not resolve earlier missing history.

Evidence inspection and persistent-repair policy remain separate A1089 work.

### Task 8 staff refund and held-cancellation qualification, 2 November 2026

`apps/server/src/fiscal-remedy.staff-refund.test.ts` uses a real provisioned venue and the
core sale and void writers. It returns 12.10 in cash through the till's refund route before
voiding the invoice; the refund route deliberately refuses an already voided invoice. The
filing queue sets the ordinary cancellation aside after the original's definitive rejection.
An explicitly enabled synthetic correction is accepted by the real client and fake tax service;
the administrator then releases the same cancellation. Concurrent release and reordered retries
return the saved decision. A refund retry returns the original completed refund. The checks compare
all sale, line, tender, settlement, void, refund, drawer, print-job and series rows, plus the
immutable fiscal rows and chain head after release and filing.

The other cases retain those accounting effects while refusing record-producing remedies for
unknown outcomes, conflicting invoice identities and an already generated ordinary cancellation.
Since A1425 the administrator may release a held cancellation once its original's
correction is accepted, whichever issuing chain the correction is on. The original rejection in
these cases is synthetic stored evidence; they do not send a real refund or establish a legal
remedy. The public permitted-remedy set stays empty. The completed implementation still needs the
owner's fiscal review before landing and separate legal authority before production enablement.

The whole-branch review reproduced a dependency cycle when a correction was appended behind an
ordinary cancellation still waiting to be sent: the cancellation waited for that correction's
answer, while the correction waited behind the cancellation. The action now refuses unless any
existing ordinary cancellation is already held for resolution. It also refuses completed,
failed or unknown cancellation states and a synthetic held absent-original cancellation. Once
the queue has actually held the ordinary cancellation, the same decision can be submitted again,
accepted and followed by its explicit release. No queue-order rule was weakened.

For a definitively rejected delivery, the correction action requires a matching non-null rejection
code on the case and delivery; it refuses code 3000 in either admissible outcome. This aligns the
rejected-record boundary with the sibling remedies. The duplicate-code probe used synthetic
stored evidence: the pinned library's reducer returned duplicate outcomes for the tested 3000
reply variants, not a plain rejection. No claim that normal filing generated that inconsistent
state is made. Accepted-with-errors acknowledgement preservation retains its existing behavior.

The staff suite also exercises the built-in empty policy for all five actions in both deployment
modes. The policy is a permitted-action set shared by those modes; a future enablement decision
must account for that scope. The two Claude reviews' findings and deliberate refusal choice are
recorded in the pull request; a passing synthetic tax-service response supplies no legal authority.

**1 November 2026, Task 8 storage decision (owner).** A correction keeps the invoice's issuer,
number and issue date. Its nullable `corrects_registro_id` names the version it replaces;
a unique index permits one replacement per version, and the invoice-identity index applies
only to originals. This permits successive corrections without updating earlier records.
The generated storage migration adds the column and replaces indexes; it does not rebuild
the table.
Correction payload persistence, administrator-only remedy operations, held-case
resolution and the real AEAT second-correction proof remain part of Task 8 before publication.
Disputed production remedies stay disabled pending Q35/Q37/Q38/Q40 or a case-specific owner decision.

**1 November 2026, Task 8 receipt replay check.** The receipt lookup explicitly selects the
original issued alta by its empty correction link. `record-version-receipt.test.ts` stores
three versions with different issuer names, VAT and totals, then compares the replay with the
original receipt under both ordinary and reversed unordered-query traversal. Before that
filter, the reversed traversal returned the second correction's figures. This check covers
receipt replay, not the remaining current-version filing and remedy decisions.

**1 November 2026, Task 8 marker and append checks.** `Subsanacion`, `RechazoPrevio`
and `SinRegistroPrevio` have nullable stored columns. The payload round-trip cases compare the
built and rebuilt records and their XML markers, including explicit `N` and omitted fields.
The append cases exercise successive correction links after an unrelated sale, retain older
rows and recompute the new fingerprints. A competing replacement receives
`fiscal.record_already_corrected`; a missing target, different invoice, sale or node, an
anulación target or an absent correction flag receives `fiscal.remedy_invalid`.
The generated marker migration adds columns without rebuilding the table. These checks do
not implement administrator remedy actions, select the current version for filing, resolve held
cases or prove acceptance by AEAT. Those remain Task 8 work before publication.

**1 November 2026, Task 8 cancellation and consultation checks.** The cancellation queries use
the alta with no replacement. `drain.record-versions.test.ts` exercises two corrections: older
refusals do not set aside a cancellation after the current version is accepted; an unknown
current outcome keeps the cancellation and its later records unsent; a refused current version
sets the cancellation aside. A held cancellation is not set aside using an older refusal while
the current version is unknown. Every case compares the immutable record rows before and after.

`reconcile.record-versions.test.ts` exercises a consultation reporting only the second
correction's reference. Earlier delivery rows and acknowledgements stay unchanged; the current
version still receives lost-acknowledgement recovery or no-trace resubmission. The reconciliation
write transaction rechecks which versions remain current after the network request; a correction
appended during that request prevents a stale resubmission of its predecessor. These tests use
the library's fake authority; live second-correction acceptance, the administrator action boundary
and held-case resolution remain unfinished.

**1 November 2026, Task 8 payload and backend version admission.** The row converter refuses
optional library fields without stored counterparts rather than silently discarding them, including
explicit `N` flags. It also refuses caller-supplied `RefExterna`: the drainer assigns the stored row
id when submitting. Credit-note and substitution admission use the unreplaced version's invoice
type; a correction from F2 to F1 therefore refuses the existing R5/F3 paths, while a correction to
F2 permits them. Void identity and origin come from the issued original, while its chain pointer
uses the current head. These are synthetic storage and backend checks; no new remedy is enabled.

**1 November 2026, Task 8 administrator action boundary.** The fiscal module grants
`fiscal.remedy` to administrators only. `applyRecordCorrection` checks the live management
session and the caller's server policy before creating a correction and its case-resolution event
in one transaction. A retry with the same decision returns the saved record and event; changed
facts under that action key are refused. Its checks include the target node and environment on
replay. The synthetic cases retain original record and delivery rows, exercise two successive
version cases and report a malformed predecessor without rewriting it.

The public `POST /management-api/fiscal-records/remedy` route refuses every remedy kind.
Client-supplied enablement and operator fields cannot grant authority. No production action is
enabled. The HTTP adapter covers synthetic corrections to stored invoice facts for rejected records
and records accepted with errors. The separately gated synthetic absent-original operation is
described below. The separately gated corrective HTTP adapter is also described below. Resolution
of existing held cancellations and manual brake release now have the synthetic paths described
below. Actual staff cancellation/refund qualification remains Task 8 work. The live second-correction
prerequisite is recorded in the dated entry below.

**2 November 2026, Task 8 synthetic corrective-invoice transaction.** The internal operation
uses the existing core correction writer, which now accepts a management session and still checks
`sale.rectify`. The remedy operation separately checks the live administrator's `fiscal.remedy`
permission and its server policy. It requires a current alta with a matching rejection or
accepted-with-errors case and delivery evidence; unknown outcomes, duplicate conflicts and an
already generated cancellation are refused. It binds the original sale and issuing node from the
selected record and host, then writes the corrective sale, its numbered R5, delivery and case event
in one transaction. The earlier sale, fiscal rows and tenders remain unchanged in these tests.
Retries compare the complete decision and return the saved sale, record and event without another
number or payment. A failed resolution rolls the accounting and number allocation back.

`record-remedy-corrective.test.ts` exercises this internal transaction with real accounting and
fiscal writers. No new production remedy is enabled.

**2 November 2026, Task 8 synthetic corrective HTTP boundary.** With a test policy explicitly
allowing `corrective-invoice`, the management route passes validated signed line facts to that
transaction. The host supplies the node, deployment environment and clock; the action uses
`operator_script` origin and the authenticated administrator. Client claims for those values are
refused. The wire input accepts the series, total, operation description, whole-invoice flag and
lines with number, name, language descriptions, quantity, unit price, VAT rate and base, plus
optional gross amount, product id and original-line id. Other line metadata is refused rather
than discarded. Core retains its accounting, whole-invoice, line-reference and series checks.

`record-remedy-corrective-http.test.ts` exercises the real route and writers, including distinct
production/preproduction stamps, fractional quantities, whole-invoice credits, parallel retries,
changed decisions, live write authority and clock refusals. These synthetic operations leave the
earlier sale, fiscal records and payment/refund rows unchanged. The route's default policy remains
empty. Existing held-record and manual brake release have separate synthetic paths below. Actual
staff cancellation/refund integration remains unfinished; this HTTP milestone does not complete Task 8.

**2 November 2026, Task 8 synthetic held-cancellation release.** A cancellation already set
aside has its own immutable identity, so this operation submits that existing record. With a test
policy allowing `release-held-cancellation`, you name the held cancellation, its case and the
accepted current invoice version. The operation requires the same sale, invoice identity and
environment, a cancellation written by this box or a box in its takeover history (since A1425
the accepted version may be on any issuing chain), an ordinary cancellation still set aside, and
its matching `fiscal.anulacion_retenida` case. A pending, unknown, rejected, accepted-with-errors or superseded
invoice version is refused. Production policy remains empty.

The delivery becomes pending and due at the action's clock reading, its held acknowledgement is
deleted, and a resolution event records the signed-in administrator and complete decision in one
transaction. The event names no new remedy record. Changed decisions or another administrator
cannot reuse the action key. A retry returns the saved release even after submission; it still
checks the current administrator, server policy, writable host, node and environment. An earlier
different resolution rolls the delivery and acknowledgement changes back.

`record-remedy-held.test.ts` sends a correction through the real client to the fake tax service,
releases the held cancellation, and then submits that same cancellation. Its fiscal rows, chain
head and sales stay unchanged by the release. This synthetic exercise does not qualify the actual
staff cancellation/refund path or a production legal remedy. Those remain before whole-item review
and publication. Since A1425 (#2570) a new cancellation goes on the chain of the box running now,
whichever box made the sale.

**2 November 2026, Task 8 synthetic absent-original cancellation.** An administrator explicitly
selects the operation for a current rejected alta with matching case evidence. Unknown outcomes,
duplicate conflicts, a different case, an existing cancellation and a superseded version are
refused. The new immutable cancellation keeps the invoice identity and issued origin, carries
`SinRegistroPrevio=S` and joins the current chain head. Its delivery and resolution event commit
together. A retry compares the complete decision and returns its saved result without another
append. These checks leave sales and earlier fiscal rows unchanged; they do not qualify a staff
refund or resolve an already generated unsuitable cancellation.

The filing loop distinguishes this stored absent-original operation from an ordinary cancellation
of a rejected original. Synthetic filing tests send the former and retain the ordinary hold.
The production enabled set stays empty. This is an engineering path under the plan's synthetic
gate, not an adviser answer or a new live AEAT receipt. Historical descriptions of ordinary
cancellation holds below retain their original scope.

**2 November 2026, Task 8 live second-correction prerequisite.** Verifactu
[#150](https://github.com/waitron-io/verifactu/pull/150) adds the manual `double-correction`
probe. Its single authorised [AEAT TEST run](https://github.com/waitron-io/verifactu/actions/runs/41370629637)
submitted an original alta and two description corrections under invoice
`CI/20261102/41370629637-DOUBLE`, dated `02-11-2026`, on one synthetic installation.
All three batch and line replies were `Correcto`, without an error code. Each correction kept
that identity, used `Subsanacion=S` and `RechazoPrevio=N`, and linked to the preceding version.
The final consultation returned one `Correcto` record with the second correction's description,
fingerprint and link to the first correction.

The [dated evidence](../superpowers/specs/2026-11-02-aeat-double-correction-evidence.json)
retains the records, parsed replies and request/reply SOAP after identity masking. You can use
this as the Task 8 storage design's live prerequisite for two successive corrections. It does
not settle which invoice errors legally permit that remedy or enable production policy.
Rejected originals, changed money or tax, actual staff refunds and held-record resolution remain
outside this run; the remaining Task 8 workflows still need implementation and qualification.

| Source, checked 2 November 2026 | Exact words | Observation |
| --- | --- | --- |
| [AEAT TEST run 41370629637](https://github.com/waitron-io/verifactu/actions/runs/41370629637), three submission replies | `EstadoEnvio: "Correcto"`, `EstadoRegistro: "Correcto"` | The original and both S/N description corrections received those states. |
| Same run, final consultation | `ResultadoConsulta: "ConDatos"`, `EstadoRegistro: "Correcto"` | One record carried fingerprint `BB7FFF9845DDB687E31FA5404A273EE186F9D3FAF6FC8EC7B8A04E00ECF2F3F1` and description `Double correction probe: secondCorrection`. |

**2 November 2026, Task 8 corrected-fact requests.** The synthetic HTTP adapter accepts partial
corrections to the stored description, issuer name, invoice type, recipients, tax breakdown, total
and tax amounts, corrective/substitution references and correction amounts. Omitted fields keep
the selected version's facts; explicit null removes optional recipients or correction fields from
the new version. The invoice's issuer tax number, number and issue date remain unchanged. Reference
calendar dates survive a change in generation offset. Amounts must be exact decimal strings;
nested unknown fields and malformed choices are refused before the record builder, which still
validates the complete record. The saved decision includes all supplied facts and the prior outcome,
so changing a fact on retry refuses while object key order does not matter. Tests compare original
records, deliveries and sale rows. These are synthetic record corrections, not new accounting or
refund operations; all production remedies remain disabled.

**2 November 2026, Task 8 explicit accepted-with-errors description decisions.** With a synthetic
server policy, `priorOutcome: "accepted-with-errors"` requires both an accepted-with-errors delivery
and that cause on the selected filing case. The correction retains `Subsanacion=S` and
`RechazoPrevio=N`; the rejected path retains S/X. Omitting the selection means rejected, so omitted
and explicit rejected decisions share one saved result. A changed selection under a saved action
key is refused. Retries after a later delivery outcome and clock change preserve the saved result.
The tests compare earlier records, deliveries and case facts, including two successive synthetic
accepted-with-errors corrections. These are local engineering checks, not AEAT acceptance or a
decision that a particular invoice error permits this remedy. Production policies remain empty.

| Source, checked 2 November 2026 | Exact words | Scope |
| --- | --- | --- |
| [AEAT service description v1.0.3, §9.1.2, p.56](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf) | “No informar <RechazoPrevio> o informarlo con valor N” | The ordinary correction operation uses S with an absent or N prior-rejection marker. The section covers accepted records, including acceptance with errors, when another invoicing remedy is not required. This does not settle the adviser's open questions. |

**1 November 2026, Task 8 synthetic HTTP description correction.** With an explicit server-side
test policy, the route appends a correction and resolves its case. It accepts a description, case
and record references, reason and action key; it refuses unknown fields, including client claims
about policy, operator, node, deployment, software identity or generation time. Boot supplies
record-generation facts through the module route context. Its write check reads the current mode,
primary role and fence and requires trading admission; the adapter binds the clock to the stored
issue zone inside the write transaction. The invoice identity, amounts, tax breakdown, recipient
and corrective/substitution fields come from the selected immutable record. Tests preserve these
fields across a summer-to-winter offset change and retain the original invoice calendar day.

The saved decision excludes server generation facts, so a retry after the clock advances returns
the committed record and event. A changed description under that action key is refused; a changed
original delivery outcome after commit does not generate another correction. Two successive
rejected versions are exercised through HTTP with the earlier records and case facts retained.
These are synthetic checks, not AEAT acceptance or legal enablement. The production policy
remains empty; every disputed production action is refused.

 Earlier
Task 7 automatic-switch requirements below are historical; the 1 November decision supersedes them.

**2026-10-12, a conflict no longer holds its chain (owner).** A record AEAT refuses as a duplicate
(3000) while holding a different or cancelled record under that key is now `rechazado` with code
3000, with its incident and filing case, and the chain's later records are still sent
(`handleDuplicate`, `packages/fiscal-verifactu/src/drain.ts`). AEAT preproduction accepted, without a
warning, a later record after a conflict over changed contents; none after a conflict over a
cancelled record was tested ([W41s-1c receipt](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md#successor-receipt-2026-10-12-w41s-1c-both-probes-re-run-with-fresh-chains)).
Three conflicts in a row now trip the same-code brake; the owner wants them to switch to a fresh
number series automatically and keep selling instead (needs Tasks 4 and 7). A cancellation whose
original AEAT refused is now set aside on its own (envío state `retenido`, migration
`0005_envio_retenido`) with an `error` incident and a filing case, both `fiscal.anulacion_retenida`,
and holds nothing behind it; one already held behind its original is set aside in the transaction
that records the original's refusal. The three-refusal brake does not see a set-aside record: it
neither breaks a run of refusals nor counts towards one.
A record accepted with errors opens a filing case unless AEAT exempts the code (2004, 2009); a
re-sent one AEAT answers as a duplicate (3000), and one the reconciliation sweep corrects
(`reconcile`, no production caller yet), are judged by
the stored copy's own error, read from the duplicate detail or AEAT's consulta. What
still holds later records: the three-refusal brake and the wait behind an unknown answer.

**2026-10-13, old-backup authentication:** the owner chose the verifier in the selected
backup for cold restore; live takeover keeps the live verifier. The key name is now stored
beside each newly minted verifier, shown with the handover secret, and read from the placed
backup before the restore authentication callback. The runbooks warn you to keep older paper
keys until no backup from before their replacement remains. No outside current-key record is planned.

**2026-10-12, standby decision:** the owner selected dormant reservation at join and activation at
takeover. Historical signature verification
is separate from current outside consumption; it does not authenticate the caller or prove the
current register state. Takeover must
authenticate the administrator, isolate the old box, rule out parallel recovery and check
outside consumption before atomic activation. All three invoice purposes stay separate.

**Update, 2026-10-04:** the owner requires prevention before conflict recovery, including an
old-backup restore on new hardware with no internet. The
[revised design](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md)
records manual recovery, a paper allocation register in the recovery pack, an optional cloud
registry reachable by phone, emergency random series and an explicit later switch to a fresh
short series. Device evidence is optional. Matching invoice date and amounts no longer excuse
a fingerprint mismatch. Q5(f) and Q33–Q40 in the adviser document are revised, and Q41 covers
issued invoices missing from the backup. The owner approved this design ("lgtm") and selected
queue execution. The [revised implementation plan](../superpowers/plans/2026-10-04-fiscal-prevention-and-offline-recovery.md)
separates development from production-enablement gates: prevention and evidence work can
proceed while adviser answers are pending; disputed remedies retain explicit gates. It includes
an allocation-contract checkpoint, live AEAT probes, offline recovery, corrective workflows and
a separately owned Cloud registry workstream. The owner approved the revised plan on 2026-10-04;
it replaces the 2026-10-03 task list while W41s remains the backlog item. The owner approved
the allocation and recovery contract in §9 and granted W41s-4 a narrow H2 scope exception on
2026-10-05. Task 2 landed as [#1213](https://github.com/clintongormley/waitron/pull/1213).
W41s-1 completed eight synthetic preproduction probes;
[the dated protocol receipt](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md#71-protocol-receipt-2026-10-05-w41s-1)
records each outcome and its limits; the library probe PR is
[waitron-io/verifactu#132](https://github.com/waitron-io/verifactu/pull/132) (no release tag was created).
**Update, 2026-10-05 (W41s-1d):** [the asesor questions](../compliance/asesor-questions.md)
Q33–Q41 and [the findings, §16](../compliance/verifactu-findings.md#16-aeat-test-service-observations-for-conflict-recovery-added-2026-10-05-w41s-1)
now carry the test-system receipts and their limits. The legal questions remain open.
W41s-10c landed as [#1264](https://github.com/clintongormley/waitron/pull/1264). A231 #1256 has
landed before A948 enabled the prepared table and unpaid-departure F1 paths. **Next action:** continue the approved dependent W41s tasks in campaign order,
keeping each task's fiscal and adviser gates.
**Update, 2026-10-12 (W41s-1c re-run):** the clock fix merged as verifactu
[#141](https://github.com/waitron-io/verifactu/pull/141) and both probes ran again on its main
commit; [the dated receipt](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md#successor-receipt-2026-10-12-w41s-1c-both-probes-re-run-with-fresh-chains)
sits beside the partial one. Every line was free of 2004. The successor after a 3000 refusal,
the batch successor sent with its refused predecessor, the next successor after it, and the
successor linked to an unsent cancellation all returned `Correcto`. An exact re-send of the
accepted batch successor returned `Incorrecto`/3000 with `EstadoRegistroDuplicado` `Correcta`.
No consulta, production run or legal answer is behind this; existing holds are unchanged.

**Update, 2026-10-12 (W41s-3d):** PR
[#1309](https://github.com/clintongormley/waitron/pull/1309) adds an hourly retry of the first
eligible brake-held record. An accept or a different-code refusal can release the remaining
brake holds; a same-code refusal keeps them held. A record with its own filing case, an earlier
held record, an unresolved earlier send, a cancellation of a refused original or a different
environment is not probed. The alert's “Since” stays at the time the run reached three
same-code refusals, including after refused hourly retries (owner, 2026-10-12).

**2 November 2026, Task 8 synthetic manual brake release.** With a test policy explicitly
allowing `release-brake`, you name the first held record, the holding refusal's case, your reason
and an action key. The administrator action makes that record pending and due immediately. It
uses the drainer's brake eligibility: three matching refusals immediately before it, no earlier
held or unanswered record and no case of its own. An ordinary cancellation of a refused current
invoice remains held. The action leaves the attempt count and previous send facts unchanged,
clears the held acknowledgement and records a note in the same transaction.

A note permits a retry; it does not resolve the original refusal. Later held records still wait
until the released record's answer breaks the refusal run. Another refusal with the same code
keeps them held. The request can be retried after submission without changing delivery again;
current permissions, host identity, writable status and server policy are checked again. The
public policy stays empty. `record-remedy-brake.test.ts` exercises these outcomes through the
real client and fake tax service, including a rollback when the note cannot be stored. This
synthetic path does not qualify actual staff refunds or enable a production remedy.

A line AEAT moves away from
its record's position is never applied, so that record stays unknown and is retried unless an
earlier record on its chain is on hold, while records whose line is still at their position are
applied as usual. A record whose line AEAT moved in every reply it was sent in would never be
confirmed: Route B's lookup never runs for it, each retry sends it again in the same chain order
while the later records of its chain wait behind it — loud (an alert per record) and never a wrong
acceptance. One option for the owner, not built: after a mismatch, send
each unknown record again in an envío of its own. An incident is not stored while one with the same
code for the same sale is open, so while a `fiscal.respuesta_descuadrada` is open for a sale, a later
mismatched reply to an envío whose first record belongs to the same sale (that record again, or the
sale's cancellation) keeps none of its lines.

**2026-10-22, A985 observation:** the cancellation-reply identity question is
answered for the two synthetic cancellation submissions in
[run 39721604913](https://github.com/waitron-io/verifactu/actions/runs/39721604913): both replies
named the cancelled invoice and operation `Anulacion`. The unchanged retry returned `Correcto`,
not duplicate `3000`; its lookup returned `Anulado` with the cancellation's fingerprint.
The duplicate-response path remains unobserved in this run. See the
[dated findings and limits](../compliance/verifactu-findings.md#19-cancellation-replay-zero-total-and-wrong-fingerprint-added-2026-10-22-a985).

**W41s-4 reconnect qualification, recorded 2026-10-12:** extend the reconnect qualification
through the recovery runtime path; the recorded test exercises an offline and then successful
fiscal drain without a series switch.

**For Task 9 (the filing screen):** `listFilingCases` reads every case and event with no filter or
paging, and `heldRecords` reads every `rechazado`/`detenido` row; neither has a production caller
yet, so the screen should add an open-only filter or paging when it calls them.

## C126 (cancelling an order whose invoice was issued credits it; owner, 2026-10-02, option b, decided without the asesor) — landed as #1030

- **C126 (cancelling an order whose invoice was issued credits it; owner, 2026-10-02, option b,
  decided without the asesor) — landed as #1030.** `POST /api/working-orders/:id/cancel` (`cancelPlacedOrder`,
  `apps/server/src/working-order.ts`; the credit in `apps/server/src/cancel-credit.ts`) issues
  an R5 corrective invoice, by differences, for the whole invoice. The PIN override is B33
  (#1041). The owner dropped the dashboard Orders screen's "Invoice not credited" mark
  (2026-10-02 ~12:05): such a bill is to show as Cancelled with its credit note. Open:
  - **B32 (the till offers "Cancel and credit"; owner, 2026-10-02 ~12:05) — landed as #1055.**
    The dialog's dismiss button reads "Keep the bill" ("Mantener la cuenta"), not the
    shared "Cancel" beside "Cancel and credit" (owner, 2026-10-02). The owner also kept the
    cancel's answer empty, so the till goes on reading the credit note's number from the bills.
    Open:
    - **The approver list is fetched with no time limit.** After a refusal for lack of
      permission the till asks `GET /api/cancel-credit-authorizers` who can approve, and until
      the answer arrives the dialog stays busy with its buttons disabled (`apps/till/src/till-app.ts`,
      the approvers fetch). The unpaid-departure and refund dialogs fetch theirs the same way and
      predate B32; a time limit belongs on all three together. Raised by B32's review by reading
      only; nobody reproduced a stalled answer.
    - **No till test covers a payment refusal that arrives after the approver's PIN.** Since A845
      (#1895) a person without `sale.rectify` meets the PIN prompt before the server's
      `bill.payments_received` or `order.payment_in_flight`; by reading only (#1895's review), the
      till then closes the PIN prompt and the cancel dialog shows the payment message. Add a till
      case that answers the PIN with each refusal and checks what the dialog shows.
  - **Done by B34 (#1077, 2026-10-03; owner, 2026-10-02): a counter order invoiced when it was placed and still
    unpaid can be cancelled with a credit note at the till.** The waiting list "is drawn only
    inside the held-orders card" (Task 16, in [till.md](till.md#task-16-981-counter-handover-with-b25-b26-b29-b30)), so a till layout without that card offers no Cancel and
    credit for counter orders either. How it differs from the table's path, and what is left open:
    - **The result does not name the credit note.** The table's dialog reads the credit note's
      number from the party's bills; the waiting list drops a cancelled order, and the cancel's
      answer is empty, so the dialog says "A credit note was issued and the bill is cancelled"
      without a number. Naming it would need the number from somewhere new; not decided.
    - **A cancel that gets no answer is never shown as done.** On the table, the till reads the
      bills again and shows a bill now cancelled as done. On the counter, an order missing from
      the list may have been cancelled, or may have left it another way (paid and handed over,
      say), so the dialog says the cancel may have been made and to check the waiting orders (a
      new sentence, `cancel_credit.unconfirmed_counter`). The dialog shows this first, and then the
      till reads the waiting list again.
    - Unlike the table's button, the counter's does not check for a payment on the order. Two ways
      of giving a placed counter order a bill payment were tried while building B34 and both were
      refused: taking the payment on the placed order (`working_order.not_open`), and placing an
      order already holding one (`bill.payments_received`). Other ways were not looked for. If an
      order does hold one, the cancel refuses it with `bill.payments_received`, after the
      `sale.rectify` check, and the dialog says so.
  - **`GET /api/cancel-credit-authorizers` (B33) lists the active holders of `sale.rectify`.**
    Every role holding `sale.rectify` today also holds `sale.refund`, `sale.void` and
    `cash.drawer`, so its cases cannot tell which of those it reads.
  - **Done by C132 (landed as #1060, 2026-10-03): a credit note's line names the invoice line it reverses.**
    `sale_lines.corrects_line_id` (core migration `0070_sale_line_corrects`, a foreign key to
    `sale_lines.id`) holds, on a corrective invoice's line, the original line it reverses or
    adjusts. A partial correction keeps the looser rule: its lines may name a line or not. No
    report reads the link yet. Open, for partial corrections only, which no product code makes yet
    (only tests and demo scripts do): whether a line a correction ADDS (a new charge, not a change
    to an invoice line) stays unlinked, and whether two adjustments may name the same invoice
    line. When a report starts reading the link it will want an index on the column, as
    `sales_corrects_idx` serves `sales.corrects_sale_id`.
  - **A fully credited bill's original invoice can still be reprinted**, from the till and from
    the dashboard; the server allows it. Whether a reprint should say the invoice was credited is
    not decided.
  - **Left in the dashboard Orders plan and spec after #1034 landed beside C126:** their banners
    still say C126 "is to" credit the bill (it is built); the plan's owner-answers row 7 still says
    "Task 2, as written" for the dropped mark; its Task 1 voided-bill case still lists
    `invoiceNotCredited: false` with no pointer to the drop; and #1034 did not write its planned
    test that a cancelled bill with an invoice shows its credit note.
  - **An invoice that already has a correction cannot be cancelled.** One that lowered it leaves
    less than the whole credit takes back, so the cancel is refused
    `sale.correction_exceeds_total`; one that raised it is refused `sale.correction_not_whole`,
    because a whole credit must be the invoice's first correction. Both are cases in
    `apps/server/src/cancel-invoiced-order.test.ts`. No route issues a credit note other than this
    one.
  - **The credit note is not printed** for the customer (asesor Q32 (b)).

## Uncertain receipt delivery

Automatic receipt transport retries and manual retries of exhausted original jobs retain their
payload. If a printer printed before its reply was lost, sending those bytes again can produce
another unmarked sheet. A991 contains repeated original requests and refuses resending a job
recorded as completed; it does not establish that an uncertain transport attempt printed nothing.

Next action: design recovery for uncertain physical delivery across automatic retries and explicit
retry actions, retaining the customer's route to a legible invoice. Do not describe the outbox's
job count as a physical exactly-once printing guarantee.

## A888. After A795 lands: the owner's checks with real certificates

- **Left open by A795.** These were A795's landing condition until the owner approved landing it on
  2026-10-19 before they ran; the owner runs them with real certificates afterwards. Each is a question the
  [design](../superpowers/specs/2026-10-18-a795-aeat-certificate-after-setup-design.md) (§8) and
  [plan](../superpowers/plans/2026-10-18-a795-aeat-certificate-after-setup.md) (§3, decision 11)
  could not answer from a source or a test server.
- Run them with the operator harness, which opens the file and asks AEAT a read-only `consultar`
  with the code an install runs, and files nothing. Its variables are listed in its header and in
  `apps/server/README.md` ("Installing or replacing the AEAT certificate after setup"):
  `pnpm --filter @waitron/server test:preprod --reporter=default src/aeat-certificate-check.preprod.test.ts`
  (file `apps/server/src/aeat-certificate-check.preprod.test.ts`).
- The checks:
  - a consulta to production AEAT, and a consulta with a company seal at `www10`;
  - each type at the other type's address: a seal sent to `www1` and a representative certificate
    sent to `www10` (`WAITRON_CERT_CHECK_ADDRESS_KIND`), which says whether the live check catches
    a wrong type;
  - how AEAT answers an expired certificate: refused during the connection (and with which error,
    `other side closed` or `ECONNRESET`), an HTTP error or SOAP fault, or a reply refusing each
    record;
  - where a real seal keeps the company's tax ID, and whether real representative certificates all
    carry `organizationIdentifier` and `O`;
  - whether files exported by FNMT's own procedure, by the browsers the export guides cover and by
    the Mac keychain use the old RC2 encryption; if they do, the guides say how to export with AES;
  - a non-ASCII passphrase: the tests use ASCII passphrases only, because a test file built with
    one could not be opened by Node (plan §3);
  - where an AEAT error number arrives in a refused consulta. This decides whether the design's
    "AEAT refused this certificate for {taxpayerNif} ({codigo})" sentence is built; today a SOAP
    fault is shown with the code and reason AEAT sent (plan decision 11).
- If any of them answers differently from the design, the affected part is redesigned in a
  follow-up.

## A853. The box makes a company seal's private key itself

- **Decided out of A795 (2026-10-18), design §2.7 and §3.9.** FNMT's seal procedure: «Esta operación
  deberá realizarse en una máquina del suscriptor» — the key pair and certificate request are made on
  the subscriber's machine, and FNMT returns only the certificate
  (`docs/compliance/getting-to-production.md:181-182`, `:199-200`; `action-plan.md:108-109`). Setup
  and A795 both install only a `.p12` file, so a seal's key has to be made on another computer and
  moved to the box. The flow: the box makes the key and the request, shows the request to paste into
  FNMT's form, keeps the key while the request is with FNMT, and takes back only the issued
  certificate. One design for setup's first install and for renewal on A795's card. It also decides
  whether the box keeps the previous seal's key, since the owner then has no file of their own, and
  what the card shows while a request is pending.

## VAT at line add (M7v, A68)

Asesor Q26 (the rate on the day of issue) is open. Owner rulings
at landing (2026-09-27): invoice-first issues at placing, so it takes the placing day's rate; a
box holding order lines is reset rather than given data-migration code; and every invoice path
reads its one clock after the order's lines. `apps/server/src/vat-class-at-line-add.test.ts`
copies its setup from `issuance-pass.test.ts`; a shared helper could absorb it. The till computes
a basket VAT split (`vatBreakdown`, `apps/till/src/state/working-order.ts`) that no screen shows.

## Nothing in the product can issue a corrective invoice (R5, _factura rectificativa_) for a VAT error on an issued simplified invoice

`recordCorrection` exists
(`packages/core/src/record-correction.ts`; the Verifactu backend corrects only an F2, as an R5);
the whole-order cancel route calls it for a credit of the whole invoice. No route issues a
correction for part of one. The owner also needs a way to
correct an issued invoice when a customer spots an error after payment, regardless of the future
Tabs · Bill choice (2026-10-04, A261 step 2 decision). **The owner's points for when this is
designed (2026-09-29):** (1) the amount staff enter is what the customer gets back,
VAT included — a €2.00 correction at 10% is €1.82 base plus €0.18 VAT; (2) whether a correction
should instead cancel the original and issue a new invoice (`TipoRectificativa` "S", where
today's path files by differences, "I", in `packages/fiscal-verifactu/src/backend.ts`) — asked as
asesor Q31 (2026-09-30), not decided.

- **A802: design approved 2026-10-21; implementation remains open.** The
  [design](../superpowers/specs/2026-10-20-a802-partial-paid-invoice-correction-design.md)
  covers paid-receipt corrections, their money-back workflow and A758's same-step correction.
  The owner approved correction before connected refund, both permissions with explicit refund
  links, and the proposed source-history gates. The
  [build plan](../superpowers/plans/2026-10-22-a802-partial-paid-invoice-correction.md) identifies
  the protected-writer approval needed before implementation and the exact-gross qualification
  required before the dependent money workflow.
  The owner's 2026-10-18 scope follows:
  - A server route that issues a partial correction through `recordCorrection`
    (`packages/core/src/record-correction.ts`), filing by differences as today.
  - A till action on a paid receipt, where staff already find one (the find-a-bill page, beside
    Refund): pick the wrong lines and how many, or enter an amount; the amount entered is what the
    customer gets back, VAT included (owner, 2026-09-29); print the corrective receipt.
  - Settle in the spec how a correction and the existing Refund relate, by reading the code paths:
    whether money goes back in the same step, and what each files.
  - Asesor Q31 (difference vs. substitution) changes only the filing type; build for differences.
  - A758 §3.8 (revised 2026-10-19 for the owner's Q43 notes): a dish cancelled on a paid bill with
    its Refund tick on is refunded through the ordinary refund, with no correction of its own.
    Owner decision (Q43 e, 2026-10-18): once A802 lands, a refund of cancelled dishes files their
    partial R5 in the same step. §3.8.1 there has a worked example: €5.50 back at 10% is an R5 of
    −€5.50, base −€5.00, VAT −€0.50.
  - Later fit: the bills-and-tables brainstorm (2026-10-17/18) moves order lines to one portion per
    line; a correction then picks portions the same way staff pick dishes to move.

## Correct VAT without returning money

The owner excluded a VAT-only correction from A802 on 2026-10-21. Design how to correct a wrong
VAT rate or classification while keeping the customer's gross total unchanged and returning no
money. Settle its fiscal document, source-history checks, paper and reporting in that separate
design. A802's gross-reduction workflow does not authorise this build.

## "No tax (0%)" is an open fiscal question, and it must be answered before the first live filing

The 2026-10-09 research found the only 0% rate in the VAT Law is art. 91.Cuatro, goods
donated to non-profits; the 0% on basic foods ended on 30 September 2024.

From **The product editor and catalogue (#345, #379, #387) — what is left open.**
[Operator guide](../../apps/server/src/guide/en/products.md); [developer guide](../developers/products.md).

- The selector shows the catalogue's zero-rate class under that name; pricing puts the
  whole gross in the base with zero VAT, and Veri\*Factu files it as `S1` — taxable, not exempt — at
  a 0.00 rate. AEAT separately requires a _non-subject_ operation to record its cause (`N1`,
  Articles 7, 14 and others; `N2`, place-of-supply rules), and nothing established that any of this
  venue's products is legally non-subject. Asesor question Q20 asks which intended cases belong in
  `S1` and which need `N1` or `N2`, and whether the label should read "IVA 0%" rather than "Sin
  impuestos". **Non-blocking while pre-production; blocking before going live.** If the answer moves
  a case to `N1`/`N2`, that is an explicit classification threaded through sale facts, reporting and
  every Veri\*Factu sale, correction and substitution path — never a quiet redefinition of `zero`.

## Loose ends left by A230 (`@waitron/verifactu` 0.2.1, #1099).

- A resent cancellation AEAT already holds now counts as accepted when AEAT's stored fingerprint
  matches the cancellation's (`drain.ts`'s `handleDuplicate`; a mismatch is refused with
  `fiscal.duplicado_anulado`). The TEST-service retry in A985 returned `Correcto`, with a
  subsequent lookup `Anulado` and the matching cancellation fingerprint. A real
  `3000`/`Anulada` response and Waitron's handling of it remain unobserved in that run.
  [Findings](../compliance/verifactu-findings.md#19-cancellation-replay-zero-total-and-wrong-fingerprint-added-2026-10-22-a985).
- A voided sale whose lookup AEAT answers under the sale's own reference is not handled; not
  shown to happen either way.
- An unusable `TiempoEsperaEnvio` is not recorded anywhere (the raw value is dropped).

## A556. A full invoice that later replaces a bill's simplified one would not be delivered through the bill.

The dashboard's order detail reaches a bill's invoice as the sale carrying that bill's
id; a replacing full invoice (an F3) is a separate sale, and whether it would carry the bill's id
was not checked (A231q's review, read, not run). Nothing issues an F3 today: no route calls
`recordSubstitution`.

**2026-10-22 source-reading addendum:** core substitution exists, but no public app caller
was found in the inspected main/product trees. The [A739 owner-flow revision](../superpowers/specs/2026-10-22-a739-owner-payment-and-receipt-flow.md#the-fiscal-dependency-is-visible-not-solved-by-moving-fields)
records the missing recipient/address, request recovery, bill/delivery and no-charge integration
here under A556, with A948/Q17/Q5(d). No new fiscal item or enablement is created.

## Bundle: One owner session with a real certificate against AEAT

3 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1270. Verify the fake AEAT's invoice-date comparison at midnight.**
  The readiness fixture uses a controlled clock. The library's `1112` check compares invoice dates
  at UTC midnight; AEAT validations §3.1.3.1 and the error wording do not name the comparison zone.
  Establish it from an authoritative definition or controlled preproduction probe, then correct and
  release `@waitron/verifactu` if needed. Keep this separate from A696's venue-zone implementation.
  The handover simulation now uses an advancing noon clock after its first filing reproduced
  `1112` at 23:28 UTC on 6 November, on both main and the certificate-worker branch.
  Audit the other server fixtures found by `rg 'createFakeAeat.*serverNow: new Date' apps/server`;
  their exposure to the same date boundary has not been reproduced.
  [Reproduction and sources](../developers/testing-guide.md#give-a-fake-fiscal-service-and-its-sample-one-controlled-clock).
- **A888. After A795 lands: the owner's checks with real certificates** (left open by A795). The
  owner approved landing A795 on 2026-10-19 before these ran.
  If any answers differently from the design, that part is redesigned in a follow-up.
  [Detail](fiscal.md#a888-after-a795-lands-the-owners-checks-with-real-certificates)
- **A679's internet time reading came back unavailable against pre-production in each of four runs
  on 2026-10-23.** Found while planning A798-B slice 9.
  [Detail](fiscal.md#a679s-internet-time-reading-came-back-unavailable-against-pre-production-in-each-of-four-runs-on-2026-10-23)

## Bundle: Settle the hold and the brake once

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Still open after W41s-3 (#1289): one reply can open up to 1,000 filing cases.** A refusal
  that applies to every later record (one about the taxpayer's identity, say) opens one case per
  record in that reply before the repeated-code brake takes effect (`MAX_REGISTROS_POR_ENVIO`).
  [Detail](fiscal.md#still-open-after-w41s-3-1289-one-reply-can-open-up-to-1000-filing-cases)
- **Re-examine the hold behind an unknown outcome once the asesor answers** — OPEN (waiting on the asesor; owner 2026-10-06).
  The decision is put to the asesor as [Q47](../compliance/asesor-questions.md#q47-keeping-a-chains-later-records-unsent-added-2026-10-12) (S19 in the short list),
  covering this hold and the three-refusal brake.
  [Detail](fiscal.md#re-examine-the-hold-behind-an-unknown-outcome-once-the-asesor-answers)

## Bundle: Show a late success, decide the address, fix those strings

3 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A554. Should any screen show the address an invoice email went to?** An owner question, open.
  [Detail](fiscal.md#a554-should-any-screen-show-the-address-an-invoice-email-went-to).
- **A557. A success reported after an attempt had ended is not shown.**
  [Detail](fiscal.md#a557-a-success-reported-after-an-attempt-had-ended-is-not-shown).
- **A558. The `invoice_delivery.*` refusals other than `.active` end without a full stop.**
  [Detail](fiscal.md#a558-the-invoice_delivery-refusals-other-than-active-end-without-a-full-stop).

## Bundle: One authorised edit of a protected test, plus its neighbours

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **`packages/fiscal-verifactu` code** — found by #562 while pruning comments. **Open:** the inner
  try/catch around the log call in `aeat-transport.ts`'s `closeAll` is dead; removing
  `appendToChain`'s nested `tx.transaction` makes no test fail; and `write-path.e2e.test.ts` points
  at fixture lines that have moved. [Detail](fiscal.md#packagesfiscal-verifactu-code)
- **Reconcile the protected fiscal write-path test's old policy quotation.** Its header still says
  no fiscal condition blocks a sale; the approved local conflict stop is an exception. Keep its
  behavioral assertions and protected-file scope intact.
  [Detail](fiscal.md#protected-write-path-test-policy-quotation).

## Decisions and deliberate limits

### A1425 part 1: after a takeover (owner, 2026-11-08)

A box the held membership chart does not name `serving-primary` refuses a sale before any money moves.
So far only on a Veri\*Factu venue: `NoneBackend` has no such check.
A conflict AEAT reports on a record inherited from a box this one took over from is recorded and does
not stop this box. Approved with #2570; the note is in the campaign's
`questions.md`, 2026-11-08 10:44.

### W41s-7: administrator conflict switching only (owner, 2026-11-01)

After the conflict reply commits, stop issuance on its clashing identity until an administrator
uses the current recovery key and the existing activation writer to select a fresh minute identity.
Keep the rejected original and its case. The owner excludes automatic switching permanently and
removes Task 7's outside sole-seller grant, fence acknowledgement, outside switch history and
24-hour automatic limit. Those are not prerequisites for this administrator procedure.
The permitted writer rotates the affected node's identity and series and resets its chain head;
record contents, hash and number-allocation logic, `registerSif`, `restoreFiscal` and protected
assertions remain outside the change. See the [implementation plan](../superpowers/plans/2026-11-01-w41s-7-conflict-recovery.md).

- **27 October 2026, A1157:** Keep the normalized text and source files alongside the library's
  watched fingerprints, updated by `--refresh`; keep date stamps in the comparison (owner: “we
  should keep one for comparison”). The exact October scope-page edit remains unrecovered.
  [Current-rule review and archive limits](../compliance/research/2026-10-27-a1157-faq.md).

- **A948, owner decision 2026-10-27: enable full invoices in every environment now.** No
  environment flag remains. A555, A444, applicable B2B delivery, physical paper/QR checks and
  the asesor's manual-remedy approval were dropped as prerequisites to the switch, not closed.
  Counter sales, integrated-card payment and unissued counter collection retain their F1 refusal
  until A555 carries original delivery through payment. Saved F1 choices may grow above the
  simplified-invoice ceiling.

- **Backup access is independent of a retained setup's password (A731; owner, 2026-10-15).**
  Authenticate the selected backup with its own named node key, plus the archive key or source
  credentials it needs. Keep unrelated local records opaque and retain their files. A key that
  opens the backup does not replace fiscal history admission. Follow
  [repair recovery](../operations/hour-recovery.md#recover-while-first-setup-is-blocked).
  (2026-10-31, A1131bc slice 3: a new recovery no longer keeps the failed setup's files; Recover from
  backup deletes the setup first, then uses the ordinary restore. The anchor now describes that.)

- **Pre-squash certificate metadata (A889).** Until a pre-A795 test box is reset under
  [A760](../operations/a760-migration-squash.md), reinstall its certificate through the
  certificate card if it shows **Installed: not recorded**. The card's expiry alerts and
  reminder emails use an install record. A direct `waitron-credentials set --purpose fiscal.aeat`
  write still creates no install record; use the card when you need that metadata. Removing
  A889 from open work does not mean the planned A760 reset has run.

- **Lost credentials use reinstallation, not A732's recovery desk (owner, 2026-10-21).**
  A732's fresh-workspace action, taxpayer-proof routes and recovery desk are withdrawn.
  If you have lost both the administrator password and recovery sheet, reinstall and set up
  the box again. This loses its local data and starts a fresh fiscal identity and chain.
  Copies held separately remain separate recovery sources, requiring their own recovery keys;
  reinstalling does not recover access to them. See [first Live setup](../operations/first-live-fiscal-setup.md#when-both-credentials-are-lost).

- **The Cloud fiscal allocation registry is dropped (owner, 2026-10-29, A1189).** "We no longer
  have the reservations because we use the time-based codes instead." Waitron's client and report
  journal are removed; the fiscal package still reads old Cloud receipts until
  [their retirement](#retire-the-historical-allocation-formats-from-fiscal-verifactu).

- **A €0 fully comped sale settles when it is comped (owner, 2026-10-21).** Keep the
  settlement-time behaviour; do not backdate it to the invoice's issue time.

### A venue without Cloud needs a usable paper-custodian route

The owner approved the hour-code design on 16 October 2026 at 14:50, replacing paper/Cloud
allocation and S/P/C/E naming with taxpayer-wide coordination, clock/history checks and one
recovery-key PDF. The 18 October clarification requires one prefix for each invoice purpose.
The owner approved the generated PDF and exact retained CLI-launch patch on 19 October.
The [approved design](../superpowers/specs/2026-10-16-a679-hour-coded-series-design.md)
and [historical decision/checkpoint snapshot](../operations/a679-development-checkpoints.md)
retain the decisions and their earlier alternatives. No simultaneous-box reservation guarantee
or conversion of old fiscal records is part of this change. (2026-10-22: A947 slice 4a replaced
the hour names with five-symbol UTC-minute names, the recent-setup question with a 30-second
check against a second clock, and dropped the installation code from the sheet; see the
[A947 design](../superpowers/specs/2026-10-21-a947-two-box-failover-design.md) §6.5 and §6.7.)

- **A795, owner decisions 2026-10-18 (design §9, Q1–Q3).** Replacing the AEAT certificate needs the
  existing `system.manage` (managers and admins); no new permission. Warnings go by type, in
  calendar days left: a company seal turns amber at 90 and red at 30, a representative certificate
  at 60 and 14 (`CERTIFICATE_THRESHOLDS`, `packages/fiscal-verifactu/src/certificate-dates.ts`). The
  box emails every active person holding `system.manage` who has an email address, at most once per
  person and stage. Receipt: [plan §1](../superpowers/plans/2026-10-18-a795-aeat-certificate-after-setup.md).

- **A845 (#1895), owner decision 2026-10-17: cancelling an invoiced bill checks the permission first**, as
  the drawer, refund and unpaid-departure routes do: "not permitted" (with the PIN checked and
  counted) comes before any payment refusal.

- **A741, owner decision 2026-10-15: one large-bill limit of €3,000** (#1774). A sale of exactly
  €3,000.00 is accepted and one of €3,000.01 refused (`simplifiedInvoiceLimit`,
  `packages/fiscal-verifactu/src/backend.ts`), inside the 3,010.00 that `@waitron/verifactu`'s
  validator applies. The till asks whether a large bill is for different people at the server's
  limit, and asks no full-invoice question and draws no Full invoice button while the server sends
  `fullInvoices: false`.
- **A696, owner decision 2026-10-15: “A — Venue's time zone”.** Every new invoice date and
  record offset, ordinary receipt and till use the saved venue zone, including DST, independently
  of the process zone. Old records, including their dates, offsets and hashes, stay unchanged.
  Receipt: `~/waitron-campaign-e/questions.md`, **WATCHER 2026-10-15 ~05:12**, “OWNER ANSWER
  to A696 question 1”; [spec decision](../superpowers/specs/2026-10-15-a696-invoice-time-zone-design.md#owner-decision-recorded-2026-10-15-the-venues-saved-time-zone).
  That answer alone grants no repair permission or build approval; the later 17:20 scope
  decision is recorded below. A696 stays open and A444 stays separate.
- **A696, owner decision 2026-10-15 17:20: include restricted guided zone repair.** Only an
  invalid or missing saved zone is eligible. A manager confirms the named zone, the captured
  payment resumes without another charge, and new issuance uses the recovery instant and its
  venue offset. Keep the capture instant and settled replay facts; valid-to-valid settings locks
  stay in force. Receipt: `~/waitron-campaign-e/questions.md`, **WATCHER 17:20**, answer to
  A696 question 2. The [exact design](../superpowers/specs/2026-10-15-a696-guided-zone-repair-design.md)
  awaits owner approval before planning or building; the scope answer does not approve its
  proposed permission or repair mechanism.
- **A696, owner supersession 2026-10-15 ~22:25, recorded here 2026-10-20:** validate the saved
  zone at startup and every writer; stop trading before any sale, payment or invoice under a bad
  zone. A manager/admin confirms only a missing/invalid zone using existing `venue.configure`,
  one handled incident and no new table. Valid-zone changes keep all settings locks. This replaces
  the 17:20 post-capture repair direction above: drop its captured-payment failure state, resume
  action and historical-reporting consequence. Keep mid-payment recovery only if a supported live
  invalidation path is evidenced. Receipt:
  `~/waitron-campaign-e/questions.md`, **OWNER 2026-10-15 ~22:25**.
  The [startup redesign](../superpowers/specs/2026-10-20-a696-startup-zone-validation-design.md)
  passed requirements review.

- **Reply matching (owner, 2026-10-06).** Line N of AEAT's reply is paired with record N of the envío, and is
applied only when it carries that record's reference, names the invoice (issuer NIF, number, date)
the record was sent as, and names no operation (`Operacion.TipoOperacion`) other than the one sent;
a line with no operation is not refused for that.

- **Records that need a person's decision (owner, 2026-10-12, PR #1596).** A 3000 conflict is
  refused and holds nothing; a cancellation of a refused original is set aside (`retenido`) with a
  filing case of its own and holds nothing; a record accepted with errors opens a filing case
  unless AEAT exempts its code (2004, 2009). Three conflicts in a row still trip the same-code
  brake until Tasks 4 and 7 switch to a fresh number series instead.
- **Decided (owner, 2026-10-02): a whole-invoice credit copies the invoice's own VAT split,
  negated** (`recordCorrection`'s `wholeInvoice`, `packages/core/src/record-correction.ts`).
  Worked out from the lines, as a partial correction still is, a 0.55 dish at 21% invoiced
  0.45 + 0.10 reverses to -0.45 - 0.09 (measured 2026-10-02); copied, it is -0.45 - 0.10.
- **Over-limit invoices (A261-2c, #1285; owner decision, 2026-10-06).** Non-fiscal placement
  accepts an over-limit order; collection refuses the over-limit invoice without taking money.
- **What a legal-name change leaves reading the current name (A494, 2026-10-11).** On a venue with
  no tax regime, a reprinted receipt and an emailed invoice show the current name, since none is
  stored with them (`apps/server/src/receipt-print.ts`, `apps/server/src/invoice-document.ts`). The
  card payment slip, the Modelo 303 export and the till's start-up read the current name. A
  reconcile query across a rename takes its header name from whichever of its rows comes first
  (`packages/fiscal-verifactu/src/reconcile.ts`).
- **Full invoices by email or on A4: the owner's answers in place of the asesor's (2026-10-07, A231d's
  plan Task 0.1, so A231p could be built).** The owner dropped the enablement prerequisites on
  2026-10-27 (A948 above); the asesor is still asked to confirm these as [Q44](../compliance/asesor-questions.md#q44-sending-a-full-invoice-as-a-pdf-by-email-or-on-a4--the-owners-interim-answers-added-2026-10-07):
  1. A PDF emailed after a paper original, or paper after an emailed original, is a «duplicado» and is marked so.
  2. Consent to email: staff ask the customer and record the answer on the till. The customer does not sign or confirm anything themselves.
     **Gap found 2026-10-09 (A448):** for a consumer, TRLGDCU art. 63.3 requires the request for consent to «precisar la forma en la que se procederá a recibir la factura electrónica, así como la posibilidad de que el destinatario que haya dado su consentimiento pueda revocarlo y la forma en la que podrá realizarse dicha revocación». The till's question must say both.
     _2026-10-12: for the product this answer is superseded. The owner removed the consent step on
     2026-10-09 ("We don't need customer consent to send them an email; just giving us the email
     address is sufficient."), and A231q's tasks C1a and C1b removed it
     ([plan](../superpowers/plans/2026-10-12-a231q-invoice-delivery-part-2.md)). A448 keeps the
     legal question open._
  3. Keeping: the same as a printed F1 — the invoice's database record. No copy of the PDF file is stored. The reconciled plan drops the proposed delivered-PDF table and keeps delivery metadata only.
  4. An unsigned PDF is a valid original for a business customer before the [business regime](#when-the-business-e-invoicing-regime-starts) applies, carrying the same QR and legend as paper. Receipts, each found word for word in the source fetched 2026-10-07: RD 1619/2012 art. 8.4, «se presumirá acreditada cuando se haya expedido utilizando un sistema o programa informático en conformidad con los requisitos»; DGT binding ruling V2891-18 (08/11/2018), an emailed PDF «con independencia de que no haya sido firmada digitalmente por el emisor de la misma, tendrá la calificación de factura electrónica»; AEAT's Veri*Factu FAQ, the QR on a PDF «no tendrá especialidades respecto de la que corresponde a la emisión en papel».
  5. A retry after a failed or uncertain send is still the original.
- **Office printers are sent pages Waitron draws itself, rather than through CUPS** (owner, 2026-10-03,
  A231d's decision 10): PDF when the printer lists it, else PWG Raster, else Apple Raster
  (`apps/print-agent/src/ipp-capabilities.ts`). The measurements behind it are in the
  [design](../superpowers/specs/2026-10-03-invoice-pdf-email-and-office-printing-design.md). Office
  printing reverses the 2026-09-09 provisioning design's "raw ESC/POS only" decision.

**Update, 2026-10-12 (W41s-4 key authority):** the owner selected the current node key alone
with permanent attribution to its authentication event. Internal qualification now checks the
real verifier before the lock and rechecks it in the write transaction. Signed consumption and
approval bind `{kind:"recovery-key",nodeId,eventId}`; normal administrator actions retain person
attribution.

**2026-10-14, approved hook-contract checks:** the owner approved exactly the seven groups in
[the supplemental request](../superpowers/plans/2026-10-14-w41s4-hook-contract-assertion-approval.md).

**2026-10-14 setup-check approval:** both exact setup-check changes are approved and applied.
[Exact proposals and retained checks](../superpowers/plans/2026-10-14-w41s4-setup-check-approval.md).
[Host checks and demo decision](../superpowers/plans/2026-10-14-w41s4-host-check-and-demo-decision.md).

### W41s-4 recovery-key label, 2026-10-13

The owner's 18:00 naming override replaces the random 16-character label with the UTC issue
date and four characters from an alphabet without 0/O, 1/I/L, 2/Z, 5/S, 6/G or 8/B pairs. The
stored spelling is `2026-10-15 · K7QF`; the handover shows `Recovery key 15 Oct 2026 · K7QF`
or `Clave de recuperación 15 oct 2026 · K7QF`. Switching language keeps the stored spelling
and secret. A replacement redraws a code matching the current key's name inside the same
transaction that replaces the verifier. The short name does not promise uniqueness across
all historical papers and never authenticates an operation.

### W41s-4 adoption boundary checkpoint, 2026-10-14

An adoption file cannot carry the live authentication that an allocated standby needs. When an
independently prepared module owns series at activation, the public adopter refuses before its
first local write, and the setup route returns `409 module.operation_invalid`. The pending worker
logs that refusal and keeps the complete adoption file. A booted pending mirror returns only its
pending status, with no ambient viewer session, sealed node key or selling identity created by
that step. A disabled allocation module does not prevent adoption.

**Review clarification, 2026-10-14:** the defaults now select allocated hooks, so a fiscal
standby's public adoption deliberately refuses rather than completing. No shipped caller supplies
fresh establishment authority and the primary's venue copy together. This is the missing-allocation
refusal allowed by spec §9.4, not a completed join journey. The open backlog entry carries the
remaining copy and authentication work. A primary reservation remains consumed/reserved even if
its empty spare cannot finish adoption.

- **`packages/fiscal-verifactu` restates rules the validator owns** — Exporting the patterns from the library instead was DEFERRED on purpose (owner, 2026-09-12).
  Revisit when something else needs those patterns.
  [Detail](fiscal.md#packagesfiscal-verifactu-restates-rules-the-validator-owns)

## W41s-6 pack-download checkpoint (2026-10-14)

Follow the [offline restore procedure](../developers/offline-fiscal-restore.md) for the outside
mounts and operator steps. Task 11 still owns the complete operational exercise; these checks
did not test physical power loss, a physical printer or remote incident storage.

## Still open after W41s-3 (#1289): one reply can open up to 1,000 filing cases

A refusal
that applies to every later record (one about the taxpayer's identity, say) opens one case per
record in that reply before the repeated-code brake takes effect (`MAX_REGISTROS_POR_ENVIO`).
The successor probes are finished: W41s-1c's [receipt](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md#successor-receipt-2026-10-12-w41s-1c-both-probes-re-run-with-fresh-chains)
records warning-free `Correcto` successors after a 3000 refusal and after an unsent
cancellation, and a 3000 answer to an exact re-send. The holds after a 3000 conflict and behind a
cancellation of a refused invoice were dropped on 2026-10-12 (owner); the brake and the wait
behind an unknown answer are unchanged.
[W41s detail](#w41s-fiscal-prevention-and-offline-recovery--design-and-revised-plan-approved-2026-10-04)

## Re-examine the hold behind an unknown outcome once the asesor answers

**Re-examine the hold behind an unknown outcome once the asesor answers** — OPEN (waiting on the
asesor; owner 2026-10-06). The owner kept the hold for now (it landed with W41s-3c, #1304) and
asked to revisit it when the asesor answers Q37 and its siblings
([questions](../compliance/asesor-questions.md)): drop the hold, keep it, or add the overtaking case
to the W41s-1b probe first. The W41s-1b probes have since run without an overtaking case; their
results are in [W41s-1c's receipt](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md#successor-receipt-2026-10-12-w41s-1c-both-probes-re-run-with-fresh-chains).
The decision is put to the asesor as [Q47](../compliance/asesor-questions.md#q47-keeping-a-chains-later-records-unsent-added-2026-10-12)
(S19 in the short list), covering this hold and the three-refusal brake. The holds after a 3000
conflict and behind a cancellation of a refused invoice were dropped on 2026-10-12 (owner).
[W41s detail](#w41s-fiscal-prevention-and-offline-recovery--design-and-revised-plan-approved-2026-10-04)

## Asesor questions to send

The [curated list](../compliance/2026-11-06-adviser-questions.md) replaces the Spanish batch of 5 November and is for the owner to review. The old batch: It separates fiscal/accounting, labour, privacy and consumer-law questions, retaining their stable references. It has not been sent by this campaign; adviser answers remain open.

The owner records the earlier shortened list as sent around 15 October in [the question register](../compliance/asesor-questions.md). Q27–Q29 and Q32 belong to that earlier batch; follow up their answers rather than duplicating the enquiry. The new batch covers Q13(d), Q48–Q61 and the labour list, excluding points already answered by primary sources. Q19 also remains open in the earlier question register.

## A940. Waitron's declaración responsable — design approved 2026-10-22; slice 1 landed 2026-10-23 (#2000).

The producer's statement that a version meets the Veri\*Factu rules, one per release,
readable on every terminal and before installation (compliance plan Step 8). The
[design](../superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md) drafts the text
from AEAT's worked example, makes `pnpm release prepare` land each version's copy in a pull
request and `pnpm release tag` tag it, adds About Waitron to the dashboard, the till's More menu,
an ⓘ corner and the setup wizard, serves it at `/legal/declaration` before setup, on the
plain-HTTP page and on the recovery page, attaches it to each GitHub Release, and gives the
`@waitron/verifactu` library its own declaration. The owner answered all four questions on
2026-10-21: he is the producer (his name, NIF and publishable postal address were supplied by
2026-11-04 and are public); e) = «S» for this version and f) = «N»; item d) is the draft sent to the asesor as
Q53, pending their answer; production boxes run releases only. The owner approved the second revision on 2026-10-22 (about 02:45) and chose
A993's offline behaviour (about 02:55); the third revision folds those answers in. Slice 1,
built from its [plan](../superpowers/plans/2026-10-22-a940-1-software-identity.md), landed on
2026-10-23 (pull request #2000): every record kind's software block, built in
`buildSistemaInformatico` (`packages/fiscal-verifactu/src/backend.ts`), names "Waitron", the
build's version (`0.0.0-dev`, plus the build's commit on a published build) instead of `0.0.0`,
and `TipoUsoPosibleMultiOT = N`. The producer is a marked placeholder until the owner supplies
his name and NIF: meanwhile records still carry the taxpayer's name and NIF there, and a
published build set to production refuses to trade (`sif.producer_unset`). Two test checks
changed with it: the Spanish practice sales were re-recorded (only their software block moved),
and the pinned digest of the shipped XML in `apps/server/src/full-comp.fiscal-identity.test.ts`
changed (the owner accepted it on 2026-10-23). Still open: [Task 8](../superpowers/plans/2026-10-22-a940-1-software-identity.md),
rewritten on 2026-11-06 for the owner's answers of 4 and 6 November and not built. The name, tax
number and postal address are public; they are three settings named for the software's producer
(`WAITRON_PRODUCER_NAME`, `WAITRON_PRODUCER_TAX_ID`, `WAITRON_PRODUCER_ADDRESS`), carried by each
official image from repository secrets of the same names and never committed, so a fork builds with
its own. A production start with none refuses whether or not the build is stamped, and a production
start whose open chain was made under another tax number refuses (`sif.producer_changed`) until A993
can open the new installation, so a change of producer is blocked in production until A993 lands
and the tax number is not changed before then. The owner or the watcher sets the three secrets
before Task 8 lands.
Then slices 1b to 6, and A993's plan. Still needed from outside: the asesor's answer to Q53. The
owner's address is settled: supplied on 2026-11-04, it travels with the other two.

## A993. A change of the system's identity opens a new installation by itself — designed in A940 §5.6, approved 2026-10-22; fiscal, the owner lands it.

AEAT identifies an invoicing system by the taxpayer's NIF,
the two-character code and the installation number, and the code counts only together with its
producer's NIF, so a new producer (the owner → a future Waitron company), a new code, or a move
to another fiscal policy (the owner: one installation, one policy) makes a different system.
Each chain stores the producer and compliance mode it was opened under (today `registro_sif`
stores neither, `packages/fiscal-verifactu/src/schema/sif.ts:20-22`); the upgrade's step and
every start compare them with the running release's and, on a difference, open a new installation, series and chain in
one transaction, on the filing node only, through a new `identity-change` activation that only
the upgrade's step, or a start that finds the change not made, can authorise (A947's slice 4a
amends CLAUDE.md §5's "does not mint an installation number" sentence; A993 adds the one
allocation no person asks for); a guard, proven by deletion, refuses to add a record to a chain
opened under another identity. Corrections of invoices issued before the change join the new
chain; the design asks for asesor Q53(d)(2) to be widened to cover that. The name is A947's
five-symbol UTC minute (A947 §6.5), so A947's slice 4a lands first; no new recovery sheet is
asked for. Because A947 needs a second clock for every name and a start has nobody present, the
design has the upgrade check the clock while the old release still serves, and make
the change only once that check passes — otherwise the old release never stops. A sale can still
wait on the internet after a crash between the migration and the change, or when the new release
is started by hand; and a power cut during the upgrade's stop leaves no app running until the
upgrade runs again, until the restart-at-boot step the design adds is built. Chosen by the owner
on 2026-10-22 (A940's second-revision question 2, about 02:55), with one addition: in that stuck
case the page the box shows instead of trading also accepts a phone's or a till's clock under
A947's clock rule, and explains every wait with a countdown (design §5.6, "The stuck page";
picture 6). A947's slice 4a landed as #1990 and A940's slice 1 as #2000; its plan comes
after slice 1's, and it lands before the first production venue goes live. A move between fiscal modules stays a refused start
until the first non-Veri\*Factu mode. Since 2026-11-06 the producer is a setting each image
carries (A940 Task 8), so a start that opened a new installation on any producer difference would
let a hand override do it with nobody present; Task 8 refuses instead, and A993's plan has to
decide whether a start may ever make a producer change itself (recommended: only when the upgrade's
own marker names that producer; an owner question).
[Design](../superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md#56-when-the-systems-identity-changes-a-new-installation-by-itself-a993)

## Can a simplified invoice carry an operation date different from its issue date?

Left open by A663 Part 2. If it can,
art. 7.1.c requires that date on the receipt. The document builder already prints one on a
simplified receipt, in captioned rows, whenever the receipt's data
carries one (`apps/server/src/receipt-document.ts`, A754), but no sale has one: the only writer of
a sale's operation date writes none without a customer tax identity
(`packages/core/src/record-sale.ts:284-286`). Check, then record the date on such a sale if needed.

## Retire the historical allocation formats from `fiscal-verifactu`

Signed paper, Cloud receipts and emergency names are still read by historical code: the activation
check (`packages/fiscal-verifactu/src/allocation-envelope.ts`, its Cloud branch importing
`cloud-evidence.ts`) and the historical setup
contribution (`initial-setup.ts`, spread into production by `hour-configuration.ts`). The settings
`WAITRON_FISCAL_CLOUD_TRUST_FILE`, `WAITRON_FISCAL_CLOUD_FINGERPRINT` and
`WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY` are read by `allocation-configuration.ts`,
`initial-setup.ts` (the trust file and receipt folder) and `initial-cloud-setup.ts` (the trust
file and the fingerprint); their only guide, the Cloud allocation guide, was deleted. Removing the
formats changes activation and the remaining assertions of several tests (among them
`hour-configuration.test.ts`, `backup-verification-history.test.ts`,
`paper-register-history.test.ts`, and the server's `retired-first-setup-routes.test.ts` and
`hour-restore-retired-inputs.test.ts`), so it is its own fiscal change for the owner to land. Left
by A1189 (2026-10-29), which removed the server's unused registry client and report journal.

## Rename the `hour-*` names to minute names

Left by A947 slice 4a, which made every
installation code a UTC minute but kept the `packages/fiscal-verifactu/src/hour-*.ts` file names,
their identifiers, the `source: "hour"` label the allocations carry, and test titles that still
say "hour" for what is now a minute (for example "same-hour code", "burns the entire hour"). Before go-live it needs
no compatibility code: until then any installation may be reset (CLAUDE.md §3).
