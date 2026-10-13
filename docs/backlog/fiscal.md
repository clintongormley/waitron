# Fiscal records, invoices and the asesor — detail

> **2026-10-10, receipt presentation:** A366 slice 7 supersedes the F1 location-address
> exclusions below. Thermal and till receipts follow the global current-address switch,
> independently of filed domicile; A4 omits the optional current-address block. Filed domicile
> remains. Follow [the slice 7 plan](../superpowers/plans/2026-10-08-a366-slice-7-receipts-per-department.md).

The open entries are listed in [the backlog](../backlog.md), under "Fiscal records, invoices and the asesor". This file holds
their full text.

## No sale over €3,010 can be made at all

- **No sale over €3,010 can be made at all**: Waitron issues only simplified invoices and no screen
  accepts a customer's tax ID, so a full invoice is not offered. Spain's legal ceiling for a
  simplified invoice in hospitality is €3,000 (RD 1619/2012 art. 4.2, quoted in
  [verifactu-findings.md](../compliance/verifactu-findings.md) and the
  [full-invoices design](../superpowers/specs/2026-10-03-full-invoices-at-till-design.md)); the
  branch refuses over €3,010, the limit `@waitron/verifactu`'s validator applies (3,000 plus its
  10.00 tolerance), as the owner asked.

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

## Test titles still carry claims the comments no longer make (#598)

- Found by #598 (`packages/core`), not fixable in a comments-only change. Test titles still
  carry claims the comments no longer make: `incidents.test.ts:463` says orphan raises de-dup
  "via NULLS NOT DISTINCT" (PostgreSQL wording); `record-void.test.ts:340` and
  `record-correction.test.ts:443` say an ordering "never leaks an authz error", which #598's
  review did not bear out (Codex ran both orders: with the lookup first, an unauthorised caller
  tells a missing sale from an existing one by the error); and `record-sale.test.ts:888`, `:964`
  and `:1029` carry history ("legacy path unchanged", "additive, no behaviour change"). No test
  reaches `settleSale`'s catch that turns a `sale_settlements` unique-key refusal into
  `sale.already_settled` (`packages/core/src/settle-sale.ts`); #598 measured the earlier check
  stopping both concurrent-settlement tests first. `sale.number_reused` is registered in
  `packages/core/src/errors.ts` and `git grep number_reused -- apps packages` finds no thrower
  (see _Decide whether to implement `sale.number_reused`_). Outside core,
  `docs/developers/conventions-data.md` says the stored breakdown holds "the literals a fiscal
  record hashes" (#598 found the hash covers the totals, not the breakdown).

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
  - **`drain.ts`'s Route B lookup (`client.consultar`) — PARTLY DONE (W21, #1130).**
    - **Open:** a failed lookup, when the save reaches its line, still backs the whole batch off,
      discarding every line's outcome and the reply's receipt code (the CSV, one per
      submission), which AEAT does not send again.
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

## A1a. A foreign business customer needs an identifier-type decision

`recordSale` now names a Spanish recipient on a full invoice. A non-Spanish one is refused by name
(`fiscal.foreign_recipient_unsupported`), deliberately: AEAT's `IDOtro` needs an `IDType` — NIF-IVA,
passport, residence certificate and so on, enumerated in
`@waitron/verifactu`'s AEAT XSD (`SuministroInformacion.xsd`) — and choosing wrongly files a record
into an append-only table that can never be unfiled. Whoever wires up business-customer sales makes
that call. A231 adds the saved Spanish-recipient choice around issuance, with public F1 disabled. Foreign
recipient support remains outside that build; `recordSubstitution` still has no HTTP route.

## `packages/fiscal-verifactu` restates rules the validator owns

- **`packages/fiscal-verifactu` restates rules the validator owns** — `venue-fields.ts` its venue-field
  patterns and caps, `backend.ts` its simplified-invoice limit — kept honest by drift guards
  (`record-limits.test.ts` compares the limit and the recipient name cap with the validator's verdict).
  Exporting the patterns from the library instead was DEFERRED on purpose (owner, 2026-09-12) — it
  widens an audited fiscal library's public surface and the drift guard already closes the risk.
  Revisit when something else needs those patterns.

## A1e. Simplified and full invoices use separate series — BUILT, PUBLIC F1 DISABLED (2026-10-06)

A231 [#1256](https://github.com/clintongormley/waitron/pull/1256) adds the `full` purpose beside
`standard` and `rectificative`, provisions its series, and makes core require it for F1 and F3.
Public F1 issuance remains disabled; no route calls `recordSubstitution`. The separate-series
basis is recorded in [verifactu-findings.md §10.1](../compliance/verifactu-findings.md).
**Next action:** complete A231's enablement gates below. Asesor Q5(d) remains open for F3 and R5.

## A231. Full invoices at the till — GATED IMPLEMENTATION LANDED (2026-10-06)

The owner authorised the gated implementation, which landed as
[#1256](https://github.com/clintongormley/waitron/pull/1256), squash `2d972685530676fbe7c182760f0d96f461214e47`.
Existing preproduction venues require a reset for the schema change. Public F1 issuance remains
disabled. The [design](../superpowers/specs/2026-10-03-full-invoices-at-till-design.md) and
[implementation plan](../superpowers/plans/2026-10-03-full-invoices-at-till.md) retain the decisions
and dated implementation receipts.

The build covers a Spanish recipient's saved tax ID, name and address, a separate full-invoice
series, taxpayer domicile, filed receipt data and replay, original/duplicate printing, delivery
status and retry, staff handover confirmation, invoice lookup, and reporting. Paper and till
omit the location address when an F1 shows its filed taxpayer domicile; phone/email and the
F2/absent-domicile controls remain. Automatic F1 credit/refund/cancellation is refused.
The operation day is the owner's provisional service-start rule, awaiting asesor confirmation.

The owner approved the historical-export fixture's current artifact
refusal, including its could-not-open operator advice; provenance, HTTP400/domain-error,
unchanged-database and empty-staging checks remain. This is preproduction format rejection,
with no backward-compatibility implementation.

**Next action:** verify physical 58/80 mm paper and QR output, settle what paying at the counter
does with an email or A4 choice (A555), obtain the asesor's manual-remedy approval and settle
applicable B2B delivery before enabling public F1. The enablement change needs its own direct, invoice-first, unpaid-departure,
offline and zero-total public-path acceptance checks. F3 conversion, F1's R1–R4 correction path
and foreign-recipient `IDOtro`/`IDType` remain separate decisions. Follow the campaign's current
queue order; this landing does not start another fiscal item.

## When the business e-invoicing regime starts

Found by A231d's research. [Orden HAC/1028/2026](https://www.boe.es/buscar/doc.php?id=BOE-A-2026-20587) (BOE núm. 247, 5 October 2026) «entrará en vigor el día siguiente al de su publicación en el «Boletín Oficial del Estado», dándose inicio al cómputo de los plazos» of [RD 238/2026](https://www.boe.es/buscar/act.php?id=BOE-A-2026-7295)'s fourth final provision: «Doce meses después» for businesses whose turnover is over €8 million, and «Veinticuatro meses después, para el resto de los empresarios y profesionales». So from about October 2027, or October 2028 for smaller businesses, an invoice to a Spanish business must be a structured message, and a PDF alone is not enough (the design's register, RD 238/2026 art. 7.1). The exact end day of each period, and whether a restaurant's F1s to businesses fall inside the regime, are asked as [Q45](../compliance/asesor-questions.md#q45-when-does-structured-business-invoicing-reach-a-restaurants-full-invoices-added-2026-10-07). Researched 2026-10-07 in the watcher session; the fetched texts were not kept in the repository.

## A275. Invoice a bill paid later by transfer (full or simplified invoice) — WAITS ON ASESOR Q42 (2026-10-06)

The owner, 2026-10-06: a large bill (their example, €5,000) is rarely paid on the spot; the customer
gets the invoice and pays later, for instance by bank transfer — or, as the owner has seen in Italy,
gets a proforma and the invoice only once the money arrives. [Q42](../compliance/asesor-questions.md#q42-a-bill-paid-later-by-bank-transfer--invoice-now-or-a-proforma-and-the-invoice-on-payment-added-2026-10-06)
asks the asesor whether both are lawful and which is recommended, for full invoices (F1, A231) and
simplified invoices (F2) alike, with non-payment and deposits. **No design or build until the asesor
answers and the owner decides.**

Already built, to reuse: filing an order's invoice with no payment (`issueUnpaidInvoice`,
`apps/server/src/working-order.ts`); the amount due on each issued invoice (`apps/server/src/sale-due.ts`);
collecting a placed order's issued invoice later (`collectOrder`, `apps/server/src/till-sale.ts`);
unpaid departure, which issues an F2 for the full amount and records what it owes (Q28); the Orders
screen's Unpaid filter and Still owed column (`apps/server/src/orders-list.ts`); and a `transfer`
tender method in the schema (`packages/db/src/schema/sales.ts`). Missing: a till action that issues an
invoice for the customer to pay later (today only invoice-first placing and an unpaid departure
issue one before payment); recording a payment by transfer with its reference (collecting
accepts only cash or card, `sale.unsupported_tender`); collecting part of what an issued invoice
owes (`settleSale`, `packages/core/src/settle-sale.ts`, refuses a settlement that does not match what is due, or a second one);
whether the Orders screen is enough as the list of unpaid invoices; how the daily close shows an
invoice still owed; and what happens when the customer never pays. An F1 also needs A231's build.

## W41s. Fiscal prevention and offline recovery — DESIGN AND REVISED PLAN APPROVED (2026-10-04)

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
Statements below that a conflict holds its chain, that a cancellation of a rejected original is
held or holds its chain, or that the brake reads the three records immediately before a record,
describe the earlier behaviour.

**2026-10-13, old-backup authentication:** the owner chose the verifier in the selected
backup for cold restore; live takeover keeps the live verifier. The key name is now stored
beside each newly minted verifier, shown with the handover secret, and read from the placed
backup before the restore authentication callback. The runbooks warn you to keep older paper
keys until no backup from before their replacement remains. A real archive taken before
replacement retained its name and accepted its old key; the live database refused that key
and accepted its replacement. Physical recovery-pack output and the backup selection screen's
key-name display remain Task 6 work. No outside current-key record is planned.

**2026-10-12, standby decision:** the owner selected dormant reservation at join and activation at
takeover. The Task 4 branch signs a dedicated paper-reservation receipt for the named spare and
checks its signatures, outside reserved state and stored venue scope without writing a SIF,
chain, series, audit result or counter. The signing command requires current-register and outside
reservation confirmations. That receipt cannot replace a takeover consumption receipt.
An internal operation now retains the signed proof and complete bases in `fiscal_reservations`.
Its database-backed tests compare all active fiscal rows, retry the same join, refuse retained
event/allocation/identity reuse and check rollback and update/delete refusals. A caller-mutation
case failed before the operation took a detached proof snapshot. The root append-only list and
fiscal schema-ownership list gained exactly the two entries approved by the owner at 20:55.
The internal takeover operation now rechecks the retained join signatures and binds a different
consumption event to the same source, target, block and complete allocation. Its tests retain the
primary and reservation rows, compare replay rows and roll back a refused final audit write.
Ordinary recovery refuses using a name retained for a spare. Historical signature verification
is separate from current outside consumption; it does not authenticate the caller or prove the
current register state. Bundle, adoption and promotion integration remain open. Takeover must
still authenticate the administrator, isolate the old box, rule out parallel recovery and check
outside consumption before atomic activation. All three invoice purposes stay separate.

**2026-10-12, internal host authority:** a new server helper checks the actual administrator
password, authenticator and permission before issuing authority for one module/action/event/source/
target. Its authentication transaction ends before the operation callback. New internal fiscal
wrappers require that authority and recheck it after awaited reads, before writes or replay.
The synthetic integration case combines real authentication, dormant activation and the existing
role/membership transaction; a refused membership write rolls those rows back together. The
wrappers are not in the fiscal public barrel and no boot or HTTP entry point uses them yet.
They authenticate an operator, not an outside register. Outside continuity, text SIF/counter
retirement and all host replacements remain open.

**2026-10-12, internal setup/restore carrier:** the setup runner can pass module-owned input with
authority attributed to the account it created in that transaction. It refuses using a retained
administrator for this bootstrap grant and rechecks the new account's role/status before each
seed. Host-chosen account/node IDs let outside consumption evidence name them before setup writes.
The generic restore hook can receive opaque input and scoped authority from fresh account
authentication; it checks module, action, target and authority lifetime before entering that hook.
New database tests cover unchanged absent-input calls, retries, rollback and caller mutation.
A synthetic setup integration writes a signed initial allocation with standard, full and
rectificative series; substituting the operator or removing current outside confirmation refuses
the transaction. This does not connect the production fiscal seats or change SIF/counter typing.

The owner selected key-only authority at 22:55 on 2026-10-12, superseding the A/B choices in the
[decision inventory](../superpowers/plans/2026-10-12-w41s4-break-glass-operator-decision.md).
The signed consumption and permanent approval name the recovery-key event, never a person.

**2026-10-12, restore placement and CLI carrier:** the initial CLI accepts host-selected node/account
IDs and module input through its dependency object. It keeps the selected database and module list.
Archive, bucket and staged runners can pass a host authentication callback to the placed database;
its transaction contains the module hooks and series checks. New tests exercise actual encrypted
file validation and stream placement with separate backup and node keys. Wrong-key refusal leaves
no published identity; a later hook refusal backs out authentication and earlier hook writes.
Host-issued input is snapshotted before hooks run. Neither the staged marker nor the backup carries
in-process authority. These injectable paths do not yet collect production allocation input or
connect the fiscal seats. Current outside confirmation, text SIF/counter retirement, all host
replacements, final schema regeneration and full branch qualification remain open.

**2026-10-12, Task 5:** invoice issuance reads the live series inside its transaction.
Startup, development seeds, mirror bundles and saved trading identity carry node and location
without a cached invoice-series id. Restore still checks live standard and full series before
publishing identity. The switch, replay, rollback and reconnect cases are in
`apps/server/src/transactional-series.test.ts`; the integrated-card switch cases are in
`apps/server/src/till-sale-integrated.db.test.ts`.
Task 4's allocation activation remains open, followed by the dependent recovery tasks.
The owner selected a separate external paper-custodian key on 2026-10-12, with independent
fingerprint comparison against the current outside register on replacement hardware. Signed
paper evidence and the [custodian tool](../developers/paper-custodian.md) are on the Task 4 branch;
persistent activation and recovery-pack enrolment remain open. The Task 4 branch also validates
paper/emergency allocation and approval envelopes against separately supplied host context.
Its transaction-bound preflight reads the stored taxpayer, environment, node and existing software
scope, checks recovery bases against the live series, and refuses retained identities and codes
across nodes, including retired rows (`packages/fiscal-verifactu/src/allocation.test.ts`). Initial setup without series uses the trusted host's intended bases. An inactive `activateAllocation`
operation now retires the live SIF and series, creates the supplied identity and complete series
set, resets the chain head without resetting its sequence and appends the result to the new
immutable `fiscal_allocations` ledger in the caller's transaction. Paper replay checks outside
commitment and evidence again, binds both envelopes to the stored event, and checks the live SIF
and complete series set before returning the saved references. Six forced-write failures roll
back the local rows; a synthetic retained-record comparison checks unchanged stored bytes.
The operation has no package-root export or host caller. SIF typing remains numeric until the
coupled representation and consumer replacement: the inactive writer currently binds the text
identity through SQL, as the transaction-validation fixtures did. Counter retirement, all host
entry points and recovery-pack integration remain open. Emergency replay following restart and
the two-restored-database control now pass on the branch. The owner approved the root append-only
`EXPECTED` entry for the allocation ledger, and that guard passes without a logic change.
Cloud input remains refused until its separate trusted adapter exists. The existing recovery kit carries the old box's pointer
signer; it does not declare a paper custodian (`packages/stream/src/kit.ts`, `RecoveryKit`).
A disposable SIF text-schema candidate has passed populated-record migration and integrity
controls, recorded in [the migration notes](../developers/conventions-data.md). The complete
allocation schema and consumers still need that qualification together.
Keep activation disconnected until its full validation and atomic writes are implemented; emergency input formats alone
provide no reservation or consumption evidence.
When activation is connected to recovery, extend the reconnect qualification through that runtime
path; today's test exercises an offline and then successful fiscal drain without a series switch.
The owner answered its format question with first symbol `0–7` and 128 random bits.


**Update, 2026-10-12: W41s-3d landed as
[#1309](https://github.com/clintongormley/waitron/pull/1309), commit
`5e99c6781df6512f6bac4127937f0146e61e2ecc`.** The first eligible brake-held record retries
hourly. A refused same-code retry retains the first stop time in the alert, as the owner chose.
The owner authorised landing W41s items after green checks and resolved findings; an important
unresolved decision still needs an answer. W41s-4 is next; manual release remains Task 8.
The 2026-10-11 status below describes the candidate before landing.

**Update, 2026-10-11: queued again in Lane E, after A435-6.** The owner resumed W41s-3d
first, then W41s-4, -5, -6, -1b, -7, -8, -9, -10a, -10b, -11 and -C in campaign order.
Each fiscal implementation still needs the owner's approval to land. W41s-3d is on draft
PR [#1309](https://github.com/clintongormley/waitron/pull/1309), awaiting the owner's landing
approval. Its candidate preserves W41s-3c's reply identity checks and A494's one-taxpayer-name
batching. The owner approved retaining missing-reply incidents for probes. The resumed tests
add separate ordinary/probe and probe-only name batches and check that a
deferred batch does not stamp an unsent probe. Run the focused checks with
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain.probe.test.ts src/drain.probe.names.test.ts src/drain.probe.gate.test.ts src/drain.probe.seat.test.ts`.

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
landed with public F1 disabled. **Next action:** continue the approved dependent W41s tasks in campaign order,
keeping each task's fiscal and adviser gates.
**Update, 2026-10-06 (W41s-3, landed):** Task 3 landed as
[#1289](https://github.com/clintongormley/waitron/pull/1289), with the owner's approval of its
nine changed filing checks and of the landing. Every line of AEAT's reply is kept (but see W41s-3c
below). A
rejection on its own no longer holds the later records of its chain (D2, on
[§7.1's receipts](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md#71-protocol-receipt-2026-10-05-w41s-1));
only rejection code 1161 was tested, and it was triggered artificially. A conflict with AEAT's
copy, or a held cancellation, holds the later records of its chain that have not been sent. A
record sent in the conflict's own envío is not held when the reply is applied; a record of the
conflict's envío that comes after it on the chain and whose outcome is still unknown is held at its
next claim like any later record of that chain, and is not sent again.
A cancellation whose original was rejected or is held is itself held and never sent. When the
lookup that follows a duplicate answer fails, only that record's outcome becomes unknown. Each
record that needs a person's decision gets a filing case, kept in tables whose rows cannot be
changed or deleted; resolving a case releases nothing yet (Tasks 8–9 do that). A new ongoing
alert, `fiscal.filing_cases_open`, counts the cases with no resolution. **Still open:** no probe
has yet shown what AEAT does with a record sent after a 3000 conflict or after a held
cancellation; the owner chose (2026-10-06) to keep holding there, and the live probe of those two
cases is queued as W41s-1b. A refusal that would refuse every later record (one about the
taxpayer's identity, say) opens one case per record until the brake below stops the chain; one
reply can still open up to 1,000 cases first (`MAX_REGISTROS_POR_ENVIO`).
**W41s-3b (landed, #1303, 2026-10-06):** when the three records immediately
before a record on its chain were all rejected with one error code (`SAME_CODE_REFUSAL_LIMIT` in
`packages/fiscal-verifactu/src/drain.ts`), the drain holds that record and the chain's later ones
when they are claimed, between envíos, and only records never sent before. A record still awaiting
AEAT's answer breaks a run: when the record right after a run was sent and its answer is unreadable
or missing, the records added after it are sent with its retry, and a later record is held only
once the refusals immediately before it make a run of three. The ongoing alert
`fiscal.refusals_repeated` names the code and the length of the run. Nothing releases the hold yet.
**Update, 2026-10-12 (W41s-1b preparation):** [Verifactu PR #140](https://github.com/waitron-io/verifactu/pull/140)
prepares conflict-successor and held-cancellation-successor probes. Its current-head CI and
Documentation runs passed at `65b38d707d74ea31dd3dd608c6142529533bb84d`; no live AEAT request
has run. The library PR awaits owner review before merge because the live workflow runs only
on `main`. [The handoff](../compliance/aeat-successor-probe-handoff.md) lists the two commands
and the evidence to retain. The held cancellation stays unsent in its probe, matching the
current drain; the successor links to that cancellation's hash. Existing holds remain in place
until actual service evidence and the dependent task's gates support a change.

**Update, 2026-10-12 (W41s-1b live result):** the earlier preparation and unprobed-successor
notes above are superseded by [the dated receipt](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md#successor-receipt-2026-10-12-w41s-1b-partial-conflict-run).
AEAT accepted the later successor after 3000 and the successor linked to an unsent cancellation
as `AceptadoConErrores`/2004. The stale-generation control stopped the conflict run before its
batch and exact-replay cases. Those cases and warning-free successor observations remain open;
the library clock fix needs owner review before another live run. Existing holds are unchanged.

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
same-code refusals, including after refused hourly retries (owner, 2026-10-12). The real-database
case “keeps the alert at the third refusal's time” in `drain.probe.test.ts` checks two retries.
Manual release remains Task 8.
The statements below about no release or hourly retry describe the landed W41s-3b version.

**Follow-up (W41s Task 8, held-record resolution): release a brake hold (send the held records
again).** Task 8 as planned resolves records that have a case of their own; a record the brake holds
has none. While held, those records are not retried hourly. The owner chose (2026-10-06) to add
an automatic hourly probe that sends the first held record once an hour, an accept restarting the
chain and a same-code refusal adding one case: queued as W41s-3d. The owner also chose to keep the
records added after a run's unanswered successor sent with its retry, as built. It was built so because when the retried record's answer is anything but a refusal with
the run's code, the run is broken and nothing would explain such a hold: the
`fiscal.refusals_repeated` alert would not show, and when that answer is not a refusal at all
`heldRecords` would name no case for the held records.
**Follow-up W41s-3c — DONE ([#1304](https://github.com/clintongormley/waitron/pull/1304), landed
2026-10-07 on the owner's approval):** `resolveLines` in `packages/fiscal-verifactu/src/drain.ts` used to match a
reply line to a claimed record by `RefExterna` alone; a review probe gave invoice B's accepted line
invoice A's reference and the drain marked A `aceptado` though AEAT had rejected it. Now, as the
owner chose (2026-10-06), line N of AEAT's reply is paired with record N of the envío, and is
applied only when it carries that record's reference, names the invoice (issuer NIF, number, date)
the record was sent as, and names no operation (`Operacion.TipoOperacion`) other than the one sent;
a line with no operation is not refused for that. No other line is consulted for that record, so a
copy of record A's line at record B's position leaves B unknown and still applies A's own line,
whatever the copy says. Any record whose line fails becomes unknown at once: it waits for its retry,
its chain's records not yet sent wait behind it, and its `fiscal.estado_desconocido` carries the
operation and invoice sent and the line at its position (`lineaRespuesta`). Before, a record with no
line sat `enviando` until the five-minute recovery or a restart. When the reply holds a different
number of lines than records sent, no line is applied, every record of the envío is unknown with the
reply's line count (`lineasEnRespuesta`) on its alert, and the reply's lines are kept once, in a
warning `fiscal.respuesta_descuadrada` on the sale of the envío's first record, with the envío's
record ids and its CSV. The dashboard's sentence does not show those lines; `readOpenAlerts`
(`apps/server/src/alerts.ts`), behind `GET /management-api/alerts`, returns them in the alert's
params. **Still open:** in AEAT's preproduction environment two runs of shuffled envíos of up to
1,000 records each got their replies back in the order sent (verifactu #138's probe, recorded in
[Q43](../compliance/asesor-questions.md)); production is not measured, and the question stays with the
asesor. A line AEAT moves away from
its record's position is never applied, so that record stays unknown and is retried unless an
earlier record on its chain is on hold, while records whose line is still at their position are
applied as usual. A record whose line AEAT moved in every reply it was sent in would never be
confirmed: Route B's lookup never runs for it, each retry sends it again in the same chain order
while the later records of its chain wait behind it — loud (an alert per record) and never a wrong
acceptance. One option for the owner, not built: after a mismatch, send
each unknown record again in an envío of its own. An incident is not stored while one with the same
code for the same sale is open, so while a `fiscal.respuesta_descuadrada` is open for a sale, a later
mismatched reply to an envío whose first record belongs to the same sale (that record again, or the
sale's cancellation) keeps none of its lines. And no run
against real AEAT has shown that a cancellation's reply line names the cancelled invoice (the schema
types the line's `IDFactura` with the plain field names, and the library's fake echoes the cancelled
invoice there). If AEAT named a different invoice on that line, the cancellation would come back
unknown and be retried with an alert; a line without the plain field names is refused by the
library's parser, which backs off the whole envío; that back-off raises no incident and keeps no
CSV, and every resend would meet the same refusal, so those records would wait until the four-hour
delayed-submission alert (`fiscal.submission_delayed`,
`packages/fiscal-verifactu/src/submission-alerts.ts`).
**Re-examine the hold behind an unknown outcome once the asesor answers — OPEN (waiting on the
asesor; owner 2026-10-06).** `claimBatch` in `packages/fiscal-verifactu/src/drain.ts` does not send a
record while an earlier record of its chain is `enviando` or waits for a retry (W41s-2, #1213,
following the design §4 line "A retry delay must not let a later record overtake an earlier unknown
outcome", written 2026-10-04). The AEAT preproduction probes of 2026-10-05 were not checked against
that line: AEAT accepted records linked to a refused predecessor in the same batch, in a later batch,
and all 999 successors of a 1,000-record batch ([evidence](../superpowers/specs/2026-10-05-aeat-protocol-evidence.json),
runs 37283677375, 37283909983 and 37283910284). Records sent in the same batch as an unknown one
are not held; only unsent ones wait. Not probed: a successor reaching AEAT before its predecessor
arrives. The owner kept the hold for now (it landed with W41s-3c, #1304) and asked to revisit it
when the asesor answers Q37 and its siblings ([questions](../compliance/asesor-questions.md)): drop the
hold, keep it, or add the overtaking case to the W41s-1b probe first.
The question is now [Q47](../compliance/asesor-questions.md#q47-keeping-a-chains-later-records-unsent-added-2026-10-12)
(S19 in the short list, added 2026-10-12), which also covers the three-refusal brake.
**For Task 9 (the filing screen):** `listFilingCases` reads every case and event with no filter or
paging, and `heldRecords` reads every `rechazado`/`detenido` row; neither has a production caller
yet, so the screen should add an open-only filter or paging when it calls them.
Public F1 issuance stays disabled pending the physical 58/80 mm paper and QR checks, A555
and the asesor's approval. The F1 taxpayer-domicile receipt must omit the location address.
Task 3 can use the published receipts; D2 retains its remaining plan gates, and D5 still needs
old-chain evidence and its adviser answer. Independent queue items may proceed under the plan.

## C126 (cancelling an order whose invoice was issued credits it; owner, 2026-10-02, option b, decided without the asesor) — landed as #1030

- **C126 (cancelling an order whose invoice was issued credits it; owner, 2026-10-02, option b,
  decided without the asesor) — landed as #1030.** `POST /api/working-orders/:id/cancel` (`cancelPlacedOrder`,
  `apps/server/src/working-order.ts`; the credit in `apps/server/src/cancel-credit.ts`) issues
  an R5 corrective invoice, by differences, for the whole invoice. The PIN override is B33
  (#1041). The owner dropped the dashboard Orders screen's "Invoice not credited" mark
  (2026-10-02 ~12:05): such a bill is to show as Cancelled with its credit note. Open:
  - **For the owner, from B33's review: the cancel checks the permission after its payment
    refusals.** A bill holding a payment, or with a card payment in flight, is refused for that
    before `sale.rectify` or an override is looked at — the order C126 built, which B33 kept. So
    someone without the permission is told about the payment rather than "not permitted", and a
    PIN sent with that request is neither checked nor counted. The drawer, refund and
    unpaid-departure routes check the permission first. Moving it earlier changes who gets which
    refusal; not decided.
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
      order does hold one, the cancel refuses it with `bill.payments_received` and the dialog says
      so.
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
  - **A placed order with no invoice is not checked against stored card payments when it is
    cancelled.** Its cancel
    sees a card running at the reader in this process, but not a stored payment its provider has
    not resolved, nor one captured and not yet filed; the cancel had no payment check at all
    before C126.

## "the fiscal record is built from `total` + `vat_breakdown`" is a false-narrow enumeration, and it reproduces itself.

- **"the fiscal record is built from `total` + `vat_breakdown`" is a false-narrow enumeration, and it
  reproduces itself.** Two compliance-track documents carry the same shape about tips
  (`docs/compliance/asesor-questions.md:465`, `docs/compliance/verifactu-findings.md:678`); their tip
  claim is TRUE and the legal track is kept separate. **Next action:** whoever next works the
  compliance track widens those two sentences.

## One original per invoice, structurally

- **One original per invoice, structurally.** F2 requests to `POST /api/sales/:id/receipt` still
  have no limit or idempotency; two calls produced three unmarked originals, and art. 14.1 says
  exactly one. A231's branch now retains the existing original job for F1 requests, with a
  no-printer-at-issuance path that queues it later; its F2 control still queues three originals.
  **Remaining:** contain repeated F2 requests per sale, with the invoice number on the slip.

## Installing or renewing the AEAT certificate after setup

- **Installing or renewing the AEAT certificate after setup.** Only the setup wizard can set it
  (`apps/server/src/setup-api.ts`), and nothing watches when it expires: `cert-expiry.ts` reads the
  box's own HTTPS certificate, not the AEAT one. Needs a view, renew and replace surface and an
  expiry alert. Separate from getting the certificate onto a promoted standby (_Afterwards_). Fiscal:
  the owner lands it.

## VAT at line add (M7v, A68)

- **VAT at line add (M7v, A68).** Asesor Q26 (the rate on the day of issue) is open. Owner rulings
  at landing (2026-09-27): invoice-first issues at placing, so it takes the placing day's rate; a
  box holding order lines is reset rather than given data-migration code; and every invoice path
  reads its one clock after the order's lines. `apps/server/src/vat-class-at-line-add.test.ts`
  copies its setup from `issuance-pass.test.ts`; a shared helper could absorb it. The till computes
  a basket VAT split (`vatBreakdown`, `apps/till/src/state/working-order.ts`) that no screen shows.

## Nothing in the product can issue a corrective invoice (R5, _factura rectificativa_) for a VAT error on an issued simplified invoice

- **Nothing in the product can issue a corrective invoice (R5, _factura rectificativa_) for a VAT
  error on an issued simplified invoice.** `recordCorrection` exists
  (`packages/core/src/record-correction.ts`; the Verifactu backend corrects only an F2, as an R5),
  but no route calls it: its only callers under `apps/` are three scripts in
  `apps/server/scripts/` (`daily-close-demo.ts`, `modelo-303-demo.ts`, `settle-invoice-first.ts`)
  and tests. _(2026-10-02, C126: the whole-order cancel route now calls it, for a credit of the
  whole invoice only; no route issues a correction for part of one.)_ The owner also needs a way to
  correct an issued invoice when a customer spots an error after payment, regardless of the future
  Tabs · Bill choice (2026-10-04, A261 step 2 decision). **The owner's points for when this is
  designed (2026-09-29):** (1) the amount staff enter is what the customer gets back,
  VAT included — a €2.00 correction at 10% is €1.82 base plus €0.18 VAT; (2) whether a correction
  should instead cancel the original and issue a new invoice (`TipoRectificativa` "S", where
  today's path files by differences, "I", in `packages/fiscal-verifactu/src/backend.ts`) — asked as
  asesor Q31 (2026-09-30), not decided.

## "No tax (0%)" is an open fiscal question, and it must be answered before the first live filing

From **The product editor and catalogue (#345, #379, #387) — what is left open.**
[Operator guide](../products.md); [developer guide](../developers/products.md).

- **"No tax (0%)" is an open fiscal question, and it must be answered before the first live
  filing.** The selector shows the catalogue's zero-rate class under that name; pricing puts the
  whole gross in the base with zero VAT, and Veri\*Factu files it as `S1` — taxable, not exempt — at
  a 0.00 rate. AEAT separately requires a _non-subject_ operation to record its cause (`N1`,
  Articles 7, 14 and others; `N2`, place-of-supply rules), and nothing established that any of this
  venue's products is legally non-subject. Asesor question Q20 asks which intended cases belong in
  `S1` and which need `N1` or `N2`, and whether the label should read "IVA 0%" rather than "Sin
  impuestos". **Non-blocking while pre-production; blocking before going live.** If the answer moves
  a case to `N1`/`N2`, that is an explicit classification threaded through sale facts, reporting and
  every Veri\*Factu sale, correction and substitution path — never a quiet redefinition of `zero`.

## Decisions and deliberate limits

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
  plan Task 0.1, so A231p could be built).** Public F1 stays disabled until A231's own enablement gates are met; the asesor is asked to confirm these as [Q44](../compliance/asesor-questions.md#q44-sending-a-full-invoice-as-a-pdf-by-email-or-on-a4--the-owners-interim-answers-added-2026-10-07):
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
attribution. Tests compare retained audit/role rows around takeover and rollback, with no accounts
or management sessions. This does not connect a public promotion or cold restore. Coupled
representation, all host consumers, outside continuity and final review remain open.


### W41s-4 standby-host qualification, 2026-10-13

The feature branch adds scoped reservation/establishment input and a module takeover seat inside
real mirror promotion. Synthetic signed paper evidence and the actual current node-key verifier
now exercise dormant activation, all three invoice purposes, key-event attribution and rollback
when the membership write refuses. Expiration during a module or settings await refuses the
operation and rolls back its database writes. Incomplete series refuse before settings persistence;
the settings file is not a transactional database write and is not covered by that rollback claim.

Production fiscal-seat wiring and allocation collectors, text SIF/counter retirement and all coupled
consumers, final schema regeneration/populated upgrade and the whole-branch review/CI remain open.
This checkpoint establishes no independent current paper history or remote-writer exclusion.

### W41s-4 initial-series handoff qualification, 2026-10-13

The generic setup runner can delegate series creation to the filing seed and return its active
references without opening base rows first. Synthetic signed allocation tests exercise this path
and compare counters and all series rows on retry. The internal fiscal resolver checks the
committed allocation against requested bases and current venue/SIF/series state.

The production fiscal seed does not declare this contribution yet. Its activation, independent
outside evidence and every host consumer still belong to the coupled Task 4 transition above.
No production continuity or writer-exclusion result is established by this checkpoint.

### W41s-4 host preparation qualification, 2026-10-13

The branch adds a generic module preparation seat and an explicit public paper-source factory.
Setup, restore and promotion can collect before their write transaction. The fiscal seat carries
an attempt-local token whose source, binding and authenticated operator cannot be reconstructed
from a saved marker. Initial setup checks the same newly created active administrator inside its
transaction; known administrators and a competing creation refuse that initial authority. A
committed setup retry returns its retained series without collecting again.

Signed initial-setup and actual node-key restore tests exercise all three purposes, account-free
recovery and rollback. Restore also rechecks each module after its hook and before commit, including
an earlier module whose authority expires during a later hook. These tests establish the generic
hosts and an explicitly supplied descriptor, not the default production composition.

Production configuration, fiscal seed/restore/standby seats, text SIF/counter retirement and all
remaining consumers, current-main regeneration/populated upgrade and the whole-branch gates remain
open. No independent current-register or remote-writer exclusion result is established.

### W41s-4 recovery-key label, 2026-10-13

The owner's 18:00 naming override replaces the random 16-character label with the UTC issue
date and four characters from an alphabet without 0/O, 1/I/L, 2/Z, 5/S, 6/G or 8/B pairs. The
stored spelling is `2026-10-15 · K7QF`; the handover shows `Recovery key 15 Oct 2026 · K7QF`
or `Clave de recuperación 15 oct 2026 · K7QF`. Switching language keeps the stored spelling
and secret. A replacement redraws a code matching the current key's name inside the same
transaction that replaces the verifier. The short name does not promise uniqueness across
all historical papers and never authenticates an operation.

Real database checks cover issue-day rollover, replacement collisions, snapshot key matching,
node isolation and rollback. Browser checks cover both languages, live language changes,
malformed stored labels and eight theme/width views. The lane retains red/green and installed
removal-control receipts under `receipts/w41s4-short-name-*`. Physical paper output and the
backup chooser remain Task 6 work; the coupled production allocation transition remains open.


### W41s-4 allocated standby qualification, 2026-10-13

The allocated standby contribution returns signed reservation state without a SIF or series.
Establishment stores its signed proof and complete bases in the existing reservation ledger.
Both actions use freshly scoped host authority and separately collected current paper statements;
a statement remains an operator assertion rather than independent continuity evidence.
The configured paper preparation factory handles these actions alongside activation.

Real bundle/adoption carriers now collect before their write transaction, reject scaffold series
for a module that opens them at activation, and recheck every module's authority before commit.
A two-database synthetic journey reserves, adopts and takes over with the spare's actual node
key, checking all three purposes and key-event attribution. Absent current consumption and a
refused membership write retain the dormant reservation. Source/authority/argument snapshots,
late expiry, rollback, wrong target and active-spare refusals have focused checks and installed
removal controls. The existing behavioural assertions remain unchanged.

The production collector and initial public setup input are connected in the later checkpoint
below. The default seed/restore/standby contributions remain old. The text
SIF/counter transition, remaining entry points, current-main schema regeneration/populated upgrade,
Cloud handoff binding and both whole-branch reviews plus push-hook/current-head CI remain open.
This branch checkpoint does not complete Task 4 and must not be published.


### W41s-4 production source and initial input, 2026-10-13

The production module list selects paper collection from three independent host settings. Missing
settings refuse collection. The configured files are reread for each attempt, and their operator
statements still do not establish independent current outside history.

Initial setup carries a planned node and administrator plus opaque signed module inputs through
the public route and provisioning CLI. The CLI reads at most 128 KiB and refuses malformed or
unselected-module input before the permanent environment stamp. Setup recovery asks the filing
module for its committed series references and compares their IDs, codes and purposes with stored
rows in one transaction. Planned node/admin mismatches refuse. A persisted-route test interrupts
after the venue commits, removes outside confirmation, and then checks a successful retry with
unchanged series counters and allocation rows.

The host tests explicitly supply the allocated seed; the production descriptor still selects its
old seed, restore and standby hooks. Selecting those hooks, text SIF/counter retirement, remaining
public authentication/input paths, current-main regeneration/populated upgrade, Cloud binding and
both reviews plus hook/current-head CI remain. Do not publish this incomplete Task 4 checkpoint.

### W41s-4 re-registration and cold-restore input, 2026-10-13

The branch accepts a detached generic operation file in `register-till` and both cold-restore
command forms. It obtains the node key separately, checks it before collecting outside evidence,
and runs the prepared seeds or restore hooks inside the authentication transaction. Re-registration
rechecks the node's location before its seeds. Committed re-registration retains series IDs and
counters; a later seed refusal rolls back the local allocation while the outside consumption stays.

Staged archive and stream requests may retain public operation input. The entry process reconstructs
the runner after restart from that marker or its operation file and obtains its key from the
process environment. The marker's input takes precedence over the environment file. Malformed or
non-round-trippable JSON input refuses staging before replacing an earlier request. The marker
stores no node key or authentication authority.

Command: `pnpm --filter @waitron/server exec vitest run src/provision-node-operation.test.ts
src/recovery-operation-input.test.ts src/recovery-restore-input.test.ts
scripts/register-till-allocation.test.ts` (the final focused set also includes their legacy consumer
suites). The new real fiscal command cases run encrypted archive validation and stream placement
with signed paper evidence, create exactly `P000042` and its three series, and compare the retained
old SIF and every old series row. They inject source-tree migrations and the allocated fiscal hooks;
the bucket case supplies an already downloaded database and does not exercise an S3 download.

The public initial setup path was qualified in the previous checkpoint. Default fiscal descriptors,
readiness, standby HTTP/boot consumers, text SIF/counter retirement, current-main schema regeneration,
populated upgrade, Cloud binding and both full reviews/hook/current-head CI remain. Task 4 is
incomplete; do not publish this candidate.


### W41s-4 public standby and readiness input, 2026-10-13

The bundle and promotion routes accept a detached `moduleOperation` containing the generic binding
and public evidence. A bundle request authenticates `mirror.create`, binds the original primary and
requested standby, and rejects operations for modules that the enabled set does not reserve.
Promotion authenticates an account holding `node.promote` or the node recovery key; its scoped
runner collects before the write transaction. The key verifier is checked again at commit.
A committed promotion retry authenticates but skips outside collection and returns the existing
series. Boot passes the enabled modules and runner to mirror promotion.

Readiness accepts `initialOperations` for its own preproduction allocation and stamps only its
separate test database. Recovery uses the same supplied module set and committed allocation-owned
references. In `apps/server/src/fiscal-readiness-allocation.test.ts`, a signed synthetic allocation
produces `A-S000042/1`; a retry with the outside confirmation removed compares all saved SIF,
allocation and invoice rows. Acceptance is simulated in that case. The existing real-drain refusal
case remains in the focused checks; no live AEAT acceptance is claimed.

The generic route cases use a test module; separate signed fiscal HTTP cases exercise the actual
paper source and dormant/activation contributions. A real boot uses a test contribution to check
both credential paths and wiring. Fiscal descriptors are supplied explicitly in the fiscal cases.
Adoption still has its existing missing-copy limitation; no new copy mechanism or boot-time
establishment credential is supplied here. Default fiscal descriptors, text SIF/counter retirement,
current-main regeneration/populated upgrade, Cloud binding and both full reviews/hook/current-head
CI remain. This is an incomplete Task 4 checkpoint, with no intermediate PR.
