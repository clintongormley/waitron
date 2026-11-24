# A1201 receipt extra count

On 58 mm and 80 mm printed simplified receipts, a grouped dish's counted extra starts with its
own total count. For two portions of Pollo asado con patatas, the indented extra reads
`2 Pimientos de Padrón` and still shows `4,00`. The owner picked “Yes, show its total
(Recommended)” on 24 November 2026 at 22:06, in the watcher's small-questions answers, item 10.
The queue says “Paper only.” The watcher will settle whether that includes the till's preview.

1. In `apps/server/src/receipt-ticket.test.ts`, format two identical one-portion dish and extra
   pairs priced at `9,50` and `2,00` each. Decode both widths and assert the indented caption
   `2 Pimientos de Padrón`, the extra amount `4,00` and the receipt total `23,00`. Update the
   existing three-dish print case to use the stored Each shape (`unitName: { es: "ud" }` and
   `soldInEach: true`). Assert the exact extra captions `6 Extra queso` and `3 Sin cebolla` at
   their existing amounts. Run the new expectations before the fix and watch the captions fail.
2. In `packages/orders-sales/src/receipt-facts.ts`, add the localised combined count to
   `WithVatOption` for counted extras on simplified receipts. Require a positive whole dish count
   above one and reuse the existing check that the dish's printed quantity carries no unit name.
   Take the extra count from the stored or merged quantity. Extend the existing exact assertions in
   `receipt-facts.test.ts` for `Wafer` and `Cherry`, leaving the measured `Berries` row as the control.
3. In `apps/server/src/receipt-document.ts`, print that count before the indented name in place of
   the `xN` suffix, if present. For the recommended paper scope, add an explicit `groupedExtraCounts`
   render option set only by `drawReceipt` in `receipt-ticket.ts` and assert the existing per-dish
   caption through `till-receipt-preview.test.ts`. If the watcher includes the till preview, use the
   shared document layout directly and update the grouped Burger case in `receipt-document.test.ts`.
   The existing measured-dish tests keep their exact captions. Single dishes, measured extras,
   negative corrective quantities, full invoices, filed amounts, VAT and QR data use their existing paths.
4. Run the changed test files, the receipt document and A4 `invoice-layout.test.ts` suites, and
   `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
   Keep the existing full-invoice 58 mm and 80 mm golden files. Use a temporary copy beside
   `apps/server/scripts/receipt-look.ts` to inspect both printed widths, including a single dish with
   `x2` and a long extra at 58 mm. Remove the copy and keep the samples outside Git. Obtain the owner's
   OK on the paper before landing. Close A1201 in `docs/backlog.md` and `docs/backlog/{printers,till}.md`
   and redirect the old A960/A961 plan's A1201 link here.

Expected size is about 20 production lines and 60 test lines, plus the backlog and link edits.
