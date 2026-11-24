# A1201 receipt extra count

On 58 mm and 80 mm simplified receipts and the till preview, show the total count of a grouped
dish's counted extra. For two Pollo asado con patatas, the indented extra reads
`2  Pimientos de Padrón` beside `4,00`. The owner picked “Yes, show its total (Recommended)” on
24 November 2026 at 22:06, in the watcher's small-questions answers, item 10. The watcher cleared
the shared preview at 23:45 and named portions and dish-row spacing at 23:47.

1. In `packages/orders-sales/src/receipt-facts.ts`, add the localised count to `WithVatOption`
   for a counted extra on a simplified receipt when its dish has a whole quantity of at least
   two. Keep the existing quantity text for the A4 renderer. `receipt-facts.test.ts` checks the
   rule for Each, named portions, a single dish, a measured extra and a negative corrective.
2. In `apps/server/src/receipt-document.ts`, put the count before the indented name, with two
   spaces as on a dish row. Continue a wrapped name under its first letter. The till preview
   uses the same layout. The grouped Burger assertion in `receipt-document.test.ts` checks the
   caption. Full invoices keep their current layout.
3. In `receipt-ticket.test.ts`, decode both widths for two chicken dishes and their extras.
   Check the count and amount on the short extra, the long extra's continuation and the total.
   Update the existing Spanish and Catalan expectations for the counted extra under a dish
   sold in named slices, keeping the language assertions. Watch these expectations fail before
   the fix.
4. Run the three changed test files, the till preview and A4 layout suites, and the unedited
   `write-path.e2e.test.ts` and `inmutabilidad.test.ts` in fiscal-verifactu. Keep the full-invoice
   58 mm and 80 mm golden files. Render both widths with a temporary copy of `receipt-look.ts`,
   including a single dish with `x2` and a wrapped extra. Keep the samples outside Git and get
   the owner's OK before landing. Close A1201 in `docs/backlog.md` and
   `docs/backlog/{printers,till}.md`. Redirect the old A960/A961 plan's link here.

Expected size is about 20 production lines and 80 test lines, plus the backlog and link edits.
