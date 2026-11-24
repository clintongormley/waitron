# Split kitchen printing

Developers can find ticket routing, corrections, reprints and their tests by filename. The
watcher cleared this plan with three edits at 18:08 on 24 November. Build after Lane H’s
working-order split lands. Aim for one PR and an hour of build time. Move
about 3,157 product lines and 3,743 test lines. Allow about 450 more lines for product imports
and path edits, 250 for test imports and setup, and 130 for the move map.

Move `apps/server/src/kitchen-print.ts` into these files in the same directory. Each product
file has a 1,000-line limit.

- `kitchen-ticket-items.ts` owns `FiredItem`, item building, station and order-header reads.
- `kitchen-ticket-printers.ts` owns `PrinterMapping`, `printerMappings` and `groupByLayout`.
- `kitchen-ticket-plan.ts` owns whole and held routing. `kitchen-ticket-state.ts` owns
  `TicketState`, quantities and kitchen-work expressions. `in-ids.ts` owns the SQL helper `inIds`.
- `kitchen-ticket-enqueue.ts` owns firing, hold marking and job enqueueing.
- `kitchen-ticket-corrections.ts` owns name, note, void, reroute, extra and allergy slips.
- `kitchen-ticket-paper.ts` owns shared sent and held reads. `kitchen-ticket-moves.ts` owns
  moved slips and names on paper. `kitchen-ticket-links.ts` owns link writes and copies.
- `kitchen-ticket-reprint.ts` owns reprint parts, targets, `joinedPapers` and re-enqueueing.
- `kitchen-ticket-problems.ts` owns problem queries and jobs cleared by later paper. It keeps
  the `./errors.js` side-effect import.

Commit `scripts/kitchen-print-split.json` for `node scripts/move-ts-declarations.mjs` (#4244).
Keep names, signatures and behaviour. Check every moved body byte for byte after formatting.
Audit generated `type` specifiers and repoint dynamic imports. Check for cycles wholly among
the new files, including type imports. Point callers at definitions and delete `kitchen-print.ts`.
Keep the map through rebases
and retire it with the split tool when the queued moves finish.

The queue’s mount-function rule covers both other files. At `e81b714793`, `mountPrintApi` is
1,612 of 2,181 lines and `mountPaymentsApi` is 1,748 of 2,115. Their existing 2,250-line caps apply.

Move whole test blocks to `kitchen-print.{fire,extras,portions,corrections,reprint}.test.ts`
for fire and routing, extras and units, A803 portions, corrections and moves, and full reprints.
Put “show the rest of the order” and “a station printer that was deleted” in `fire`. Put the
table-driven measured-extra label cases in `extras`. Keep the piece-unit group with the English
exception, the stored-option answers, the frozen-name cases, table labels and course headings in
`kitchen-print.test.ts`. `kitchen-print.test-support.ts` holds the shared helpers and a database
binding initialised in each isolated suite by `useVenueDb`. Every suite that uses helpers from
`split-extras-venue.ts` calls `useSplitExtrasDb` in its own `beforeAll`. Keep both `afterEach`
hooks in their original order. Compare block bytes and all 104 original cases.

Run the split suites and the five existing `kitchen-print.*.test.ts` suites. The six originals
passed 164 cases at `e81b714793`. Also run `print-problems.test.ts`, `till-api.reprint.test.ts`,
`kitchen-allergy.capture.test.ts`, Server typecheck, root size and English guards, and `git diff --check`.
Remove the old product cap and replace its test duration row using measured split-file times.
Repoint live source, guard and documentation references, including any stale backlog path.

On a disposable copy of Lane H’s `e989bce6da`, the script moved eleven planning declarations.
It carried H’s changed `passStationsByGroup` import and preserved `planKitchenTickets`’s 7,370
body bytes. Typecheck flagged six imports missing `type`. No other open branch touched
`kitchen-print.ts` when checked. Run the full map in a disposable copy at build time. List any
new overlap in the PR and share the command and import fixes for each lane’s own rebase. Use
both `finish-branch` run-it reviews for concurrency and verify the selected current-head CI jobs.
