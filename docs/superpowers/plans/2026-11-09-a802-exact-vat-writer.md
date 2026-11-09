# A802 slice 2: the correction writer files the exact VAT split it is given

**Plan for watcher approval; no code until approved.** Lane L, 2026-11-09. Slice 1 (the pure amount
calculator, `packages/core/src/correction-allocation.ts`) landed as #2653 (`604fdde31a`).

## Authority

- **Owner, 2026-10-22 ~11:50** (lane E `archive/questions-to-2026-10-23.md`, heading "OWNER ANSWER —
  A802: the protected-writer scope is APPROVED"): "the optional `partialVatBreakdown` on
  `RecordCorrectionInput` (`packages/core/src/record-correction.ts`) validated in new
  `packages/core/src/partial-correction-breakdown.ts`, used only by the new opt-in partial path … No
  edit to the builder/append bodies, hash, number allocator, stored records or existing fiscal
  assertions. The plan's qualification gate stands: if the real €0.03 path needs a protected builder
  change, stop and ask." This slice is exactly that scope and nothing more.
- **Owner, 2026-11-09 16:45** (lane E `questions.md`): cash-first route, each slice "about 1,000
  written lines including tests, each naming its next capability", tests at most about twice the code
  or the plan says why. Slice 1's plan named this slice as successor (1): "carry exact partial VAT
  through the existing `recordCorrection` … and prove the actual fiscal validator accepts the cents".

## What it delivers

Staff get nothing they can use from this slice. It is the foundation for the cash correction: today
`recordCorrection` works out a partial correction's VAT itself (`deriveVatBreakdown`: VAT = rounded
base × rate), which cannot take the last cents of a rate. Example: a €12.10 dish at 21% (base 10.00,
VAT 2.10) refunded as €6.05, €6.02 and then €0.03. Slice 1's rule gives the first two base 5.00 +
VAT 1.05 and base 4.98 + VAT 1.04, so the last must take what is left: base −0.02 and VAT −0.01.
Today's derivation gives that line VAT 0.00 (−0.02 × 21% rounds to nothing), so base plus VAT is
−0.02 where €0.03 was refunded, and 1 cent of VAT is never corrected. After this
slice, a caller may hand the writer the exact split that slice 1's calculator produces, and the
writer checks it and files it unchanged. The next slice (3) reads an invoice's history — its
original lines and what earlier corrections already took — so the calculator can be fed real data.

## Files and size

- Create `packages/core/src/partial-correction-breakdown.ts` (checks the supplied split) and its
  `.test.ts`.
- Modify `packages/core/src/record-correction.ts`: the optional input field; when present, use the
  checked split instead of `deriveVatBreakdown`; read each named original line's `vatRate` and
  `lineGross` in the existing line read (line ~214) and refuse a correction line whose rate differs
  from its original line's, or whose amount is more than that whole line. One added clause in the
  function's doc comment saying where the new refusal falls in the refusal order; nothing else in it.
- Modify `packages/core/src/errors.ts`: one code, `sale.correction_breakdown_invalid` (empty
  params), following slice 1's `sale.correction_*` naming. HTTP status and English/Spanish wording
  come with the first route that can return it.
- Create `packages/fiscal-verifactu/src/partial-correction-gross.e2e.test.ts`: the real core writer
  plus the real Verifactu backend, real migrations and the library's own `validate`.
- Source of the code: private branch commit `414102aa6d` (Task 3 of the old plan), rebuilt on
  current main, its error renamed, its repeated setup folded into one seeding helper.

**Budget: about 150 code lines, about 300 test lines, 450 total.** Stop for an outside opinion past
650 written lines, or if tests pass twice the code. The private commit measured 150 code and 747
test lines; the cut comes from one shared seed in the end-to-end file and table-driven refusal cases
in the core test, not from dropping any case below.

## Steps (test first)

1. **Real backend, failing first.** In the new end-to-end file, record a real original (one €12.10
   line at 21%), then two partial corrections and a final €0.03 one. Write the assertions for the
   wanted result (total −0.03, line base −0.02, filed VAT −0.01) and run it through today's path:
   it must fail on the arithmetic (stored VAT 0.00), not on setup. Then switch the case to the new
   field and see it pass. For each stored correction: rebuild the record from its row, run the
   library's `validate` and require no issues, recompute its hash and compare. Check the original
   sale, its lines and its fiscal record are byte-identical before and after.
2. **The calculator's own figures file.** Same file: file the splits slice 1 pins (€2 over €11 at
   10% and €12.10 at 21%: gross .95/1.05, base before VAT .86/.87, VAT .09/.18; three €0.01 refunds
   at 21%, the last base 0.00 and VAT 0.01), as negative corrections, each passing `validate`.
3. **Refusals, core test, failing first.** Table cases, each a one-field change to a split the same
   test shows passing: amounts past the cent or positive; total not equal to the sum of bases and
   VAT; a rate group not equal to its lines; a rate given twice or with no lines; a line with no
   original line, the same original twice, or no gross; a line's rate not its original's; a line
   larger than its original line; the field together with `wholeInvoice`. Each asserts the code,
   and that no sale row was written and the rectificative series' next number did not move.
4. **Nothing else moves.** Without the field, every existing caller keeps today's path:
   `record-correction.test.ts` passes unedited, as do `correction-path.e2e.test.ts`,
   `correction-amount.huella.test.ts` (its pinned hash) and the golden pair
   (`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` and
   `… vitest run inmutabilidad`). Guards: `scripts/errors-reachable.test.ts`,
   `scripts/alert-codes.test.ts`, `scripts/module-seams.test.ts`. Core typecheck.

## Left out

No change to the Verifactu record builder, chain append, hash, numbering, `registros_facturacion`,
`deriveVatBreakdown`, ordinary sales, substitution or the whole-invoice credit. No history reader,
no admission check on the original's filing state (old plan Task 4), no refund, route, screen,
paper or report. No export from `packages/core/src/index.ts` beyond what the writer's input type
already carries.

## One open point for the watcher

The proof here is the library's `validate`, not AEAT. The chain already refuses a record `validate`
marks as an error (`packages/fiscal-verifactu/src/chain.ts:207–219`); these tests also require no
warnings. The private branch reported no issues for these shapes (commit `414102aa6d`'s message), to
be re-run on current main, not trusted. The riskiest shape is the final cent (base 0.00, VAT −0.01).
I recommend one AEAT preproduction run of that shape
through the `waitron-io/verifactu` live-AEAT workflow (which already filed a double correction on
2026-11-02, `docs/superpowers/specs/2026-11-02-aeat-double-correction-evidence.json`) as a
prerequisite of the slice that lets staff file it, not of this one, because nothing files a partial
split in production until then.
