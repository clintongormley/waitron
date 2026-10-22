# A802 Partial Paid Invoice Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Implement inline, task by task. Read superpowers:test-driven-development before writing any implementation or test code. Do not dispatch implementation or review subagents for individual tasks.

**Goal:** Correct a selected part of a settled simplified invoice and cover its exact VAT-inclusive reduction with explicitly linked earlier refunds or new refunds, recovering the same correction after interruptions.

**Architecture:** Keep `recordCorrection` as the sole corrective writer. Add frozen allocation facts and durable operation recovery in core, regime-owned admission reads in the fiscal backend, and server coordination over the existing refund reservation/resolver machinery. The till, A758, reporting and corrective paper consume that one operation.

**Tech Stack:** TypeScript, shared exact `Decimal` arithmetic, Drizzle/SQLite migrations, Hono, Lit, Vitest and real Chromium.

**Spec:** [Complete A802 design](../specs/2026-10-20-a802-partial-paid-invoice-correction-design.md).

## Authority and global constraints

- Owner approval on 2026-10-21 at approximately 02:30, recorded in Lane E `questions.md`, settles all three policy questions: save the correction before connected-card refund; require both permissions and explicit earlier-refund/cancellation linkage; admit queued/sending/accepted originals but refuse refused/stopped/held or unusable history. The dated approval note in the design supersedes its original proposed/await-approval wording.
- Gross amounts include VAT; use differences, with A758 correction and refund acceptance in the same step. Do not ask those product questions again. VAT-only corrections without money back remain separate open work in the fiscal backlog.
- RUNNER H2 remains a separate implementation boundary. Publish this document independently of implementation dependencies. This plan grants no H2 exception and does not authorize implementation now.
- No change to `computeHuella`, hashing, chain sequencing, number allocation, `registros_facturacion` schema or existing rows, `registerSif`, `restoreFiscal`, ordinary-sale policy, whole-invoice cancellation, F1/F3 support or void restrictions. No parallel fiscal writer or coordination-only product module.
- Amounts remain `Decimal` above rows; money columns store cents, quantities thousandths and rates basis points. No floating-point proportional allocation. Provider I/O and PIN derivation stay outside write transactions; await statements on a transaction serially.
- Preserve existing behavioral assertions, especially all fiscal assertions. Add new fiscal suites. Any necessary existing fiscal assertion or `scripts/` guard change needs exact owner approval before editing, unless a recorded standing exception covers that exact enumeration change. Do not infer permission from the design or a failing guard.
- Every behavioral task observes RED for the named behavior, implements minimally, then observes GREEN. Missing imports, broken fixtures and TypeScript errors do not qualify as behavioral RED. Use `useVenueDb` for database suites.
- Critical deletion controls run only in an independently installed disposable checkout containing the complete candidate, including uncommitted/new files. Never swap, delete, restore or mutate feature-tree files for a control. Keep original assertions and record failing assertion, restored result and candidate SHA/tree.
- Each task below targets roughly 20–60 tool calls and must remain well below 100. Split a task at its stated interface if its execution grows; do not defer its acceptance cases. Commit coherent results with `git commit -s`, never skip hooks.
- Read `CLAUDE.md`, RUNNER, `writing-claims.md`, `conventions-data.md`, `testing-guide.md`, `conventions-ui.md`, `design-system.md` Forms/draft protection, `products.md` frozen names, `workflow-guide.md` and `ci-and-gates.md` before the relevant implementation.

## Review focus

Each risk has named assertions in its owning task; these are mandatory, not future suggestions.

1. A final cent after earlier amount reductions must consume the original rate's remaining base and VAT exactly, including €0.03 at 21% (Tasks 2–3).
2. A displayed group, priced extra or weighed portion must retain its real invoice identity and entitlement when the catalogue or display order changes (Tasks 2, 5 and 11).
3. A pending split leg or failed outcome save must not permit ordinary Refund, manager recovery or another till to return the same money (Tasks 6–9).
4. An external terminal return followed by a failed fiscal save must retain both its money record and evidence, without another instruction to return money (Task 9).
5. A saved operation whose response or refresh is lost must recover its number, refund legs and document intent after reload or operator/device change, under current access (Tasks 7, 10, 12–13).

## Current-source map and traced consumers

**READ ONLY, base `d15ff47ed059bb8be569b3b795436d3f4e86d805`.** These are source readings, not verified runtime behavior. No tests, provider calls, migrations, printer trials or deletion controls were run to author this plan. All new names/signatures below are proposals unless explicitly identified as existing. Refresh line positions and intersecting lane changes before execution.

| Inspected boundary                                                                                                                     | Reading that determines the plan                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/record-correction.ts:35,96,171,195,236,261,307`                                                                     | Existing input has `wholeInvoice`, no supplied partial breakdown. Partial uses `deriveVatBreakdown`; core checks `sale.rectify`, total budget and any named line ownership. Integrity issues log and proceed. Allocation and backend append follow those checks. |
| `packages/core/src/record-sale.ts:126,148,181`; `record-substitution.ts:97`                                                            | `deriveVatBreakdown` multiplies summed rounded bases. Ordinary sale also accepts its own supplied breakdown. Changing this shared helper would reach ordinary sales/substitution, so leave it alone.                                                             |
| `packages/core/src/record-correction.ts:335`; `apps/server/src/cancel-credit.ts:44,64`                                                 | Whole credit checks exact line reversal and copies the original VAT breakdown; `creditWholeInvoice` subsequently settles the original with no tender. Keep that branch and its no-payments caller restriction.                                                   |
| `packages/fiscal-verifactu/src/backend.ts:394,422,425,455`; `chain.ts:174,189,200`                                                     | Correction maps the supplied total/breakdown into R5/I, calls `appendToChain`, then outbox insertion. Chain builds alta, validates and inserts the immutable record. Exact input changes reach these protected builders even without editing them.               |
| `packages/fiscal/src/backend.ts:195,222`; `fiscal-none/src/backend.ts:61`; `fiscal/src/testing/fake-backend.ts:197`                    | Backend correction contract already carries `SaleForFiscalRecord.vatBreakdown`. Add admission reading separately; do not change the correction backend signature.                                                                                                |
| `apps/server/src/tender-refunds.ts:58`; `tender-refund-reservation.ts:35`; `tender-refund-authorization.ts:73`                         | Existing service opens an authorization transaction, reserves, completes cash/manual locally and resolves connected money afterwards. Extract a transaction-taking body rather than nesting it inside A802.                                                      |
| `apps/server/src/tender-refund-balance.ts:33,86`; `packages/payments/src/store.ts:227,641`                                             | Refundable balance combines ledger, pre-invoice and provider evidence without simply adding mirrored events. Preserve those calculations and reversibility checks; add shared operation reservations around them.                                                |
| `apps/server/src/tender-refund-sends.ts:137,223,291,349`; `tender-refund-recovery.ts:22`                                               | Outcome, manager attestation, send stamp and lookup are separate boundaries. The loop/manager marks a never-sent refund failed; only an explicit retry sends an unsent reservation. Preserve that recovery policy.                                               |
| `apps/server/src/line-cancel.ts:62,305,397`; `line-cancel-api.ts:124,163`; `cancellation-refund-value.ts:6`                            | Cancellation returns revision, ignores `recordAdjustment`'s returned id, writes zero reduction for keep-charge, and stores cumulative service cancellation state. The positional refund-value helper is not a durable invoice identity map.                      |
| `apps/server/src/working-order.ts:1276,6538,6580`; `bill-payments.ts:696,721`; `till-sale.ts:972,1596,1767`                            | `OrderLineIdentity` accompanies priced lines at issuance. Persist a mapping there, while both priced identities and newly written sale lines exist, rather than reconstructing it from a later screen.                                                           |
| `packages/db/src/schema/sales.ts:183,240`; `core/src/sale-line-rows.ts:15`                                                             | Fiscal sale-line quantity cannot be zero. Amount reductions therefore need separate zero-quantity-consumption allocation facts; do not reinterpret their fiscal presentation quantity as a physical return.                                                      |
| `apps/server/src/transaction-receipt.ts:39,149`; `receipt-issuer.ts:36`; `receipt-document.ts:137`                                     | Absent gross uses a display remainder fallback; receipt type is currently F1/F2. A802 needs a checked allocation reconstruction and an explicit corrective document projection.                                                                                  |
| `apps/server/src/receipt-print.ts:312,618`; `tender-refund-api.ts:195`; `find-bill-transactions.ts:54`                                 | Copies, refund drawer and transaction projections already have separate seams. Reuse document/drawer primitives, add one durable correction original-print intent, and link acknowledgment to correction.                                                        |
| `packages/reporting/src/vat-summary.ts:36`; `cash-up.ts:33,59`; `daily-close.ts:19`                                                    | Fiscal totals come from stored breakdown; completed refund rows affect money totals. Coverage links must not create another revenue or money reduction.                                                                                                          |
| `packages/db/src/migrations.ts:17`; `classification.ts:18,74`; `composition/src/modules.ts:139`; `db/src/configuration-transfer.ts:26` | Core schema belongs in db, its descriptor derives append-only names, composition/manifest carry them, and configuration export is enumerated. Ledger/recovery data must not enter configuration transfer.                                                        |

`rg -n 'recordCorrection\(|RecordCorrectionInput|deriveVatBreakdown' packages apps --glob '*.ts'` identified the following consumer groups. Re-run it before the contract edit and include any new consumers in focused verification:

- Production core caller: `apps/server/src/cancel-credit.ts`; ordinary sale/substitution share only the derivation helper, which remains unchanged.
- Script callers: `apps/server/scripts/{modelo-303-demo,daily-close-demo}.ts`. Preserve their legacy partial inputs; do not silently make all callers supply the new field.
- Core tests: `record-correction.test.ts`, plus structural backend wrappers in `record-sale.test.ts` and `record-void.test.ts`. In particular preserve `record-correction.test.ts:553` (legacy mismatching cents), `:694` (legacy derivation), whole reversal, authorization and no-settlement cases.
- Real-regime consumers: `fiscal-verifactu/src/{backend.test,correction-path.e2e.test,correction-amount.huella.test}.ts`; direct backend tests already supply a breakdown. Preserve the pinned correction hash at `correction-amount.huella.test.ts:177` and all golden write-path/inmutabilidad bytes.
- Backend implementations/tests: fiscal-none, fiscal testing fake, and their correction tests. Optional admission avoids forcing structural test wrappers to change existing assertions.
- Server fixtures/tests: `unpaid-departure`, `receipt-language`, `till-sale-integrated.db`, `fiscal-none.e2e`, `counter-handover`, `collect-by-invoice`, `cancel-invoiced-order`, `till-sales.disk-full`, and `testing/order-venue.ts`. These retain old inputs and behavior.

## Implementation gates: resolve before product code

**H2 question to the owner, exact proposed scope:** May A802 add the optional `partialVatBreakdown` input to `packages/core/src/record-correction.ts`, validate it in new `packages/core/src/partial-correction-breakdown.ts`, and pass that exact negative total/base/VAT through the existing `backend.recordCorrection`? This changes amounts reaching `backend.ts:422–468` and `chain.ts:174–210` for this new input branch. It does not edit those builder/append bodies, number allocation at `record-correction.ts:261`, hash code or existing record rows/schema. May the backend gain a delegated, read-only `correctionAdmissionFor` member plus new regime-owned reader, including reads of original records, submission state, substitution/void history and integrity? A802 alone refuses unusable history before calling core; ordinary sale and whole credit retain log-and-proceed policy.

Request approval for these concrete protected reaches before any A802 product/test code. Record the answer with exact paths and scope in the implementation ledger. Design approval is insufficient. No existing fiscal assertion change is proposed; the opt-in design is intended to leave them unchanged, subject to execution checks. The specific legacy assertions above stay. If execution exposes a necessary change, stop with the exact test/case/assertion, old expectation, proposed expectation and why an added independent test cannot suffice. Do not pre-authorize editing it here.

**Qualification gate after approval:** A new real-backend test must store/file `−0.03 = −0.02 + −0.01` at 21%, pass the existing library validation policy and consume exact rate remainders. Do not claim this from arithmetic alone. If validation refuses it, stop downstream issuance: report validation codes and the exact proposed builder/library edit for a further H2 approval. Never change tolerances, strip warnings, invent taxable balancing lines or refuse valid cents as the fix.

| Integration gate                 | Exact interface or overlap to establish at execution                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A739 payment window/reservations | Refresh landed `readBillBalance`, `previewBillPayment`, `beginBillPayment`, `issueIfFullyPaid`, `readRefundableTenders`, receipt-context dispatch, and till Pay/Refund handlers. Its unlanded `2026-10-20-a739-payment-window.md` is coordination only. A802 corrects the final settled sale, never a part-payment slip. Wait only for intersecting hunks/interfaces; do not duplicate a reservation system.                                                           |
| A757/A807/A808 service/printing  | Recheck lane-owned `line-cancel.ts`, kitchen correction-slip behavior, `receipt-print.ts`, receipt projections and till cancellation handlers. Preserve service cancellation and printer roles; adapt only after their actual contracts are released/landed.                                                                                                                                                                                                           |
| A798 readiness                   | Base has `FiscalBackend.assertRecordableAt`, `issueMoment`, `disk-full-gate.ts` and `read-only-gate.ts`. Clock-behind stop/restart are planned A798-B slices 8/9, not an available money guard. Before final integration, name the released function, signature and landed SHA that gates refunds/new records and fresh/resends while permitting outcome evidence. No guessed import or permissive fallback; clock-dependent acceptance/send tasks remain conditional. |
| A947 minute identity             | Select the current live rectificative series with `readLiveSeriesIdTx`; never mint or cache names. Refresh A947's actual series-selection/identity contract after landing if it intersects this path; no allocation/registration edit is authorized.                                                                                                                                                                                                                   |
| Migrations and final delivery    | Recheck active migration ownership and regenerate on collisions. No partial public money workflow: publish implementation only when all acceptance/recovery/UI/document gates pass. Documentation publication waits for none of these builds.                                                                                                                                                                                                                          |

## Proposed file and interface boundaries

Define domain selection/allocation/history types in `packages/core/src/correction-allocation.ts`. Core never imports an app, UI or payment module. Mirror HTTP DTOs in server `invoice-correction-types.ts` and till `api/invoice-correction-types.ts`, following the existing separate refund types. Convert explicitly between wire strings and domain decimals; test the complete server/client shape, including frozen saved details and null states. The till gains no runtime import of core's server-oriented barrel. Generic code contains no regime SQL.

In signatures below `Tx = Transaction`, `Backend = FiscalBackend`, `Cfg = DeviceRequestConfig`, `Actor = {personId:string; sessionId:string; attempts:PinAttempts}`, and `Deps = TenderRefundDeps & {backend:Backend; loadCorrectionProviderCapabilities:CorrectionCapabilityLoader}`. `Decimal`, `SaleId`, `NodeId`, `VatBreakdownLine`, `AuthzInput` and `RecordSaleLine` are existing exported types. Wire amounts use canonical decimal strings and timestamps use ISO strings.

```ts
type CorrectionTarget = { saleLineId: string; portionIds?: string[] };
type CorrectionSelection =
  | { mode: "items"; lines: (CorrectionTarget & { quantity: string })[] }
  | { mode: "amount"; lines: CorrectionTarget[]; gross: string };
interface CorrectionAsk {
  submissionId: string;
  expectedRevision: string;
  selection: CorrectionSelection;
  cancellationIds: string[];
  reasonId: string;
  note: string | null;
  earlier: { refundId: string; appliedAmount: string }[];
  legs: { tenderId: string; appliedAmount: string }[];
  cashConfirmed?: boolean;
  override?: Override;
}
interface CorrectionAllocation {
  saleLineId: string;
  portionIds: string[];
  quantityUsed: Decimal;
  rate: Decimal;
  gross: Decimal;
  base: Decimal;
  tax: Decimal;
}
type CorrectionAllocationWire = Omit<
  CorrectionAllocation,
  "quantityUsed" | "rate" | "gross" | "base" | "tax"
> & {
  quantityUsed: string;
  rate: string;
  gross: string;
  base: string;
  tax: string;
};
interface CorrectionPreview {
  revision: string;
  allocations: CorrectionAllocationWire[];
  gross: string;
  vatBreakdown: { rate: string; base: string; tax: string }[];
  earlierApplied: string;
  returnNow: string;
  refundable: RefundableTender[];
}
type CorrectionFiling =
  | "queued"
  | "sending"
  | "accepted"
  | "accepted_with_issues"
  | "refused"
  | "stopped"
  | "held"
  | "history_unusable";
interface CorrectionView {
  operationId: string;
  originalSaleId: string;
  correctiveSaleId: string | null;
  invoiceNumber: string | null;
  stage: "prepared" | "returned" | "issued" | "released";
  gross: string;
  completed: string;
  pending: string;
  remaining: string;
  refunds: TenderRefundView[];
  print: "owed" | "queued" | "failed";
  filing: { original: CorrectionFiling; corrective: CorrectionFiling | null };
}
interface CorrectionDetail extends CorrectionView {
  selection: CorrectionSelection;
  allocations: CorrectionAllocationWire[];
  reason: { id: string; name: string; note: string | null };
  original: { number: string; issuedAt: string; locale: string; invoiceLocales: string[] };
  lines: {
    saleLineId: string;
    lineNo: number;
    parentLineId: string | null;
    descriptions: Record<string, string>;
    quantity: string;
    unitPrecision: number | null;
    unit: string | null;
    priceQuantity: string;
    variantName: string | null;
    optionLabels: string[];
    gross: string;
    base: string;
    tax: string;
    rate: string;
  }[];
  earlier: { refundId: string; appliedAmount: string }[];
  legs: { tenderId: string; refundId: string; appliedAmount: string }[];
  terminal: {
    tenderId: string;
    terminalRef: string;
    appliedAmount: string;
    outcome: "unknown" | "returned" | "not_returned";
    recordedAt: string;
  }[];
  requestedBy: string;
  authorizedBy: string;
  allowedActions: ("record_correction" | "retry_refund" | "record_evidence" | "print_copy")[];
}
```

`CorrectionView` is the action summary. GET operation/discovery returns `CorrectionDetail` so another authorized device can reconstruct the accepted review without its browser journal. Persist frozen selection, allocation, reason and invoice facts at preparation/acceptance; derive current filing/money/document outcomes and allowed actions when reading. Frozen option/variant labels use the saved receipt language, never current catalogue names. Terminal evidence is durable before issuance. Allowed actions are presentation hints; commands reauthorize. Amounts/allocations in previews come from the server. The acceptance body sends choices, never trusted line/rate/base/tax amounts. `expectedRevision` fingerprints frozen history, active reservations and canonical preview facts; it excludes cosmetic filing progress between allowed states. Actor/PIN changes do not change request meaning. Canonicalize UUID case, exact money/quantity spellings and set order; reject duplicates before sorting.

Define `CorrectionProviderCapabilities` as `{observedAt:string; entries:readonly {tenderId:string;captureId:string;provider:string;providerPaymentRef:string;providerRevision:string;partialRefunds:boolean}[]}` and `CorrectionCapabilityLoader = (cfg:Cfg,saleId:SaleId) => Promise<CorrectionProviderCapabilities>`. `providerRevision` is a local fingerprint of the provider configuration and capture context, not a proposed remote-provider API field. Services call the loader outside a write transaction; preview takes the snapshot explicitly. Acceptance, terminal preparation and finalization fetch their own server-owned snapshot before opening their transaction and compare its tender/capture/provider identities and locally observed provider revision inside it. A changed identity/revision requires a fresh outside read and preview, never network I/O under the lock. This does not promise a remote provider cannot change after observation; later HTTP refusal follows the saved refund outcome path. Never accept a capability snapshot from HTTP input.

### Task 1: Pin the approved contract and existing behavior

**Files:** Inspect, do not rewrite, existing correction suites and the named consumer inventory. New exact-gross tests belong to Task 3, immediately before its implementation.

**Interfaces:** consumes the H2 approval; produces the recorded unchanged baseline and dependency inventory. This is preflight, not a failing-test commit.

- [ ] Record refreshed base, H2 answer and actual dependency intersections. Read TDD skill; retain the complete old fiscal-test assertion inventory. Run the protected pair unedited and existing core correction suite using the commands under validation below.
- [ ] Record baseline results and preserve existing fixtures. Do not introduce the exact-gross RED fixture until Task 3, so Task 2 can end with a coherent passing commit.

### Task 2: Calculate frozen entitlements and cumulative deltas

**Files:** Create `packages/core/src/correction-allocation.ts`, `correction-allocation.test.ts`; export domain types and pure allocator from `packages/core/src/index.ts`. The persistent server history reader belongs to Task 5 after its schema exists.

**Interfaces:** `allocateCorrection(history:CorrectionHistory,selection:CorrectionSelection):CorrectionPreviewAmounts` is pure and uses fixture histories in this task. Define `CorrectionHistory` as original lines (id/lineNo/parent, frozen quantity/precision/priceQuantity, gross/base/rate and descriptions), stored rate budgets and consumed/reserved allocations; `CorrectionPreviewAmounts` is preview gross/allocations/breakdown only. No SQL reader or future table import is needed here.

- [ ] Add table-driven allocation assertions: €2 at 10% is `2.00/1.82/0.18`; €5.50 at 10% is `5.50/5.00/0.50`; €2 over €11@10% and €12.10@21% is gross `.95/1.05`, base `.86/.87`, VAT `.09/.18`. Observe numerical RED before implementing.
- [ ] Implement largest-remainder gross distribution with `(lineNo,id)` ties, per-line caps and exact Decimal operations. At a rate, round cumulative credited gross divided by `1+rate/100`, subtract previously credited base, and set VAT to gross minus base. Exhausting a rate consumes exactly its stored remaining base and VAT. Distribute base deterministically across affected lines, bounded by their reconciled budgets; tax is each gross less base. Validate all line/rate budgets together.
- [ ] Pin repeated `.03`/one-cent reductions, zero tax rates, partial amount then quantity, final quantity taking all residual cents, rate exhaustion and uneven multi-line tax rounding. Amount consumes zero physical quantity; Items consumes requested frozen precision. A weighed portion is whole in Items and price-adjustable in Amount. Negative/zero amount, overprecision, foreign/duplicate/parent-extra overlap and exhausted lines fail with domain codes.
- [ ] Parent selection includes priced extras proportionally, each at its original rate; an extra alone retains parent context. Zero-price options are descriptions. Use actual discounted/comped line gross, never list price or today's catalogue. Zero-value dishes remain visible without a positive refund.
- [ ] With one remaining rate, start Amount with all remaining lines visibly selected. With mixed rates, require explicit affected lines before entering money. Canonicalize portion identities beneath grouped lines and aggregate their allocations per source sale line; never turn a group count into interchangeable identities.
- [ ] For absent gross, use deterministic base-plus-rate starting values and assign the stored per-rate residual to the last absent line by `(lineNo,id)`, only after nonnegative gross and per-rate base/tax/total reconciliation. Materialize the checked allocation snapshot on acceptance. Refuse inconsistent original or historical allocations; no guessed quantity, balancing line or automatic historical backfill. Earlier corrections consume budgets even if refused/held. Run the pure core allocation file RED then GREEN; `git commit -s` allocation unit.

### Task 3: Carry the exact partial breakdown through the existing writer

**Files:** Modify `packages/core/src/record-correction.ts`; create `partial-correction-breakdown.ts`, its test and `packages/fiscal-verifactu/src/partial-correction-gross.e2e.test.ts`. Existing `record-sale.ts`, backend builder/chain/record schema and existing fiscal tests remain unchanged.

**Interfaces:** add `partialVatBreakdown?: readonly VatBreakdownLine[]` to `RecordCorrectionInput`. Add `validatePartialCorrectionBreakdown(total:string,lines:readonly RecordSaleLine[],breakdown:readonly VatBreakdownLine[]):VatBreakdownLine[]`. Absence retains the old derived branch; `wholeInvoice:true` plus this field refuses before allocation. Whole credit retains its exact copied breakdown.

- [ ] Add the real-backend €0.03 fixture using a valid original with enough rate budget, trusted clock, real migrations and existing permissions. Assert the desired stored/filed split against today's derivation path: total `-3` cents, line base `-2`, filed VAT `-0.01`, and sum `-0.03`. Observe arithmetic assertion RED, not an invalid-original failure. Keep this RED and the following opt-in implementation in this same task.
- [ ] Add RED assertions for supplied gross/base/tax disagreement, duplicate/foreign rates, missing gross or `correctsLineId`, duplicate source lines, fractional cents and nonnegative deltas; assert no sale, number movement or backend call. Keep legacy partial semantics confined to the absent-field branch.
- [ ] Validate the supplied branch as exact cents, negative gross and nonpositive base/tax, exact total equality and line/rate gross/base equality, original line/rate membership. Extend the existing source-line read in `record-correction.ts` with `vatRate`/`lineGross` for this check; the pure helper checks shape/sums and the writer checks original membership. Use the acceptance history's cumulative budgets in Task 7; do not multiply rounded base to overwrite the supplied tax. Construct corrective lines with negative exact base/gross and frozen descriptions/source id.
- [ ] Items uses negative selected physical quantity. Amount uses negative selected scope quantity as document context (nonzero), with `quantityUsed=0` in operation allocation; reporting/UI must never treat that context as returned units. Retain `priceQuantity`, units and analytics snapshots from the original.
- [ ] Switch the new case to the opt-in input; run it GREEN through real core, backend, stored record reconstruction, validation and hash recomputation. Also test mixed rates and exact final stored remainder; compare original sale/lines/record before and after. Inspect and retain any validation warnings without weakening existing policy.
- [ ] Run old correction suite, legacy scripts' typechecks and protected pair unedited. If a protected builder/assertion change is necessary, stop at H2 with the precise new question above. Otherwise `git commit -s` exact-contract unit and its new tests.

### Task 4: Let the regime decide admission without teaching core its tables

**Files:** Modify `packages/fiscal/src/backend.ts`, its export barrel; `packages/fiscal-verifactu/src/backend.ts`; create regime `correction-admission.ts` and test; extend fiscal-none/fake backend and add new admission tests.

**Interfaces:** optional `FiscalBackend.correctionAdmissionFor(tx:Tx,saleId:SaleId,nodeId:NodeId):Promise<CorrectionAdmission>`. Result is `{eligible:true; filing:"queued"|"sending"|"accepted"|"accepted_with_issues"; original:{number:string;issuedAt:string}}` or `{eligible:false;reason:"unsupported"|"missing"|"wrong_node"|"voided"|"replaced"|"filing_refused"|"history_unusable"}`. Absence refuses A802 as unsupported. Generic service separately calls `checkIntegrity` and refuses issues for A802 only.

- [ ] Add RED admission matrix: settled positive local F2 accepted while queued/sending/accepted/accepted-with-errors; refuse F1/F3/R5, zero/negative original, anulación, substituted F2, wrong node, missing/divergent record, rejected/stopped/held and integrity issues. Include allowed controls beside every guard.
- [ ] Implement a read-only regime reader; delegate from the backend without altering `recordCorrection`, alta construction or append logic. Query actual substitution references and stored records inside the regime, not receipt display flags. `fiscal-none` explicitly returns unsupported; fake supports purpose-built histories for server tests.
- [ ] Keep settlement, reconcilable allocation and resolved payment/refund state across the original, every capture and its bill as server acceptance requirements for Task 7 after Task 5's reader exists. This includes unanswered attempts and captured-but-not-filed money, which their payment flow resolves first. Do not import future tables into this regime-only task. Run new admission files plus `scripts/module-seams.test.ts` and `packages/fiscal/src/no-regime-vocabulary.test.ts`; `git commit -s` admission unit.

### Task 5: Persist immutable operations, allocation identities and recovery

**Files:** Create `packages/db/src/schema/invoice-corrections.ts` and test; modify schema barrel, classification, manifest and relevant db exports/guards. Create `apps/server/src/invoice-line-identities.ts`, `invoice-correction-history.ts` and their tests; modify issuance sites in `working-order.ts`, `bill-payments.ts`, `till-sale.ts`. Generate only new core migrations after release/approval.

**Interfaces:** `saveInvoiceLineIdentities(tx:Tx,saleId:SaleId,identities:readonly OrderLineIdentity[]):Promise<void>` maps the priced inputs' line numbers to newly written sale-line ids in that issuance transaction, validating count/product/parent/quantity. Return no fabricated match for history without this mapping.

After creating/migrating these tables, implement `readCorrectionHistory(tx:Tx,saleId:SaleId):Promise<CorrectionHistory>` as the server adapter from frozen rows, prior credits and operation reservations into Task 2's domain history. Test it against real migrated rows and inconsistent history. It is available before Tasks 6–7, not a dependency of the pure allocator.

- [ ] Add database RED cases for duplicate submission/issue/coverage keys, invalid cents, foreign line and replace/update/delete of immutable facts; prepare a real row before testing trigger refusal. Add issuance tests for renumbered lines, extras, split/moved dishes, response replay and A803 grouped portions, with distinct frozen identities.
- [ ] Add these tables, all with declared FKs to mandatory core rows and `restrict` deletes: `invoice_correction_requests` (unique original sale/submission id, canonical fingerprint/body, checked frozen entitlement snapshot, original node/location/device, mode, gross, reason id/name/policy snapshot/note, requester/authorizer); `invoice_correction_allocations` (unique request/source line, selected portion ids, quantityUsed, gross/base/tax/rate); `invoice_correction_issues` (unique request and corrective sale); `invoice_correction_attempts` (unique request/retry submission, fingerprint); `invoice_correction_coverage` (request, optional attempt, tender refund id, exact applied amount, earlier/new kind, unique request/refund); `invoice_correction_terminal_evidence` (request/tender/evidence submission, terminal context/reference, actual amount, outcome, person/note/time); `invoice_line_identities` (sale line, original working-line/portion id, allocated frozen quantity/value).
- [ ] Declare request/allocation/issue/attempt/coverage/evidence/identity facts `appendOnly(...,"ledger",...)`. Add `invoice_correction_recovery` as mutable `state`, keyed by request, storing stage/revision, terminal resolution and original-print intent/job/status. Persist intent as owed at issuance; neither recovery status nor cached totals replaces immutable facts/refund rows as budget authority. All data survives reload/restart and transfers with venue history, not configuration export.
- [ ] Core owns sale/payment coordination because both mandatory sale and tender-refund tables already live there. State that reason in the migration commit. Optional identity/reason ids follow the existing plain-id snapshot pattern, with target checks at write sites; no core dependency on adjustments/identity/payment-provider migration sets. These tables stay outside enumerated configuration export. Add `CORE_CLASSIFICATION` entries, check `CORE_MIGRATIONS` derived names and composition descriptor/manifest equality, schema inventory and schema conformance.
- [ ] Persist identities at every inspected issuance path, including captured-payment completion/recovery, without changing sale prices, fiscal input or settlement policy. Historical direct invoice-line selection can work from frozen rows; A758/individual grouped portions require a durable authoritative map. If A803 groups several portions into one fiscal line, persist each portion's quantity/value share; never infer shares from a displayed count. Without such facts disable that individual selection with an explanation.
- [ ] Run new schema/identity suites and schema commands below. No shipped migration edits or ambiguous backfill. `git commit -s` schema/identity unit.

### Task 6: Share payment capacity and incomplete-operation ownership

**Files:** Create `apps/server/src/invoice-correction-reservations.ts` and test; modify `tender-refund-reservation.ts`, `tender-refund-balance.ts`, `bill-refunds.ts` at actual admission/reservation boundaries.

**Interfaces:** `assertCorrectionMoneyAccess(tx:Tx,saleId:SaleId,operationId?:string):Promise<void>` refuses a competing refund while a preparation or issued correction has unfinished money. `readCorrectionCoverage(tx:Tx,operationId:string):Promise<{completed:Decimal;pending:Decimal;remaining:Decimal}>` derives from coverage/evidence and refund states. Internal optional operation context is server-created, never a trusted HTTP bypass flag.

- [ ] Add RED races for two last-dish corrections, two assignments of the same earlier refund, ordinary tender/bill refund versus A802 preparation, and two retries after one failed split leg. Assert exact totals and ids, not merely a thrown error. Include ordinary unrelated goodwill with no active operation as an allowed control.
- [ ] Reuse `readRefundableTenders`/capture matching/`assertReversible`. Count pending money reservations, preparation capacity and provider/pre-invoice evidence once. A preparation reserves all reviewed line/rate and money capacity until an established non-return or acceptance; no timer release. An issued failed refund releases only its money capacity, never its fiscal allocation, and the original still points to that unfinished operation.
- [ ] Earlier coverage accepts only attributable completed post-invoice `tender_refunds.appliedAmount` minus all assigned amounts. Never assign tips, pre-invoice returns already netted from tenders, pending/unknown money or unmatched provider events. A €10 original, €3 earlier refund and €5 correction produces €2 new money if all €3 assigned, €4 if only €1 assigned. Unrelated goodwill stays unrelated and may leave insufficient capacity; do not infer coverage from reason/date/value.
- [ ] Keep all-or-nothing capacity checks inside the venue write transaction. Derive A802's active operation from unresolved terminal preparation or uncovered/pending money; allow same-operation recovery. Update ordinary refunds, A758 and manager admission to share it. Run new reservation and existing balance/reservation/bill-refund suites RED then GREEN; `git commit -s` capacity unit.

### Task 7: Accept one correction and its refund reservations atomically

**Files:** Create `apps/server/src/invoice-corrections.ts`, `invoice-correction-authorization.ts`, corresponding tests and `invoice-correction-types.ts`; modify `tender-refunds.ts` to extract its transaction-taking completion body.

**Interfaces:** `previewInvoiceCorrection(tx:Tx,deps:Deps,cfg:Cfg,saleId:SaleId,ask:Omit<CorrectionAsk,"submissionId"|"expectedRevision"|"override">,capabilities:CorrectionProviderCapabilities):Promise<CorrectionPreview>`; `acceptInvoiceCorrection(deps:Deps,cfg:Cfg,saleId:SaleId,ask:CorrectionAsk,actor:Actor):Promise<CorrectionView>`. Extract `beginSettledTenderRefundIn(tx:Tx,deps:Deps,cfg:Cfg,saleId:string,request:TenderRefundRequest,actor:{requestedBy:string;authorizedBy:string},createdAt:string):Promise<{refund:TenderRefundView;replayed:boolean}>`; outer existing API retains its authorization/claim behavior.

- [ ] Add RED transaction cases for €2/€5.50/mixed-rate issuance, fully earlier-covered correction with no new money, split cash/card, stale revision, double tap and lost commit response. Assert one correction, one operation, exact coverage, negative breakdown, no settlement/tender on correction, original bytes unchanged and no external calls on rollback.
- [ ] Use Task 5's real history reader and Task 4's admission result; require a settled positive original, reconcilable allocations and resolved payment/refund state across its captures and bill. Refuse unknown/captured-but-not-filed attempts with their existing payment-resolution route. Recheck inside acceptance, with a legitimate resolved-payment control.
- [ ] Perform PIN derivation/throttled turns before the lock. Inside, recheck session, active device/profile admission and every source-order zone, then both `sale.rectify` and `sale.refund`. One approver must hold both, not one person per permission. Retain core's own rectify check; carry only operation-scoped checked credential, never stored PIN. For manual terminal confirmation preserve its forced PIN rule even if the operator personally holds both permissions. Resolve a Void reason and current note-required/Other policy through adjustments; snapshot its wording/policy at acceptance and retain A758's refund reason text shape.
- [ ] Resolve an identical saved submission after current access checks, before new capacity/readiness/allocation checks. Refuse changed meaning with `submission.id_reused`; authorizer identity is audit, not fingerprint meaning. A revoked person/device/zone cannot replay through the old approval. New commands re-read all budgets/reason policy/capabilities inside the transaction and compare reviewed revision before issuance.
- [ ] Select live corrective series; check primary/write/disk, trusted record time and released A798 readiness. Save immutable request/allocations, call `recordCorrection` with `partialVatBreakdown`, save unique issue link, reserve new tender refunds and complete cash in the same transaction. Reuse manual completion only through Task 9's evidence path. Save coverage links and original-print intent. Cash queues at most one permitted audited drawer job; card creation/printing adds none.
- [ ] Provider discovery/capabilities needed for preview are fetched outside the transaction into a validated snapshot and rechecked for selected provider/capture identity before reserving. No provider/network wait inside `begin...In`. Reuse resolver ownership after commit; do not begin a provider send if the transaction fails. Run new service/authorization suites RED then GREEN; `git commit -s` acceptance unit.

### Task 8: Recover connected split refunds and manager outcomes

**Files:** Modify `tender-refund-sends.ts`, `tender-refund-recovery.ts`, tender-refund management routes in `payments-api.ts`, `tender-refund-api.ts`, and boot dependency wiring; create `invoice-correction-recovery.ts` and test.

**Interfaces:** `retryInvoiceCorrection(deps:Deps,cfg:Cfg,operationId:string,submissionId:string,legs:CorrectionAsk["legs"],actor:Actor,override?:Override):Promise<CorrectionView>` reserves only uncovered amounts under the same issue. `refreshCorrectionRecoveryIn(tx:Tx,refundId:string):Promise<void>` updates recovery projection from immutable coverage and authoritative refunds; call it from every completion/failure/attestation path.

- [ ] Preserve each failed new leg's original tender identity and method on retry. A retry covers only that failed leg's still-uncovered applied amount on the same original tender after its prior outcome is established; pending/completed legs are not replacement capacity. No card-to-cash fallback is added. Reject an attempted cash replacement for failed card money even when this operator/device may normally return cash; keep an allowed same-card-tender retry. Changing methods needs separate approved policy, not a generic permission check.
- [ ] Add RED injected failures: provider success then local outcome rollback, captured-but-not-filed original, response loss, provider timeout/lookup-none, definitive failure, unsent restart, contradictory/duplicate provider refs, live resolver and split pending/completed/failed legs. Assert same correction number, stable refund/send identities and no repeated completed leg.
- [ ] Retain committed send stamp/count, capture, exclusion refs and provider idempotency key `tr_<refundId>`. Resume lookup/reconciliation before any allowed resend. A missing match or timeout does not establish failure. Preserve `refundOutcome`, resolver ownership and existing resend windows. Manager evidence can settle money, never alter invoice/reason/allocation or silently issue another correction.
- [ ] Preserve unsent loop/manager failure rather than adding an automatic send. That leaves the issued correction visibly owing money; an authorized retry can reserve a new leg under its existing issue. While a leg is pending, its amount remains reserved. Confirmed failure frees only that leg's money; linked allocation remains spent.
- [ ] Apply the actual A798 readiness contract to first sends and resends, including after reservation and restart. Lookup and saving returned-money evidence remain possible during a clock stop; no new invoice or money send bypasses it. Refresh state for existing loop/manager routes, not only A802 HTTP calls. Keep ordinary unsent recovery tests and add an A802 equivalent.
- [ ] Exercise at least one real HTTP provider refusal through the existing provider client alongside fake outcomes; run focused sends/recovery/management suites RED then GREEN. `git commit -s` recovery unit.

### Task 9: Prepare before a standalone terminal return

**Files:** Create `apps/server/src/invoice-correction-terminal.ts` and test; extend Task 7 authorization/service and operation API types.

**Interfaces:** `prepareTerminalCorrection(deps:Deps,cfg:Cfg,saleId:SaleId,ask:CorrectionAsk,actor:Actor):Promise<CorrectionView>` commits reviewed request/allocations/capacity with no issue. `recordTerminalCorrectionEvidence(deps:Deps,cfg:Cfg,operationId:string,evidence:{submissionId:string;tenderId:string;outcome:"unknown"|"returned"|"not_returned";appliedAmount:string;terminalRef:string;note:string},actor:Actor,override:Override):Promise<CorrectionView>` saves evidence first. `finalizePreparedCorrection(deps:Deps,cfg:Cfg,operationId:string,submissionId:string,actor:Actor,override?:Override):Promise<CorrectionView>` then issues the saved preparation in a separate transaction. Finalization accepts no changed selection, reason, amount, tender or evidence.

- [ ] Add RED cases asserting preparation is durable before the UI can instruct an external refund; both permissions/capacity/profile/terminal context are checked first. Two devices cannot consume its lines or money. Closing/reloading/time passing does not release it or instruct another return.
- [ ] Save terminal evidence independently of fiscal issuance, with an invariant comment explaining the external action cannot be rolled back. For an exact confirmed return, the evidence transaction also records the completed tender/manual payment refund and immutable coverage once, using the preparation's reserved capacity. Returned evidence, money rows and actual exact amount survive failed issue save, clock stop and lost HTTP response; the next action is Record correction against the same preparation. Unknown remains unresolved; established non-return may release preparation without issuing. Recheck current confirmation PIN/access.
- [ ] Implement finalization separately from replay of the original prepare submission. Reauthorize current person/device/zones and both permissions, then return the saved result if a unique issue already exists. Otherwise require attributable returned evidence for all manual legs, reuse the frozen request/allocation and evidence, exclude this operation's own reservations from competing-capacity checks while retaining their ownership, and recheck source history and issuance readiness. Create the issue, remaining cash/connected reservations and print intent once in that transaction; never instruct another terminal return. Failed issuance leaves preparation/evidence/reservations intact. Test failure followed by reload and another authorized device's finalization, clock-stop recovery, concurrent finalization and lost-response replay with one corrective number/refund set.
- [ ] A mismatching actual amount or terminal identity records evidence but refuses automatic issuance/resend; expose resolution, never rewrite reviewed facts. If completing such a mismatch requires changing the reviewed correction, stop that recovery for a precise approved resolution design rather than inventing manager fiscal authority.
- [ ] For mixed manual/connected/cash legs, prepare the entire operation, collect terminal evidence first, then atomically issue and reserve the remaining legs. Issuance reuses already recorded manual coverage and never repeats its payment/refund rows. Keep the existing manual-card drawer behavior; this feature adds no drawer action for terminal evidence, correction or reprint. Do not duplicate a previously completed refund assigned as earlier coverage. Run terminal/service cases RED then GREEN; `git commit -s` terminal unit.

### Task 10: Expose authorized previews, replay and durable discovery

**Files:** Create `apps/server/src/invoice-correction-api.ts` and test; mount in `till-api.ts`; modify `find-bill-types.ts`, `find-bill-transactions.ts`, `errors.ts`; add till API types/client and `invoice-correction-client.test.ts`.

**Interfaces:** GET `/api/transactions/:saleId/correction-context`; POST `/api/transactions/:saleId/corrections/preview`; POST `/api/transactions/:saleId/corrections`; POST `/api/transactions/:saleId/corrections/prepare-terminal`; GET `/api/invoice-corrections/:operationId`; POST its `/retry`, `/terminal-evidence` and `/finalize` actions. Context lists original frozen scope, remaining entitlements, assignable earlier refunds and active/saved operations. GET saved operation returns the full `CorrectionDetail`. POST parsers validate unknown/null/type/UUID/money/quantity shapes; no client prices or rates accepted. Add cancellation discovery with Task 11 and the `/print` endpoint with Task 13 once its real service exists; Task 10 requires no fake handlers or future-table imports.

- [ ] Add RED route cases for passive reads, malformed body, one-permission-only, wrong PIN/throttle, retired/non-admitted device, forbidden method, any foreign source zone and current-access replay refusal. Add map rows/refusing cases in `till-api.profile-actions.test.ts` and `till-api.profile-zones.test.ts`.
- [ ] Route through common services and normal primary/disk/read-only gates. Preview is read-only; write body has one local acceptance transaction, with the deliberate preparation/evidence exceptions documented. `take-cash`, reader-card and hand-keyed-card restrictions apply per selected new leg; a PIN never grants a device method. Earlier-only correction needs both person permissions but no fictitious new tender.
- [ ] Return saved operation after response loss and list its complete details for another authorized device/operator even without browser journal. Assert full selection/allocations/frozen lines/reason, original reference, terminal evidence, current allowed actions and separate filing/money/document outcomes against the server-to-wire conversion; include prepared/null-correction states. Match the till client's full-shape assertion without importing domain runtime into the browser. Register domain codes under `invoice_correction.*` in server/core as appropriate, localized EN/ES, with field params where a shown field is named. Run new routes/client plus error guards RED then GREEN; `git commit -s` API unit.

### Task 11: Connect A758 cancellations to this service

**Files:** Modify `line-cancel.ts`, `line-cancel-api.ts`, `cancellation-refund-value.ts`, till cancellation types/handlers; create `packages/adjustments/src/schema/invoice-corrections.ts`, its barrel/classification/manifest entries and new tests; add `invoice-correction-cancellations.ts` and test in server.

**Interfaces:** extend cancellation result with `cancellationIds:string[]` containing immutable adjustment ids, including service-command replay. `readCorrectionCancellations(tx:Tx,saleId:SaleId):Promise<{cancellationId:string;saleLineId:string;quantity:Decimal;grossRemaining:Decimal}[]>` uses durable invoice identities and zero-reduction cancel facts. Store immutable `adjustment_invoice_corrections` links (adjustment/request/source line/quantity/value), owned by adjustments with declared core references; core never depends on its optional module.

- [ ] Add RED €62/Flan case: cancel keeps original €62 and adjustment reduction zero; submitting €5.50 refund creates one R5 `-5.00/-0.50`, one linked refund and net invoiced €56.50. Money remains €62 until connected completion. Abandoning the window creates no correction. Returning via another till explicitly selects the existing cancellation id.
- [ ] Retain `recordAdjustment`'s id in command result instead of guessing from the latest row or using cumulative `lineServiceCancellations` as an immutable event. Persist module-owned links in acceptance, reject already consumed/foreign cancellations, and cap by both remaining cancelled quantity/value and invoice entitlement. No editing append-only adjustments or free-text automatic linkage.
- [ ] Add cancellation discovery to Task 10's context/API and full-shape client checks now, using the real module-owned links and reader. Earlier tasks must not fabricate cancellation results for this later integration.
- [ ] Use the common dual-permission action, prefilled reason and amount, and standalone preparation when needed. On failure never fall back to ordinary money-only refund. Keep no-cash-device handoff, no cash-handover switch or cash-owed/customer-presence ledger; keep ordinary deliberate goodwill refund. If retained wire `cashConfirmed` is required, derive it from submitting the action, not a new cash-handover control.
- [ ] Preserve kitchen cancellation/correction slips, no-payments whole cancel, served/unserved restrictions and unrelated A758 behavior. Run new cancellation integration, existing line-cancel API and whole-cancel suites RED then GREEN; generate new adjustments migration only after ownership release and run schema guards. `git commit -s` A758 unit.

### Task 12: Build the correction window and its recovery state

**Files:** Create till `widgets/invoice-correction-dialog.ts` with `.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts`; state `invoice-correction.ts` and test; modify `screens/till-ticket-view.ts`, `till-app.ts`, `i18n/strings.ts` and `i18n/codes.ts`.

**Interfaces:** state journal stores original/request/submission/operation id without PIN before send, following the existing refund journal's definitive-refusal versus unknown distinction. Dialog consumes `CorrectionPreview`/`CorrectionView` and submits `CorrectionAsk`; accepted operations render read-only recovery actions against their saved ids.

- [ ] Add RED UI cases for Items/Amount, mixed-rate required scope, grouped identities/extras/weighed restrictions, earlier-refund partial assignment, reason/Other note and device-limited tenders. Review shows number, quantities/scope, signed rate totals, earlier returned and Return now. Main labels: Correct and refund €2.00 or Record correction; ordinary Refund a payment explains money-only behavior.
- [ ] Add state/browser cases for double taps, storage failure before send, unknown response/reload, new authorized device, stale preview, definitive refusal then edit, changed PIN holder on same request, late answer after changing receipt, server-saved result plus failed refresh, split pending/failed retry and terminal-return-save failure. Keep accepted facts read-only and recover from server discovery, not browser storage alone.
- [ ] Use shared named fields, comma/dot input, bottom error summary/field errors, quiet disabled choice/load action, registered `trackDialog()` and draft scope. Restore global language after tests; wait for close events and real browser grants. Do not let a request refusal alone disable retry or a failed refresh invite another issue.
- [ ] Run focused UI/state/a11y suites RED then GREEN. Open actual EN/ES screen states in light/dark at phone/desktop width with keyboard; inspect Items, Amount, confirmation, pending/failure and terminal recovery. `git commit -s` correction-window unit.

### Task 13: Print the existing corrective document once

**Files:** Create server `invoice-correction-receipt.ts` and test; integrate `receipt-document.ts`, `receipt-print.ts`, `tender-refund-receipt.ts`, transaction projections and till saved-result presentation.

**Interfaces:** `readInvoiceCorrectionReceipt(tx:Tx,backend:Backend,operationId:string):Promise<CorrectionReceipt>` projects saved original reference, signed lines/breakdown, reason, QR and money status. Define `CorrectionReceipt` as those facts plus original invoice locales and copy designation; do not widen ordinary `TillSaleResult` into an assumed fiscal-type reader. `enqueueCorrectionOriginalIn(tx:Tx,cfg:Cfg,operationId:string,personId:string):Promise<void>` consumes the unique durable intent; explicit copies use existing document jobs and copy marking.

- [ ] Add RED assertions for R5 title/reference/signed amounts/QR, EN/ES frozen names, 58/80mm layouts, pending/failed/earlier-covered money wording, concurrent lost-response printing, missing printer, forbidden print action, explicit marked copy and no extra drawer/refund. Retain existing receipt type/whole-cancel assertions.
- [ ] Corrective paper says Corrective invoice, its own number/date and original reference, frozen customer descriptions/options, negative gross/base/VAT, reason and backend QR. Print refunded/pending/remaining accurately and link refund acknowledgment to the correction. Select a corrective document explicitly; do not infer R5 from counterparty-null F2 display logic or fabricate payment tenders.
- [ ] Create one original intent in issuance and queue at most one original job when permitted printer resolves. No printer leaves owed state. Job failure keeps the same document/job history; an explicit copy is marked. Response replay queues no extra original; reprint never refunds or opens drawer. Check `print-receipt`, printer/location scope and frozen receipt languages separately; no permission means recoverable paper outcome, not lost correction.
- [ ] Mount and test Task 10's deferred POST `/api/invoice-corrections/:operationId/print` using this real print service; no earlier placeholder may send a generic F2 document. Preserve current-access and copy checks on HTTP replay.
- [ ] Run focused receipt/drawer suites RED then GREEN. Render EN/ES 58/80mm paper and LOOK at negative totals/reference/QR/copy marks. Record physical delivery and real printer behavior as unverified unless actually tried. `git commit -s` corrective-paper unit.

### Task 14: Reconcile reports and publish the guides

**Files:** Add server `invoice-correction-reporting.test.ts`; extend reporting tests for daily close/VAT/cash-up and adjustment reports; modify report code only where the new behavior requires it. Update `apps/server/src/guide/{en,es}/table-service.md`, till `help-guide.ts`, and add matched `invoice-corrections.md` guide twins if separate explanation is needed; update `docs/backlog.md`/area detail for completed scope.

**Interfaces:** reports read negative corrective sales once for revenue/VAT, completed tender refunds once for money and coverage solely for linkage. Physical corrected quantities use operation `quantityUsed`, not Amount's contextual fiscal quantity. No new totals are derived by subtracting coverage again.

- [ ] Add RED report assertions for €62→€56.50 invoiced while card pending; completion moves money €62→€56.50 once; failure leaves revenue corrected and money owing. Include terminal money recorded before a failed fiscal save, prior €3 coverage, partial assignment, tip, split methods, provider mirrored evidence, different business days/nodes, amount-only quantity zero and cash drawer count. Daily close, VAT return, takings and device cash count agree with their respective event dates.
- [ ] Preserve existing report behavioral assertions; correct only demonstrated double-counting or presentation gaps. If existing fiscal assertions need changes, stop for the exact approval rather than editing expectations. Run new reporting and existing cash-up/VAT/adjustment suites RED then GREEN.
- [ ] Write EN/ES guides in second person: choose correction versus goodwill, review VAT-inclusive amount, select earlier refunds/cancels explicitly, pending/failed card, standalone preparation, recovery and copies. Match section ids/twins and add help links through till `help-guide.ts`; run guide content/link checks. Retire current-behavior claims across every touched README/runbook/guide, while keeping dated historical designs.
- [ ] Verify the separate VAT-only backlog entry and approved-design pointer remain; remove only finished A802 backlog scope, retain genuine residuals/physical qualifications. `git commit -s` reporting/guides unit.

## Focused validation commands for execution, not receipts

Run each owning task's new file(s) with `pnpm --filter @waitron/<package> exec vitest run <relative-file> --reporter=dot` before and after implementation. Inspect a real `Tests` count and domain/numeric assertions. Existing package names/scripts were read from their manifests. Do not execute these commands for this docs-only publication.

```bash
pnpm --filter @waitron/core exec vitest run src/record-correction.test.ts --reporter=dot
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/correction-amount.huella.test.ts src/correction-path.e2e.test.ts --reporter=dot
pnpm --filter @waitron/server exec vitest run src/tender-refund-reservation.test.ts src/tender-refund-balance.test.ts src/tender-refund-authorization.test.ts src/tender-refunds.test.ts src/tender-refund-management.test.ts src/tender-refund-drawer.test.ts --reporter=dot
pnpm --filter @waitron/server exec vitest run src/line-cancel-api.test.ts src/cancel-invoiced-order.test.ts src/report-api.tender-refunds.test.ts --reporter=dot
pnpm --filter @waitron/reporting exec vitest run src/cash-up-tender-refunds.test.ts src/daily-close.test.ts src/vat-summary.test.ts src/vat-return.test.ts --reporter=dot
pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts --reporter=dot
pnpm exec vitest run scripts/guide-links.test.ts scripts/module-seams.test.ts scripts/alert-codes.test.ts scripts/errors-reachable.test.ts --reporter=dot
```

After each migration, run focused new table tests plus these root guards and composition equality; on a generation collision regenerate against main, never hand-edit snapshots/journals:

```bash
pnpm --filter @waitron/db db:generate --name invoice_corrections
pnpm --filter @waitron/adjustments db:generate --name invoice_correction_links
pnpm --filter @waitron/db exec vitest run src/schema/schema-conformance.test.ts --reporter=dot
pnpm --filter @waitron/composition exec vitest run src/composition.test.ts --reporter=dot
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/classification-complete.test.ts scripts/append-only-migration-sets.test.ts scripts/apply-migrations-callers.test.ts scripts/module-graph-honesty.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/migration-upgrade.test.ts --reporter=dot
```

Generation commands above belong only to their approved task and released migration set. Read each package's actual schema/ownership inventory guards before adding entries; run the adjustments schema-conformance suite too. Run browser packages only after checking `memory_pressure | grep free` and concurrent test activity; never overlap coverage directories. Use package-wide coverage locally only for an investigating failure; normal push hook and current-head CI provide the required broad checks.

### Task 15: Qualify the complete candidate and finish the fiscal branch

**Files:** All candidate changes, final backlog/guide claims and PR validation inventory. No second implementation path or unfinished public workflow.

**Interfaces:** consumes all prior GREEN tasks, released dependency interfaces and H2 approvals; produces one reviewed green fiscal PR that the owner lands.

- [ ] Re-read the complete spec against Tasks 1–14. Exercise actual end-to-end cash, connected pending/failure/split, earlier-covered, A758 and terminal-recovery paths. Verify frozen originals, one number/record per operation, exact preview/store/file/receipt/report agreement, both permissions and device gates, and provider waits outside transactions. Record actual commands/results and unresolved physical/external limits.
- [ ] In an independently installed disposable full-candidate checkout, remove critical replay uniqueness/budget checks, prior-refund cap, unfinished-operation lock, current dual authorization, readiness send gate and original-print intent guard one at a time. Each corresponding test must fail for its intended assertion; restore and pass. Include legitimate allowed controls. Keep feature tree untouched and remove only the disposable resources/processes you started.
- [ ] Run protected golden write-path and inmutabilidad unedited, preserve old fiscal assertion inventory and new exact-gross validation results. Run focused affected checks, then announce readiness for `finish-branch` and invoke the Codex skill under the lane's standing authorization.
- [ ] After initial rebase, obtain the single Claude whole-branch run-it review in an independently installed complete candidate checkout via `claude-seat.sh review-run`. Read completed findings, triage/fix with focused RED/GREEN, and inspect later rebases without repeating the full review solely for rebase. Use signed-off commits, normal push hook and required current-head CI including selected package coverage/merge jobs; no hook bypass or arbitrary whole-workspace rerun.
- [ ] Finish to a reviewable green PR, list changed test checks and exact H2 authority, traced consumer validation, dependency SHAs and unverified qualifications. This changes invoices, so park `needs-owner-review` for fiscal owner landing. Do not auto-merge. Keep campaign bookkeeping outside the repository.

## Coverage and limits

The complete spec maps to arithmetic/history (2–5), atomic money linkage (6–7), interruption/evidence recovery (8–10), A758 (11), forms/paper (12–13), reporting/guides (14) and final qualification (15). Whole cancel, F1/F3/void and ordinary-sale restrictions are preserved in Tasks 1, 3, 4 and 11. No new policy decision is requested for the three approved policies.

This document specifies a candidate contract, not a verified implementation. Exact fiscal validation, generated constraints, deployed A739/A798/A947 interfaces, live provider behavior, physical paper and cross-node operation remain unverified. Cross-node correction is outside this version. If exact-gross validation needs protected builder changes, or history/terminal discrepancies cannot be resolved without changing approved immutable facts, stop the dependent path with the concrete failing case and exact approval question. Do not publish a partial money workflow around that gate.
