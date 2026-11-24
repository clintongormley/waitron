# Split kitchen printing

Developers can find kitchen ticket routing, corrections, reprints and their tests by filename.
Build after Claude’s review, watcher clearance and Lane H’s working-order split. Aim for one PR
within an hour of build time. Expect about 3,157 product lines and 3,743 test lines moved, plus
about 180 lines of import edits, 120 for the map and 80 for test setup and path updates.

Map every top-level declaration in `apps/server/src/kitchen-print.ts` by its job. Keep each
new file in `apps/server/src/` to about 1,000 lines or less.

- `kitchen-ticket-items.ts` owns `FiredItem`, item building, station and order-header reads.
- `kitchen-ticket-plan.ts` owns whole and held ticket routing, layouts and `joinedPapers`.
- `kitchen-ticket-enqueue.ts` owns fire, hold marking and shared job enqueueing.
- `kitchen-ticket-state.ts` owns `TicketState`, quantity and kitchen-work expressions.
- `kitchen-ticket-corrections.ts` owns name, note, void, reroute, extra and allergy slips.
- `kitchen-ticket-moves.ts` owns moved slips and names on paper. Put shared sent and held
  reads in `kitchen-ticket-paper.ts` and link writes and copies in `kitchen-ticket-links.ts`.
- `kitchen-ticket-reprint.ts` owns reprint parts, targets and re-enqueueing.
- `kitchen-ticket-problems.ts` owns problem queries and jobs cleared by later paper.

Commit `scripts/kitchen-print-split.json` and run
`node scripts/move-ts-declarations.mjs scripts/kitchen-print-split.json` (#4244). TypeScript’s
Move to file repoints imports. Keep names, signatures, bodies and behaviour. Check body bytes
after formatting, fix type-only and dynamic imports, and preserve `./errors.js` side effects.
Keep new modules free of cycles, import helpers from their homes and delete `kitchen-print.ts`.
Review `print-api.ts` next, then `payments-api.ts`. The syntax tree at `e81b714793` puts
`mountPrintApi` at 1,612 of 2,181 lines (489–2100) and `mountPaymentsApi` at 1,748 of 2,115 (368–2115).
Keep both 2,250-line caps in `scripts/product-file-size-limits.json` and leave both files and tests intact.

**Tests and references**

Move whole test blocks out of `kitchen-print.test.ts` into suites for firing and item content,
corrections and moves, and reprints. Keep every name, assertion and fixture, including rollback
with zero jobs and the whole reprint’s two jobs with both rounds.
Compare block counts and bytes, keeping relative order. Give each file its own `useVenueDb`.
Bind `useSplitExtrasDb` in `beforeAll` where used. Register both file-wide `afterEach` hooks
in original order so job deletion runs before mock restoration and the database reset.

Run the original suite on the baseline and the split files after the move, both alongside
`kitchen-print.{allergy,concurrency,language,moved-notice-ticket,shared-printers}.test.ts`,
`print-problems.test.ts`, `till-api.reprint.test.ts` and `kitchen-allergy.capture.test.ts`. Compare
case names and outcomes. The six kitchen-print suites passed 164 tests at `e81b714793`.
Run `pnpm --filter @waitron/server typecheck`, `scripts/{product-file-size,english-only}.test.ts`
and `git diff --check`. Remove the old cap, carry over only needed `english-only-still-to-clean.ts`
entries and review `apps/server/test-durations.json` for the new test paths. Update affected path
references in guards, source and current docs, including backlog entries where they become stale.

On a disposable copy of `feat/h-working-order-pieces` at `e989bce6dafcb87f67513f84ae18ac583dbe6db5`,
the script moved eleven declarations into `kitchen-ticket-plan.ts`. `passStationsByGroup` kept
its import from `working-order-pass-groups.js`. An independent syntax-tree check matched all
7,370 body bytes of `planKitchenTickets`. `git diff --check` passed. The one-group preview’s
typecheck flagged six type-only imports (see lane `receipts/split-print-payment-files/`).
List overlapping open branches in the PR and give them the map and command to run on their copies
before rebasing. Use both `finish-branch` run-it reviews for concurrency, reuse valid reviews,
and verify current-head CI under the existing lane rules.
