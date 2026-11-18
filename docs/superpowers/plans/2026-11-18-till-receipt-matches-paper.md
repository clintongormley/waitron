# Till receipt matches paper

**Finish line.** Open a paid bill awaiting handover or a recorded transaction in Find a bill and see
the receipt's contents in paper order, including full and corrective invoices. The screen uses the
compact 80 mm layout. A 58 mm print can format its date differently and an A4 print uses page
layout. The browser's text wraps and stays readable in either theme. The scope ends at the receipt
article and its signed-in reads. Lane L owns paper and fiscal output.

**Ask.** “Bring it into line with the printed receipt” (`docs/backlog/printers.md:274` at
`fd0dc1c922`).
Render the server's `buildReceiptDocument` elements as accessible text and tables.

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
   display logo. Draw both practice marks in the supplied positions. Leave the receipt area empty when the
   answer has no preview. Keep the exported `lineName`
   for the correction dialog, and the inherited delivery controls for the settlement dialog.
   Lane D's #3703 removes the same set-lunch formatting from both screen and paper. Reconcile
   that patch if it lands first. Update both table-service guides and the stale references in
   `docs/developers/products.md`, `docs/developers/conventions-ui.md`, `layout.ts` and
   `receipt-lines.ts`. Remove the completed item and correct the printers backlog bundle count.
3. **Verify test-first.** Check the paid-bill flag, read-only snapshot and refusals in
   `till-api.receipt.test.ts`. Check the stored guests, language, issuer and practice flags in
   `transaction-receipt-api.test.ts`. Run every changed suite plus `receipt-document.test.ts`
   and `receipt-ticket.test.ts`. Inspect phone and desktop in each theme and operator language.
   Record changed assertions in the PR using the table below.

**Estimate.** Production +250/−450, tests +300/−1,500. One PR. The watcher cleared the plan at
05:35 on 2026-11-18 with a stop at 800 added lines.

| Existing checks | Build disposition |
| --- | --- |
| till-ticket-view.test.ts issuer, trim, address, regional names, date and order, quantities and extras, discounts and net rows, A803 grouping, tender amounts, and corrective contents | Use the existing receipt-document and receipt-ticket assertions for the layout's own rules. Carry over any assertion that has no matching case. Keep a browser case where the supplied full invoice and mixed-rate receipt exercise element order and table rendering. |
| till-ticket-view.test.ts language, QR, practice and optical layout checks | Keep browser checks for article language beside operator labels, QR payload and alignment, both practice marks, and readable wrapping. Move caption wording and fixed-language content decisions to the existing builder cases. |
| till-ticket-view.test.ts delivery, print, drawer, correction and refund controls | Keep the behavioral assertions. Update only fixtures and selectors affected by the article. |
| till-ticket-view.presentation.test.ts | Keep immutable logo URL, old and new answer transitions and optional trim disappearing. Use supplied elements for text and remove duplicate currency and formatting fixtures only when the builder pins them. |
| till-ticket-view.kitchen-note.test.ts | Check the server's preview omits operational instructions and the till draws only the provided customer content. |
| till-ticket-view.a11y.test.ts | Retain both themes, delivery and choice states, and exercise the distinct element and table variations on actual preview fixtures. |
| till-app.test.ts server-versus-basket test and affected entry tests | Keep the divergent fixture. Check that the preview appears when opening through the existing transaction and paid-bill path. |
