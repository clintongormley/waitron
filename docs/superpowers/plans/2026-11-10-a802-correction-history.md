# A802 slice 3: read an invoice's correction history and whether it may be corrected

_2026-11-11: slices 4–5 re-planned after the owner's option A (a fix never changes amounts) — see [2026-11-11-a802-slices-4-5.md](2026-11-11-a802-slices-4-5.md)._

**Status: R1–R5 cleared by the watcher 2026-11-10 16:23 with four changes, and the owner's three
questions answered 16:26–16:28; both are written into the
[revision](#clearance-and-answers-2026-11-10-1623-1628). Slice 3b is cleared to build after this slice.**
Parts B and C were built before the runner read the owner's instruction: the watcher wrote its note
at 15:43; the runner, in a firing that started at 15:00, did not read it until 15:48; Part B
(15:15), Part C (15:22) and the review-fix round (15:47) were committed in that window. The
owner approved the first version 2026-11-10 14:33 ("approve all, no old invoices exist"), all
four choices below; the
[revision at the end](#revision-2026-11-10-second-review-and-the-owners-1543-instruction) changes
Parts B and C, adds slice 3b, and asks the owner two questions. Slice 1 (the amount calculator,
`packages/core/src/correction-allocation.ts`) landed as #2653; slice 2 (the writer files the exact
split it is given, `packages/core/src/partial-correction-breakdown.ts`) landed as #2671
(`8f6ba75dca`).

## Authority

- **Owner, 2026-10-22 ~11:50** (lane E `archive/questions-to-2026-10-23.md`, heading "OWNER ANSWER —
  A802: the protected-writer scope is APPROVED"): approves "the read-only
  `FiscalBackend.correctionAdmissionFor` with its delegated regime reader", besides slice 2's writer
  field. "No edit to the builder/append bodies, hash, number allocator, stored records or existing
  fiscal assertions."
- **Owner, 2026-10-21 ~02:30** (design approval, recorded in the
  [design](../specs/2026-10-20-a802-partial-paid-invoice-correction-design.md)): an original whose
  filing is queued, sending, accepted or accepted with errors may be corrected; one that is refused,
  stopped or held, or whose history cannot be read, may not.
- **Owner, 2026-11-09 16:45** (lane E `questions.md`): cash first; each slice about 1,000 written
  lines including tests, naming its next capability; tests at most about twice the code.
- Slice 1's plan names this slice as successor (2): "provide reconciled original facts and `consumed`
  allocations from the old plan's Task 5 history reader, including missing-gross reconstruction and
  the minimum cash history storage it needs. Never substitute an empty history or guess allocations
  for older corrections." This plan drops the reconstruction and needs no storage; see "For the
  watcher", point 1.

## What it delivers

Staff get nothing they can use yet. After this slice the server can answer two questions about a
paid simplified invoice from what is stored, with no caller supplying amounts: **does its filing
allow a correction** (settlement and the chain's integrity are slice 4's checks), and **exactly what
would a correction of €X over these lines file**, as the lines and split `recordCorrection` takes. The end-to-end test
proves the three slices fit: the history this slice reads feeds slice 1's calculator, whose split
slice 2's writer accepts and files, three times in a row on one invoice, until the last cent.

Example: a €12.10 dish at 21% (base 10.00, VAT 2.10). Asking for €6.05, then €6.02, then €0.03 gives
base 5.00 + VAT 1.05, base 4.98 + VAT 1.04, base 0.02 + VAT 0.01, each read from the invoice and the
corrections already filed; a fourth ask for €0.01 is refused because nothing is left. Today nothing in
the product can produce those figures from a real invoice.

**What is left after this slice, so staff can use it (cash only):** slice 3b (revision, section D):
a correction of an invoice whose fix changed its figures, filed at the fix's figures, which needs
the owner's approval of a change to the protected writer; and the top-sellers report counting an
amount correction as money, not dishes. Then slice 4, the cash acceptance —
a route the till calls with a submission id, permission and PIN checks, one transaction that files
the correction and records the cash refund, a replay record, the drawer job, and the AEAT
preproduction run of the final-cent shape (watcher 2026-11-09 19:42) before it lands; slice 5, the
till screen, the corrective paper and the guide.

## Part A — the history reader (core)

Create `packages/core/src/correction-history.ts` with
`readCorrectionAmountHistory(tx: Transaction, saleId: SaleId): Promise<CorrectionAmountHistory>`,
returning slice 1's `CorrectionAmountHistory` type unchanged:

- `lines`: every `sale_lines` row of the invoice, extras included: `id`, `lineNo`, `rate` (basis
  points to a two-place rate), `gross` (`line_gross`), `base` (`line_total`).
- `vatBreakdown`: the invoice's stored `sales.vat_breakdown`, as stored.
- `consumed`: every line of every sale whose `corrects_sale_id` is the invoice, whatever its filing
  state (the old plan's Task 2: "Earlier corrections consume budgets even if refused/held"):
  `saleLineId` = `corrects_line_id`, `rate`, `gross` = −`line_gross`, `base` = −`line_total`,
  `tax` = gross − base. A whole-invoice credit names every line (`apps/server/src/cancel-credit.ts`,
  `correctsLineId: row.id`), so it consumes everything and the calculator refuses any further amount.

Refusals, in this order: no such sale → `sale.not_found` (the code `recordCorrection` throws,
`record-correction.ts:146`); the sale is itself a corrective invoice → `sale.correction_history_unusable`;
an invoice line or an earlier correction's line with no `line_gross`, or an earlier correction line
naming no invoice line → `sale.correction_history_unusable`; and an earlier correction whose lines,
summed per rate, differ from its own stored `vat_breakdown` (gross from base plus tax, and base) →
the same code. The calculator reconciles the invoice and `consumed` (`correction-allocation.ts:165–232`)
but never sees earlier corrections' stored splits, which slice 2's writer checks against
(`record-correction.ts:275–280`); without this check a preview could succeed that the writer then
refuses with `sale.correction_breakdown_invalid`. Whole credits and slice 2 corrections agree by
construction; corrections filed by the legacy derived path may not.

**No missing-gross reconstruction (watcher point 1).** The design (line 136) and slice 1's plan ask
for an absent line gross to be rebuilt from the rate remainder. Every till filing path stores one:
`bill-payments.ts:749`, `till-sale.ts:1011`, `:1744`, `:1899` and `working-order.ts:7388` file
`withReceiptListPrices(priced.lines, …)`, whose `lineGross` is set at
`packages/catalogue/src/pricing.ts:162` (read 2026-11-10; confirmed by the plan review). The other
callers `git grep -n "recordSale(" -- ':!*.test.ts'` finds set no `lineGross`, and none is a
production path: the demo seeder (`apps/server/scripts/demo-seed/seed-sales.ts:300`, which refuses
production at `seed-sales.ts:173`), `apps/server/scripts/testing/sale.ts`, the fixtures in
`apps/server/src/testing/` (`backup-verification-fixture.ts`, `invoice-customer-fixture.ts`,
`order-venue.ts`, `staged-hour-crash.ts`, `synthetic-invoice.ts`) and `apps/server/test/`
(`held-setup-database.ts`, `hour-recovery-host.ts`), and
`packages/fiscal-verifactu/test/live-conflict-fixture.ts`. The one filing without it is the setup
readiness test sale (`packages/provisioning/src/fiscal-readiness-runner.ts:112`), which no one
corrects. Until go-live no data is carried forward (root CLAUDE.md §3), so such history is refused,
not rebuilt. Step 1 re-runs this search on the build base before relying on it.

Slice 2's writer keeps its own reads and checks (`record-correction.ts:236–290`): it re-checks
whatever a caller hands it, so it does not take this reader's word.

## Part B — admission (the regime decides)

As the old plan's [Task 4](2026-10-22-a802-partial-paid-invoice-correction.md#task-4-let-the-regime-decide-admission-without-teaching-core-its-tables),
the approved interface:

- `packages/fiscal/src/backend.ts`: optional
  `correctionAdmissionFor?(tx: Transaction, saleId: SaleId, issuingNodeId: NodeId): Promise<CorrectionAdmission>`
  (`issuingNodeId`: the box that would issue the correction),
  with `CorrectionAdmission` =
  `{ eligible: true; filing: "queued" | "sending" | "accepted" | "accepted_with_issues"; original: { number: string; issuedAt: string } }`
  or `{ eligible: false; reason: "unsupported" | "missing" | "wrong_node" | "voided" | "not_simplified" | "filing_refused" | "filing_versions_unusable" }`.
  A backend without the member counts as `unsupported`. Exported from the fiscal barrel.
- Create `packages/fiscal-verifactu/src/correction-admission.ts`, delegated from `VerifactuBackend`.
  It reads the sale's records in `registros_facturacion` by `sale_id`. A refused filing that was fixed
  (subsanación) leaves two altas for one sale, the second pointing at the first
  (`chain.ts:235–268`, `record-remedy-http.ts:168`), and the writer already files against the latest
  (`fiscal-verifactu/backend.ts:520–529`); admission does the same: it judges the **latest alta
  version** and **that version's** `envios.estado`. Eligible only for an F2 (simplified) alta filed by
  this node, with no cancellation (anulación) carrying the sale's `sale_id`, whose latest submission
  is `pendiente`/`enviando`/`aceptado`/`aceptado_con_errores` (the four `filing` values).
  `rechazado`, `detenido`, `retenido` → `filing_refused`; no alta or no submission → `missing`;
  another node's → `wrong_node`; F1, F3 or an R type → `not_simplified`; a cancellation → `voided`
  (it covers core voids, written in the same transaction, `record-void.ts:88,103`, and the remedy
  path's cancellation, which writes no `sale_voids` row, `record-remedy-absent.ts:134`;
  `recordCorrection`'s `sale_voids` check, `record-correction.ts:150`, stays the writer's backstop);
  versions that do not form one line of fixes → `filing_versions_unusable`. A zero-total invoice is not
  admission's concern: the calculator refuses an amount when nothing has value.
- **(Superseded by the clearance's point 1: a separate `filedFiguresFor`; admission unchanged.)**
  **Revised 2026-11-10 (finding 1).** The eligible answer also carries `filed: { total: Decimal;
  vatBreakdown: VatBreakdownLine[] }`, the judged version's total and split read from the same row
  (`desglose`, `importe_total`, `cuota_total`), the same figures for the latest version of each
  earlier corrective invoice core names, and a new refusal reason `filed_figures_unreadable`.
  Rules in the revision, section A.
- **Substitution is read in core, not the regime.** The regime stores it only inside the F3's
  `facturas_sustituidas`, which no index covers (the plan review's EXPLAIN: a scan of every record),
  while core's `sale_substitutions` has a unique index on `substituted_sale_id`. `recordCorrection`
  does not check substitution, so Part C refuses a substituted invoice (`reason: "replaced"`) from
  that table before asking the regime.
- `packages/fiscal-none/src/backend.ts` returns `unsupported`; the fake backend in
  `packages/fiscal/src/testing/fake-backend.ts` returns a result the test sets, eligible by default.
- No change to `recordCorrection`, the record builders, chain append, hash, numbering or any stored
  row. `checkIntegrity` and settlement are not admission's: slice 4's service checks them, as the old
  plan's Tasks 4 and 7 say.

## Part C — one entry point, and the proof the slices fit

In `correction-history.ts`, `previewCorrectionAmounts(tx, backend, saleId, issuingNodeId, selection)`:
the substitution check, then admission (an ineligible result, or a substituted invoice, throws
`sale.correction_not_admitted` with `{ reason }`, a new code beside slice 1's), then the reader, then
slice 1's `allocateCorrectionAmounts`. It returns the calculator's `CorrectionAmountPreview`, the
admission's `filing` and `original`, and the correction's `lines: RecordSaleLine[]` ready for
`recordCorrection`: one per allocation, copying every field the whole-invoice credit copies
(`apps/server/src/cancel-credit.ts:83–117`, checked by `satisfies Required<RecordSaleLine>`), so the
category, reporting classification, product, parent product, menu and kitchen name are kept
(finding 2, built in Part C's first build); `quantity` the negated invoice
line's quantity (an amount correction's quantity is the scope shown, never units returned, as
slice 2's plan says); `lineTotal` −base, `lineGross` −gross, `listGross` null (a part of a line has
no list gross), `correctsLineId` the invoice line. **Revised 2026-11-10:** after admission, the
preview compares the filed figures with the stored ones, for the invoice and for each earlier
corrective invoice of it; when any differ it refuses with
`sale.correction_not_admitted { reason: "filed_figures_changed" }` until slice 3b files such a
correction at the fix's figures (revision, section A). The
end-to-end test and slice 4 both file exactly these, so neither invents its own. Export it and
`CorrectionPreview` from `packages/core/src/index.ts` (the admission type is exported by
`@waitron/fiscal`): slice 4's server service is its production
consumer and the end-to-end test in `fiscal-verifactu` needs it (slice 1 kept the index unchanged
until a consumer existed; this is the point where one does).

## Files and size

Create `packages/core/src/correction-history.ts` and its `.test.ts`;
`packages/fiscal-verifactu/src/correction-admission.ts` and its `.test.ts`;
`packages/fiscal-verifactu/src/filed-figures.ts` (tested in `correction-admission.test.ts`);
`packages/fiscal-verifactu/src/correction-history.e2e.test.ts`. Modify `packages/fiscal/src/backend.ts`
(+ barrel), `packages/fiscal-verifactu/src/backend.ts` (one delegating member),
`packages/fiscal-none/src/backend.ts`, the fake backend, `packages/core/src/errors.ts` (one code),
`packages/core/src/index.ts`. No schema, no migration, no generated files.

**Revised 2026-11-10:** built so far, 347 code lines and 877 test lines (`git diff --numstat
origin/main...HEAD`, plan excluded); the revision adds about 65 code and 150 test lines (section D),
about 1,440 in all, past the 1,400-line stop unless step R4's cuts land (section D says what moves).
Tests are already about 2.5 times the code, past the owner's "at most about twice"; the lane cuts
cases another test covers before landing and, if it cannot reach about twice, says so in the PR.

**Budget: about 380 code lines, about 700 test lines, about 1,100 total** (raised after the plan
review added fixed originals, the core substitution check, the earlier-split check and the line
builder). Stop for an outside opinion past 1,400 written lines or tests past twice the code. If Part B alone passes about 450 lines, split
it into its own PR at the `CorrectionAdmission` interface and say so in questions.md first.

**2026-11-10 (watcher, 18:35):** the stop is now about 2,100 written lines, plan excluded.

## Steps (test first; implementer dispatches at medium)

1. **Re-check the premises on the build base.** Re-run the `recordSale(` caller search above and the
   `lineGross` source; confirm no production caller files a line without it besides the readiness
   test sale. Run the golden pair and slice 1–2 suites unedited as the baseline.
2. **Reader, failing first** (`correction-history.test.ts`, `useVenueDb`, real core writers): an
   invoice with two rates and an extra line; read with no corrections (empty `consumed`), after a
   slice 2 exact correction (its lines consumed per invoice line, exact cents), after a whole-invoice
   credit (all consumed). Table refusals, each a one-field change to a history the same test reads:
   unknown id, a corrective invoice's id, an invoice line with null gross, an earlier correction line
   with null gross, one naming no line, an earlier correction whose lines disagree with its own stored
   split at one rate. The line builder: frozen facts copied, signs, quantity, `correctsLineId`, an
   extras line keeping its rate. One case per property; the calculator's reconciliation is not
   re-tested here.
3. **Admission, failing first** (`correction-admission.test.ts`, real Verifactu backend and
   migrations): an F2 in each of the seven submission states (four eligible with their `filing`, three
   `filing_refused`); a refused F2 fixed by a subsanación whose new version is queued (judged on the
   new version); cancelled by a core void and by the remedy path's cancellation; F1; an R5; another
   node's; no record. In core, a substituted invoice refused before the regime is asked. (As built,
   the remedy-path cancellation case was cut under the owner's 2026-11-09 test rule: the core-void
   case covers the branch, and `record-remedy-absent.test.ts` asserts the sale's id on that
   cancellation.) Each
   refusal beside an eligible control that differs in one fact. fiscal-none and the fake: one case
   each. Guards: `scripts/module-seams.test.ts`, `packages/fiscal/src/no-regime-vocabulary.test.ts`.
   **Revised 2026-11-10:** the filed figures and their refusal (revision, section D, step R1).
3a. **The preview, Part C, failing first** (in `correction-history.test.ts`, the fake backend):
   an admitted preview returns the admission's `filing`, `original` and the built lines; no regime
   member answers `unsupported`; a substituted invoice is refused before the regime is asked
   (all built in Part C's first build). **Revised 2026-11-10:** filed figures that differ from the
   stored ones are refused (section D, step R2).
4. **End to end, failing first** (`correction-history.e2e.test.ts`, real core writers, real Verifactu
   backend, the library's `validate`): the €12.10 invoice above, three rounds of
   `previewCorrectionAmounts` then `recordCorrection` with the preview's own lines and split; assert each stored and filed
   figure exactly, then the €0.01 refusal. Ten €1.20 coffees at 21%, each on its own line (base 9.90, VAT 2.10; one line of quantity 10 would store base 9.92): €11.98 then
   €0.02, the last filing base 0.00, VAT −0.02. A refused original (`rechazado`) is refused by the
   preview before any read of history. The original sale, lines and record are unchanged throughout.
5. **Nothing else moves.** Golden huella and `inmutabilidad` unedited
   (`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` and
   `… inmutabilidad`); slice 1's `correction-allocation.test.ts`, slice 2's
   `partial-correction-breakdown.test.ts` and `partial-correction-gross.e2e.test.ts`,
   `record-correction.test.ts`, `correction-path.e2e.test.ts`, `correction-amount.huella.test.ts`
   unedited; `scripts/errors-reachable.test.ts`, `scripts/alert-codes.test.ts`; typecheck core,
   fiscal, fiscal-verifactu, fiscal-none and apps/server (the backend interface widens).
6. **Plans of the new reads.** EXPLAIN each new query on a migrated database with no planner
   statistics; only one that does not use the index its `where` names gets `indexed by` and a plan
   test, as #2704 did (root CLAUDE.md §3, A1469). The plan review found every by-sale record read
   already picks `registros_sale_idx`, so none is expected. This slice does not depend on #2711.

## Left out

No route, screen, paper, refund, drawer, replay record or permission check (slice 4–5). No
reservation of capacity: cash acceptance files and refunds in one transaction, so nothing waits
between preview and filing. No Items mode, A758 link, card refund or historical gross rebuild. No
change to slice 2's writer or slice 1's calculator in this slice; slice 3b asks to change the
writer (revision, section A).

Demo-seeded sales and the server test fixtures above store no line gross, so the reader refuses
them. Slice 4 gives the fixtures its tests use a line gross (a fixture gaining a missing field). The
demo seeder also splits VAT per rate from summed bases, and its golden file
(`seed-sales.golden.test.ts`) forbids re-recording, so making demo sales correctable is a question
for the owner when slice 5's screen is planned.

## For the watcher

1. **No missing-gross reconstruction.** Slice 1's plan and the design (line 136) require it, and the
   lane rejected the refuse-instead alternative on 2026-11-09 for that reason (lane E `questions.md`
   line 116: "its nullable-gross refusal alternative is not adopted because the design requires
   reconciled reconstruction in the later history slice"). I recommend reversing that: every till filing path stores the gross (receipts in Part A),
   so the rebuild could only ever run on the setup readiness test sale or on data from before a venue
   reset, and root CLAUDE.md §3 forbids carrying such data forward before go-live; after go-live every
   invoice has one. Such history is refused with `sale.correction_history_unusable`. The design gets a
   dated pointer. The alternative is to build the receipt reader's remainder rule
   (`apps/server/src/transaction-receipt.ts:40–65`) into core here, about 60 more lines.
2. **A fixed original.** A refused filing fixed by a subsanación is judged by its newest version: if
   that is queued, sending or accepted, it may be corrected. I recommend this (it is what the writer
   already files against); the alternative is to refuse any invoice ever refused.
3. **Admission in this slice.** The queue names this slice "read an invoice's history"; I have added
   the approved admission reader because slice 4 needs both, the end-to-end proof calls both, the owner
   asked for slices of about 1,000 lines rather than many small PRs, and both are read-only. The
   alternative is the reader and Part C without admission (about 550 lines) and admission inside
   slice 4. I recommend this plan as written.
4. **Landing.** Like slices 1 and 2, staff cannot use this slice. The owner's 18:06 permission to land
   a foundation on its own named slice 1, and the 19:57 one slice 2. I recommend this one lands on its
   own too, owner-landed; the alternative is to hold it open until slice 4.

**Plan review, 2026-11-10 (fresh-context Opus, lane L).** It read the design, the old plan, both
landed slice plans and the code, and ran slice 1's calculator on every figure above: all match. Its
three high findings (fixed originals refused, the dropped reconstruction hidden in a quote, an
unindexed substitution lookup) and four medium ones (cancellation mapping, earlier corrections'
stored splits, a dependency on unlanded #2711, the line builder) are written into this revision.

## Revision 2026-11-10 (second review and the owner's 15:43 instruction)

**Inputs.** The second review, `~/waitron-campaign-l/receipts/a802-slice3-fable-review.md`
(findings 1–8, read against Part A's first build only). The owner's instruction,
`~/waitron-campaign-shared/desk/done/20261110-1543-a802-slice3-fable-review.md` and lane L
`questions.md` "WATCHER 2026-11-10 15:43". The owner's words: "I'm not sure what you mean here.
what would you be refusing, because we need to be able to do the refund, albeit with the right VAT
figures", then "y" to: every correction is measured against the latest version the tax agency
accepted; where a fix changed the split or total, the amounts and rates at each VAT rate come from
that fix, not the frozen sale rows; a full refund then nets every rate at the agency to zero. A
fresh-context review of this revision's first draft found one critical and three
important gaps; they are written in below.

### Clearance and answers (2026-11-10 16:23–16:28)

Lane L `questions.md`, "WATCHER 2026-11-10 16:23" (a watcher decision for slice 3) and the owner's
answers relayed at 16:26, 16:27 and 16:28 (`~/waitron-campaign-shared/desk/done/20261110-1623-L-a802-q1-fixed-invoice-refund.md`,
`…-q2-returned-dishes-vat.md`, `…-q3-refund-before-aeat-answers.md`). They override anything below
that disagrees.

1. **One read of the filed figures, `filedFiguresFor`, built in R1** and shared by the preview
   (slice 3) and the writer (slice 3b). `correctionAdmissionFor` is not widened: it keeps its
   current answer. Shape, in `@waitron/fiscal` beside `CorrectionAdmission`, in neutral terms:
   `filedFiguresFor?(tx, saleIds: readonly SaleId[]): Promise<ReadonlyMap<SaleId, FiledFigures>>`,
   where `FiledFigures` is `{ readable: true; newest: FiledVersionFigures; newestAnswered:
   FiledVersionFigures | null } | { readable: false }` and `FiledVersionFigures` is `{ total:
   Decimal; vatBreakdown: VatBreakdownLine[] }`. **Newest** is the version admission judges (the
   one alta of the sale no other alta names in `corrects_registro_id`); **newest answered** is the
   newest version in that line of fixes whose submission is accepted or accepted with errors, or
   null. A sale with no alta is absent from the map. `readable: false` when the sale's altas do not
   form one line of fixes, or when either version's `desglose` is not the shape `toDetalleDesglose`
   writes (`fiscal-verifactu/src/backend.ts:146–154`): a detail with an exemption, a not-subject
   amount, an equivalence surcharge, another tax or regime, or a missing rate or VAT amount; two
   details at one rate; or details whose bases plus VAT do not equal `importe_total`, or whose VAT
   does not equal `cuota_total`. One query for all ids, through `registros_sale_idx`. fiscal-none
   leaves it out (admission already answers `unsupported` there); the fake backend answers from the
   stored `sales.total` and `sales.vat_breakdown` for both versions, with a setter to override one
   sale. (As built: one query per 1,000 sale ids, and the fake backend answers from its own filed
   records; see [As built](#as-built-2026-11-10).)
2. **Option C is dropped** from question 1, and with it design point 3's "slice 4 … ships with this
   refusal": the owner rejected refusing ("we need to be able to do the refund"). The refusal of a
   moved invoice is slice 3's only, until slice 3b.
3. **Slice 3b's tests**: end to end, only the replay (21% filed, refused, fixed to 10%, full refund,
   every rate zero) and one part refund. The queued-fix refusal, the part amount refused when the
   fix changed the total, and the control where the fix kept the figures are tested ONCE each, in
   core, with the fake backend (the owner's 9 November test rule).
4. **Owner's answers.** Q1 **A**: the protected writer reads the figures AEAT accepted, through
   `filedFiguresFor` (the protected-writer approval for slice 3b; cite the Q1 file in its PR). Q2:
   **keep the running split**; no change (cite the Q2 file in the PR). Q3: **allow** a correction
   while the invoice's filing is queued or sending, as the 21 October design says, moved or not,
   measured against the newest version; a moved invoice whose newest version is a fix not yet
   answered is still refused in slice 3b (point 3's queued-fix case), because nothing has yet been
   accepted to measure against. The limit, in one line: **a refund filed before AEAT refuses the
   sale, whose fix then changes its VAT split, stays out of balance at AEAT and nothing repairs
   it.**

**Slice 3 after this clearance.** `previewCorrectionAmounts`: substitution check → admission (as
built) → read the earlier correctives' ids → `filedFiguresFor` for the invoice and each corrective
→ any id absent or `readable: false` refuses `sale.correction_not_admitted { reason:
"filed_figures_unreadable" }`; any whose **newest** figures differ from its stored ones (rates, base
and VAT at each rate to the cent, total) refuses `{ reason: "filed_figures_changed" }` → the
calculator as built. `newestAnswered` is unused until slice 3b.

**Words used.** The **split** is the base (price before VAT) and the VAT at each VAT rate. A
**corrective invoice** is the new negative invoice that takes value off an earlier one (type R5).
A **fix** is a second version of a filing the agency refused (or accepted with errors), sent again
with corrected contents (in Spanish, a subsanación). **Admission** is the tax regime's answer to
"may this invoice be corrected?" (Part B). The **stored figures** are Waitron's own
`sales.vat_breakdown`, `sales.total` and `sale_lines` for a sale, written once and never changed.
The **filed figures** are the total and split of a sale's latest filed version. A sale is **moved**
when its filed figures differ from its stored ones. An **answered** version is one the agency has
accepted, with or without errors. The **writer** is slice 2's `recordCorrection`; the
**calculator** is slice 1's `allocateCorrectionAmounts`.

### A. Finding 1: every correction is measured against the filed figures

**What I ran** (temporary tests in `packages/core`, deleted; `git status` clean after each):

- The writer's two split checks on a €12.10 dish stored at 21% and fixed to 10%. Lines at 10% with
  a 10% split: `checkPartialCorrectionBreakdown` accepts, then `checkPartialCorrectionHistory`
  refuses with `sale.correction_breakdown_invalid` (a line's rate must be its invoice line's,
  `partial-correction-breakdown.ts:146`). Lines at the stored 21% with a 10% split:
  `checkPartialCorrectionBreakdown` refuses with the same code (lines must sum to the split at each
  rate, `:81–103`). Had the writer accepted the fix's rate, either would have printed "passed".
- The calculator given the stored 21% line and the fix's 10% split refuses with
  `sale.correction_history_unusable` (`correction-allocation.ts:190–206`). Given instead one
  stand-in line per filed rate (10%: base 11.00, VAT 1.10; 21%: base 10.00, VAT 2.10), it took
  €5.00, €7.77 and €11.43 as `[10%: 2.27/0.23, 21%: 2.07/0.43]`, `[3.54/0.35, 3.20/0.68]`,
  `[5.19/0.52, 4.73/0.99]`, ending at exactly 11.00/1.10 and 10.00/2.10, and refused one more cent
  (`sale.correction_amount_invalid`). The landed calculator needs no change to work per rate
  against a fix's split.
- The reviewer's gap in the writer, re-run: `checkPartialCorrectionHistory` with the invoice split
  10% 11.00/1.10, an earlier correction at 21% (−5.00/−1.05) and a new 10% correction
  (−5.50/−0.55) **passes**; the control with the 10% budget already used refuses
  `sale.correction_breakdown_invalid`. Its per-rate loop runs only over the new split's rates
  (`partial-correction-breakdown.ts:163–181`), so an earlier correction at another rate is never
  compared.
- The older derived path's VAT working, re-run: `deriveVatBreakdown("-6.05", [one 10% line, base
  −5.50])` gives `[10.00, −5.50, −0.55]`, and `deriveVatBreakdown("-12.00", [one 10% line, base
  −11.00, gross −12.10])` returns a split summing to −12.10 with no refusal
  (`record-sale.ts:148–158`, from `e56323007c`, #982, 2026-10-01). The reviewer ran the whole
  unchanged writer on that path (I did not): two €6.05 corrections of a 21% invoice, lines naming
  its line, each stored `[10.00, −5.50, −0.55]`, netting a fix's 11.00/1.10 exactly; one more cent
  refused with `sale.correction_exceeds_total`; and a corrective of total −12.00 with lines summing
  −12.10 accepted.

**Where the fix's figures live.** The fix route accepts any filed invoice record (`alta`) of this
box's history, corrective invoices included (`fiscal-verifactu/src/record-remedy-http.ts:56–62`),
builds the new version's `Desglose` (the split as the agency receives it), `CuotaTotal` (VAT total)
and `ImporteTotal` (invoice total) from the administrator's facts, falling back to the earlier
version's (`:129–131`), and links it to the version it replaces (`:168`; chain check
`chain.ts:235–268`). They are stored on that row of `registros_facturacion` (`desglose`,
`cuota_total`, `importe_total`, `schema/registros.ts:83, :90–91`). Nothing changes `sales` or
`sale_lines` (the review's run: the stored split stayed `[21.00, 10.00, 2.10]` after the fix). The
regime already turns a stored `Desglose` back into the neutral `VatBreakdownLine` (rate, base, tax)
for receipts (`fiscal-verifactu/src/backend.ts:408–416`, the inverse of `toDetalleDesglose`,
`:146–154`), for the FIRST version only (`:396–397`).

**A fix of an earlier corrective invoice (the review's critical finding).** What earlier corrections
took is read from each corrective's stored split, by the reader (`readHistory` in
`correction-history.ts`) and by the writer (`record-correction.ts:275–280`), never from what was
filed. A part corrective refused by the agency (plausible for the final-cent shape, base 0.00 with
VAT only) and fixed with
different figures is then counted at its old figures, and a full refund leaves rates off zero. So
every check below covers the invoice AND each earlier corrective of it.

**Design.**

1. **(Superseded by the clearance's point 1: a separate `filedFiguresFor`, admission unchanged.)**
   **The regime returns filed figures with admission** (slice 3). Core first reads the ids of the
   invoice's earlier corrective invoices (it already reads them, in `readStored`;
   the read moves before admission) and passes them to `correctionAdmissionFor`. Admission already
   reads the invoice's rows and picks its latest version (`correction-admission.ts:28–52`); it now
   also reads that row's `desglose`, `cuota_total` and `importe_total`, and the same for the latest
   version of each named corrective (each by its indexed `sale_id`, so the regime never reads core's
   correction column), and returns them on an eligible answer as `filed: { total, vatBreakdown }`
   and `filedCorrections: { saleId, total, vatBreakdown }[]`, in the neutral `VatBreakdownLine`
   type `@waitron/fiscal` already exports (`packages/fiscal/src/vat-breakdown.ts:5`). No Veri*Factu
   word reaches core; `scripts/module-seams.test.ts` and
   `packages/fiscal/src/no-regime-vocabulary.test.ts` stay as they are. A version whose split
   Waitron cannot express is refused with the new reason `filed_figures_unreadable`: any detail
   other than the shape `toDetalleDesglose` writes (an exemption, a not-subject line, equivalence
   surcharge, another tax or tax regime, a missing rate or VAT amount), two details at one rate, or
   details that do not sum to `ImporteTotal` and `CuotaTotal`. This stays inside the owner's
   2026-10-22 approval of a read-only admission member with its regime reader (Authority, first
   bullet); the watcher should say if it reads otherwise.
2. **Core compares** (slice 3, in `previewCorrectionAmounts`): for the invoice and each earlier
   corrective, the same rates, at each rate the same base and VAT to the cent, and the same total.
   When nothing is moved (every sale never fixed, and every fix that kept the figures) the path
   already built runs, unchanged: the writer's checks against stored splits are then checks against
   filed ones.
3. **Anything moved is refused in slice 3** (`sale.correction_not_admitted`, reason
   `filed_figures_changed`). No member of staff meets this refusal before slice 4 (nothing files a
   correction from the till until then), and slice 3b, which the owner chose, lifts it first.
4. **Slice 3b, design A (recommended): file at the fix's figures through a changed writer.**
   - **When.** A moved invoice is admitted only once its fix has the agency's answer (accepted, or
     accepted with errors). Measuring against a fix still queued is not harmless: if the agency
     then refuses the fix, it holds the earlier version or nothing, and a corrective filed at the
     fix's figures leaves rates unbalanced with no repair. An invoice never moved stays correctable
     while queued or sending, as the approved design says. Moved correctives are counted at their
     answered version's figures the same way.
   - **The split** comes from the filed figures. The calculator runs over one stand-in line per
     filed rate (the probe above); what earlier corrections took at each rate is read from their
     filed figures, not their stored splits.
   - **The lines** stay Waitron's own record of what goes back for which dish: the calculator's
     allocation over the stored invoice lines for the same amount, at those lines' stored rates,
     with finding 2's field set. The agency never sees lines (the corrective's `Desglose` is built
     from its split alone, `backend.ts:545`); receipts and reports read them. The corrective's
     lines and split then disagree rate by rate, as the fixed invoice's own lines disagree with its
     accepted version. Both ledgers reach zero together: the agency's at every rate, Waitron's on
     every line, so the category and top-sellers reports net to zero on a full refund.
   - **Capability cuts** (both depart from the owner's 18 October scope, "Select wrong lines and
     quantities, or enter an amount"; the owner's question below asks about them): on a moved
     invoice staff cannot choose dishes, because the fix's split does not say which dish went to
     which rate (only an amount, spread over the rates in proportion to what is left at each, or the
     full refund; a request naming lines is refused with `sale.correction_scope_invalid { reason:
     "filed_figures_changed" }`); and when the fix changed the total, only the full refund is
     offered (for example a fix to 10%, base 10.00, VAT 1.00, total €11.00 on a sale stored and paid
     at €12.10: the corrective files −10.00/−1.00, total −€11.00, and takes all −€12.10 of the stored
     lines; a part amount is refused, since no rule says how much of each ledger a part takes). The
     cash handed back is the corrective's total; whether it may differ from what the customer paid
     is slice 4's settlement question, put to the owner in its plan.
   - **What "consumed" means.** Two budgets: at each rate, what earlier correctives took by their
     filed figures; on each invoice line, the sum of earlier correction lines' gross
     (`partial-correction-breakdown.ts:128–141`). Not moved, they agree (the reader's check in
     `readHistory`). Moved, they are kept separately and the reader skips that
     agreement check. An earlier correction at a rate the filed split lacks (filed before a fix
     that moved the split) is refused with `sale.correction_history_unusable`: the calculator finds
     no stand-in line for its rate (`correction-allocation.ts:207–217`, the test at `:210`), and the
     writer must refuse it too (scope point 4b; today it does not, as the run above shows). The
     agency's figures are then already out of balance; the administrator's fix screen is where that
     is repaired. Rare, and nothing wrong is filed.
5. **Slice 3b, design B (no protected change): full refund only, through the older derived path.**
   Core builds one line per filed rate at that rate, its base the rate's remaining filed base,
   naming an invoice line, and passes no split; the unchanged writer works out each rate's VAT by
   rounding its base (`record-sale.ts:126–138`). Core refuses when the fix's remaining VAT is not
   what that rounding gives (the final-cent shape, base 0.00 with VAT only, never is) or when the
   total moved. Cost: no part amounts and no dish choice on a moved invoice; Waitron's lines put
   all the money on the named dish; and that path re-checks almost nothing, as the runs above show
   (a −12.00 corrective with −12.10 of lines was accepted; that weakness is from `e56323007c`,
   #982, 2026-10-01, and this branch does not touch it).

**Why design A changes the writer.** The writer's three paths cannot file a split other than the
stored one with its exactness checks: the part path refuses (the runs above); the whole-invoice path
files the stored split negated (`record-correction.ts:138, :454–458`, read, not run); the derived
path works out VAT by rounding and checks nothing against the invoice (design B lives with that).

**Reports and reprints (outside A802).** The modelo 303 VAT return reads the filed per-rate sum
"over the filed `sales.vat_breakdown`" (`packages/reporting/src/vat-return.ts:14–16`, through
`vat-summary.ts:54, :64`, since `4cd53ebb21`, 2026-09-25), so it shows a fixed invoice's first
version, not the accepted one; a reprinted receipt does too (`backend.ts:396–397`, since
`fe080412c5`, 2026-11-02). Both predate this branch. After slice 3b, a full refund of a moved
invoice nets to zero at the agency, but the VAT return shows the original at its old rate and the
corrective at the new one. Not A802's to fix (a wrong VAT return could cost a filing): the watcher
queued it at 16:26 as its own item, A1481, in lane L after slice 3b, its backlog entry to come with
its first pull request; `docs/backlog.md` does not name it yet. The derived path's weakness joins
the A802 bundle in `docs/backlog/fiscal.md` ("Nothing in the product can issue a corrective
invoice…") when slice 3b lands.

**The tests.**

- Slice 3 (step R5, in `correction-history.e2e.test.ts`): the real fix route moves a sold
  invoice's split to 10%, then the preview refuses with `filed_figures_changed`.
- Slice 3b (`packages/fiscal-verifactu/src/correction-filed-figures.e2e.test.ts`: real core
  writers, the real Veri*Factu backend, the real fix route as `record-remedy-http.test.ts` drives
  it, the library's `validate`), design A:
  - The review's experiment replayed: a €12.10 dish filed at 21%, refused, fixed to 10% (base
    11.00, VAT 1.10, total unchanged), the fix accepted; then a full refund. The corrective's split
    is `[10.00, −11.00, −1.10]` with no 21% line; `validate` finds nothing; summing the accepted
    version and every corrective at each rate, every rate ends at exactly zero. The invoice line
    ends at zero gross; one more cent is refused.
  - A part correction of the same invoice: €6.05 then €6.05, each 10% −5.50/−0.55, every rate zero
    at the end; a request naming a line is refused.
  - The same invoice with its fix still queued: refused until the fix is accepted.
  - The fix changed the total (10%, 10.00/1.00, €11.00): a part amount is refused; the full refund
    files −10.00/−1.00, total −€11.00, its lines −€12.10; every rate at the agency zero.
  - A part corrective refused and fixed to different figures: the next preview and the writer
    count the fix's figures, and a final full refund leaves every rate at zero.
  - Control: a fix that kept the figures takes the ordinary path, choosing dishes allowed.
  - With scope point 5 approved: cancelling an order whose moved invoice was issued files the fix's
    split.

**Size.** Slice 3: about 65 code and 150 test lines added (section D). Slice 3b, finding 1's part
(design A): about 150 code (writer and checkers about 60, the regime member about 20, core's moved
path about 60, the answered-version rule about 10) and 400 test lines (the end-to-end file about
230, writer and checker cases about 110, core about 60).

### The owner's questions

**Question 1: how may a correction of a fixed invoice whose figures changed be filed?**

- **A (recommended): change the protected writer** as listed below; part amounts and full refunds
  at the fix's figures, every rate exact.
- **B: no protected change**; full refund only, at the fix's figures, through the older derived
  path, refused when rounding cannot give the fix's figures or the total changed; that path's
  weak checks (above) stay.
(Option C, keeping such invoices refused, was dropped by the watcher at 16:23; the owner chose A.)

Under A or B, two cuts from the owner's 18 October scope ("Select wrong lines and quantities, or
enter an amount"): no choosing dishes on a moved invoice, and only the full refund when the fix
changed the total. And slice 3b's tests come to about three times its code (about 400 against 150
under A), past the owner's "at most about twice", because the replay the owner asked for is about
230 lines on its own: may 3b exceed it, or should the replay drop its control and queued cases?

**The exact writer change under A, and nothing else** (no change to the record builders, chain
append, hash, numbering, stored rows or the corrective's filing shape):

1. **(Superseded by the clearance's point 1 and [As built](#as-built-2026-11-10): built in slice 3,
   answering the newest and the newest answered version.)** A new optional, read-only fiscal
   backend member, `filedFiguresFor(tx, saleIds)`, returning for
   each sale the figures of its newest **answered** version, or nothing when no version is
   answered; the regime answers it with admission's reader. The writer cannot use admission: the
   existing administrator path files corrective invoices against refused filings on purpose
   (`fiscal-verifactu/src/record-remedy-corrective.ts:118–134`), which admission would refuse.
2. In `recordCorrection`, when the invoice is moved, use its filed total in place of `sales.total`
   for the "more than is left" check (`record-correction.ts:211–226`) and its filed split in place
   of `sales.vat_breakdown` as the split the part check measures against (`:272`); and for every
   earlier corrective, use its filed split in place of its stored one (`:275–280`). This also
   changes the administrator path, which calls `recordCorrection`
   (`record-remedy-corrective.ts:134`): a sale with no answered version gives nothing, so a
   corrective against a never-accepted invoice keeps today's stored figures; one whose fix was
   answered is measured against the fix.
3. Move the per-rate agreement of lines and split out of `checkPartialCorrectionBreakdown`
   (`partial-correction-breakdown.ts:81–103`) into the history check, which knows whether the
   invoice is moved; for a moved invoice it no longer applies. `checkPartialCorrectionBreakdown`
   runs before any database read (`record-correction.ts:117–125`), so a corrective whose lines and
   split disagree is refused later than today, after the sale, series, permission and
   line-on-invoice checks; the documented refusal order (`:94–110`) changes with it. Each side
   still holds on its own: the split's signs and its sum equal to the total; every line naming a
   different invoice line at that line's own rate, within what is left of it.
4. In `checkPartialCorrectionHistory`: (a) where the filed and stored totals agree, the lines'
   gross must equal the total; where they differ, the correction must empty both the filed split
   and the stored lines (this needs the history, so it lives here, not in the check of point 3);
   (b) compare every rate any earlier corrective used, not only the new split's rates
   (`:163–181`), refusing a rate the invoice's split lacks. This relaxes and changes existing
   fiscal checks, which the 2026-10-22 approval ("no edit to … existing fiscal assertions") does
   not cover; hence this question.
5. Optional, recommended: the whole-invoice credit (`record-correction.ts:435–488`), used when an
   order whose invoice was issued is cancelled (`apps/server/src/cancel-credit.ts:68–79`), files the
   filed split negated for a moved invoice and skips its line-against-split check at each rate; its
   lines still reverse the invoice line for line (`:266–268`). Without it, cancelling such an order
   files the old figures, finding 1's defect in a feature outside A802 (read, not run). About 10
   more code lines.

**Question 2 (finding 5): when staff return whole dishes, should the corrective give back those
dishes' own stored VAT, or the running split at each rate (what is built)?**

Ten €1.20 coffees at 21%, each stored at base €0.99 and VAT €0.21 (invoice: base €9.90, VAT €2.10).
Staff return five whole coffees, €6.00.

- **Running split (built, slice 1; the approved design, lines 150–156):** files base −€4.96, VAT
  −€1.04; one coffee's correction line holds base −€1.00 against its €0.99. Fifty €0.04 sweets
  (each €0.03 + €0.01): returning half, €1.00, files −€0.83/−€0.17 where those 25 were charged
  €0.75/€0.25; if the rest is never returned, the venue has declared €0.08 more VAT on them than
  their receipt lines show. Every rate still ends exact when everything is returned, and both
  figures are valid 21% splits at the agency. Cost: nothing.
- **Dishes' own figures:** files −€4.95/−€1.05, matching what those coffees were charged. Cost: it
  breaks what follows. I ran the built calculator after such a return: one more cent is refused
  (`sale.correction_history_unusable`, because the running rule then works out a base larger than
  the cent), and the next whole coffee files €1.00/€0.20, so the cent of difference comes back one
  step later. Doing it properly means a different rule for every later correction (measured from
  each line's own figures), a change to slice 1's landed calculator, and another protected change
  to the writer's base check (`partial-correction-breakdown.ts:170–180`): about 60 code and 120 test
  lines.

**Recommendation: keep the running split.** The difference is a few cents on a part-returned bill,
every rate ends exact, the agency accepts both, and the alternative reopens two landed slices.

### B. Findings 2–8

| Finding | Response | Where | Status |
| --- | --- | --- | --- |
| 2. Correction lines lost category, product and menu | The builder copies the whole-invoice credit's field set, checked by `satisfies Required<RecordSaleLine>` (`correctionLinesFor`); its test in `correction-history.test.ts` asserts every field. `listGross` stays null on purpose: only the receipt reads it, to print comps and discounts beside a full invoice's lines (`apps/server/src/receipt-adjustments.ts:51–82`); no report reads it (`git grep` of `packages/reporting`); a negated whole-line list price on a part correction would overstate. `listUnitPriceGross`, a frozen unit price, is copied. One gap remains: an extra corrected without its dish gets no parent (`correctionLinesFor`'s `parentLineNo`), so when the category report folds extras into their dishes it files that extra under its own category (`packages/reporting/src/category-sales.ts:226–231`). Slice 3b step S5 has the report fall back through the corrected invoice line to its dish. That the report now places the money under the dish's category is read, not run; S5's test asserts it. | Part C; slice 3b S5 | Done, one gap planned |
| 3. Amount corrections take whole quantities off top sellers | Only the top-sellers report reads correction quantities (`packages/reporting/src/top-sellers.ts:18–19, :46`). The other readers of `sale_lines.quantity` are the order list, which lists no corrective invoice (`apps/server/src/orders-list.ts:192, :684, :875`), and the writer's own check (`record-correction.ts:244`); the category report reads money and category only (`category-sales.ts:202–207`). Rule: per corrected invoice line, the correction whose running sum of gross completes that line's money counts as its dishes returned (minus the line's quantity); every other correction line changes money, never dishes. So €6.05, €6.02 and €0.03 off one steak return the steak with the third. A line with no stored gross (a whole-invoice credit of an invoice whose lines have none) counts when its line total completes the line's, so such a credit still counts its dishes as returned. Lines naming no invoice line (older administrator corrections) count as today. Stored facts are enough (`corrects_line_id`, `line_gross`, `line_total`, `quantity`): no schema change, which the A1308 table hold would block. A future mode choosing dishes and quantities would store which units went back and replace this rule. About 20 code and 70 test lines, with a category assertion. Slice 3b, not slice 3 (slice 3 is already at its stop). | Slice 3b, step S5 | Planned |
| 4. Demo sales store no line gross | Checked: `apps/server/scripts/demo-seed/seed-sales.ts:255–278` files lines with no gross and works out each rate's VAT from its summed base (`:136–145`), so every demo invoice is refused with `sale.correction_history_unusable`. The golden test forbids re-recording to make it pass (`seed-sales.golden.test.ts:6–8`). Options: (a) leave demo sales uncorrectable, free, but the first thing anyone trying the screen on demo data meets is a refusal; (b) the seeder stores each line's gross and takes each rate's VAT as gross minus base, as the till does, and the golden copy is re-recorded deliberately with the owner's say-so: about 15 lines plus a regenerated golden file, and demo venues reset; (c) seed through the till's pricing, larger. Recommend (b). The owner decides when slice 5's plan (the screen) is cleared, before anyone can try it. The plan's false sentence about callers was corrected in the review-fix round (Part A's caller list). | "Left out"; slice 5 plan | Owner, at slice 5 |
| 5. Returning whole dishes does not give back their own VAT | Not decided here: the owner's question 2. | Question 2 | Owner |
| 6. Four reader branches untested | Ran each change against today's tests. M1 (each earlier correction checked against all corrections' lines): the reader tests still pass (17), the end-to-end three-round case fails, so it is caught. M2 (no refusal of an earlier line without gross): still passes (17); the split check refuses the same history with the same code (a missing gross counts as zero there). M3 (no base comparison) and M4 (no refusal of an unmatched rate): each fails one test, the rows the review-fix round added. M2: the implementer reshapes that row so only the missing-gross check can refuse it, or deletes the check if no storable history reaches it, showing which by deleting the branch. | Section D, step R3 | M1, M3, M4 done; M2 planned |
| 7. A cancelled correction still uses up value | Core has no mark of it: the administrator's cancellation appends a cancellation record with the corrective's sale id and writes no `sale_voids` row (`fiscal-verifactu/src/record-remedy-absent.ts:54–58, :102–111, :125–140`). Cost: slice 4 hands the cash back in the same step as filing, so if a refused corrective is then cancelled, the agency holds no correction, the venue's declared revenue stays too high by that amount, and Waitron gives no way to file it again. Excluding it would not repair that alone: it needs the regime to list cancelled correctives, the reader to drop them, and the protected writer to drop them from its three reads (`record-correction.ts:139–140, :275–289`): about 30 code and 60 test lines plus another protected change. Recommend counting it as used (Waitron refuses, never credits twice) and telling administrators that the remedy for a refused corrective is a fix of it. A fix that keeps the corrective's figures keeps its share and files correctly; one that changes them is the critical case in section A, refused in slice 3 and measured at its filed figures in slice 3b. The design gets: "a cancelled correction keeps its share, as a refused or held one does." | Design pointer at landing | Recommendation |
| 8. Small points | Part C now has its own step (3a). The double read was removed in the review-fix round: one read of the invoice lines in `readHistory` feeds both the calculator and the line builder. The lane E pointer now reads line 116, where the quoted text is. The reconciliation pointer now reads `correction-allocation.ts:165–232`; the writer's latest-version read is cited at `fiscal-verifactu/src/backend.ts:520–529`. The first line is replaced by the revised status. | Plan body | Done |

### C. Parts B and C as built

**(Superseded by the clearance's point 1: what was built is in [As built](#as-built-2026-11-10).)**

- **Part B** (its first build and the review-fix round): kept. Changed by step R1: admission takes
  the earlier correctives' ids, returns the filed figures of the invoice and of each, and refuses
  `filed_figures_unreadable`. The fake backend's default eligible answer returns the stored figures;
  fiscal-none is unchanged (`unsupported`).
- **Part C** (its first build and the review-fix round): kept. The line builder already answers
  finding 2. Changed by step R2: the correctives' ids are read before admission, and anything moved
  is refused. The end-to-end file keeps its three cases and gains step R5's.

### D. What remains

**Slice 3 (this branch), after clearance:**

- **R1. `filedFiguresFor`, failing first** (`fiscal-verifactu/src/correction-admission.test.ts`, where the separate file was merged, the
  clearance's point 1): an unfixed invoice and a corrective answer their own figures for both
  versions; a fixed version's figures are the fix's (a fix row at 10% beside a refused first
  version at 21%), `newestAnswered` null while the fix is queued and the fix's once accepted; a
  table of `readable: false` rows (an exempt detail, a surcharge, two details at one rate, details
  not summing to the total, two lines of fixes); a sale with no alta absent. Fake backend: one case.
- **R2. Moved refused, failing first** (`correction-history.test.ts`, fake backend): the invoice's
  newest figures differing at one rate, differing only in total, and an earlier corrective's
  differing, each refused with `filed_figures_changed`; one `readable: false` row refused with
  `filed_figures_unreadable`; equal figures preview as today (the existing case).
- **R3. Finding 6's M2 row.**
- **R4. Trim** test cases another test covers: at least 60 lines.
- **R5. End to end:** the real fix route, then the preview's refusal (section A).
- Then steps 5 and 6 as written, and `/finish-branch`.

Revised size: about 410 code and 1,030 test lines, about 1,440 in all with no plan, past the
1,400-line stop. R4's cuts bring it to about 1,380. If R4 cannot cut 60 lines, the
`filed_figures_unreadable` table keeps one row and its other rows move to slice 3b (about 25
lines), and the lane says so to the watcher before passing 1,400. Tests about 2.5 times the code.

**Slice 3b (new, before slice 4), after the owner's answer to question 1 (design A shown):**

- **S1.** **(Superseded: built in slice 3; see [As built](#as-built-2026-11-10).)** The backend
  member `filedFiguresFor` (interface; Veri*Factu sharing admission's reader; fiscal-none absent;
  fake).
- **S2.** The writer and checker change, points 2–4 (and 5 if approved), failing first in
  `partial-correction-breakdown.test.ts` and `record-correction.test.ts`, including the reviewer's
  other-rate case and the new refusal order; the golden huella, `inmutabilidad`, and slice 1–2
  suites unedited except where point 3 moves a refusal, each such edit named in the PR.
- **S3.** Core's moved path: the answered-version rule; the split from stand-in lines per filed
  rate with consumption from filed figures; the lines from the stored lines; the full-refund-only
  rule when the total moved; the scope refusal; the reader skipping its line-against-split check
  for a moved invoice.
- **S4.** The end-to-end file in section A.
- **S5.** Top sellers (finding 3) and the extras fallback in the category report (finding 2), with
  a category assertion after a part correction.

Size under A: about 180 code and 540 test lines, about 720 in all; tests about three times the code
(question 1 asks; the clearance's point 3 trims the tests to about twice the code). Under B: about
90 code and 330 test lines.

**What is left after slices 3 and 3b, so staff can use it (cash only):** slice 4, the cash
acceptance (route, permission and PIN checks, one transaction filing the correction and recording
the cash refund, replay record, drawer job, the agency's test-system run of the final-cent shape),
which also answers whether the cash handed back may differ from what was paid when a fix changed
the total; slice 5, the till screen, the corrective paper (it prints the corrective's split, not
sums of its lines) and the guide, with the owner's demo-seed choice (finding 4).

**Settled.** The queued-invoice reading went to the owner as question 3 and was answered
"allow" (the clearance, point 4): the one-line limit written there stands in place of this
paragraph's earlier text.

### As built (2026-11-10)

**The preview's order.** `previewCorrectionAmounts` (`packages/core/src/correction-history.ts`)
refuses an invoice a full invoice replaced (`sale.correction_not_admitted`, reason `replaced`);
asks the regime's `correctionAdmissionFor`, whose answers are unchanged; reads the stored sale and its earlier correctives' ids (refusing `sale.not_found`, or
`sale.correction_history_unusable` when the sale is itself a correction); refuses a named-customer
invoice with `sale.correction_unsupported`, through the writer's own `requireSupportedCorrection`;
asks `filedFiguresFor` for the invoice and each corrective, refusing `filed_figures_unreadable` (a
sale absent from the answer, unreadable figures, or a backend with no `filedFiguresFor`) or
`filed_figures_changed` (newest filed figures differ from the stored ones); reads the history; runs
slice 1's calculator; then builds the lines from its allocations.

**`filedFiguresFor` as built.** It answers `newest` and `newestAnswered`; `newestAnswered` is unused
until slice 3b. The Veri*Factu reader (`packages/fiscal-verifactu/src/filed-figures.ts`) reads
through `registros_sale_idx`, one query per 1,000 sale ids. The fake backend answers from its own
filed records, so a sale it never filed is absent, with a setter to override one filed sale.

**Size** (`git diff --numstat bb313893b4 -- packages/`): production 543 lines added; test support
(`fake-backend.ts`) 58 added and 5 removed; tests 1,112 added and 1 removed; 1,713 added in all.

**Test cases cut** under the owner's 2026-11-09 test rule and the watcher's 2026-11-10 18:35
decision, one line each with what still covers it:

- End to end, "refuses a refused original before reading its history": R5's case fails when
  admission moves after the history read.
- Filed figures, "answers an unfixed invoice's and a corrective's own figures": each check it held
  fails a remaining case (a fixed-filing row, the no-alta case or the end-to-end cases).
- The exempt-detail row: only the unknown-key check refuses it, and the surcharge row fails without
  that check.
- "Reads a whole-invoice credit": core's happy path files its earlier correction as two lines, and
  fails when the reader keeps only the last line at a rate instead of their sum.
- The "invoice filed at another rate" row: the base-and-VAT-moved and corrective rows fail without
  the per-rate comparison.
- The detenido and retenido rows: the rechazado rows fail when an unknown filing state is admitted.
- The ten-coffees end-to-end case: the calculator test refunds those bills cent by cent, and
  `partial-correction-gross.e2e.test.ts` files the same zero-base correction through the real
  backend.
- The separate `filed-figures.test.ts`, merged into `correction-admission.test.ts`: both filed the
  same records through the chain writer, so they share one setup.
- The eligible answer repeated before each admission refusal: the submission-state table owns it.
- Core's two reader happy paths, two line-builder cases and two "regime lacks a member" cases,
  each merged into one case or table.
- The fake backend's filed-figures case files one sale and one correction, not two sales.
- From the earlier fix round: the remedy-path cancellation (the core-void case and
  `record-remedy-absent.test.ts` cover it), the exact partial read (the derived-path case and the
  end-to-end rounds) and the regime refusal passed through (the end-to-end refused original).

**Corrections found while building.**

- The chain writer cannot write a filing with a missing VAT rate or VAT amount, so that
  unreadable-figures check in `filed-figures.ts` has no test.
- The reverse-charged (S2) row files an F1 invoice at rate 0.00 with no VAT, because the chain
  writer refuses S2 on any other invoice type or with tax charged.
