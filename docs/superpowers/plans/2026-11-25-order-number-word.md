# Name the order number on kitchen slips

Kitchen staff can tell what the number means when a slip names it `Pedido 1` in Spanish or `Order 1` in English. The owner’s 25 November answer was “Land both, print ‘Pedido 1’ next (Recommended).” Scope ends at freshly generated kitchen paper.

- [ ] In `apps/server/src/kitchen-ticket.test.ts` and the language or note suites that check the header, pin the new line for unnamed station and combined tickets, a reprint, a held ticket or correction, and a single-order note. Check Spanish and English with the paper’s saved language. Keep the named orders, multi-order notes and MOVED slips in the focused sweep so their names and number ranges are still checked. Run the cases first and record which bare-number checks turn red.
- [ ] In `apps/server/src/kitchen-ticket.ts`, use the existing `kitchenTicketWords(...).order` and `emitOrderLine` for unnamed tickets and corrections. Use the note formatter’s existing singular and plural branch for single-order notes too. The existing MOVED and name-change formatters already share the labelled line. Record the new decision beside A683 in `docs/backlog/kitchen.md`.
- [ ] Run the directly affected `kitchen-ticket*.test.ts` and `kitchen-print*.test.ts` files with `pnpm --filter @waitron/server exec vitest run` and record the counts. Compare old and new 80 mm kitchen output from `previewPrintJob` using the same orders and languages. Show the before and after paper to the owner and record their approval before landing.

Expect about 15 product lines and 55 test lines, plus the decision note.
