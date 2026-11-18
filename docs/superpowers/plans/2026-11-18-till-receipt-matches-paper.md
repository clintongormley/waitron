# Till receipt matches paper

**Finish line.** Open a paid bill awaiting handover or a recorded transaction in Find a bill and see
the receipt's contents in paper order, including full and corrective invoices. The screen uses the
compact 80 mm layout. A 58 mm print can format its date differently and an A4 print uses page
layout. The browser's text wraps and stays readable in either theme. The scope ends at the receipt
article and its signed-in reads. Lane L owns paper and fiscal output.

**Ask.** [Bring the till receipt into line with paper](../../backlog/printers.md#the-tills-on-screen-receipt-is-a-second-copy-of-the-layout).
The server's `buildReceiptDocument` supplies the content. Its existing structured elements let
the browser render text and table headings for people using assistive technology.

1. **Serve the document.** In `till-api.ts` build `receiptPreview` only for
   `GET /api/sales/:id?receiptPreview=1`, requested by the existing paid-bill opening in
   `till-app.ts` through an opt-in in `api/client.ts`. Add it to
   `GET /api/transactions/:saleId/receipt` in `transaction-receipt-api.ts`. Keep the session
   and zone checks ahead of both. In `till-receipt-preview.ts`, pass the existing ticket, its
   receipt language and naming language, date offset, trim and address flag to
   `buildReceiptDocument` with the 80 mm setting. Use `readPrintedGuests` for the saved count
   and `readTaxpayer` only when the ticket lacks a filed issuer. Pass the server's practice-mode
   and simulated-card flags. Put the existing element and table **types** in
   `packages/shared/src/receipt-document.ts` and re-export them from their current server files.
2. **Render the document.** In `till-ticket-view.ts` use a Lit renderer that handles every
   element kind. Carry forward alignment and indentation and render native tables with scoped
   headings, reusing headings on a continued item table. Use the existing QR and followed-server
   display logo. Draw the practice wording once from the document. Keep the exported `lineName`
   for the correction dialog, and the inherited delivery controls for the settlement dialog.
   Lane D's #3703 removes the same set-lunch formatting from both screen and paper. Reconcile
   that patch if it lands first. Update both table-service guides and the stale references in
   `docs/developers/products.md`, `docs/developers/conventions-ui.md`, `layout.ts` and
   `receipt-lines.ts`. Remove the completed item and correct the printers backlog bundle count.
3. **Verify test-first.** In `till-api.receipt.test.ts`, reopen the same sale with and without the
   flag, checking preview presence, the existing no-write snapshot and refusals. In
   `transaction-receipt-api.test.ts`, check a mixed-rate simplified document with saved guests
   and a discounted full invoice. In `till-app.test.ts` make the server preview disagree with
   the basket and check what opens in both entry paths. In the `till-ticket-view` main,
   presentation, kitchen-note and accessibility suites keep the assertions about what the browser
   renders, including literal text, table semantics, QR, logo replacement, language and controls.
   Use `receipt-document.test.ts` for layout rules and `receipt-ticket.test.ts` for paper checks.
   Keep each existing assertion at the layer that owns it, using an existing equivalent check
   where one already pins that behaviour. Record changed checks in the PR. Run every changed test
   file plus both paper suites. Look at phone and desktop in English and Spanish UI and both themes.

**Expected size.** Production about +250/−450 lines. Tests about +300/−1,500, mostly removing
fixtures and checks duplicated by the paper suite. Keep the route and rendering tests in this PR.
