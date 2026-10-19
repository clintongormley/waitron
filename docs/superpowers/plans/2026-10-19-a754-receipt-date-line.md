# A754 — the receipt's date and time on a line of their own: plan

Status: approved layout (owner, 2026-10-19 ~04:35–04:52, lane B `questions.md`, "OWNER ANSWER to A754"
and its two corrections, and "OWNER ANSWER for the FULL INVOICE"). The pull request is opened marked
needs-owner-review; the owner lands it.

## What the owner asked for

Simplified receipt, everyday (no operation date):

```
Mesa 12                      Pedido 123
T/123                18 ago 2026, 11:21      ← 80 mm and A4: the date in words
T/123                  18/08/2026 11:21      ← 58 mm: the date in numbers
```

Simplified receipt when an operation date prints (captioned rows):

```
Mesa 12                      Pedido 123
Factura simplificada              T/123      ← 58 mm: "Fra. simplificada"
Fecha                18 ago 2026, 11:21
Fecha de operación          17 ago 2026
```

Full invoice, every paper (two lines for FACTURA and Fecha, always):

```
Mesa 6                        Pedido 41
FACTURA                            FF/1
Fecha                18 ago 2026, 00:34
Fecha de operación          17 ago 2026      ← only when it differs, as today
```

Hours always two digits ("00:34", never "0:34") on every receipt date, in words and in numbers, in
every receipt language.

## Decisions this plan makes that the owner's answer does not

1. **58 mm has 30 columns, not the 32 the answer's arithmetic used** (`COLUMNS` in
   `packages/printing/src/layout.ts`). Real invoice numbers are `<series code>/<counter>` with no
   year and no padding (`formatInvoiceNumber`, `packages/core/src/record-sale.ts:105-107`), so the
   owner's `T-2026/000123` is longer than a typical number. DEFAULT: build the owner's rule by PAPER
   (58 mm numeric, 80 mm and A4 words); where a number is too long for the numeric date beside it on
   30 columns, the renderer's existing rule drops the date to its own right-aligned line. Pictures
   show it; the owner is asked. The figures: the numeric row fits a number of at most 12 characters
   (30 − 2 − 16); "Fra. simplificada" beside a number fits at most 12 (30 − 1 − 17, a captioned row
   keeping today's default gap); a series code is at most 21 characters (`venue-fields.ts:76`); a cold restore
   suffixes `-<installation>` of 7 characters, or 27 for an emergency one (`allocation-identity.ts`),
   so a restored one-letter series (`T-S123456/123`, 13 characters) drops the date from its third
   digit on, and the longest possible number is 60 characters (`reserved-series.ts:8-13`), which
   wraps by itself on both papers. A row with a value on each side (table and order; number and date)
   keeps a two-space minimum gap, as the order-and-date row does today (`receipt-document.ts:221-222`);
   a captioned row (caption left, value right) keeps today's default.
2. **The paper reaches the builder as an input.** `buildReceiptDocument` gains `paper?: "58mm" |
   "80mm"`; `drawReceipt` (`apps/server/src/receipt-ticket.ts`) passes `printer.paperWidth`. Absent
   (A4, PDF, raster) means words. No new element kind.
3. **Keep each language's existing date form; pad only the hour.** Explicit date parts change Catalan
   ("18 d’ag. del 2026") and Basque. DEFAULT: format with `dateStyle: "medium", timeStyle: "short"`
   as today and pad the `hour` part from `formatToParts` to two digits. Numeric form: the date with
   `day`/`month` 2-digit and `year` numeric, then a space, then the time with `hour`/`minute` 2-digit
   and `hourCycle: "h23"` — Spanish, Catalan and Galician print `18/08/2026 00:34`, Basque its own
   `2026/08/18 00:34`. Measured with Node v26.11.1 on 2026-10-19.
4. **A table-less order** (no `orderLabel`): the order alone on the RIGHT of the first row, so it sits
   where it does on a table's receipt.
5. **The captioned simplified shape is reached by no path today**: the only writer of a sale's
   operation date writes `null` without a customer tax identity (`packages/core/src/record-sale.ts:284-286`),
   which is what makes a sale simplified. It is built and tested at the document level only, as the
   owner asked: the builder prints it whenever an F2 result carries `operationDate`.
6. **Two-digit hours apply to every printed receipt date** — also `tender-refund-receipt.ts:121-125`
   (which formats in UTC and appends " UTC": it keeps doing so, passing `offsetMinutes: 0`) and
   `payment-slip.ts:43`, through one shared formatter; and the till's on-screen receipt
   (`apps/till/src/screens/till-ticket-view.ts:145-153`), which cannot import a server module, gets
   the same padding in its own formatter. A 12-hour locale (an English refund slip) pads too:
   `09:05 AM`.
7. **New label `simplifiedInvoiceShort`**: es/ca/gl "Fra. simplificada"; eu keeps "Faktura erraztua"
   (16 characters, already short). Spain is the only pack with receipt labels.
8. **Unchanged:** FACTURA stays bold; a sale with no order prints "Pedido 0" as today
   (`invoice-document.test.ts:833`); a long table label (`Ana · Mesa 4, 5`, `Terraza interior 12`)
   that does not fit beside the order lets the order drop to a right-aligned line (the renderer's rule).
9. **Pictures before the PR, not before the code.** The owner asked for pictures before building; they
   are drawn from the branch's own code (the only faithful source) in Task 3 and posted to lane B's
   `questions.md` and `~/My Drive/Waitron mockups/2026-10-19 A754 receipt date line v2/` before the
   PR opens. Anything the owner changes goes back into Task 2a before landing; the owner lands it.

## Global constraints

- TDD: failing test first, watch it fail. The golden huella test and `inmutabilidad` are not touched.
- Every changed test check is listed for the PR (owner rule 2026-10-05: a check may change when the
  item changes what it checks).
- No `--no-verify`; every commit `-s`.

## Review focus

The 58 mm and 80 mm rows at their real column counts; the hour padding in all four languages; that A4
and PDF keep words; that a full invoice never merges FACTURA and Fecha.

## Task 1 — one formatter for printed dates, and the short heading label

Files: new `apps/server/src/receipt-dates.ts` (+ `.test.ts`); `receipt-document.ts` (`issueDate` and
the operation-date format move there); `tender-refund-receipt.ts`; `payment-slip.ts`;
`packages/country/src/country.ts` (`RECEIPT_LABEL_KEYS`); `packages/country-es/src/receipt-labels.ts`;
any test pinning the label key list (grep `RECEIPT_LABEL_KEYS` and `simplifiedInvoice` across
`packages/`).

- `receiptDateTime(iso, locale, offsetMinutes?)` — words, hour padded (decision 3).
- `receiptDateTimeNumeric(iso, locale, offsetMinutes?)` — numbers (decision 3).
- `receiptDay(isoDate, locale)` — the operation date as today (`dateStyle: "medium"`, UTC).
- Tests: es, ca, gl, eu at 00:34, 09:05 and 12:34; with and without `offsetMinutes`; the existing
  Catalan "15 de gen. 2026, 12:34" unchanged.
- A failing check at 09:05 on each path routed through it: the refund slip
  (`tender-refund-receipt-api.test.ts`), the payment slip's test, the till's
  `till-ticket-view.test.ts:85` (today `0:05`).
- Hour padding changes what the receipt prints: update the hour in `receipt-document.test.ts:64`,
  `receipt-ticket.test.ts:120`, `invoice-pdf.test.ts:71` in this task (hour only — the layout is 2a).
- Run: `pnpm --filter @waitron/server exec vitest run src/receipt-dates src/tender-refund-receipt
  src/payment-slip src/receipt-document src/receipt-ticket src/invoice-pdf`;
  `pnpm --filter @waitron/till exec vitest run src/screens/till-ticket-view`;
  `pnpm --filter @waitron/country-es exec vitest run`; `pnpm --filter @waitron/country-packs exec
  vitest run`; typecheck server, till, country, country-es.

## Task 2a — the new header rows

Files: `apps/server/src/receipt-document.ts` (+ `.test.ts`), `receipt-ticket.ts` (+ `.test.ts`).

- `paper` input (decision 2); the three shapes above; decisions 4, 5 and 8.
- New tests at the document level (elements) for each shape and paper, and at the ticket level at 30
  and 42 columns: the everyday row on one line on both papers with a short number (`T/123`); a
  13-character number on 58 mm drops the date to its own right-aligned line; the full invoice keeps
  FACTURA and Fecha on two lines on every paper; a table-less order sits on the right; the captioned
  F2 shape with "Fra. simplificada" on 58 mm and "Factura simplificada" on 80 mm.
- Update the existing pins in those two files only.
- Run: `pnpm --filter @waitron/server exec vitest run src/receipt-document src/receipt-ticket`.

## Task 2b — the other tests that pin the header rows

Update to the new layout, changing only what the layout changed, and list every changed check:
`sample-receipt.test.ts`, `invoice-pdf.test.ts:70-72`, `invoice-language.test.ts:15-49`,
`receipt-language.test.ts` (331, 377, 1108-1109), `receipt-adjustments.test.ts` (585, 658),
`receipt-print.test.ts` (2167, 2172), `invoice-document.test.ts:833`, `invoice-raster.test.ts`,
`receipt-preview-api.test.ts`, and anything else a full `pnpm --filter @waitron/server exec vitest run`
turns red (grep `simplifiedInvoice`, `Pedido `, `Comanda `, `· Pedido` too).
- Run: that full server run (it is the cheapest way to find every pin), then `pnpm --filter
  @waitron/server typecheck`.

## Task 3 — LOOK

Render from the built code with `apps/server/scripts/receipt-look.ts` (or a scratch copy outside the
tree): simplified everyday 80 mm and 58 mm in Spanish and Catalan, a short (`Mesa 6`) and a long
(`Terraza 12`) table; the captioned shape on both papers; a 58 mm everyday receipt with a long number;
full invoice 80 mm, 58 mm and A4. Add: a restored series' number (`T-S123456/123`) and an emergency
one on 58 mm; long labels `Terraza interior 12` and `Ana · Mesa 4, 5`; the Catalan captioned shape on
58 mm. Sheet into PNGs for the owner question (decision 9). Nothing committed but the PNGs under
`docs/backlog/mockups/a754-receipt-date-line/`.

## Task 4 — docs

Delete A754's entry from `docs/backlog.md`; in `docs/backlog/printers.md` move the owner's layout
decisions and the RD 1619/2012 / HAC/1177/2024 provenance table to `## Decisions and deliberate
limits` rather than deleting them; update `docs/backlog.md:163` ("Can a simplified invoice carry an
operation date…") to say the captioned shape is built and only the date has to be supplied; leave a
short entry for anything left open (the long-number question, if the owner has not answered). Grep the user guides
(`apps/server/src/guide/`) and `docs/developers/` for prose describing the receipt's header or date and
update it.
