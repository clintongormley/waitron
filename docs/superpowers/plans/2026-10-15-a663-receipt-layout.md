# A663 — receipts and full invoices that are easier to read — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Print the simplified receipt and the full invoice in the two layouts the owner approved on
2026-10-14 — ruled-off sections, a large TOTAL, one row per item on a full invoice, the registered
address once or labelled, VAT rates written "10%" and "17,5%", and guests and the amount per person —
on 58 mm and 80 mm paper and on the A4 page.

**Architecture:** Everything printed comes from one list of elements built by
`buildReceiptDocument` (`apps/server/src/receipt-document.ts:95`). Two renderers draw that list: the
roll printer (`formatReceipt`, `apps/server/src/receipt-ticket.ts:28`) and the A4 page
(`layoutInvoicePages`, `apps/server/src/invoice-page.ts:63`, drawn to PDF by `invoice-pdf.ts` and to
pixels by `invoice-raster.ts`). The work adds two styles to the element list (bold, and double size),
a table element for the full invoice's items, and teaches both renderers to draw them. The roll
printer draws every line of text as a picture from our own glyph table
(`packages/printing/src/escpos.ts:42-81`), so bold and double size are new drawing modes in
`packages/printing`, not printer commands. Nothing filed, hashed or sent to AEAT changes: the work
reads the same filed figures and lays them out differently.

**Tech Stack:** TypeScript, Vitest (unit tests, plus `useVenueDb` for the reader in Part 3), the
`@waitron/printing` raster builder, and PDFKit and sharp for A4.

**Spec:** `docs/backlog/printers.md`, section "A663 — receipts and full invoices that are easier to
read", with the approved mockups `docs/backlog/mockups/a663-receipt-layout/1-simplified-receipt.png`
and `2-full-invoice.png`. Read the section and look at both pictures before starting any task. The
mockups are "drawn, not rendered": where this plan departs from a drawing, it says so and why. The
owner changed one point of `1-simplified-receipt.png` on 2026-10-15 (Q11): a one-rate simplified
receipt prints «Base imponible» and «IVA» under TOTAL, not «IVA 10% incluido». Part 2b builds it;
the picture is kept as drawn.

---

## How the work is cut

Six pull requests (a seventh, Part 4, was withdrawn by the owner on 2026-10-15): Part 1 is split in
two (1a and 1b) so that the half that touches no file of lane A's A661 branch (landed 2026-10-15,
#1745) could start before it. Each leaves `main` green and correct on its own; none needs
a later one. The task numbers are not changed by the split; the table says which tasks each pull
request holds.

| Part | What it delivers | Tasks | Can start |
| ---- | ---------------- | ----- | --------- |
| 1a | Bold and double-size lines in `@waitron/printing`; VAT rates as "10%"/"17,5%" and the `formatAmount` helper; TOTAL drawn double size on paper and A4, on both documents, where it already sits | 1.1, 1.3, 1.4, then 1.8 (LOOK, fiscal gate, backlog) | Now |
| 1b | Receipt labels; ruled sections and the one-fact-per-line business block on both documents; the simplified receipt's layout (heading lines, TOTAL straight after the items, «IVA 10% incluido») | 1.2, 1.5, 1.6 (in two halves), 1.7 | After Part 1a and A661 have landed (A661 landed 2026-10-15, #1745) |
| 2 | The full invoice's layout: "FACTURA" heading, a "Cliente" block, one table row per item with the item and its discount before VAT, «Base imponible» per rate, the address once or labelled «Domicilio fiscal:», and the same on the A4 page; a count in «ud» printed bare on both documents | 2.1, 2.2, 2.3a, 2.3b, 2.3c-1, 2.3c-2, 2.3d, 2.4, 2.5, 2.6 (ten dispatches) | Now: Part 1b (#1756) and A661 (#1745) have landed |
| 2b | A one-rate simplified receipt prints «Base imponible» and «IVA» under TOTAL instead of «IVA 10% incluido» (owner, Q11) | Written at the start of the part | After Part 2 has landed |
| 2c | Each sale line stores its price before any discount, so every line prints its own price and discount (owner, Q9); the whole-bill discount prints once per VAT rate at the end of the table (owner, Q10). A database change | Written at the start of the part | After Part 2b has landed |
| 3 | Guests and the amount per person | 3 | After Parts 1a and 1b have merged (A661, which also edits `receipt-print.ts`, landed 2026-10-15, #1745); uses owner question Q2's default unless answered |
| 4 | The drink/food subtotal setting | 6 | Withdrawn by the owner on 2026-10-15: the drink and food subtotals are not built. Was: after owner questions Q1, Q3 and Q6 are answered, and after A661 lands |

Why 1b and 2 wait for A661 (A661 landed 2026-10-15, #1745): see "A661 overlap" below.

Parts 2b and 2c were added on 2026-10-15, when the owner answered Q9, Q10 and Q11 with the
alternatives after Part 2 was built on the defaults. Part 2 lands as built: it is fifteen reviewed
commits, and a database change deserves its own pull request. Part 2b (Q11) is small and changes no
database; Part 2c (Q9 and Q10 together, since both change the discount rows) adds a column to
`sale_lines`. Until Part 2c lands, `main` prints a whole-bill discount under each dish, the default
the owner did not choose; nothing is live, and Part 2c replaces it. Then Part 3.

Point 4 of the spec ("17,50 € × 2", not "/ 2") is handled inside Part 2: on paper and on the A4
page, the only place a unit price is printed beside a quantity is the full invoice's «Precio sin
IVA» line (`netFacts`, `receipt-document.ts:146-165`, the `" / "` at line 150), and Part 2 replaces
that line with the table's price column, which prints the price alone (owner, Q4). The till's
on-screen copy of the receipt prints the same line itself
(`apps/till/src/screens/till-ticket-view.ts`); that screen is outside A663 (see "A661 overlap").
See owner question Q4 for why the "/" is not turned into "×".

Point 2's "Fecha de operación only when it differs from the issue date" is already how the code
behaves: both readers that feed a full invoice drop the operation date when it equals the issue day
(`apps/server/src/receipt-issuer.ts:29-35`, `apps/server/src/invoice-document.ts:146-148`; both
since 2026-10-06/08 per `git log -S"sale.operationDate !== issueDay"`, commits `2d9726855` and
`eb6403150`). Two existing cases in `invoice-document.test.ts` pin it (named in commit `1bf7567a6`); Part 2 adds no code.

---

## Global Constraints

- **Work in a worktree**: `python3 ~/workspace/tools/worktree.py new waitron <branch> --headless`.
  Branch names: `feat/a663-1-receipt-layout` (Part 1a), `feat/a663-1b-receipt-layout`,
  `feat/a663-2-full-invoice-layout`, `feat/a663-2b-one-rate-vat-lines`,
  `feat/a663-2c-price-before-discount`, `feat/a663-3-guests`.
  Every commit `git commit -s`.
- **Test first.** Every task writes its failing test, runs it and sees it fail for the stated
  reason, then writes the code.
- **Fiscal gate, every part, run UNEDITED and passing before the part's PR:**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/sale-amount.huella.test.ts src/money-conversion.huella.test.ts src/correction-amount.huella.test.ts`
  (the last three are the record-fingerprint suites in `packages/fiscal-verifactu/src`, listed with
  `ls packages/fiscal-verifactu/src/*.huella*.test.ts` on 2026-10-15). If any needs an edit to pass, STOP: something printed is reaching a filed record or a hash,
  which this item must never do. Nothing in this plan writes to `sales`, `sale_lines`,
  `registros_facturacion`, the QR text or any input of `computeHuella` — except Part 2c, which the
  owner approved (Q9) to add one column to `sale_lines` that must reach no fiscal record; see Part 2c.
- **If a point turns out to need a change to what is filed or hashed, STOP that point** and add it
  to "Owner questions" in this plan instead of building it.
- **Review path: FULL for every part** (CLAUDE.md §5 — a printed invoice is a legal document):
  per-task reviews, then `/finish-branch` with the Codex run-it seat run twice (the second told to
  set this plan's checklist aside and test what it does not name).
- **Keep existing behavioural assertions.** Many suites read the printed receipt back as text
  (`apps/server/src/testing/decode-ticket.ts`). When a layout change moves a line, update the test's
  expectation of WHERE or HOW it prints, never delete the fact it checks (that the NIF, the TOTAL,
  the change, the VERI\*FACTU line, … are printed). A test whose subject is a removed line (the
  «Precio sin IVA» line in Part 2) is rewritten to assert its replacement.
- **The two captured byte files** `apps/server/src/testing/full-invoice-58mm.bin` and
  `full-invoice-80mm.bin` (read by `receipt-document.test.ts:12-29`) pin the full invoice's exact
  paper bytes. A task that changes the full invoice's paper regenerates them, and its commit message
  lists the decoded text before and after (`printedLines`), so a reviewer sees the change in words.
- **Labels** are added to `RECEIPT_LABEL_KEYS` (`packages/country/src/country.ts:56-80`) and to all
  four languages in `packages/country-es/src/receipt-labels.ts` (es-ES, ca-ES, gl-ES, eu-ES). No
  existing key is removed: the till app reads `fullInvoice` and `netUnitPrice`
  (`apps/till/src/screens/till-ticket-view.ts:90,670`).
- **Money and rates are display-only here.** Sums of money use `@waitron/shared`'s decimal helpers
  (`addDecimal`, `divideDecimal`, …), never JavaScript arithmetic on floats. `Number(value)` is used
  only to hand a value to `Intl.NumberFormat`, as `formatMoney` already does
  (`apps/server/src/receipt-money.ts:8-18`).
- **Running the receipt suites.** Layout changes ripple into every suite that reads a printed
  receipt back. After a layout task, check memory (`memory_pressure | grep free`), then run them all:

  ```bash
  cd <worktree> && git grep -l -E "decodeTicket|printedLines|printedCommands|layoutInvoicePages|renderInvoicePdf|renderInvoiceRaster|buildReceiptDocument|formatReceipt" -- 'apps/server/src/*.test.ts' | sed 's#^apps/server/##' | xargs pnpm --filter @waitron/server exec vitest run
  ```

  Read the `Tests` count in the output; a run without one proves nothing (CLAUDE.md §4).
- **LOOK.** Part 1a's Task 1.8 adds `apps/server/scripts/receipt-look.ts`, which writes PNG
  pictures of real tickets (58 mm at 203 dpi, 80 mm at 180 dpi) and the A4 page; Task 1.7 and each
  later part extend it. Every part ends by running it and opening every picture. CLAUDE.md §4: a page asserted only as text has nothing checking that it
  renders.

## A661 overlap — files to leave alone until it lands

Lane A's branch `feat/a661-invoice-printer-on-device-profile` (worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a661-invoice-printer-on-device-profile`) is
open, with no pull request yet (`gh pr list --head feat/a661-invoice-printer-on-device-profile`
returned `[]` on 2026-10-15). At its commit `c7a59d097`,
`git -C /Users/clintongormley/workspace/worktrees/waitron-feat-a661-invoice-printer-on-device-profile diff --name-only origin/main...HEAD | wc -l`
counted 125 files (run 2026-10-15, after a `git fetch`). The ones this plan could touch:

- `apps/server/src/receipt-print.ts` and `apps/server/src/receipt-print.test.ts` (+58/−2 and
  +99/−1 lines there, `git diff --numstat`). **Parts 3 and 4 must edit `receipt-print.ts`**
  (`buildReceiptBytes`, `receipt-print.ts:141-201`, is where the paper receipt gathers its inputs),
  and **Task 1.5 must change `receipt-print.test.ts`**: it asserts the legal name and NIF joined by
  " · " on one line (`receipt-print.test.ts:1968`, `:2175`, `:2201`, `:2216`, `:2256`) and phone and
  email joined (`:2204`), which Task 1.5 puts on separate lines.
- `apps/server/src/bill-payments.test.ts` asserts a printed "Factura completa"
  (`bill-payments.test.ts:1297` on `main`), which Part 2 removes; A661 changes that file and adds
  two more "Factura completa" assertions, in `orders-invoice-deliveries.test.ts` and
  `till-api.deliveries.test.ts` (`:1000` and `:960` on A661's branch).
- `apps/till/src/screens/till-ticket-view.ts` and its test: the till's on-screen copy of the
  receipt, which prints its own «Precio sin IVA … / 1 ud» line and two-decimal rates ("21.00%",
  `till-ticket-view.ts:91-92, 97, 104, 807, 811`). It is outside A663, and A661 changes it; Task
  1.8 adds a backlog entry for it.
- `apps/server/src/till-api.ts`, `apps/server/src/working-order.ts`,
  `apps/server/src/management-api.ts`, `apps/server/src/orders-api.ts`,
  `apps/server/src/errors.ts`, `apps/server/src/invoice-delivery-*.ts`,
  `apps/server/src/invoice-choice-delivery.ts`: no task here edits them.
- `docs/backlog.md` and `docs/backlog/printers.md`: each part's backlog edit is small; rebase over
  A661 if it lands first.
- A661 adds core migrations `0155`–`0157` in `packages/db/drizzle/`.

**So:** Part 1a (Tasks 1.1, 1.3, 1.4, 1.8) starts now. None of its files —
`packages/printing/src/{raster-text,escpos,index}.ts`,
`apps/server/src/{receipt-money,receipt-document,receipt-ticket,invoice-page,invoice-pdf,invoice-raster}.ts`,
their tests, the two `.bin` files and `apps/server/scripts/receipt-look.ts` — is in A661's list
(checked one by one against that `--name-only` list on 2026-10-15); only its backlog edit to
`docs/backlog/printers.md` is. The only printed "21.00%" assertions outside those files are in
`apps/till/src/screens/till-ticket-view.test.ts` (`git grep -n -E "[0-9]\.[0-9]{2}%"` over
`apps/server/src/*.test.ts` and `apps/till/src`), the till screen this item does not change. If a
Part 1a run of the receipt suites still fails in a file A661 changes, stop: move that change to
Part 1b rather than editing the file. Part 1b, Part 2 and Part 3 start only after A661 has
merged (A661 landed 2026-10-15, #1745).

**Whichever of A661 and A663 lands second** re-runs the receipt suites (Global Constraints) on top
of the other and updates the layout assertions that fail — in the files above and in any the other
branch added. It keeps what each one asserted (the facts printed: the NIF, the name, the heading,
the TOTAL, …) and changes only where or how they print, and its PR description names every
assertion it changed.

## Legal re-check — RD 1619/2012 arts. 6 and 7

Fetched 2026-10-15 09:23 UTC with
`curl -sS -L -A "Mozilla/5.0" "https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696"` (HTTP 200,
242,447 bytes), tags stripped with Python and the raw text read. The page says «Última actualización
publicada el 31/03/2026»; arts. 6 and 7 were last changed by RD 1007/2023 (in force 07/12/2023).
Quotes are copied from that text.

| Layout point | What the regulation says | Article |
| ------------ | ------------------------ | ------- |
| Simplified: one rate prints only the rate and «IVA incluido»; several rates print a base per rate | «f) Tipo impositivo aplicado y, opcionalmente, también la expresión «IVA incluido». Asimismo, cuando una misma factura comprenda operaciones sujetas a diferentes tipos impositivos del Impuesto sobre el Valor Añadido deberá especificarse por separado, además, la parte de base imponible correspondiente a cada una de las operaciones.» | 7.1.f |
| Simplified: the number and its series | «a) Número y, en su caso, serie.» | 7.1.a |
| Simplified: the issuer block needs name and NIF, not an address | «d) Número de Identificación Fiscal, así como el nombre y apellidos, razón o denominación social completa del obligado a su expedición.» | 7.1.d |
| Simplified: items | «e) La identificación del tipo de bienes entregados o de servicios prestados.» | 7.1.e |
| Simplified: TOTAL | «g) Contraprestación total.» | 7.1.g |
| Both: operation date only when it differs | «c) La fecha en que se hayan efectuado las operaciones que se documentan […], siempre que se trate de una fecha distinta a la de expedición de la factura.» (7.1.c); the same words in 6.1.i | 7.1.c, 6.1.i |
| Full invoice: address of issuer and customer | «e) Domicilio, tanto del obligado a expedir factura como del destinatario de las operaciones.» | 6.1.e |
| Full invoice: unit price before VAT and a discount not in it | «f) Descripción de las operaciones, consignándose todos los datos necesarios para la determinación de la base imponible […] y su importe, incluyendo el precio unitario sin Impuesto de dichas operaciones, así como cualquier descuento o rebaja que no esté incluido en dicho precio unitario.» | 6.1.f |
| Full invoice: rate and VAT per rate | «g) El tipo impositivo o tipos impositivos, en su caso, aplicados a las operaciones.» «h) La cuota tributaria que, en su caso, se repercuta, que deberá consignarse por separado.» | 6.1.g, h |
| Full invoice: several rates need each item's base | «2. Deberá especificarse por separado la parte de base imponible correspondiente a cada una de las operaciones que se documenten en una misma factura en los siguientes casos: […] c) Cuando se comprendan operaciones sujetas a diferentes tipos del Impuesto sobre el Valor Añadido.» | 6.2.c |
| Both: the QR and the VERI\*FACTU phrase stay | «a) La representación gráfica del contenido parcial de la factura mediante un código "QR".» «b) […] la frase "Factura verificable en la sede electrónica de la AEAT" o "VERI\*FACTU" […]» (6.5); 7.5 applies 6.5 to simplified invoices | 6.5, 7.5 |

**Nothing in the fetched text contradicts the spec.** Two things it adds that the spec does not say:

1. Art. 6.1.e's second sentence: «Cuando el obligado a expedir factura o el destinatario de las
   operaciones dispongan de varios lugares fijos de negocio, deberá indicarse la ubicación de la sede
   de actividad o establecimiento al que se refieran aquéllas en los casos en que dicha referencia sea
   relevante para la determinación del régimen de tributación correspondiente a las citadas
   operaciones.» Printing both addresses when they differ (point 3) already shows the premises. No
   change needed; noted so a reviewer does not read point 3 as "either address will do".
2. Art. 7.1.c (operation date) applies to simplified invoices too. The document builder prints an
   operation date only on a full invoice (`receipt-document.ts:191`), and the reader sets one only
   when the sale has a customer tax id (`receipt-issuer.ts:31`). Whether a simplified invoice can
   ever carry an operation date different from its issue date was not checked. It is outside A663;
   Task 2.6 adds it to the backlog as a question to check, not as a defect.

Art. 6.2.c (each item's base when several rates apply) is met by the full invoice's table: each
item's base is its amount less its discount row, and the base per rate prints below (Part 2, "The
rule this part builds"). (Revised 2026-10-15: the spec's claim that the amount column alone gives
each item's base stopped being true once the owner's Q5 answer put the amount before the
discount.)

---

## Review Focus

The five inputs most likely to go wrong for a person using this, which no single task's main test
exercises; each has its test added to the task named.

1. **A TOTAL too wide for double size.** On 58 mm paper a double-size line has 15 cells
   (30 columns ÷ 2, `packages/printing/src/layout.ts:8`). «TOTAL 1234,56 €» is 15 characters and
   fits; «TOTAL 10.000,00 €» is 17 and does not (es-ES formats measured with Node v26.11.1,
   2026-10-15). Expected: TOTAL and its amount double size on two lines, and if the amount alone is
   wider than 15, the whole TOTAL at normal size — never cut off. Test in Task 1.4.
2. **A long trading name or legal name in bold.** Bold must wrap like any other line and read back as
   the same words. Test in Task 1.5.
3. **A full invoice on 58 mm paper with two VAT rates.** The table gains a rate column and the item
   column becomes too narrow. Expected: each item's name on its own line with its figures on the
   next, nothing truncated. Test in Task 2.2.
4. **A full invoice line with no filed before-VAT figures** (`TillSaleLine.net` absent; the builder
   already has a branch for it at `receipt-document.ts:245-251`). Expected: that item (its dish
   group) alone still prints, with its amount with VAT and «(IVA incluido)», in the simplified row
   form rather than a table row with empty cells; the other items stay in the table. Test in Task
   2.3b.
5. **A venue address that matches the registered address except for case, commas or spacing.**
   Expected: printed once. And one that differs by a single real character (a different number):
   both printed, the registered one labelled. Test in Task 2.4.

---

# Part 1 — formatting, styles, ruled sections and the simplified receipt

Two pull requests:

- **Part 1a**, branch `feat/a663-1-receipt-layout`, starts now: Task 1.1, Task 1.3, Task 1.4, then
  Task 1.8 (its own LOOK, fiscal gate and backlog step, written after Task 1.4 below).
- **Part 1b**, branch `feat/a663-1b-receipt-layout`, from `main` after Part 1a **and A661** have
  merged (A661 landed 2026-10-15, #1745): Task 1.2, Task 1.5, Task 1.6a, Task 1.6b, Task 1.7.

### Task 1.1: Bold and double-size lines in `@waitron/printing`, readable back as text (Part 1a)

Today every line is one 28-dot picture drawn from the glyph table
(`packages/printing/src/raster-text.ts:17-40`), and the decoder that tests and the dashboard's print
preview use (`readRasterText`, `raster-text.ts:72-108`) returns `undefined` for any picture that is
not exactly a regular line. The glyphs are already Iosevka Term **Bold**
(`packages/printing/src/glyphs.ts:1`), so "bold" here means one dot heavier: each glyph row ORed
with itself shifted one dot right, kept inside its 12-dot cell. Measured 2026-10-15 (a throwaway
`tsx` script over `GLYPHS` applying that rule to every row, Node v26.11.1): there are 339 glyphs.
Three look the same bold as regular: space, no-break space and em dash (U+2014). The only bold
picture equal to a DIFFERENT glyph's regular picture is the blank one (space and no-break space).
Glyphs that share a bold picture form three groups — hyphen, soft hyphen and en dash; Đ and Ð;
space and no-break space — the same three groups that already share a regular picture. So the
decoder takes the lowest code point among glyphs sharing a bold picture, the rule it already
applies to regular pictures (`raster-text.ts:42-53`). Double size draws each glyph 2×2,
24 dots wide and 56 tall, over half as many cells starting at the same `offsetDots`, so a double
line's right edge lines up with the normal lines' right edge.

**Files:**
- Modify: `packages/printing/src/raster-text.ts`
- Modify: `packages/printing/src/escpos.ts:68-81` (`line`)
- Modify: `packages/printing/src/index.ts:20` (export `TextStyle`, `textBandHeight`)
- Test: `packages/printing/src/raster-text.test.ts`, `packages/printing/src/escpos.test.ts`

**Interfaces:**
- Produces: `export interface TextStyle { bold?: boolean; double?: boolean }`;
  `export function textBandHeight(style?: TextStyle): number` (28 or 56);
  `drawTextBand(text, grid, align = "left", style: TextStyle = {}): Uint8Array`;
  `EscBuilder.line(s = "", style: TextStyle = {}): this`;
  `readRasterText(widthDots, heightDots, data)` now also reads bold lines and 56-dot double lines.

- [ ] **Step 1: Write the failing tests** (append to `raster-text.test.ts`)

```ts
import { GLYPHS } from "./glyphs.js";
import { gridForWidth, SETTING_WIDTHS } from "./layout.js";
import { TEXT_BAND_HEIGHT, drawTextBand, readRasterText, textBandHeight } from "./raster-text.js";

describe("bold and double-size lines", () => {
  it.each(SETTING_WIDTHS)("reads a bold line back as its text at $widthDots dots", ({ widthDots }) => {
    const grid = gridForWidth(widthDots);
    const band = drawTextBand("Santet Deli Co", grid, "center", { bold: true });
    expect(band).not.toEqual(drawTextBand("Santet Deli Co", grid, "center"));
    expect(readRasterText(widthDots, TEXT_BAND_HEIGHT, band)?.trim()).toBe("Santet Deli Co");
  });

  it("reads every glyph back when drawn bold, the lowest code point winning a shared picture", () => {
    const grid = gridForWidth(512);
    const byPicture = new Map<string, string>();
    for (const [codePoint] of GLYPHS) {
      const ch = String.fromCodePoint(codePoint);
      const key = Buffer.from(drawTextBand(ch, grid, "left", { bold: true })).toString("hex");
      if (!byPicture.has(key)) byPicture.set(key, ch);
      const expected = byPicture.get(key)!;
      expect(readRasterText(512, TEXT_BAND_HEIGHT, Buffer.from(key, "hex")), ch).toBe(
        expected === " " ? "" : expected,
      );
    }
  });

  it.each(SETTING_WIDTHS)("draws a double line 56 dots tall on half the cells at $widthDots", ({ widthDots }) => {
    const grid = gridForWidth(widthDots);
    expect(textBandHeight({ double: true })).toBe(56);
    const band = drawTextBand("TOTAL 407,00 €", grid, "left", { double: true });
    expect(band.length).toBe((widthDots / 8) * 56);
    expect(readRasterText(widthDots, 56, band)).toBe("TOTAL 407,00 €");
  });

  it("cuts a double line at half the columns", () => {
    const grid = gridForWidth(360); // 58 mm, 30 columns, so 15 double cells
    const band = drawTextBand("TOTAL 10.000,00 €", grid, "left", { double: true });
    expect(readRasterText(360, 56, band)).toBe("TOTAL 10.000,00");
  });

  it("right-aligns a double line to the normal lines' right edge", () => {
    const grid = gridForWidth(512); // 80 mm, 42 columns
    const normal = drawTextBand("407,00 €".padStart(42), grid);
    const double = drawTextBand("407,00 €".padStart(21), grid, "left", { double: true });
    const lastInk = (data: Uint8Array, height: number) => {
      let last = -1;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < 512; x++) if (data[y * 64 + (x >> 3)]! & (0x80 >> (x & 7))) last = Math.max(last, x);
      return last;
    };
    // Both grids end at the same dot; the last cell is 12 dots wide normally and 24 doubled, so the
    // double line's last ink sits at twice the normal glyph's offset within its cell, plus one.
    const end = grid.offsetDots + grid.columns * 12;
    const offsetInCell = lastInk(normal, 28) - (end - 12);
    expect(lastInk(double, 56)).toBe(end - 24 + 2 * offsetInCell + 1);
  });

  it("does not read a 56-dot picture that is not a double line", () => {
    expect(readRasterText(512, 56, new Uint8Array(64 * 56).fill(0xff))).toBeUndefined();
  });
});
```

Add to `escpos.test.ts`:

```ts
it("draws a bold line and a double line as text images of their own heights", () => {
  const bytes = esc({ paperWidth: "80mm", resolution: "180dpi" })
    .line("A", { bold: true })
    .line("B", { double: true })
    .bytes();
  // escPosCommands (./testing/escpos-commands.js) steps over image data, so bytes inside a
  // picture are never mistaken for a command.
  const heights = escPosCommands(bytes)
    .filter((command) => command.name === "GS v 0")
    .map((command) => command.heightDots);
  expect(heights).toEqual([28, 56]);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/printing exec vitest run src/raster-text.test.ts src/escpos.test.ts`
Expected: FAIL — `textBandHeight` is not exported, and `drawTextBand`'s fourth argument is ignored.

- [ ] **Step 3: Implement** (in `raster-text.ts`)

```ts
export interface TextStyle {
  bold?: boolean;
  double?: boolean;
}

export function textBandHeight(style: TextStyle = {}): number {
  return style.double === true ? TEXT_BAND_HEIGHT * 2 : TEXT_BAND_HEIGHT;
}

/** One dot heavier: the row ORed with itself one dot to the right, kept inside its cell. */
function embolden(row: number): number {
  return (row | (row >> 1)) & 0xfff;
}

export function drawTextBand(
  text: string,
  grid: TextGrid,
  align: Alignment = "left",
  style: TextStyle = {},
): Uint8Array {
  if (grid.widthDots % 8 !== 0) {
    throw new RangeError(`a text band's width must be a whole number of bytes, got ${grid.widthDots}`);
  }
  const scale = style.double === true ? 2 : 1;
  const height = TEXT_BAND_HEIGHT * scale;
  const cells = Math.floor(grid.columns / scale);
  const stride = grid.widthDots / 8;
  const data = new Uint8Array(stride * height);
  const characters = [...prepareText(text)].slice(0, cells);
  const free = cells - characters.length;
  const firstCell = align === "center" ? Math.floor(free / 2) : align === "right" ? free : 0;
  characters.forEach((ch, i) => {
    const rows = glyphRows(ch)!;
    const left = grid.offsetDots + (firstCell + i) * GLYPH_WIDTH * scale;
    for (let y = 0; y < height; y++) {
      const source = rows[Math.floor(y / scale)]!;
      const row = style.bold === true ? embolden(source) : source;
      for (let dx = 0; dx < GLYPH_WIDTH * scale; dx++) {
        if ((row & (0x800 >> Math.floor(dx / scale))) === 0) continue;
        const x = left + dx;
        data[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    }
  });
  return data;
}
```

Add a second picture map beside `BY_PICTURE` built from `embolden` applied to each row (lowest code
point first, skipping a glyph whose emboldened picture equals its own regular one: space, no-break
space and em dash, measured above). In `readRasterText`:
- for `heightDots === TEXT_BAND_HEIGHT`, look a cell up in `BY_PICTURE` and then in the bold map;
- for `heightDots === TEXT_BAND_HEIGHT * 2`, read `Math.floor(grid.columns / 2)` cells of 24 dots
  from `grid.offsetDots`, sampling every second row and every second dot, look each cell up in both
  maps, then redraw what was read with `drawTextBand(read, grid, "left", { double: true, bold })`
  and return `undefined` unless the redraw equals `data` byte for byte (so no picture that merely
  resembles text is read as text). Ink outside the cells returns `undefined`, as for a normal line.

In `escpos.ts`, `line(s = "", style: TextStyle = {})` pushes
`this.pushRaster(Math.ceil(widthDots / 8), textBandHeight(style), drawTextBand(s, grid, this.alignment, style))`.

- [ ] **Step 4: Run the tests and the package's coverage**

Run: `pnpm --filter @waitron/printing exec vitest run src/raster-text.test.ts src/escpos.test.ts`
Expected: PASS.
Run: `pnpm --filter @waitron/printing test:coverage` — the package holds 98/98/98/95.

- [ ] **Step 5: Check the decoder's two consumers still read every existing job**

Run: `pnpm --filter @waitron/server exec vitest run src/print-job-preview.test.ts src/testing/decode-ticket.test.ts src/equipment-label.test.ts src/test-page.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 6: Commit** — `git add packages/printing/src && git commit -s -m "Printing: bold and double-size lines that read back as text (A663 task 1.1)"`

### Task 1.2: Receipt labels for the simplified receipt (Part 1b)

**Files:**
- Modify: `packages/country/src/country.ts:56-80` (`RECEIPT_LABEL_KEYS`)
- Modify: `packages/country-es/src/receipt-labels.ts` (all four languages)
- Test: `packages/country-es/src/spain.test.ts`

**Interfaces:**
- Produces label keys `simplifiedInvoice` and `vatIncludedAtRate` (a template holding `{rate}`).

| key | es-ES | ca-ES | gl-ES | eu-ES |
| --- | ----- | ----- | ----- | ----- |
| `simplifiedInvoice` | Factura simplificada | Factura simplificada | Factura simplificada | Faktura erraztua |
| `vatIncludedAtRate` | IVA {rate} incluido | IVA {rate} inclòs | IVE {rate} incluído | BEZa {rate} barne |

The Catalan, Galician and Basque words are this plan's translations, built from the existing labels
beside them (`vatIncluded`: «IVA inclòs», «IVE incluído», «BEZa barne»); no native speaker checked
them (owner question Q7).

- [ ] **Step 1: Failing test** (append to `spain.test.ts`)

```ts
it("labels a simplified invoice and a single VAT rate in every Spanish receipt language", () => {
  for (const [locale, labels] of Object.entries(SPAIN_RECEIPT_LABELS)) {
    expect(labels.simplifiedInvoice, locale).not.toBe("");
    expect(labels.vatIncludedAtRate, locale).toContain("{rate}");
  }
  expect(SPAIN_RECEIPT_LABELS["es-ES"].simplifiedInvoice).toBe("Factura simplificada");
  expect(SPAIN_RECEIPT_LABELS["es-ES"].vatIncludedAtRate.replace("{rate}", "10%")).toBe("IVA 10% incluido");
});
```

- [ ] **Step 2:** Run `pnpm --filter @waitron/country-es exec vitest run src/spain.test.ts` — FAIL
  (property missing; typecheck also fails once the key is in `RECEIPT_LABEL_KEYS`).
- [ ] **Step 3:** Add both keys to `RECEIPT_LABEL_KEYS` and the four language objects.
- [ ] **Step 4:** Run `pnpm --filter @waitron/country-es exec vitest run` and
  `pnpm --filter @waitron/country-packs exec vitest run` — PASS; then
  `pnpm --filter @waitron/country exec tsc --noEmit && pnpm --filter @waitron/country-es exec tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -s -m "Receipt labels for a simplified invoice and a single VAT rate (A663 task 1.2)"`

### Task 1.3: VAT rates with significant digits only, and amounts without the € sign (Part 1a)

Today a full invoice line prints `${label.base} ${line.net.rate}%` with the rate as stored, "10.00"
(`receipt-document.ts:136-138`; the rate comes from `basisPointsToDecimal`,
`apps/server/src/receipt-adjustments.ts:73`), and the summary prints `${v.rate}%`
(`receipt-document.ts:261-262`). Spec point 5: "10%", "17,5%", in the receipt language's decimal
mark. Measured with Node v26.11.1 on 2026-10-15: `Intl.NumberFormat(locale, { maximumFractionDigits: 2 })`
formats 17.5 as "17,5" in es-ES, ca-ES, gl-ES and eu-ES and "17.5" in en-GB, and 10 as "10".
`Intl`'s own percent style writes "10 %" (es) and "% 10" (eu); the receipt keeps today's "10%" with
no space in every language, which is what the spec shows.

The mockups print item amounts without the € sign and keep it on TOTAL, VAT and payment lines;
`formatAmount` is that form.

**Files:**
- Modify: `apps/server/src/receipt-money.ts`
- Modify: `apps/server/src/receipt-document.ts:136-138, 261-262` (use `formatVatRate`)
- Test: `apps/server/src/receipt-money.test.ts`, `apps/server/src/receipt-document.test.ts`
- Regenerate: `apps/server/src/testing/full-invoice-58mm.bin`, `full-invoice-80mm.bin`

**Interfaces:**
- Produces: `formatVatRate(rate: string, locale: string): string` → `"10%"`, `"17,5%"`;
  `formatAmount(value: string, locale: string): string` → `"1234,56"`, `"-1,21"` (two decimals, no
  currency, the same space and minus-sign clean-up as `formatMoney`).

- [ ] **Step 1: Failing tests** (append to `receipt-money.test.ts`)

```ts
import { formatAmount, formatVatRate } from "./receipt-money.js";

describe("formatVatRate", () => {
  it.each([
    ["10.00", "es-ES", "10%"],
    ["10", "es-ES", "10%"],
    ["17.50", "es-ES", "17,5%"],
    ["17.5", "ca-ES", "17,5%"],
    ["5.25", "eu-ES", "5,25%"],
    ["0.00", "es-ES", "0%"],
    ["17.50", "en-GB", "17.5%"],
  ])("writes %s in %s as %s", (rate, locale, expected) => {
    expect(formatVatRate(rate, locale)).toBe(expected);
  });
});

describe("formatAmount", () => {
  it.each([
    ["13.64", "es-ES", "13,64"],
    ["1234.56", "es-ES", "1234,56"],
    ["10000.00", "es-ES", "10.000,00"],
    ["-1.21", "eu-ES", "-1,21"],
  ])("writes %s in %s as %s", (value, locale, expected) => {
    expect(formatAmount(value, locale)).toBe(expected);
  });
});
```

And in `receipt-document.test.ts` (the shared fixture stores rates as `"21"` and `"10"`,
`apps/server/src/testing/full-invoice-fixture.ts:42,49`, so it never showed the problem; a real
filed line reads `basisPointsToDecimal`'s two-decimal form, `RATE_SCALE = 2`,
`packages/shared/src/scales.ts:21`):

```ts
it("writes a filed line's two-decimal rate with significant digits only", () => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  input.result.lines[0]!.net!.rate = "21.00";
  input.result.lines[1]!.net!.rate = "17.50";
  input.result.vatBreakdown = [
    { rate: "21.00", base: "9.00", tax: "1.89" },
    { rate: "17.50", base: "8.00", tax: "0.80" },
  ];
  const captions = buildReceiptDocument(input).elements.flatMap((e) =>
    e.kind === "amount" ? [e.caption] : [],
  );
  expect(captions).toEqual(expect.arrayContaining(["Base 21%", "IVA 21%", "Base 17,5%", "IVA 17,5%"]));
  expect(captions.some((c) => c.includes(".00%") || c.includes("17.5"))).toBe(false);
});
```

- [ ] **Step 2:** Run `pnpm --filter @waitron/server exec vitest run src/receipt-money.test.ts src/receipt-document.test.ts` — FAIL (`formatVatRate` not exported).
- [ ] **Step 3: Implement**

```ts
const rateFormatters = new Map<string, Intl.NumberFormat>();
const amountFormatters = new Map<string, Intl.NumberFormat>();

function cached(map: Map<string, Intl.NumberFormat>, locale: string, options: Intl.NumberFormatOptions) {
  let formatter = map.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, options);
    map.set(locale, formatter);
  }
  return formatter;
}

/** A VAT rate as a receipt prints it: significant digits only, the locale's decimal mark, then "%". */
export function formatVatRate(rate: string, locale: string): string {
  return `${cached(rateFormatters, locale, { maximumFractionDigits: 2 }).format(Number(rate))}%`;
}

/** An amount without the currency sign, for the rows inside a receipt's item list. */
export function formatAmount(value: string, locale: string): string {
  return cached(amountFormatters, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number(value))
    .replace(/[\u{a0}\u{202f}]/gu, " ")
    .replace(/\u{2212}/gu, "-");
}
```

Use `formatVatRate(…, locale)` at `receipt-document.ts:136`, `:138`, `:261` and `:262` in place of
`` `${…rate}%` ``. (`formatAmount` is used from Task 1.6 on, in Part 1b; in Part 1a only its own
tests call it.)

- [ ] **Step 4:** Run the two files again — PASS. The byte check ("keeps the captured F1 paper
  bytes", `receipt-document.test.ts:12-29`) should still pass, since the fixture's rates were already
  whole; if it fails, regenerate the two `.bin` files (write what
  `formatReceipt({ ...FULL_INVOICE_FIXTURE, printer: { paperWidth, resolution: "180dpi" } })` returns
  for each width, with a one-off `tsx` command) only after `printedLines` shows the sole difference
  is a rate's spelling.
- [ ] **Step 5:** Run the receipt suites (Global Constraints) — PASS after updating any expectation
  that spelled a rate with two decimals (`receipt-ticket.test.ts:348-349, 481` today). If the
  failing file is one A661 changes, stop (see "A661 overlap").
- [ ] **Step 6: Commit** — message lists the decoded before/after lines of the `.bin` files.

### Task 1.4: Styles on the document, drawn on paper and on A4 (Part 1a)

The document gains a `style` on text and amount elements. The roll renderer draws them with
Task 1.1's styles; a double-size amount row wraps at half the columns with this rule (Review Focus
1): caption and amount on one double line when they fit in `columns / 2`; otherwise the caption on
one double line and the amount right-aligned on the next, when the amount fits; otherwise the whole
row at normal size. The A4 page draws bold as filled-and-stroked text (no second font file is
added, so no new licence notice), and double size at twice the body size.

**Files:**
- Modify: `apps/server/src/receipt-document.ts:47-55` (element types)
- Modify: `apps/server/src/receipt-ticket.ts:63-108`
- Modify: `apps/server/src/invoice-page.ts` (`PageText` gains `bold`; `text()` takes a size)
- Modify: `apps/server/src/invoice-pdf.ts:21-23`, `apps/server/src/invoice-raster.ts:24-37`
- Test: `apps/server/src/receipt-ticket.test.ts`, `apps/server/src/invoice-pdf.test.ts`

**Interfaces:**
- Produces: `export type ReceiptStyle = { bold?: true; double?: true }`; the `text` and `amount`
  elements gain `style?: ReceiptStyle`; `PageText` gains `bold: boolean`.
- Consumes: Task 1.1's `TextStyle`, `EscBuilder.line(s, style)`.

To test styles before Task 1.5 uses them, this task makes the TOTAL row `style: { double: true }`
in `buildReceiptDocument` (it is double size in both approved mockups) and nothing else.

- [ ] **Step 1: Failing tests** (in `receipt-ticket.test.ts`, which already defines
  `FILED_WITHOUT_TEXT` (total 20,90), `ISSUER`, `PRINTER_58` and `PRINTER_80` at its top;
  `printedCommands` is already imported there)

```ts
function doubleLines(result: TillSaleResult, printer: EscSetting): string[] {
  return printedCommands(
    formatReceipt({ result, issuer: ISSUER, receipt: {}, invoiceLocale: "es-ES", printer }),
  )
    .filter((command) => command.heightDots === 56)
    .map((command) => (command.text ?? "<not text>").trim().replace(/\s+/g, " "));
}

it.each([PRINTER_58, PRINTER_80])("draws TOTAL double size on one line when it fits ($paperWidth)", (printer) => {
  expect(doubleLines(FILED_WITHOUT_TEXT, printer)).toEqual(["TOTAL 20,90 €"]);
});

it("puts a wide TOTAL's amount on its own double line on 58 mm", () => {
  expect(doubleLines({ ...FILED_WITHOUT_TEXT, total: "10000.00" }, PRINTER_58)).toEqual([
    "TOTAL",
    "10.000,00 €",
  ]);
});

it("keeps a wide TOTAL on one double line on 80 mm", () => {
  expect(doubleLines({ ...FILED_WITHOUT_TEXT, total: "10000.00" }, PRINTER_80)).toEqual([
    "TOTAL 10.000,00 €",
  ]);
});

it("prints TOTAL at normal size when even its amount is wider than half the paper", () => {
  const huge = { ...FILED_WITHOUT_TEXT, total: "1234567890123.00" };
  const bytes = formatReceipt({ result: huge, issuer: ISSUER, receipt: {}, invoiceLocale: "es-ES", printer: PRINTER_58 });
  expect(decodeTicket(bytes)).toContain("1.234.567.890.123,00 €");
  expect(doubleLines(huge, PRINTER_58)).toEqual([]);
});
```

(The totals above do not match the fixture's lines; these cases check only the TOTAL row.)

In `invoice-pdf.test.ts`:

```ts
it("draws TOTAL at twice the body size", () => {
  const total = layoutInvoicePages(fixture)[0]!.elements.find(
    (element) => element.kind === "text" && element.text.startsWith("TOTAL"),
  );
  expect(total).toMatchObject({ kind: "text", size: 20 });
});
```

- [ ] **Step 2:** Run `pnpm --filter @waitron/server exec vitest run src/receipt-ticket.test.ts src/invoice-pdf.test.ts` — FAIL (TOTAL is one 28-dot line; A4 size 10).
- [ ] **Step 3: Implement**
  - `receipt-document.ts`: add `style?: ReceiptStyle` to the two element kinds; `row()` and
    `text()` take an optional style; the TOTAL row (`receipt-document.ts:265`) passes
    `{ double: true }`.
  - `receipt-ticket.ts`: for a `text` element, wrap at `style.double ? Math.floor(columns / 2) : columns`
    and draw each line with `b.line(line, toTextStyle(element.style))`. For an `amount` element with
    `double`, apply the three-step rule above using `labelAmountLines` at `half = Math.floor(columns / 2)`
    (one line: draw it double; caption alone fits and `amount.length <= half`: caption double, then
    `amount.padStart(half)` double; else: `labelAmountLines(…, columns, …)` at normal size). Bold
    without double wraps at `columns`.
  - `invoice-page.ts`: `PageText` gains `bold: boolean`; `width(text, size)` scales by size; the
    `text()` helper takes `{ size, bold }`; a `double` element uses `BODY_SIZE * 2` and a line height
    of `LINE_HEIGHT * 2`.
  - `invoice-pdf.ts`: for a bold element, `pdf.lineWidth(0.35).fontSize(size).text(text, x, y, { lineBreak: false, fill: true, stroke: true })`.
  - `invoice-raster.ts`: for a bold element, add `stroke="black" stroke-width="${0.35 / size}"` to
    each glyph `<path>` (the path is drawn in font units scaled by `size`, so the width is divided
    by the same scale).
- [ ] **Step 4:** Run the two files — PASS. Run the receipt suites; update any test that found TOTAL
  by an exact 28-dot line or by A4 size 10, keeping what it asserted (that TOTAL is printed, its
  amount, its position after the VAT lines on a full invoice). If the failing file is one A661
  changes, stop (see "A661 overlap"). Regenerate the two `.bin` files as in Task 1.3 Step 4 (the
  full invoice's TOTAL is now double size), with the decoded before/after in the commit message.
- [ ] **Step 5: Commit** — `git commit -s -m "Receipts: TOTAL drawn double size on paper and A4 (A663 task 1.4)"`

### Task 1.8: Part 1a's LOOK, the fiscal gate and the backlog (Part 1a, done right after Task 1.4)

Numbered 1.8 so no other task is renumbered; it is Part 1a's last task, done after Task 1.4 and
before Part 1a's pull request.

**Files:**
- Create: `apps/server/scripts/receipt-look.ts` (not under coverage: `apps/server/vitest.config.ts:36`
  excludes `scripts/**`; the other demo scripts there follow the same pattern, e.g.
  `apps/server/scripts/daily-close-demo.ts`)
- Modify: `docs/backlog/printers.md` (A663 entry: what Part 1a delivered, and two follow-ups)

- [ ] **Step 1: Write the script.** Its samples use real units: a counted line carries
  `unitName: { es: "ud" }` and a weighed one `unitName: { es: "kg" }`, because real receipts print
  the unit (measured by the plan's reviewer on 2026-10-15: `4 ud  Hamburguesa` on a simplified
  receipt, `0.35 kg  Jamón ibérico`; the code is `receipt-document.ts:207-211`, which prints
  `${dish.quantity}${unit}` before the name).

```ts
// Writes PNG pictures of real receipts for a person to look at, never run by CI.
// Run: pnpm --filter @waitron/server exec tsx scripts/receipt-look.ts <out-dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { escPosCommands } from "@waitron/printing/src/testing/escpos-commands.js";
import type { EscSetting } from "@waitron/printing";
import { formatReceipt } from "../src/receipt-ticket.js";
import { renderInvoiceRaster } from "../src/invoice-raster.js";
import { renderInvoicePdf } from "../src/invoice-pdf.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "../src/testing/full-invoice-fixture.js";
import type { ReceiptDocumentInput } from "../src/receipt-document.js";

const { default: sharp } = await import("sharp"); // as invoice-raster.ts:16 loads it
const out = process.argv[2] ?? "/tmp/a663-look";
mkdirSync(out, { recursive: true });

const PRINTERS: Record<string, EscSetting> = {
  "58mm-203": { paperWidth: "58mm", resolution: "203dpi" },
  "80mm-180": { paperWidth: "80mm", resolution: "180dpi" },
};

async function ticketPng(bytes: Uint8Array, file: string): Promise<void> {
  const images = escPosCommands(bytes)
    .filter((c) => c.name === "GS v 0")
    .map((c) => ({ width: c.widthDots!, height: c.heightDots!, bits: bytes.subarray(c.offset + 8, c.offset + c.length) }));
  const width = Math.max(...images.map((i) => i.width));
  const height = images.reduce((sum, i) => sum + i.height, 0);
  const pixels = Buffer.alloc(width * height, 255);
  let top = 0;
  for (const image of images) {
    const stride = image.width / 8;
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++)
        if (image.bits[y * stride + (x >> 3)]! & (0x80 >> (x & 7))) pixels[(top + y) * width + x] = 0;
    top += image.height;
  }
  await sharp(pixels, { raw: { width, height, channels: 1 } }).png().toFile(join(out, file));
}

const line = (quantity: string, name: string, gross: string, unit = "ud") => ({
  descriptions: { "es-ES": name },
  unitName: { es: unit },
  quantity,
  gross,
});

// The sale in 1-simplified-receipt.png: seven lines, one rate, cash.
const MOCKUP: ReceiptDocumentInput = {
  result: {
    locale: "es-ES",
    orderLabel: "Mesa 12",
    orderNumber: 112,
    invoiceNumber: "T-2026/000112",
    issuedAt: "2026-10-13T14:53:00.000Z",
    total: "407.00",
    vatBreakdown: [{ rate: "10.00", base: "370.00", tax: "37.00" }],
    lines: [
      line("1", "Bloody Mary", "15.00"),
      line("4", "Agua, pan y aceite", "24.00"),
      line("4", "Menú degustación", "320.00"),
      line("4", "Copa de tinto", "28.00"),
      line("1", "Copa de blanco", "8.00"),
      line("1", "Café doble", "4.00"),
      line("1", "Orujo blanco", "8.00"),
    ],
    tender: { method: "cash", change: "13.00" },
    qr: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B00000000&numserie=T-2026%2F000112&fecha=13-10-2026&importe=407.00",
    qrText: { caption: "QR tributario:", legend: "VERI*FACTU" },
  },
  issuer: { venueName: "SANTET DELI CO S.L.", nif: "B00000000" },
  receiptHeader: { tradingName: "Santet Deli Co", printTradingName: true },
  receipt: { footerMessage: "¡Gracias por su visita!" },
  venueAddress: ["Avinguda d'Icària 215, Bajos", "08005 Barcelona"],
  invoiceLocale: "es-ES",
};

// A filed full invoice reads its rates in two-decimal form (Task 1.3), so the sample does too.
const FULL = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
FULL.result.lines[0]!.net!.rate = "21.00";
FULL.result.lines[1]!.net!.rate = "10.00";
FULL.result.vatBreakdown = [
  { rate: "21.00", base: "9.00", tax: "1.89" },
  { rate: "10.00", base: "8.00", tax: "0.80" },
];
for (const filed of FULL.result.lines) filed.unitName = { es: "ud" };

const SAMPLES: Record<string, ReceiptDocumentInput> = {
  "simplified-one-rate": MOCKUP,
  "simplified-two-rates": {
    ...MOCKUP,
    result: {
      ...MOCKUP.result,
      total: "83.10",
      vatBreakdown: [
        { rate: "10.00", base: "51.82", tax: "5.18" },
        { rate: "21.00", base: "21.57", tax: "4.53" },
      ],
      lines: [
        line("1", "Bloody Mary", "15.00"),
        line("0.35", "Jamón ibérico", "42.00", "kg"),
        line("2", "Refresco para llevar", "26.10"),
      ],
      tender: { method: "cash", change: "6.90" },
    },
  },
  "simplified-big-total": {
    ...MOCKUP,
    result: {
      ...MOCKUP.result,
      total: "12345.67",
      vatBreakdown: [{ rate: "10.00", base: "11223.34", tax: "1122.33" }],
      lines: [line("1", "Banquete de boda", "12345.67")],
      tender: { method: "cash", change: "0.00" },
    },
  },
  "full-invoice": { ...FULL, surface: "thermal" },
};

for (const [name, input] of Object.entries(SAMPLES))
  for (const [paper, printer] of Object.entries(PRINTERS))
    await ticketPng(formatReceipt({ ...input, printer }), `${name}-${paper}.png`);

const pages = await renderInvoiceRaster(FULL, 300);
for (const [index, page] of pages.entries())
  await sharp(page.pixels, { raw: { width: page.width, height: page.height, channels: 1 } })
    .png()
    .toFile(join(out, `full-invoice-a4-page${index + 1}.png`));
writeFileSync(join(out, "full-invoice-a4.pdf"), await renderInvoicePdf(FULL));
```

The samples are pictures for a person, not fiscal fixtures: their figures add up (each total is
the sum of its lines and of its bases and VAT) but no check reads them. The script must typecheck: `apps/server/tsconfig.json` includes `scripts`, so
`pnpm --filter @waitron/server typecheck` covers it (and the pre-push hook runs it).

- [ ] **Step 2: Run it and LOOK at what Part 1a changed, and only that.**
  `pnpm --filter @waitron/server exec tsx scripts/receipt-look.ts /tmp/a663-look`, then open every
  PNG and the PDF with the Read tool. Check: TOTAL twice the size of the other lines, on both
  documents and both widths, right-aligned with the amounts above it; the 58 mm big total split
  over two double lines («TOTAL», then «12.345,67 €»), nothing cut at the right edge; every rate
  printed «10%» / «21%», never «10.00%», on paper and on the A4 page; TOTAL on A4 at twice the body
  size. The rest of the layout is still today's (Part 1b changes it). Write what you saw in the
  commit message ("opened 58mm-203 one-rate: …").
- [ ] **Step 3: Fiscal gate** (Global Constraints), unedited, PASS.
- [ ] **Step 4: Backlog** — in `docs/backlog/printers.md`'s A663 entry, per `docs/backlog.md` →
  _How to keep this file honest_:
  - point 5: delete its text, leave one line saying which pull request delivered it;
  - point 1: add one line saying TOTAL is drawn double size (Part 1a's pull request), the rest of
    the point still open;
  - the "Plan:" line: Part 1a landed; Part 1b and Part 2 after A661.
  Add two short follow-up entries in the same file, each its own `##` section:
  - **The till's on-screen receipt is a second copy of the layout.** The till draws a sale's
    receipt itself (`apps/till/src/screens/till-ticket-view.ts`): it prints its own «Precio sin IVA
    … / 1 ud» line and two-decimal rates («21.00%», `till-ticket-view.ts:91-92, 97, 104, 807, 811`
    on 2026-10-15), so A663's rate spelling and later its table do not reach it. Bring it into line
    with the printed receipt once A661 (which changes that file) has landed.
  - **Quantities print with "." whatever the receipt language** («0.35 kg» on a Spanish receipt):
    `trimQuantityForDisplay` (`apps/server/src/receipt-lines.ts:16-18`) takes no language. A663 keeps
    today's form; this entry is to print the language's decimal mark («0,35 kg»).
- [ ] **Step 5: Commit, then `/finish-branch <worktree>`** (FULL review path, Codex run-it ×2).

### Task 1.5: Ruled sections and the business block, one fact per line (Part 1b)

Both documents. Today the header joins name and NIF, and phone and email, with " · "
(`receipt-document.ts:169`, `:173-175`), and sections are separated by blank lines (`line()`). The
approved layout: a ruled line between every section; in the business block, one fact per line, the
first line in bold. The first line is the trading name when it prints (today's rule,
`receipt-document.ts:164-167`); otherwise the legal name is bold, and first unless a header subtitle
prints, which then comes first with the bold legal name beneath it (as built in Part 1b,
`receipt-document.ts:188-190` on Part 2's branch, 2026-10-15; the owner chose to keep it). Order: trading name (bold)
· header subtitle · legal name · "NIF: …" · venue address lines · "Tel. …" · email · DUPLICADO when a
copy. The logo stays at the top of the block. Full-invoice-only lines (the registered address,
`receipt-document.ts:176`, and "Factura completa", `:160`) keep their place until Part 2.

Sections, top to bottom (rules between them, none before the first or after the last):
QR block (unchanged: «QR tributario:», QR, VERI\*FACTU — spec point 1, AEAT's QR spec §3) → business
block → heading lines → (customer block, full invoice) → items → totals → payment → footer.
The practice notice stays where it is (first and last line).

The `joined()` helper and the `parts` field it alone sets (`receipt-document.ts:49, 114-119`) lose
their last caller, and so does the part-aware wrapping in `receipt-ticket.ts:38-57`; remove both and
the `PART_SEPARATOR` export if nothing else imports it (`git grep -n PART_SEPARATOR` on 2026-10-15
found only these two files and their tests).

**Files:**
- Modify: `apps/server/src/receipt-document.ts:146-199`
- Modify: `apps/server/src/receipt-ticket.ts` (drop part-aware wrapping)
- Modify: `apps/server/src/invoice-page.ts` (rules: see Step 3)
- Test: `apps/server/src/receipt-document.test.ts`, `apps/server/src/receipt-ticket.test.ts`,
  `apps/server/src/invoice-pdf.test.ts`, `apps/server/src/receipt-preview-api.test.ts`,
  `apps/server/src/receipt-print.test.ts` (changed by A661, which is why this task is in Part 1b)

The existing `describe("the top block (A497)")` in `receipt-document.test.ts` (from line ~100) pins
the block today: its `topBlock` helper ends at the first `break`, and its `joined` helper builds the
" · "-joined lines. Change `topBlock` to end at the first `rule` after the logo, and its
expectations to the one-fact-per-line list below; keep every fact it checks (the duplicate mark,
the subtitle, the trading name rule).

- [ ] **Step 1: Failing tests** (`receipt-document.test.ts`)

```ts
it("puts one fact on each line of the business block, the first one bold", () => {
  const document = buildReceiptDocument({
    ...FULL_INVOICE_DOCUMENT_FIXTURE,
    surface: "thermal",
    receiptHeader: { tradingName: "Santet Deli Co", printTradingName: true },
    receipt: { phone: "910000000", email: "hola@santet.example" },
    venueAddress: ["Avinguda d'Icària 215, Bajos", "08005 Barcelona"],
    result: {
      ...FULL_INVOICE_DOCUMENT_FIXTURE.result,
      invoiceType: "F2",
      issuer: { venueName: "SANTET DELI CO S.L.", nif: "B00000000" },
    },
  });
  const start = document.elements.findIndex((e) => e.kind === "logo");
  const end = document.elements.findIndex((e, i) => i > start && e.kind === "rule");
  expect(document.elements.slice(start + 1, end).filter((e) => e.kind === "text")).toEqual([
    { kind: "text", text: "Santet Deli Co", indent: 0, style: { bold: true } },
    { kind: "text", text: "SANTET DELI CO S.L.", indent: 0 },
    { kind: "text", text: "NIF: B00000000", indent: 0 },
    { kind: "text", text: "Avinguda d'Icària 215, Bajos", indent: 0 },
    { kind: "text", text: "08005 Barcelona", indent: 0 },
    { kind: "text", text: "Tel. 910000000", indent: 0 },
    { kind: "text", text: "hola@santet.example", indent: 0 },
  ]);
});

it("bolds the legal name when no trading name prints", () => {
  const document = buildReceiptDocument({ ...FULL_INVOICE_DOCUMENT_FIXTURE, receiptHeader: undefined });
  const first = document.elements.find((e) => e.kind === "text" && e.text.includes("Charcutería"));
  expect(first).toMatchObject({ text: "Charcutería La Buena SL", style: { bold: true } });
});

it("separates every section with a rule and leaves no blank-line breaks", () => {
  const kinds = buildReceiptDocument(FULL_INVOICE_DOCUMENT_FIXTURE).elements.map((e) => e.kind);
  expect(kinds).not.toContain("break");
  expect(kinds.at(-1)).not.toBe("rule");
  expect(kinds.filter((k) => k === "rule").length).toBeGreaterThanOrEqual(5);
});
```

In `receipt-ticket.test.ts`, a Review Focus 2 case: a 60-character trading name on 58 mm wraps over
three bold lines that `printedLines` reads back as the name's words, and none is longer than 30.

- [ ] **Step 2:** Run the files — FAIL (header still joined; `break` elements present).
- [ ] **Step 3: Implement** the block and the rules in `buildReceiptDocument`. Replace each
  section-ending `line()` with a `rule` element. On A4, `invoice-page.ts` already draws `rule` as a
  thin line across the content width (the `rule` helper in `layoutInvoicePages`, which also carries a
  rule left last on a page over to the next); keep that. The thermal renderer's
  logo spacing reads "was the previous element a blank line" (`receipt-ticket.ts:58-64, 90-96`):
  treat a `rule` as that boundary too, so a logo after the rule gets no extra blank line above it.
- [ ] **Step 4:** Run the files — PASS. Run the receipt suites and update expectations that named
  the joined header ("Charcutería La Buena SL · NIF: B12345678" → two lines; `receipt-document.test.ts:39`),
  and the A4 test that counts exactly one rule (`invoice-pdf.test.ts:257-274`): it becomes "a rule
  directly above TOTAL" plus "rules between sections", keeping its position and same-page checks.
  `receipt-preview-api.test.ts`'s marks (phone, email) find the blocks a field adds; with phone and
  email on their own lines each mark is now one line — update the expected marks, keep that each
  field's mark is found. `receipt-print.test.ts` (as A661 left it) finds the header by
  `"Deli Recibos SL · NIF: "` (`:1968`, `:2175`, `:2201`, `:2216`, `:2256` on `main`) and phone and
  email by `"Tel. +34 910 000 000 · hola@deli.test"` (`:2204`): each becomes the name line, the
  `NIF: …` line, the `Tel. …` line and the email line, keeping what each case checks.
- [ ] **Step 5:** Regenerate the two `.bin` files as in Task 1.3 Step 4. **Commit.**

### Task 1.6: The simplified receipt's own layout (Part 1b, two dispatches: 1.6a and 1.6b)

Done as two implementer dispatches so neither grows long: **Task 1.6a** builds the layout and its
own tests (Steps 1–3 and 4a); **Task 1.6b** updates the other suites the layout ripples into and
regenerates the saved `.bin` files if they changed (Steps 4b–5). 1.6a's commit leaves those other
suites failing on purpose; 1.6b is dispatched straight after it, and no pull request is opened in
between.

For a simplified receipt (`invoiceType` not `"F1"`), after this task the paper reads, section by
section (matching `1-simplified-receipt.png`):

```
QR tributario: / [QR] / VERI*FACTU
---------------------------------
[business block, Task 1.5]
---------------------------------
Mesa 12 · Pedido 112   13 oct 2026, 16:53     ← amount row: order label, issue date
Factura simplificada        T-2026/000112     ← amount row
---------------------------------
1 ud  Bloody Mary                15,00        ← amounts without €
4 ud  Agua, pan y aceite         24,00
      Descuento 10%              -2,40
---------------------------------
TOTAL                       407,00 €          ← double size
IVA 10% incluido             37,00 €          ← one rate
---------------------------------
Efectivo                    420,00 €
Cambio                       13,00 €
---------------------------------
¡Gracias por su visita!
```

With several rates the single «IVA x% incluido» line is replaced by today's pair per rate,
`Base 10%` / `IVA 10%` (art. 7.1.f). (Owner, 2026-10-15, Q11: a one-rate receipt prints the base and
the VAT too, replacing the «IVA 10% incluido» line drawn in `1-simplified-receipt.png`; Part 2b.) The date keeps `Intl`'s own format ("13 oct 2026, 16:53",
measured), not the mockup's comma-less drawing. The quantity keeps today's form, the count and its
unit name («1 ud», «0.35 kg», `receipt-document.ts:207-211`), not the mockup's bare «1»: see owner
question Q8. A bill-wide discount
(`result.billAdjustments`) stays in the items section, after the items. The full invoice keeps its
heading rows, its per-item facts and its VAT-then-TOTAL order in this part (Part 2 replaces them);
only Tasks 1.3–1.5 change it.

**Files:**
- Modify: `apps/server/src/receipt-document.ts:181-266`
- Modify: `apps/server/src/sample-receipt.ts` only if its tests need the new words
- Test (1.6a): `apps/server/src/receipt-ticket.test.ts`, `apps/server/src/receipt-document.test.ts`
- Test (1.6b): the other receipt suites (Global Constraints); regenerate, if the byte check fails,
  `apps/server/src/testing/full-invoice-58mm.bin` and `full-invoice-80mm.bin`

**Interfaces:**
- Consumes: `formatAmount`, `formatVatRate` (Task 1.3), labels `simplifiedInvoice`,
  `vatIncludedAtRate` (Task 1.2), `style` (Task 1.4).

- [ ] **Step 1: Failing tests** (`receipt-ticket.test.ts`; build the fixture as the file's
  `FILED_WITHOUT_TEXT` with one rate)

```ts
const ONE_RATE: TillSaleResult = {
  locale: "es-ES",
  orderLabel: "Mesa 12",
  orderNumber: 112,
  invoiceNumber: "T-2026/000112",
  issuedAt: "2026-10-13T16:53:00.000Z",
  total: "39.00",
  vatBreakdown: [{ rate: "10.00", base: "35.45", tax: "3.55" }],
  lines: [
    { descriptions: { "es-ES": "Bloody Mary" }, unitName: { es: "ud" }, quantity: "1", gross: "15.00" },
    { descriptions: { "es-ES": "Agua, pan y aceite" }, unitName: { es: "ud" }, quantity: "4", gross: "24.00" },
  ],
  tender: { method: "cash", change: "11.00" },
  qr: "https://example.invalid/qr",
  qrText: { caption: "QR tributario:", legend: "VERI*FACTU" },
};

it.each([PRINTER_58, PRINTER_80])("lays out a one-rate simplified receipt as approved ($paperWidth)", (printer) => {
  const lines = printedLines(formatReceipt({ result: ONE_RATE, issuer: ISSUER, receipt: {}, invoiceLocale: "es-ES", printer }))
    .map((line) => line.trim().replace(/\s+/g, " "));
  const at = (prefix: string) => lines.findIndex((line) => line.startsWith(prefix));
  if (printer === PRINTER_80) {
    expect(lines).toContain("Factura simplificada T-2026/000112");
  } else {
    // 34 characters do not fit 30 columns: the number moves to its own right-aligned line.
    expect(lines[at("Factura simplificada") + 1]).toBe("T-2026/000112");
  }
  expect(lines.some((line) => /^Mesa 12 · Pedido 112( 13 oct 2026, \d+:53)?$/.test(line))).toBe(true);
  expect(lines).toContain("1 ud Bloody Mary 15,00");
  expect(lines).toContain("TOTAL 39,00 €");
  expect(lines).toContain("IVA 10% incluido 3,55 €");
  expect(lines.some((line) => line.startsWith("Base"))).toBe(false);
  expect(at("1 ud Bloody Mary")).toBeLessThan(at("TOTAL"));
  expect(at("TOTAL")).toBeLessThan(at("IVA 10% incluido"));
  expect(at("IVA 10% incluido")).toBeLessThan(at("Efectivo"));
  expect(at("VERI*FACTU")).toBeGreaterThanOrEqual(0);
  expect(at("VERI*FACTU")).toBeLessThan(at("Factura simplificada"));
});

it("keeps a base and a VAT line per rate when there are several", () => {
  const lines = printedLines(formatReceipt({ result: FILED_WITHOUT_TEXT, issuer: ISSUER, receipt: {}, invoiceLocale: "es-ES", printer: PRINTER_80 }))
    .map((line) => line.trim().replace(/\s+/g, " "));
  expect(lines).toEqual(expect.arrayContaining(["Base 21% 10,00 €", "IVA 21% 2,10 €", "Base 10% 8,00 €", "IVA 10% 0,80 €"]));
  expect(lines.findIndex((l) => l.startsWith("TOTAL"))).toBeLessThan(lines.findIndex((l) => l.startsWith("Base 21%")));
});
```

(On 58 mm the order label and date do not fit on one 30-column line, so the date moves to its own
right-aligned line — `labelAmountLines`' behaviour, `layout.ts:134-148`; the regular expression
above accepts both. «Factura simplificada T-2026/000112» splits the same way on 58 mm: the plan's
reviewer measured it on 30 columns as `["Factura simplificada", "                 T-2026/000112"]`,
and that split is accepted, as for the date.)

- [ ] **Step 2:** Run the file — FAIL.
- [ ] **Step 3: Implement.** For a simplified receipt: heading rows
  `row(orderText, issueDate(…))` and `row(label.simplifiedInvoice, result.invoiceNumber)`; item rows
  use `formatAmount` for the line and option amounts and for adjustments (`-${formatAmount(…)}`);
  after the items a rule, then TOTAL (double), then either
  `row(label.vatIncludedAtRate.replace("{rate}", formatVatRate(v.rate, locale)), formatMoney(v.tax, locale))`
  when `result.vatBreakdown.length === 1`, or the Base/IVA pair per rate; then the payment section.
  When `result.vatBreakdown` is empty (a zero-total sale), print neither. The full invoice path is
  left as it is apart from Tasks 1.3–1.5.
- [ ] **Step 4a (Task 1.6a):** Run `receipt-ticket.test.ts` and `receipt-document.test.ts` — PASS,
  updating only those two files' older expectations as Step 4b describes. Commit —
  `git commit -s -m "The simplified receipt: ruled sections, TOTAL first and large, one VAT line for one rate (A663 task 1.6a)"`.
- [ ] **Step 4b (Task 1.6b):** Run the receipt suites; the biggest updates will be in
  `receipt-ticket.test.ts`, `till-api.fiscal-sale-paths.test.ts`, `till-sale.test.ts`,
  `working-order.test.ts` and `receipt-language.test.ts`. For each failure, read what the test
  checks; keep that fact and change only the expected position or wording (for example `"Base 10%"`
  on a one-rate receipt becomes `"IVA 10% incluido"`; an item amount with "€" loses it).
  `receipt-ticket.test.ts`'s completeness test (the comment at `receipt-ticket.test.ts:30-31` says it
  pins every art. 7.1 element) must still pass with its list of elements intact. If the byte check
  (`receipt-document.test.ts:12-29`) fails, regenerate the two `.bin` files as in Task 1.3 Step 4,
  only after `printedLines` shows the differences are this task's.
- [ ] **Step 5 (Task 1.6b): Commit** — `git commit -s -m "Receipt suites follow the simplified receipt's layout (A663 task 1.6b)"`, the message naming each changed assertion (and the decoded before/after of the `.bin` files if regenerated)

### Task 1.7: Part 1b's LOOK, the fiscal gate and the backlog (Part 1b)

**Files:**
- Modify: `apps/server/scripts/receipt-look.ts` (created in Task 1.8, Part 1a)
- Modify: `docs/backlog/printers.md` (A663 entry: what Part 1b delivered)

- [ ] **Step 1: Run the script and LOOK.** Its samples already cover the simplified receipt with
  one and two rates, a weighed line and a big total, and the full invoice; nothing is added unless
  a check below needs a sample it lacks.
  `pnpm --filter @waitron/server exec tsx scripts/receipt-look.ts /tmp/a663-look`, then open every
  PNG with the Read tool. Check against the mockups: rules between every section, the bold first
  line visibly heavier, «Factura simplificada» and its number (on 58 mm on two lines), TOTAL
  straight after the items, «IVA 10% incluido» on the one-rate receipt and a Base/IVA pair per rate
  on the two-rate one, item amounts without «€», «0.35 kg  Jamón ibérico» whole, nothing cut at the
  right edge. Write what you saw in the commit message ("opened 58mm-203 one-rate: …").
- [ ] **Step 2: Fiscal gate** (Global Constraints), unedited, PASS.
- [ ] **Step 3: Backlog** — in `docs/backlog/printers.md`'s A663 entry, mark point 1 done (delete its
  text, leave one line saying which pull requests delivered it) per `docs/backlog.md` → _How to keep
  this file honest_.
- [ ] **Step 4: Commit, then `/finish-branch <worktree>`** (FULL review path, Codex run-it ×2).

---

# Part 2 — the full invoice

Branch `feat/a663-2-full-invoice-layout`, from `main` after Part 1b and A661 have merged (A661
landed 2026-10-15, #1745; Part 1a #1748; Part 1b #1756). A661 changed `bill-payments.test.ts` and
added "Factura completa" assertions this part must update; see "A661 overlap".

**Revised 2026-10-15 after the owner answered Q4, Q5 and Q8** (answers quoted under "Owner
questions"). Every line number in Part 2 was re-checked against `main` at `974c3f308`.

Target layout (`2-full-invoice.png`; the figures are worked out the way this part prints them —
item and discount before VAT, the base and VAT from the record):

```
QR tributario: / [QR] / VERI*FACTU
------------------------------------------
[business block; the address once, or both with «Domicilio fiscal:»]
------------------------------------------
FACTURA                     F-2026/000031     ← bold
Mesa 12 · Pedido 112   13 oct 2026, 16:53
[Fecha de operación  12 oct 2026 — only when it differs]
------------------------------------------
Cliente
Distribuciones Gastronómicas del Mediterráneo S.L.
NIF: B12345678
Carrer de la Diputació 245, 08007 Barcelona
------------------------------------------
Uds Concepto              Precio   Importe    ← bold header row
  1 Bloody Mary            13,64     13,64
  4 Agua, pan y aceite      5,45     21,82
      Descuento 10%                  -2,18    ← before VAT (owner, Q5)
    Precios sin IVA
------------------------------------------
Base imponible 10%                 33,28 €    ← the record's figures
IVA 10%                             3,32 €
------------------------------------------
TOTAL                              36,60 €    ← double size, already from Part 1a
------------------------------------------
Efectivo / Cambio
------------------------------------------
¡Gracias por su visita!
```

(Bloody Mary 15,00 € and four of Agua at 6,00 €, all at 10%, 10% off the Agua: 24,00 ÷ 1,10 =
21,82; after the discount 21,60 ÷ 1,10 = 19,64, so the discount row is 21,82 − 19,64 = 2,18; base
13,64 + 19,64 = 33,28; VAT 36,60 − 33,28 = 3,32. Worked with Python's `Decimal`, rounding half
up, 2026-10-15.)

With more than one VAT rate the table gains a rate column after the amount ("10%", "21%"), every
row including a discount row carries its rate, and the base/VAT pair prints per rate.

Units (owner, Q8): a line whose unit is the Each unit («ud» in Spanish) prints its bare count
(«4»), on the full invoice's table AND on the simplified receipt; any other unit keeps its name, in
today's quantity form («0.35 kg»; quantities keep "." whatever the language, see Task 1.8's
follow-up). A weighed line widens the units column: on 58 mm (30 columns, no rate column) a
«0.35 kg» cell is 7 wide, which leaves the item column 7 wide (30 − 7 − 6 − 7 − 3 spaces), under the
10 that Task 2.2 needs, so every row of that invoice uses the two-line form. With bare counts only,
the item column is 11 wide and one line a row fits.

## The table's figures: what the sale stores, and what is worked out

Words used below: **before VAT** is «sin IVA»; a line's **list** total is its total with VAT
before any discount or invitation (comp) lowered it; **filed** means stored on the sale line when
the invoice was issued (`sale_lines`), and read back as `TillSaleLine.net`
(`apps/server/src/receipt-adjustments.ts:46-80`). A **dish group** is a dish with its extras
(`groupByParent`, `apps/server/src/receipt-lines.ts:102-113`).

### What a filed line holds (measured)

- `net.unitPrice` is the before-VAT unit price **after** every discount on the line. A discount
  lowers the order line's price with VAT (`setPrice`, `apps/server/src/adjustments-apply.ts:728-747`),
  and the sale files that lowered price before VAT (`rateLines`,
  `packages/catalogue/src/pricing.ts:178-204`, the `unitPrice` at `:193`).
- `net.base` is the line's base after every discount, **including its share of a discount on the
  whole bill**: a whole-bill discount is spread over the lines by lowering each one's price
  (`spreadBillDiscount`, `packages/adjustments/src/spread.ts:297-308`).
- `listGross` is the line's list total with VAT, present only when a discount or comp changed it
  (`listGrossOf`, `receipt-lines.ts:73-88`; stored as `sale_lines.list_gross`,
  `packages/db/src/schema/sales.ts:207`).
- The record's base for a rate is the sum of that rate's line bases: `rateLines` adds them
  (`pricing.ts:182-202`), and every till path that files a sale hands that breakdown to
  `recordSale` (`till-sale.ts:920`, `:1523`, `:1685`; `bill-payments.ts:707`;
  `working-order.ts:6116`). `recordSale` itself does not check a supplied breakdown against the
  lines per rate (`packages/core/src/record-sale.ts:180-191`), so a record filed some other way
  could differ; the printout never relies on the two agreeing.

Measured 2026-10-15 in this worktree with a throwaway database test (deleted afterwards): bills on
`provisionAdjustmentVenue`, adjusted with `applyAdjustment`, given a customer with
`setOrderInvoiceChoice`, filed through `completeBillPayment` and read back with
`readSettledTicket`, as `receipt-adjustments.test.ts:99-181` does; run with
`CLAUDECODE= AI_AGENT= pnpm --filter @waitron/server exec vitest run src/zz-a663-measure.test.ts`.
"Shown" is the rule below, applied in the same test with `@waitron/shared`'s `divideDecimal`.

| Bill | Line | quantity | listGross | filed unitPrice / base / rate | shown price / amount / discount |
| ---- | ---- | -------- | --------- | ----------------------------- | ------------------------------- |
| S1: 10% off the burger, then 10% off the whole bill | Hamburguesa | 1 | 12.00 | 8.03 / 8.03 / 21 | 9.92 / 9.92 / 1.89 |
| S1 | Croquetas (split by the bill discount into 2 + 1) | 2 | 6.66 | 2.48 / 4.96 / 21 | 2.75 / 5.50 / 0.54 |
| S1 | Jamón ibérico | 0.123 kg | 2.95 | 19.69 / 2.42 / 10 | see Q9 |
| S1 | Pizza, its Aceitunas extra | 1, 1 | 9.00, 1.50 | 6.69 / 6.69, 1.12 / 1.12 / 21 | 7.44 / 7.44 / 0.75, 1.24 / 1.24 / 0.12 |
| S3: 10% then 5% off the burger | Hamburguesa | 1 | 12.00 | 8.48 / 8.48 / 21 | 9.92 / 9.92 / 1.44 |
| S3: the wine comped | Rioja crianza | 1 | 30.00 | 0.00 / 0.00 / 21 | 24.79 / 24.79 / 24.79 |
| S4: 10,00 € salad less 10% | Ensalada | 1 | 10.00 | 7.44 / 7.44 / 21 | 8.26 / 8.26 / 0.82 |
| S5: 10% off the whole bill | Rioja crianza; Pan | 1; 1 | 30.00; 2.50 | 22.31 / 22.31 / 21; 2.05 / 2.05 / 10 | 24.79 / 24.79 / 2.48; 2.27 / 2.27 / 0.22 |

In every bill the shown lines came, rate by rate, to exactly the record's base (S1: 23,27 and
2,42; S3: 16,29; S4: 7,44; S5: 22,31 and 2,05). S5's record: total 29,25, VAT 4,69 and 0,20, and
the bill discount `{ kind: "discount", percentBp: 1000, amount: "3.25" }` in `billAdjustments`
with no entry on either line. The owner's own example was worked through the real pricing code
(`rateLines(grossLockedLines(...))` from `@waitron/catalogue`, in a second throwaway test run as
`CLAUDECODE= AI_AGENT= pnpm --filter @waitron/server exec vitest run src/zz-a663-arith.test.ts`,
also deleted): a 10,00 € menu at 10% less
10% files unit price 8,18, base 8,18, VAT 0,82, and the rule shows 9,09 less 0,91 — the owner's
figures.

### The rule this part builds

> **Owner, 2026-10-15:** Q9 and Q10 were answered with the alternatives after this part was built.
> Part 2 builds the defaults below as written; Part 2c replaces point 2's line under one priced unit
> and the whole-bill discount's rows ("A discount on the whole bill" below).

For a dish group whose every line has `net`, each line gets four cells, the figures all before VAT:

1. **Amount** (Importe): `baseFromGross(listGross, rate)` when the line has a `listGross`, except a
   line under one priced unit (point 2) or one point 3 sends back to its filed figures; else the
   filed `net.base`. `baseFromGross` is the one function the sale itself used
   (`pricing.ts:80-84`, today private to `@waitron/catalogue`; Task 2.3a exports it rather than
   copying it).
2. **Price** (Precio): the filed `net.unitPrice` when the line has no `listGross`. When it has one
   and its quantity is at least its price quantity (`quantity ≥ priceQuantity`: every counted dish,
   every extras pick, any weighed line of a kilo or more), `baseFromGross(listGross ×
   priceQuantity ÷ quantity, rate)`: the list price per priced unit, recovered exactly. Why exact:
   a list total is the whole-cent unit price times n = quantity ÷ priceQuantity, rounded once, so
   dividing back is off by at most 0,005 ÷ n, under half a cent when n is 1 or more. Checked
   2026-10-15 with the script below (`python3 -I`, 200,000 random prices and quantities, rounding
   half up): 0 wrong with n ≥ 1, 19,848 wrong with n < 1 (for example 177,42 €/kg × 0.076 kg =
   13,48, which divides back to 177,37). **With less than one priced unit** (0.123 kg) the list
   price per kilo cannot be recovered, so that line prints its filed price and base, and no discount
   of its own (owner question Q9). The price is per the line's price quantity, with nothing after
   it: an extra priced 1,24 per 0.05 portion prints «1,24» (owner, Q4).
   ```python
   from decimal import Decimal as D, ROUND_HALF_UP
   import random
   random.seed(1); cent = D("0.01"); wrong = {True: 0, False: 0}
   for _ in range(200000):
       u = D(random.randint(1, 20000)) / 100; n = D(random.randint(1, 5000)) / 1000
       total = (u * n).quantize(cent, ROUND_HALF_UP)
       if total and (total / n).quantize(cent, ROUND_HALF_UP) != u: wrong[n >= 1] += 1
   print(wrong)
   ```
3. **Discount**: amount − filed `net.base`. On a till-filed line it is never negative: a list total
   is never below the charged total, and `baseFromGross` never decreases as its input grows. A line
   whose stored figures disagree (a list total of 10,00 € at 21% beside a filed base of 9,50 would
   give 8,26 − 9,50 = −1,24 and print «--1,24») prints its filed price and base and no discount of
   its own, as point 2's short weighed line does.
4. **Units** (Uds) for a line whose price quantity is not 1 (an extra priced per portion): the
   number of portions, quantity ÷ priceQuantity, as a bare count. The sale line stores the portion
   times the picks (`physicalQuantity`, `apps/server/src/modifier-selection.ts:120-121`, multiplied
   by the dish quantity in `grossBasketWithOptions`, `packages/catalogue/src/pricing.ts:319-323`),
   so two 0.05 kg portions are stored as 0.100: the row prints «2 · Queso extra · 1,24 · 2,48», which
   adds up, where «0.100 kg» beside a price per 0.05 would not. When the division is not a whole
   number (no till path stores such a line: an extra on a dish whose `pricingUnit` is not `each` is refused,
   `extras.unsupported_product`, `apps/server/src/working-order.ts`; a hand-built test line can store anything), the cell falls back to the quantity and unit name as for
   any other line (`quantityText`, Task 2.3a). This follows the owner's Q4 answer, «we don't need
   the portion size».

So each line comes to its filed base exactly, and the table comes to the record's base, rate by
rate, on every till path (measured above). **The totals section always prints the record's
`vatBreakdown`** — «Base imponible» and «IVA» per rate — and never a sum of the table.

**Discount rows.** One row per dish group and per rate its lines carry (normally one), after the
group's rows (dish, option answers, extras), as a table row: no units, no price, the label in the
item column indented 2, the amount as «-0,91», and the rate when the table has a rate column. A
group and rate whose discounts add to zero prints no row. The label:

- «Invitación» (the comp label) when every line of the group at that rate has a filed base of
  zero;
- otherwise the adjustment's own words («Descuento 10%», `adjustmentLabel`,
  `receipt-document.ts:75-88`) when they can only describe this row: the group carries exactly one
  adjustment and the bill none, or the group carries none, the bill exactly one, and no line on the
  invoice carries any;
- otherwise plain «Descuento». Two discounts on one dish, or a dish discount on a bill that also
  has a whole-bill discount, print one «Descuento» row with their sum.

The adjustments' own amounts (`ReceiptAdjustment.amount`, with VAT) are never printed on a full
invoice whose lines have `net`; they only choose the label.

**A discount on the whole bill** prints no row of its own: each dish's share is already in that
dish's filed base, so it prints in that dish's discount row (owner question Q10 has the
alternative). S5 above prints «Descuento 10% -2,48» under the wine and «Descuento 10% -0,22» under
the bread. (The owner chose the alternative on 2026-10-15; Part 2c moves these rows to the end of
the table, one per rate.)

**A dish group with a line that has no `net`** (Review Focus 4) prints as today's simplified
receipt does — quantity and name with ` (IVA incluido)` added, `formatMoney(listGross ?? gross)`,
then its adjustments with VAT and «(IVA incluido)» (today's `takenOff`,
`receipt-document.ts:166-170`). The table stops before it and continues in a further table after
it; only the first table carries the header row. The bill's adjustments print after the items,
with VAT and «(IVA incluido)», only when no line on the invoice has `net`. No path files a mixed
invoice today — `receiptLines` gives every line `net` or none (`receipt-adjustments.ts:46-80`) — so
the mixed case exists in tests only.

### The one cent, for the owner

Because each discount row is the difference between the amount and the filed base, the table never
disagrees with the record on a till-filed invoice; the rounding cent shows up in the discount row
instead. Example (found by that second throwaway test, which tried list prices from 5,00 € up in
0,50 € steps at 10% VAT and 10% off, and stopped at the eighth that shows it, 13,50 €; 6,00, 7,00,
8,00, 8,50, 9,50, 11,50 and 12,50 € were the others): a 12,50 € menu at 10% VAT, 10% off. Amount 12,50 ÷ 1,10 = 11,36. After the discount it costs 11,25, so the record's base is
11,25 ÷ 1,10 = 10,23 and its VAT 11,25 − 10,23 = 1,02. The discount row prints 11,36 − 10,23 =
**1,13**, although 10% of 11,36 is 1,14. Printing 1,14 would make the line come to 10,22 while the
record says 10,23; the invoice prints 1,13, «Base imponible 10% 10,23 €» and «IVA 10% 1,02 €». Two
older properties stay as they are: a line's price × units can differ from its amount by a cent (three
1,00 € drinks at 21% on one line: price 0,83, amount 2,48), and the record's VAT is the total with
VAT minus the base, so it can differ by a cent from rate × base (three 1,00 € drinks at 21% on
three lines: base 2,49, VAT 0,51, while 21% of 2,49 is 0,52) — both measured with `rateLines` in the
throwaway test above. If a record ever disagreed with its lines (one not filed by a till path), the
invoice still prints the record's base and VAT; Task 2.3b pins that.

### Task 2.1: Labels for the full invoice

**Files:** `packages/country/src/country.ts`, `packages/country-es/src/receipt-labels.ts`,
`packages/country-es/src/spain.test.ts`

| key | es-ES | ca-ES | gl-ES | eu-ES |
| --- | ----- | ----- | ----- | ----- |
| `invoiceHeading` | FACTURA | FACTURA | FACTURA | FAKTURA |
| `customer` | Cliente | Client | Cliente | Bezeroa |
| `unitsColumn` | Uds | Uts. | Uds. | Kop. |
| `itemColumn` | Concepto | Concepte | Concepto | Kontzeptua |
| `priceColumn` | Precio | Preu | Prezo | Prezioa |
| `amountColumn` | Importe | Import | Importe | Zenbatekoa |
| `rateColumn` | IVA | IVA | IVE | BEZ |
| `pricesExcludeVat` | Precios sin IVA | Preus sense IVA | Prezos sen IVE | Prezioak BEZik gabe |
| `taxableBase` | Base imponible | Base imposable | Base impoñible | Zerga-oinarria |
| `registeredAddress` | Domicilio fiscal: | Domicili fiscal: | Domicilio fiscal: | Helbide fiskala: |

- [ ] **Step 1: Failing test** (append to `packages/country-es/src/spain.test.ts`)

```ts
it("has every full-invoice word in every Spanish receipt language", () => {
  const keys = ["invoiceHeading", "customer", "unitsColumn", "itemColumn", "priceColumn", "amountColumn",
    "rateColumn", "pricesExcludeVat", "taxableBase", "registeredAddress"] as const;
  for (const [locale, labels] of Object.entries(SPAIN_RECEIPT_LABELS))
    for (const key of keys) expect(labels[key], `${locale} ${key}`).not.toBe("");
  expect(SPAIN_RECEIPT_LABELS["es-ES"].registeredAddress).toBe("Domicilio fiscal:");
  expect(SPAIN_RECEIPT_LABELS["es-ES"].invoiceHeading).toBe("FACTURA");
});
```

- [ ] **Step 2:** `pnpm --filter @waitron/country-es exec vitest run src/spain.test.ts` — FAIL.
- [ ] **Step 3:** Add the ten keys to `RECEIPT_LABEL_KEYS` and to the four languages, as tabled.
- [ ] **Step 4:** `pnpm --filter @waitron/country-es exec vitest run && pnpm --filter @waitron/country-packs exec vitest run && pnpm --filter @waitron/country exec tsc --noEmit && pnpm --filter @waitron/country-es exec tsc --noEmit` — PASS.
- [ ] **Step 5: Commit.** The Catalan, Galician and Basque words ship as tabled (owner, Q7).

### Task 2.2: The item table as text lines (pure function)

**Files:**
- Create: `apps/server/src/receipt-table.ts`
- Test: `apps/server/src/receipt-table.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ReceiptTableRow {
  units: string;
  item: string;
  price: string;
  amount: string;
  rate?: string;
  /** Spaces before the item text: 2 for an extra, an option answer or a discount under its dish. */
  itemIndent?: number;
}
export interface ReceiptTable {
  /** Absent on a table continuing after a line printed outside it (Task 2.3b). */
  header?: ReceiptTableRow;
  rows: readonly ReceiptTableRow[];
  withRate: boolean;
}
/** Each printed line, with `header: true` on the header row's lines so the caller can bold them. */
export function tableLines(table: ReceiptTable, columns: number): { text: string; header: boolean }[];
```

Rule: column widths are the widest cell in each of units, price, amount and rate (header
included when there is one); one space between columns; units, price, amount and rate are
right-aligned, an empty cell as spaces; the item column takes what is left and wraps inside itself
(`wrapText`, continuation lines indented to the item column). If the item column would be narrower
than 10, each row prints in two lines instead: units and item across the full width, then the
figures right-aligned on the next line (Review Focus 3).

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { tableLines, type ReceiptTable } from "./receipt-table.js";

const HEADER = { units: "Uds", item: "Concepto", price: "Precio", amount: "Importe", rate: "IVA" };
const table = (withRate: boolean): ReceiptTable => ({
  header: HEADER,
  withRate,
  rows: [
    { units: "1", item: "Bloody Mary", price: "13,64", amount: "13,64", rate: "10%" },
    { units: "4", item: "Agua, pan y aceite", price: "5,45", amount: "21,82", rate: "21%" },
  ],
});

describe("tableLines", () => {
  it("lays out one rate on 42 columns, one line a row", () => {
    expect(tableLines(table(false), 42).map((l) => l.text)).toEqual([
      "Uds Concepto                Precio Importe",
      "  1 Bloody Mary              13,64   13,64",
      "  4 Agua, pan y aceite        5,45   21,82",
    ]);
  });

  it("marks the header row's lines", () => {
    expect(tableLines(table(false), 42).map((l) => l.header)).toEqual([true, false, false]);
  });

  it("prints no header line when the table has none", () => {
    const { header: _, ...headless } = table(false);
    expect(tableLines(headless, 42).map((l) => l.header)).toEqual([false, false]);
  });

  it("adds a rate column with several rates", () => {
    expect(tableLines(table(true), 42)[1]!.text).toBe("  1 Bloody Mary          13,64   13,64 10%");
  });

  it("prints a discount row with empty units and price, its words indented under the item", () => {
    const discounted: ReceiptTable = {
      header: HEADER,
      withRate: false,
      rows: [
        { units: "1", item: "Bloody Mary", price: "13,64", amount: "13,64" },
        { units: "", item: "Descuento 10%", itemIndent: 2, price: "", amount: "-1,36" },
      ],
    };
    expect(tableLines(discounted, 42).map((l) => l.text).slice(1)).toEqual([
      "  1 Bloody Mary              13,64   13,64",
      "      Descuento 10%                  -1,36",
    ]);
  });

  it("wraps a long item inside its column", () => {
    const long = { ...table(false), rows: [{ units: "1", item: "Menú degustación con maridaje de la casa", price: "72,73", amount: "72,73" }] };
    for (const line of tableLines(long, 30)) expect(line.text.length).toBeLessThanOrEqual(30);
    expect(tableLines(long, 30).map((l) => l.text).join(" ")).toContain("maridaje");
  });

  it("widens the units column for a weighed line", () => {
    const weighed: ReceiptTable = {
      header: HEADER,
      withRate: false,
      rows: [
        { units: "1", item: "Bloody Mary", price: "13,64", amount: "13,64" },
        { units: "0.35 kg", item: "Jamón ibérico", price: "109,09", amount: "38,18" },
      ],
    };
    expect(tableLines(weighed, 42).map((l) => l.text)).toEqual([
      "    Uds Concepto            Precio Importe",
      "      1 Bloody Mary          13,64   13,64",
      "0.35 kg Jamón ibérico       109,09   38,18",
    ]);
    const narrow = tableLines(weighed, 30).map((l) => l.text);
    expect(narrow).toContain("0.35 kg Jamón ibérico");
    expect(narrow.some((line) => line.endsWith("109,09   38,18"))).toBe(true);
    for (const line of narrow) expect(line.length).toBeLessThanOrEqual(30);
  });

  it("falls back to two lines a row when the item column would be under 10 on 58 mm", () => {
    const lines = tableLines(table(true), 30).map((l) => l.text);
    expect(lines).toContain("  1 Bloody Mary");
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(30);
    expect(lines.some((line) => line.endsWith("13,64   13,64 10%"))).toBe(true);
  });
});
```

(The expected strings were computed from the rule on 2026-10-15 with a three-line Python
`rjust`/`ljust` script: units 3, price 6, amount 7, rate 3 wide; item 23 wide on 42 columns
without a rate, 19 with one; on 30 columns with a rate the item would be 7, so the two-line form.
The weighed case was computed the same way: units 7 wide (header «Uds» right-aligned in it), item
19 on 42 columns, 7 on 30. 109,09 is 120,00 € a kilo before 10% VAT; 0.35 kg of it is 38,18. The
discount row was computed the same way while revising: `"".rjust(3) + " " + "  Descuento
10%".ljust(23) + " " + "".rjust(6) + " " + "-1,36".rjust(7)`.)

- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/receipt-table.test.ts` — FAIL (module missing).
- [ ] **Step 3:** Implement `tableLines` with `wrapText` from `@waitron/printing`.
- [ ] **Step 4:** Run — PASS. **Commit.**

### Task 2.3: The full invoice's figures, layout and units (five dispatches: 2.3a–2.3d)

Five implementer dispatches, in order: **2.3a** the before-VAT figures and the bare count as pure
functions; **2.3b** the full invoice's layout and its own tests; **2.3c-1** the paper and A4 suites
it ripples into and the saved `.bin` files; **2.3c-2** the database and API suites it ripples into;
**2.3d** the bare count on the simplified receipt and its ripple. 2.3b's commit leaves the suites
2.3c-1 and 2.3c-2 update failing on purpose; they are dispatched straight after it, and the branch
is green again only after 2.3c-2.

#### Task 2.3a: Before-VAT figures and the bare count (pure functions)

> The case named "owner question Q9" below builds Q9's default; Part 2c replaces it with the
> owner's 2026-10-15 answer.

**Files:**
- Modify: `packages/catalogue/src/pricing.ts:80-84` (export `baseFromGross`; nothing else changes
  there — `@waitron/catalogue`'s index already re-exports `pricing.ts`)
- Modify: `apps/server/scripts/demo-seed/seed-sales.ts:130-133`: delete its own copy of
  `baseFromGross` and the comment calling the catalogue's "package-private"; import it from
  `@waitron/catalogue` (the file already imports from there, `:26`), and change "from
  `baseFromGross` above" in the comment at `:135-136` to "from `baseFromGross`". Remove any import
  the deleted copy leaves unused (`HUNDRED` if nothing else reads it).
- Create: `apps/server/src/invoice-figures.ts` (renamed `receipt-figures.ts` on 2026-10-15, after review)
- Test: `apps/server/src/invoice-figures.test.ts`

**Interfaces:**
- Consumes: `TillSaleLine`, `ReceiptAdjustment` (`apps/server/src/till-sale.ts:216-252`),
  `LineGroup` (`receipt-lines.ts:90-93`), `baseFromGross`, `EACH_UNIT`
  (`packages/catalogue/src/units.ts:23-29`), `resolveSnapshotText`.
- Produces:

```ts
type FiledLine = TillSaleLine & { net: NonNullable<TillSaleLine["net"]> };
/** A line's price, amount and discount before VAT ("The rule this part builds", points 1–3);
 *  `discount` is "0.00" when nothing is taken off before VAT. */
export function beforeVatFigures(line: FiledLine): { price: Decimal; amount: Decimal; discount: Decimal };
export interface GroupDiscount {
  /** The lines' `net.rate`, as filed. */
  rate: string;
  /** The `discount` of `beforeVatFigures` for the group's lines at this rate, added; never zero
   *  (a zero prints no row). */
  amount: Decimal;
  /** Every line of the group at this rate has a filed base of zero. */
  comp: boolean;
  /** The adjustment whose words name the row, or null for plain «Descuento». */
  named: ReceiptAdjustment | null;
}
/** One entry per rate the group's lines carry, in the order the rates first appear, rates grouped
 *  with `compareDecimal` ("10" and "10.00" are one rate). Every line of `group` must have `net`.
 *  `billAdjustments` and `invoiceHasLineAdjustments` choose `named`. */
export function groupDiscounts(
  group: LineGroup,
  billAdjustments: readonly ReceiptAdjustment[],
  invoiceHasLineAdjustments: boolean,
): GroupDiscount[];
/** "4" for a count in the Each unit or a line with no unit; "2" for two portions of an extra
 *  priced per portion; "0.35 kg" for any other unit. */
export function quantityText(
  line: Pick<TillSaleLine, "quantity" | "unitName" | "soldInEach" | "net">,
  namesLocale: string,
): string;
```

`quantityText` first handles a line whose `net.priceQuantity` is not 1 (`compareDecimal`): when
`divideDecimal(quantity, priceQuantity, 3)` is a whole number it prints that number of portions
bare, trimmed with `trimQuantityForDisplay` («2»); when it is not, it carries on as below. It
prints the bare quantity when the line has no unit name, when `soldInEach` is
true, or when any stored entry of `unitName` is `EACH_UNIT.abbreviation` in that entry's language
(`Object.entries(unitName).some(([language, text]) => EACH_UNIT.abbreviation[language.split("-")[0]!] === text)`;
a sale line's unit name is stored under one content-language code, `working-order.ts:800-802`).
Otherwise it prints `${quantity} ${resolveSnapshotText(unitName, namesLocale, namesLocale)}`, as
today (`receipt-document.ts:236-240`). A sale line keeps only its unit's printed name
(`sale_lines.unit_name`, `packages/db/src/schema/sales.ts:181`), not which unit it was, while the
catalogue decides "is this Each" by the unit's identity because a venue can rename it
(`isEachUnit`, `units.ts:31-37`); so a venue that renamed its Each unit keeps seeing «4 <its
name>», the harmless direction. If building this turns out to need a new stored fact on a sale
line, STOP (Global Constraints) and keep «4 ud».

(Changed 2026-10-15 after review: `receiptLines` reads the recorded `sold_in_each` context for
every line with a unit name, dishes included, and the name test above is only the fallback for a
line with no context row, now requiring EVERY stored entry to be Each's abbreviation in its
language.)

All arithmetic uses `@waitron/shared`'s `decimal`, `multiplyDecimal`, `divideDecimal` (at
`MONEY_SCALE`), `subtractDecimal`, `addDecimal` and `compareDecimal`; no `Number`.

- [ ] **Step 1: Failing tests** (`apps/server/src/invoice-figures.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { beforeVatFigures, groupDiscounts, quantityText } from "./invoice-figures.js";
import type { ReceiptAdjustment, TillSaleLine } from "./till-sale.js";

type Net = NonNullable<TillSaleLine["net"]>;
const filed = (over: Partial<TillSaleLine> & { net: Net }): TillSaleLine & { net: Net } => ({
  descriptions: { "es-ES": "Plato" },
  quantity: "1",
  gross: "0.00",
  ...over,
});
const net = (unitPrice: string, base: string, rate: string, priceQuantity = "1.000"): Net => ({
  unitPrice,
  priceQuantity,
  base,
  rate,
});
const TEN: ReceiptAdjustment = { kind: "discount", percentBp: 1000, amount: "1.00" };

describe("beforeVatFigures", () => {
  it("works the owner's menu: 10,00 at 10% VAT less 10% is 9,09 less 0,91", () => {
    expect(beforeVatFigures(filed({ gross: "9.00", listGross: "10.00", net: net("8.18", "8.18", "10.00") })))
      .toEqual({ price: "9.09", amount: "9.09", discount: "0.91" });
  });

  it("puts the rounding cent in the discount, never in the filed base", () => {
    // 10% of 11,36 would be 1,14; the filed base 10,23 leaves 1,13.
    expect(beforeVatFigures(filed({ gross: "11.25", listGross: "12.50", net: net("10.23", "10.23", "10.00") })))
      .toEqual({ price: "11.36", amount: "11.36", discount: "1.13" });
  });

  it("reads a line no discount touched as filed", () => {
    expect(beforeVatFigures(filed({ quantity: "2", gross: "8.80", net: net("4.00", "8.00", "10") })))
      .toEqual({ price: "4.00", amount: "8.00", discount: "0.00" });
  });

  it("divides a counted line's list total back to its unit price", () => {
    // S1's Croquetas: 2 × 3,33 with 21% VAT, part of a whole-bill discount.
    expect(beforeVatFigures(filed({ quantity: "2", gross: "6.00", listGross: "6.66", net: net("2.48", "4.96", "21.00") })))
      .toEqual({ price: "2.75", amount: "5.50", discount: "0.54" });
  });

  it("keeps the filed price and base for less than one priced unit (owner question Q9)", () => {
    // S1's Jamón: 0.123 kg at 24,00 €/kg; 2,95 ÷ 0.123 would give 23,98 a kilo, not 24,00.
    expect(beforeVatFigures(filed({ quantity: "0.123", gross: "2.66", listGross: "2.95", net: net("19.69", "2.42", "10.00") })))
      .toEqual({ price: "19.69", amount: "2.42", discount: "0.00" });
  });

  it("prints the filed figures, and no discount, when the list total would leave a negative one", () => {
    // 10,00 ÷ 1,21 = 8,26, below the filed base 9,50: a row would read «--1,24».
    expect(beforeVatFigures(filed({ gross: "11.50", listGross: "10.00", net: net("9.50", "9.50", "21.00") })))
      .toEqual({ price: "9.50", amount: "9.50", discount: "0.00" });
  });

  it("prices an extra per its portion (owner, Q4)", () => {
    // Two 0.05 portions at 1,50 with 21% VAT, 10% off: 1,50 a portion is 1,24 before VAT.
    expect(beforeVatFigures(filed({ quantity: "0.100", gross: "2.70", listGross: "3.00", net: net("1.12", "2.23", "21.00", "0.050") })))
      .toEqual({ price: "1.24", amount: "2.48", discount: "0.25" });
    expect(beforeVatFigures(filed({ quantity: "0.100", gross: "3.00", net: net("1.24", "2.48", "21.00", "0.050") })).price)
      .toBe("1.24");
  });
});

describe("groupDiscounts", () => {
  const pizza = filed({ gross: "8.10", listGross: "9.00", net: net("6.69", "6.69", "21.00"),
    adjustments: [{ kind: "discount", percentBp: 1000, amount: "1.05" }] });
  const olives = filed({ parentLineNo: 1, gross: "1.35", listGross: "1.50", net: net("1.12", "1.12", "21.00") });

  it("adds a dish's and its extras' discounts into one row named by the dish's one adjustment", () => {
    expect(groupDiscounts({ dish: pizza, options: [olives] }, [], true)).toEqual([
      { rate: "21.00", amount: "0.87", comp: false, named: { kind: "discount", percentBp: 1000, amount: "1.05" } },
    ]);
  });

  it("calls a comped dish an invitation", () => {
    const wine = filed({ gross: "0.00", listGross: "30.00", net: net("0.00", "0.00", "21.00"),
      adjustments: [{ kind: "comp", amount: "30.00" }] });
    expect(groupDiscounts({ dish: wine, options: [] }, [], true)).toEqual([
      { rate: "21.00", amount: "24.79", comp: true, named: { kind: "comp", amount: "30.00" } },
    ]);
  });

  it("names no percentage for two discounts on one dish", () => {
    const burger = filed({ gross: "10.26", listGross: "12.00", net: net("8.48", "8.48", "21.00"),
      adjustments: [TEN, { kind: "discount", percentBp: 500, amount: "0.54" }] });
    expect(groupDiscounts({ dish: burger, options: [] }, [], true)).toEqual([
      { rate: "21.00", amount: "1.44", comp: false, named: null },
    ]);
  });

  it("names a whole-bill discount under a dish only when no dish has one of its own", () => {
    const wine = filed({ gross: "27.00", listGross: "30.00", net: net("22.31", "22.31", "21.00") });
    expect(groupDiscounts({ dish: wine, options: [] }, [TEN], false)[0]).toMatchObject({ amount: "2.48", named: TEN });
    expect(groupDiscounts({ dish: wine, options: [] }, [TEN], true)[0]).toMatchObject({ amount: "2.48", named: null });
  });

  it("does not name a dish's own discount when the bill has one too", () => {
    const burger = filed({ gross: "9.72", listGross: "12.00", net: net("8.03", "8.03", "21.00"), adjustments: [TEN] });
    expect(groupDiscounts({ dish: burger, options: [] }, [TEN], true)).toEqual([
      { rate: "21.00", amount: "1.89", comp: false, named: null },
    ]);
  });

  it("gives each rate in a group its own row, and none to a group nothing lowered", () => {
    const reducedExtra = { ...olives, net: net("1.36", "1.36", "10.00"), listGross: "1.65", gross: "1.50" };
    expect(groupDiscounts({ dish: pizza, options: [reducedExtra] }, [], true).map((d) => [d.rate, d.amount]))
      .toEqual([["21.00", "0.75"], ["10.00", "0.14"]]);
    expect(groupDiscounts({ dish: filed({ net: net("4.00", "8.00", "10") }), options: [] }, [], false)).toEqual([]);
  });
});

describe("quantityText", () => {
  it.each([
    [{ quantity: "4", unitName: { es: "ud" } }, "4"],
    [{ quantity: "3", unitName: { ca: "u" } }, "3"],
    [{ quantity: "1", unitName: null }, "1"],
    [{ quantity: "2", unitName: { es: "pzas" }, soldInEach: true as const }, "2"],
    [{ quantity: "0.35", unitName: { es: "kg" } }, "0.35 kg"],
    [{ quantity: "4", unitName: { es: "pzas" } }, "4 pzas"],
  ])("prints %j as %s", (line, expected) => {
    expect(quantityText(line, "es-ES")).toBe(expected);
  });

  it("counts an extra priced per portion in portions, and falls back when that is not whole", () => {
    const portion = (quantity: string) => ({
      quantity,
      unitName: { es: "kg" },
      net: net("1.24", "2.48", "21.00", "0.050"),
    });
    expect(quantityText(portion("0.100"), "es-ES")).toBe("2");
    expect(quantityText(portion("0.075"), "es-ES")).toBe("0.075 kg");
  });
});
```

Where the figures come from: the owner's menu, the 12,50 € menu and the S1/S3/S5 lines are the
measurements under "The table's figures" above. The extra's figures and the 10%-rate extra in the
last `groupDiscounts` case were computed 2026-10-15 with Python's `Decimal`, rounding half up
(`baseFromGross` rounds half away from zero, the same for positive amounts): 1,50 ÷ 1,21 = 1,24;
3,00 ÷ 1,21 = 2,48; 2,70 ÷ 1,21 = 2,23; 1,65 ÷ 1,10 = 1,50, less the filed 1,36, is 0,14; the pizza
alone is 7,44 − 6,69 = 0,75. Re-run any figure you doubt the same way before trusting the test.

- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/invoice-figures.test.ts` — FAIL (module missing).
- [ ] **Step 3:** Export `baseFromGross` from `pricing.ts`; implement the three functions.
- [ ] **Step 4:** Run it again — PASS; then `pnpm --filter @waitron/catalogue exec vitest run src/pricing.test.ts && pnpm --filter @waitron/catalogue exec tsc --noEmit && pnpm --filter @waitron/server exec tsc --noEmit && pnpm exec eslint apps/server/scripts/demo-seed/seed-sales.ts apps/server/src/invoice-figures.ts` — PASS. **Commit.**

#### Task 2.3b: The full invoice's heading, customer block, table and totals

> The case named "owner question Q10" below builds Q10's default; Part 2c replaces it with the
> owner's 2026-10-15 answer. The «IVA 10% incluido» row this task leaves alone is replaced by Part
> 2b (Q11).

Replace, for `invoiceType === "F1"`, today's lines: "Factura completa" above the header
(`receipt-document.ts:185`), the `Factura`/`Fecha` rows (`:215-219`), the item rows with their
«Precio sin IVA» / «Base x%» / «IVA x%» rows (`netFacts`, `:146-165`, used at `:242-244` and
`:270-278`), the adjustments with «(IVA incluido)» under them (`takenOff`, `:166-170`, called at
`:283-287`) and the summary's «Base» wording (`vatRows`, `:299-302`). The simplified receipt's
rows, its VAT rows and its «IVA 10% incluido» row (Part 1b) do not change in this task.

New document element: `{ kind: "table"; table: ReceiptTable }` (`ReceiptTable` from Task 2.2), so
the roll renderer calls `tableLines` and the A4 page lays out real columns (Task 2.5).

- Heading section: `row(label.invoiceHeading, result.invoiceNumber, 0, { bold: true })`, then
  `row(orderText, issueDate(result.issuedAt, locale, result.issuedOffsetMinutes))`, then the
  operation-date row when present (`:220-227`).
- Customer section: `text(label.customer)`, then today's legal name, `NIF: …` and address
  (`:229-234`).
- Items section, per dish group (`groupByParent`): when every line of the group has `net`, its
  rows join the current table — the dish (`units` = `quantityText(dish)`, `item` = its name,
  `price`/`amount` = `formatAmount` of `beforeVatFigures`, `rate` = `formatVatRate(net.rate)`),
  then each option answer as `{ units: "", item: answer, itemIndent: 2, price: "", amount: "" }`,
  then each extra the same way as the dish with `itemIndent: 2`, then one discount row per
  `groupDiscounts` entry: `{ units: "", item, itemIndent: 2, price: "", amount: "-" +
  formatAmount(amount), rate }`, where `item` is `label.comp` when `comp`, else
  `adjustmentLabel(named)` when `named`, else `label.discount`. Otherwise the group prints as "A
  dish group with a line that has no `net`" says. `withRate` is decided once for the whole invoice
  and given to every table on it: true when the lines with `net` carry more than one distinct rate,
  rates compared with `compareDecimal`, never as strings (fixtures write both "10" and "10.00"). After the items, `text(label.pricesExcludeVat, 4)` when a
  table was printed; then the bill's adjustments only when no line has `net`.
- Totals section: for each entry of `result.vatBreakdown`, `row(\`${label.taxableBase} ${rate}\`,
  formatMoney(base))` and `row(\`${label.vat} ${rate}\`, formatMoney(tax))`; then a rule; then
  TOTAL (double, from Part 1a). The record's figures, never a sum of the table.
- The fixture: in `apps/server/src/testing/full-invoice-fixture.ts:42`, change the first line's
  `net.unitPrice` from `"10.00"` to `"9.00"`, what a real filing stores for 12,10 € less 10% at
  21% (10,89 ÷ 1,21 = 9,00; "What a filed line holds"). With 10,00 left there, a builder that
  printed the filed unit price would pass the first test below.

**Files:**
- Modify: `apps/server/src/receipt-document.ts`, `apps/server/src/testing/full-invoice-fixture.ts`
- Modify: `apps/server/src/receipt-ticket.ts` (draw `table`: `tableLines(element.table, columns)`,
  header lines bold; beside the `amount` case, `:71`)
- Modify: `apps/server/src/invoice-page.ts` (temporary: draw a `table` element as its
  `tableLines(table, 90)` text lines in the body font, beside the `text`/`amount` case at `:163`,
  so A4 keeps working until Task 2.5)
- Test: `apps/server/src/receipt-document.test.ts`, `apps/server/src/receipt-ticket.test.ts`

- [ ] **Step 1: Failing tests** (`receipt-document.test.ts`)

```ts
const tableOf = (document: ReturnType<typeof buildReceiptDocument>) => {
  const table = document.elements.find((e) => e.kind === "table");
  if (table?.kind !== "table") throw new Error("no table");
  return table.table;
};
const amountRows = (document: ReturnType<typeof buildReceiptDocument>) =>
  document.elements.flatMap((e) => (e.kind === "amount" ? [[e.caption.trim(), e.amount]] : []));
const ownerMenu = (vatBreakdown: { rate: string; base: string; tax: string }[]) => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  input.result.lines = [
    {
      descriptions: { "es-ES": "Menú del día" },
      unitName: { es: "ud" },
      quantity: "1",
      gross: "9.00",
      listGross: "10.00",
      net: { unitPrice: "8.18", priceQuantity: "1.000", base: "8.18", tax: "0.82", rate: "10.00" },
      adjustments: [{ kind: "discount", percentBp: 1000, amount: "1.00" }],
    },
  ];
  input.result.vatBreakdown = vatBreakdown;
  input.result.total = "9.00";
  return buildReceiptDocument(input);
};

it("heads a full invoice with FACTURA and its number, in bold", () => {
  const elements = buildReceiptDocument(FULL_INVOICE_DOCUMENT_FIXTURE).elements;
  expect(elements).toContainEqual({ kind: "amount", caption: "FACTURA", amount: "FF/1", indent: 0, style: { bold: true } });
  expect(elements.some((e) => e.kind === "text" && e.text === "Factura completa")).toBe(false);
});

it("lists a full invoice's items one row each, before VAT, with the discount as its own row", () => {
  const table = tableOf(buildReceiptDocument(FULL_INVOICE_DOCUMENT_FIXTURE));
  expect(table.header).toEqual({ units: "Uds", item: "Concepto", price: "Precio", amount: "Importe", rate: "IVA" });
  expect(table.withRate).toBe(true);
  expect(table.rows).toEqual([
    { units: "1", item: "Menú del día con un nombre especialmente largo", price: "10,00", amount: "10,00", rate: "21%" },
    { units: "", item: "Descuento 10%", itemIndent: 2, price: "", amount: "-1,00", rate: "21%" },
    { units: "2", item: "Agua mineral", price: "4,00", amount: "8,00", rate: "10%" },
  ]);
});

it("prints the owner's menu del día: 9,09, less 0,91, base imponible 8,18, IVA 0,82", () => {
  const document = ownerMenu([{ rate: "10.00", base: "8.18", tax: "0.82" }]);
  expect(tableOf(document).withRate).toBe(false);
  expect(tableOf(document).rows).toMatchObject([
    { units: "1", item: "Menú del día", price: "9,09", amount: "9,09" },
    { units: "", item: "Descuento 10%", price: "", amount: "-0,91" },
  ]);
  expect(amountRows(document)).toEqual(expect.arrayContaining([["Base imponible 10%", "8,18 €"], ["IVA 10%", "0,82 €"]]));
  expect(JSON.stringify(document.elements)).not.toContain("IVA incluido");
});

it("prints the record's base and VAT, not the table's, when the two differ", () => {
  // No till path files this record (see "The one cent"); it pins that the totals are never a sum.
  const document = ownerMenu([{ rate: "10.00", base: "8.19", tax: "0.81" }]);
  expect(amountRows(document)).toEqual(expect.arrayContaining([["Base imponible 10%", "8,19 €"], ["IVA 10%", "0,81 €"]]));
  expect(tableOf(document).rows[1]).toMatchObject({ amount: "-0,91" });
});

it("prints a count in «ud» bare and keeps any other unit's name", () => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  input.result.lines[0]!.unitName = { es: "ud" };
  input.result.lines[1] = {
    descriptions: { "es-ES": "Jamón ibérico" },
    unitName: { es: "kg" },
    quantity: "0.35",
    gross: "42.00",
    net: { unitPrice: "109.09", priceQuantity: "1.000", base: "38.18", tax: "3.82", rate: "10" },
  };
  const rows = tableOf(buildReceiptDocument(input)).rows;
  expect(rows[0]).toMatchObject({ units: "1" });
  expect(rows.find((r) => r.item === "Jamón ibérico")).toMatchObject({ units: "0.35 kg", price: "109,09", amount: "38,18" });
});

it("prints an extra priced per portion at its price per portion and nothing after it (owner, Q4)", () => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  input.result.lines.push({
    descriptions: { "es-ES": "Queso extra" },
    parentLineNo: 2,
    unitName: { es: "kg" },
    quantity: "0.100",
    gross: "3.00",
    net: { unitPrice: "1.24", priceQuantity: "0.050", base: "2.48", tax: "0.52", rate: "21" },
  });
  const rows = tableOf(buildReceiptDocument(input)).rows;
  expect(rows.find((r) => r.item === "Queso extra")).toMatchObject({ units: "2", itemIndent: 2, price: "1,24", amount: "2,48" });
  expect(rows.some((r) => r.price.includes("/"))).toBe(false);
});

it("puts a whole-bill discount under each dish, before VAT, at its rate (owner question Q10)", () => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  input.result.lines = [
    { descriptions: { "es-ES": "Rioja crianza" }, quantity: "1", gross: "27.00", listGross: "30.00",
      net: { unitPrice: "22.31", priceQuantity: "1.000", base: "22.31", tax: "4.69", rate: "21.00" } },
    { descriptions: { "es-ES": "Pan de pueblo" }, quantity: "1", gross: "2.25", listGross: "2.50",
      net: { unitPrice: "2.05", priceQuantity: "1.000", base: "2.05", tax: "0.20", rate: "10.00" } },
  ];
  input.result.billAdjustments = [{ kind: "discount", percentBp: 1000, amount: "3.25" }];
  input.result.vatBreakdown = [{ rate: "21.00", base: "22.31", tax: "4.69" }, { rate: "10.00", base: "2.05", tax: "0.20" }];
  input.result.total = "29.25";
  const document = buildReceiptDocument(input);
  expect(tableOf(document).rows.map((r) => [r.item, r.amount, r.rate])).toEqual([
    ["Rioja crianza", "24,79", "21%"],
    ["Descuento 10%", "-2,48", "21%"],
    ["Pan de pueblo", "2,27", "10%"],
    ["Descuento 10%", "-0,22", "10%"],
  ]);
  expect(amountRows(document).some(([caption]) => caption!.startsWith("Descuento"))).toBe(false);
});

it("prints no «Precio sin IVA» line and no per-item Base or IVA line", () => {
  const captions = amountRows(buildReceiptDocument(FULL_INVOICE_DOCUMENT_FIXTURE)).map(([c]) => c);
  expect(captions).not.toContain("Precio sin IVA");
  expect(captions.filter((c) => c!.startsWith("Base"))).toEqual(["Base imponible 21%", "Base imponible 10%"]);
});

it("prints only the dish with no filed net figures as a with-VAT row, the rest as a table", () => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  delete input.result.lines[0]!.net;
  const document = buildReceiptDocument(input);
  expect(amountRows(document)).toEqual(expect.arrayContaining([
    ["1  Menú del día con un nombre especialmente largo (IVA incluido)", "12,10 €"],
    ["Descuento 10% (IVA incluido)", "-1,21 €"],
  ]));
  const tables = document.elements.flatMap((e) => (e.kind === "table" ? [e.table] : []));
  expect(tables.flatMap((t) => t.rows.map((r) => r.item))).toEqual(["Agua mineral"]);
});
```

(The fixture's figures: line one lists at 12,10 € with 21% VAT and is charged 10,89 after 10% off,
filed base 9,00; 12,10 ÷ 1,21 = 10,00, so price and amount 10,00 and the discount 10,00 − 9,00 =
1,00. Line two: two at 4,00 before VAT, base 8,00, untouched. The other figures are the
measurements under "The table's figures". The no-`net` row's caption keeps today's two spaces
after the quantity and adds ` (IVA incluido)`; check today's caption at `receipt-document.ts:240`
before running.)

Rewrite `receipt-document.test.ts:30-72` ("exposes the saved invoice figures…") so its row list is
the new one: the heading row, the date rows, `["Base imponible 21%", "9,00 €"]`, `["IVA 21%",
"1,89 €"]`, `["Base imponible 10%", "8,00 €"]`, `["IVA 10%", "0,80 €"]`, TOTAL, Efectivo and Cambio;
keep its checks that the filed issuer, domicile and customer print and the current mutable ones do
not, and change its `"1  Menú del día…"` text check to the table row. In the rate-spelling cases
below it (`:74-111`), change `"Base 21%"`/`"Base 17,5%"`/`"Base 10%"` to «Base imponible …».

- [ ] **Step 2:** Run the file — FAIL.
- [ ] **Step 3:** Implement as described. Add the `table` case to `receipt-ticket.ts` and the
  temporary one to `invoice-page.ts`, and a `receipt-ticket.test.ts` case that a full invoice's
  printed lines (`printedLines`) contain the 80 mm table's header and its first row.
- [ ] **Step 4:** Run `pnpm --filter @waitron/server exec vitest run src/receipt-document.test.ts src/receipt-table.test.ts src/invoice-figures.test.ts`
  and, for the new roll-paper case only, `pnpm --filter @waitron/server exec vitest run src/receipt-ticket.test.ts -t "<its title>"`
  — PASS. The rest of `receipt-ticket.test.ts` and the suites listed in Tasks 2.3c-1 and 2.3c-2
  stay red until those tasks; do not fix them here. **Commit**, naming in the message the suites
  left failing for 2.3c-1 and 2.3c-2.

#### Task 2.3c-1: The paper and A4 suites the full invoice's layout ripples into

Found 2026-10-15 with
`/usr/bin/grep -n -E 'Factura completa|fullInvoice|Precio sin IVA|IVA incluido\)|Base [0-9,]+%|€ / [0-9]|"Factura"|\["Fecha"|FULL_INVOICE|full-invoice-(58|80)mm|Oinarria|Base 1' apps/server/src/*.test.ts`
(run from the worktree root), then sorted by whether the file opens a database (`useVenueDb`).
These open none. A `Base N%` hit on a simplified receipt with several rates keeps «Base»; only a
full invoice's changes to «Base imponible».

**Files:**
- `apps/server/src/receipt-ticket.test.ts`, the full-invoice cases: "prints saved issue offset
  $offset …" (`:126`), "prints the saved operation day in $locale …" (`:170`), "identifies
  VAT-inclusive F1 reductions …" (`:245`, its «(IVA incluido)» rows), "prints VAT beside each F1
  dish and extra …" (`:308-357`, reads up to «Base 21%» at `:354`), "keeps the F2 gross layout even
  when net facts are present" (`:360-381`, its «Factura completa»/«Precio sin IVA» absence checks
  stay true), "labels F1 net lines in %s without changing a sub-unit price quantity" (`:384-418`,
  pins «2,50 € / 0.1 kg» at `:417` for 0.32 kg of jamón priced per 0.100 kg: 0.32 ÷ 0.100 is
  3.2 portions, not whole, so the row reads «0.32 kg Jamón 2,50 8,00» — the quantity and unit
  kept, the price alone, owner Q4; assert that row and that no «/» prints), "prints the filed combined quantity for an F1 extra …" (`:422-454`, «Precio sin IVA
  2,00 € / 1» at `:454`), "prints distinct F1 net prices and weighted price quantities …"
  (`:458-497`, `:485-493`), the two F1 address cases (`:501`, `:541`), "emits the mandated
  elements in the art. 7.1 order" (`:1009-1028`, check whether it is F1), "prints every fixed word
  in $locale" (`:2483-2494`, its `full` invoice), "keeps the goods, the VAT breakdown and the total
  in left-aligned columns" (`:2830-2843`), and "puts one blank line above and below the logo on
  $name" (`:2964-2969`, the full-invoice case expects «Factura completa» before the logo: the
  logo now opens the business block with nothing of the invoice's above it, so `before` becomes
  `[]`).
- `apps/server/src/invoice-pdf.test.ts`: "carries the saved identity, dates, discounted amounts
  and cent-exact VAT summary" (`:50-78`: «Factura FF/1» and «Fecha 18 ago 2026, 0:34» at `:69-70`,
  and `:73-75`), and "leaves half a line above and below a drawn logo …" (`:451-460`, expects
  «Factura completa» just before the logo at `:457`).
- `apps/server/src/invoice-language.test.ts` (`:15-19`, `:31-35`, `:47-51`, `:65-67`; it reads only
  the fixture, through the PDF).
- `apps/server/src/invoice-raster.test.ts` and `apps/server/src/receipt-styles.test.ts` (both use
  the fixture; run them, change only what fails).
- Regenerate `apps/server/src/testing/full-invoice-58mm.bin` and `full-invoice-80mm.bin`.

Command: `pnpm --filter @waitron/server exec vitest run src/receipt-ticket.test.ts src/invoice-pdf.test.ts src/invoice-language.test.ts src/invoice-raster.test.ts src/receipt-styles.test.ts src/receipt-document.test.ts`

- [ ] **Step 1:** Run the command; list each failure.
- [ ] **Step 2:** Update each assertion's WHERE or HOW, never the fact it checks (a «Precio sin
  IVA 10,00 € / 1» check becomes the table row; «Descuento 10% (IVA incluido) -1,21 €» becomes
  «Descuento 10% -1,00»; «Base 21% 9,00 €» becomes «Base imponible 21% 9,00 €»; «Factura FF/1»
  becomes «FACTURA FF/1»).
- [ ] **Step 3:** Regenerate the `.bin` files; run the command — PASS (read the `Tests` count).
- [ ] **Step 4: Commit**, the message naming each changed assertion and listing the decoded text
  of the `.bin` files before and after (`printedLines`).

#### Task 2.3c-2: The database and API suites the full invoice's layout ripples into

The same grep's files that open a database, plus the suites that file real full invoices and read
them back (the earlier plan named them; the grep finds no layout string in the last two, so expect
few or no changes there):

**Files:**
- `apps/server/src/bill-payments.test.ts:1325`, `orders-invoice-deliveries.test.ts:1000`,
  `till-api.deliveries.test.ts:960` — «Factura completa» becomes «FACTURA» and the invoice number.
- `apps/server/src/page-print-api.test.ts` (`:1027-1030` render the fixture), `invoice-email.test.ts`
  and `invoice-delivery.test.ts` (both import the fixture).
- `apps/server/src/receipt-print.test.ts`, `receipt-language.test.ts`,
  `receipt-adjustments.test.ts` (its F1 case, `:99-181`, reads net figures only),
  `till-api.fiscal-sale-paths.test.ts`, `till-sale-integrated.db.test.ts`.

Command: `pnpm --filter @waitron/server exec vitest run src/bill-payments.test.ts src/orders-invoice-deliveries.test.ts src/till-api.deliveries.test.ts src/page-print-api.test.ts src/invoice-email.test.ts src/invoice-delivery.test.ts src/receipt-print.test.ts src/receipt-language.test.ts src/receipt-adjustments.test.ts src/till-api.fiscal-sale-paths.test.ts src/till-sale-integrated.db.test.ts`
(check `memory_pressure | grep free` first), then the whole receipt-suite command from Global
Constraints, which must be green before the commit.

- [ ] **Step 1:** Run the command; list each failure.
- [ ] **Step 2:** Update each failing assertion's WHERE or HOW, keeping the fact it checks.
- [ ] **Step 3:** Run the command, then the receipt-suite command — PASS (read each `Tests` count).
- [ ] **Step 4: Commit**, naming each changed assertion.

#### Task 2.3d: A bare count on the simplified receipt (owner, Q8)

Today a simplified receipt's item prints `${quantity}${unit}  ` before its name
(`receipt-document.ts:236-241`): «4 ud  Agua, pan y aceite». It becomes `quantityText(dish,
namesLocale)` plus the same two spaces: «4  Agua, pan y aceite», and «0.35 kg  Jamón ibérico» stays.
The name's wrap indent (`{ after: quantity }`, `:241`) follows the new prefix. Extras keep today's
form (`:264-269`: an Each extra already prints «Aceitunas x2», a weighed one its quantity and unit).
The till's on-screen copy (`apps/till/src/screens/till-ticket-view.ts`) is outside A663; Task 2.6
adds this to its backlog entry.

**Files:** `apps/server/src/receipt-document.ts`, `apps/server/src/receipt-ticket.test.ts`, then the
receipt suites. Today's «ud» assertions, found with
`/usr/bin/grep -n -E "[0-9] (ud|u|ea)[ \"']" apps/server/src/*.test.ts` on 2026-10-15:
`adjustments-apply.test.ts:473`, `receipt-adjustments.test.ts:486-490, 528-531`,
`receipt-ticket.test.ts:2609, 3249-3258, 3310, 3369`; a pattern written another way is found only by
running the suites.

- [ ] **Step 1: Failing test** (`receipt-ticket.test.ts`, beside the simplified-layout cases at
  `:3249`): a simplified receipt with `4 × Agua, pan y aceite` (`unitName: { es: "ud" }`) and
  `0.35 kg Jamón ibérico` (`unitName: { es: "kg" }`) prints a line starting «4 Agua, pan y aceite»
  and one starting «0.35 kg Jamón ibérico» (the decoded text collapses runs of spaces, as the cases
  at `:3249-3250` read it), and no line containing «4 ud».
- [ ] **Step 2:** Run it — FAIL.
- [ ] **Step 3:** Implement with `quantityText`.
- [ ] **Step 4:** Run the receipt suites; update each «N ud» expectation to the bare count, keeping
  the fact it checks. Read the `Tests` count — PASS.
- [ ] **Step 5: Commit**, naming each changed assertion. If a `.bin` file changes (it should not: the
  fixture is a full invoice), stop and find out why.

### Task 2.4: The address once, or both with «Domicilio fiscal:»

Today a thermal full invoice prints the venue address lines (`receipt-document.ts:198-200`, only
on `surface === "thermal"`) and then the filed registered address (`:203`), unlabelled, so a venue
whose two addresses match prints the same address twice. The A4 page passes no venue address
(`invoice-document.ts:125`, `venueAddress: []`), so it already prints the registered address once.

Rule (spec point 3): compare the venue address lines joined with ", " to `issuer.domicile`, after
folding case (`toLocaleLowerCase`), replacing every run of characters that are not letters or digits
with one space, and trimming. Equal → print only the venue lines. Different → print the venue lines,
then `«Domicilio fiscal:» <domicile>` as one text line. Only the registered address present (venue
address switched off, or A4) → print it unlabelled, as today. Accents are not folded: "Icària" and
"Icaria" count as different, so both print — a repetition, never a missing address.

How often "print once" fires is not known: the registered address is typed as free text at setup
(the «taxpayerDomicile» field, `apps/setup/src/screens/venue-screen.ts:772`), so a domicile written
with a province or country added («…, 08005 Barcelona (Barcelona)») will not match the venue's
address lines and both will print, labelled. That failure is the safe one (a repeated address, never
a missing one); Task 2.6's LOOK includes such a domicile so the owner sees what it prints.

**Files:**
- Modify: `apps/server/src/receipt-document.ts:198-203`
- Test: `apps/server/src/receipt-document.test.ts`

- [ ] **Step 1: Failing tests**

```ts
const withAddresses = (venueAddress: string[], domicile: string) =>
  buildReceiptDocument({
    ...FULL_INVOICE_DOCUMENT_FIXTURE,
    surface: "thermal",
    venueAddress,
    result: { ...FULL_INVOICE_DOCUMENT_FIXTURE.result, issuer: { venueName: "Santet SL", nif: "B00000000", domicile } },
  }).elements.flatMap((e) => (e.kind === "text" ? [e.text] : []));

it("prints a matching address once, ignoring case, commas and spacing", () => {
  const text = withAddresses(["Avinguda d'Icària 215, Bajos", "08005 Barcelona"], "AVINGUDA D'ICÀRIA 215 BAJOS,  08005 Barcelona");
  expect(text.filter((t) => /Icària/i.test(t))).toEqual(["Avinguda d'Icària 215, Bajos"]);
  expect(text.some((t) => t.startsWith("Domicilio fiscal:"))).toBe(false);
});

it("prints both, the registered one labelled, when they differ by one real character", () => {
  const text = withAddresses(["Avinguda d'Icària 215, Bajos", "08005 Barcelona"], "Avinguda d'Icària 217, Bajos, 08005 Barcelona");
  expect(text).toContain("Avinguda d'Icària 215, Bajos");
  expect(text).toContain("Domicilio fiscal: Avinguda d'Icària 217, Bajos, 08005 Barcelona");
});

it("prints the registered address unlabelled when it is the only one", () => {
  const text = withAddresses([], "Avinguda d'Icària 215, Bajos, 08005 Barcelona");
  expect(text).toContain("Avinguda d'Icària 215, Bajos, 08005 Barcelona");
});
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (a small `sameAddress(lines, domicile)` function
  beside `buildReceiptDocument`). **Step 4:** Run — PASS; run the receipt suites;
  `receipt-document.test.ts:12-29`'s byte check is regenerated only if this changes the fixture's
  paper (its two addresses differ, so it now gains the label: regenerate and say so).
  **Step 5: Commit.**

### Task 2.5: The A4 page — columns and right-aligned amounts

Today the A4 page draws an amount row as caption and amount joined by one space
(the `text`/`amount` case of `layoutInvoicePages`, `invoice-page.ts:163-169`), so nothing lines up.
After this task: an `amount` element draws its caption at the left and its amount right-aligned to
`INVOICE_PAGE_WIDTH - MARGIN` (`MARGIN` is 36, `invoice-page.ts:8`); a `table` element draws
columns — units right-aligned in a column as wide as its widest cell, the item column from there,
and price, amount and rate right-aligned at fixed right edges measured with the font (`width()`,
`:43-45`), the header row bold, an item name wrapping inside its column, an empty cell drawn as
nothing. A row that needs more than the remaining page height moves to the next page whole.

**Files:**
- Modify: `apps/server/src/invoice-page.ts`
- Test: `apps/server/src/invoice-pdf.test.ts`, `apps/server/src/invoice-raster.test.ts`

- [ ] **Step 1: Failing tests** (`invoice-pdf.test.ts`)

```ts
import { invoiceFont } from "./invoice-font.js";

/** The same measure invoice-page.ts's width() takes, at a given size. */
const measuredWidth = (text: string, size: number) =>
  (invoiceFont.layout(text).advanceWidth * size) / invoiceFont.unitsPerEm;

it("right-aligns every amount to the content's right edge", () => {
  const texts = layoutInvoicePages(fixture)[0]!.elements.filter((e) => e.kind === "text");
  const total = texts.find((e) => e.kind === "text" && e.text === "19,69 €");
  if (total?.kind !== "text") throw new Error("TOTAL's amount is not its own text element");
  expect(total.x + measuredWidth(total.text, total.size)).toBeCloseTo(INVOICE_PAGE_WIDTH - 36, 1);
});

it("draws the item table's amounts, the discount's included, in one column", () => {
  const texts = layoutInvoicePages(fixture)[0]!.elements.filter((e) => e.kind === "text");
  const amounts = ["-1,00", "8,00"].map((value) => texts.find((e) => e.kind === "text" && e.text === value)!);
  const rights = amounts.map((e) => e.kind === "text" ? e.x + measuredWidth(e.text, e.size) : NaN);
  expect(rights[0]).toBeCloseTo(rights[1]!, 1);
});
```

(`-1,00` is the fixture's discount row and `8,00` the water's amount, both in the amount column
after Task 2.3b; each text is unique on the page — the bases print as «9,00 €» and «8,00 €», with
the sign. The first row's «10,00» is not used: it is both its price and its amount.) Keep every
existing A4 check: the QR first and 35 mm, the logo, pagination without clipping
(`invoice-pdf.test.ts:123`), the rule above TOTAL on TOTAL's page.

- [ ] **Step 2:** Run `pnpm --filter @waitron/server exec vitest run src/invoice-pdf.test.ts src/invoice-raster.test.ts` — FAIL.
- [ ] **Step 3:** Implement. **Step 4:** Run — PASS; run the receipt suites. **Step 5: Commit.**

### Task 2.6: Pins, LOOK, gates, backlog

- [ ] **Step 1: Pin the operation-date rule** (spec point 2; behaviour already present). In
  `apps/server/src/invoice-document.test.ts`, add a case: a sale whose `operation_date` equals its
  local issue day yields no `operationDate`, and one a day earlier yields it. If an equivalent case
  already exists (search the file for `operationDate`), name it in the commit instead of adding one.
  Prove the new case by deletion: remove `sale.operationDate !== issueDay &&` at
  `invoice-document.ts:146` locally, see the case fail, restore it.
- [ ] **Step 2: LOOK.** Extend `apps/server/scripts/receipt-look.ts` with a full invoice whose two
  addresses match, one whose addresses differ, one whose domicile is the venue's address with a
  province added («Avinguda d'Icària 215, Bajos, 08005 Barcelona (Barcelona)»), a two-rate full
  invoice with a whole-bill discount (S5's figures), the owner's menu del día (one 10,00 € menu at
  10% less 10%), a comped weighed line of under one kilo (owner question Q9's gap: it prints «0,00
  0,00» and no «Invitación» — expected until Part 2c, which prints its value and an «Invitación»
  row), an extra priced per portion (units «2», price «1,24»), one holding a
  weighed line («0.35 kg», `unitName: { es: "kg" }`) beside counted
  lines (`unitName: { es: "ud" }`), and a simplified receipt with the same counted and weighed
  lines; run it; open every 58 mm, 80 mm and A4 picture and the PDF. Check the table columns line
  up, the discount rows sit in the amount column, the 58 mm two-rate invoice and the 58 mm invoice
  with a weighed line use the two-line rows, the A4 amounts sit on one right edge, «Domicilio
  fiscal:» appears only when the addresses differ, no «(IVA incluido)» on a full invoice, and no
  «ud» on either document.
- [ ] **Step 3: Fiscal gate**, unedited, PASS.
- [ ] **Step 4: Backlog.** In `docs/backlog/printers.md`, delete points 2, 3 and 4 of the A663
  entry (point 4 by the table, «Precio» per priced unit with nothing after it, owner Q4). Add to the
  entry "The till's on-screen receipt is a second copy of the layout" that the till also still
  prints «4 ud» where paper now prints «4» (owner, Q8), and its discounts with VAT on a full
  invoice. Owner questions Q9, Q10 and Q11 are answered (2026-10-15), so none becomes an entry of
  its own: the A663 entry stays open and names what is left — Part 2b (base and VAT on a one-rate
  simplified receipt), Part 2c (each line's price before any discount; the whole-bill discount once
  per rate) and Part 3 (guests). Add a short entry under the fiscal
  area (it went to `docs/backlog.md`'s fiscal area, whose rules keep an entry of four lines or fewer there): "Check whether a simplified invoice can carry an operation date
  different from its issue date; art. 7.1.c then requires it on the receipt, and the document
  builder prints one only on a full invoice (`receipt-document.ts`)".
- [ ] **Step 5: Commit, then `/finish-branch`.**

---

# Part 2b — base and VAT on a one-rate simplified receipt (owner Q11)

Branch `feat/a663-2b-one-rate-vat-lines`, from `main` after Part 2 has landed. Its own pull
request. **Review path: FULL** (Global Constraints: what a receipt prints is a legal document), with
the Codex run-it seat twice. **Migration: none.**

This section states the scope only. The part's test-first tasks are written at its start, before
anything is built, and reviewed by a fresh-context reader against this section and the owner's Q11
answer. Line numbers are from Part 2's branch on 2026-10-15; re-check them on `main` first.

- `vatRows` (`apps/server/src/receipt-document.ts:357-372`) loses its one-rate branch (`:360-366`,
  the «IVA x% incluido» row). Every simplified receipt then prints a base row and a VAT row per
  rate, under TOTAL (the order at `:376-378` stays), from `result.vatBreakdown`: the record's own
  figures, never a sum of the lines. The owner's example: «Base imponible 10% 8,18 €» and «IVA 10%
  0,82 €».
- **Open for the driver before the tasks are written: the base's label.** The owner's words are
  «Base imponible», "as a full invoice does". A two-rate simplified receipt prints «Base 10%» today
  (`label.base`, `:367`). Either the two-rate receipt changes to «Base imponible» too, so a
  simplified receipt never names the base two ways (this plan's recommendation), or the one-rate
  receipt alone uses it.
- The `vatIncludedAtRate` label key (`packages/country/src/country.ts:82`, and its four languages in
  `packages/country-es/src/receipt-labels.ts`) loses its only reader: `git grep vatIncludedAtRate` on
  2026-10-15 found `receipt-document.ts:362` and `packages/country-es/src/spain.test.ts:288, 294`,
  and nothing in `apps/till`. The tasks remove it with its test lines.
- Tests: `git grep -n 'incluido' -- apps packages` on 2026-10-15 lists the suites that name the
  row — `receipt-document.test.ts`, `receipt-ticket.test.ts`, `receipt-language.test.ts`,
  `receipt-preview-api.test.ts`, `adjustments-bill-payments.test.ts`, `bill-payments-api.test.ts`
  and `bill-refunds.card.test.ts` under `apps/server/src`. Some assert the row is printed, some that
  it is not; each is read before it is edited. One that asserts the row changes to the base and VAT
  rows, keeping the fact it checks (that VAT prints, and where).
- The two `.bin` files hold a full invoice's bytes (Global Constraints), which this part does not
  change: regenerate them and check they come out byte for byte the same. If they differ, the part
  has reached the full invoice; stop.
- LOOK: the one-rate simplified receipt in `apps/server/scripts/receipt-look.ts` (the mockup's sale)
  shows the two rows under TOTAL on 58 mm, 80 mm and A4.
- The till's on-screen copy (`apps/till/src/screens/till-ticket-view.ts`) stays outside A663: add
  this difference to the backlog entry "The till's on-screen receipt is a second copy of the layout".
- Fiscal: this part reads the filed `vatBreakdown` and writes nothing. Fiscal gate (Global
  Constraints), unedited, PASS.
- Backlog: take Part 2b out of the A663 entry's list of what is left.

---

# Part 2c — each line's price before any discount, and the whole-bill discount once per rate (owner Q9, Q10)

Branch `feat/a663-2c-price-before-discount`, from `main` after Part 2b has landed. Its own pull
request. **Review path: FULL** — a migration on `sale_lines`, an append-only fiscal ledger table
(`appendOnly("sale_lines", …)`, `packages/db/src/classification.ts:18`) — with the Codex run-it
seat twice. **Migration: one** (a new column).

This section states the scope only. The part's test-first tasks are written at its start, before
anything is built, and reviewed by a fresh-context reader against this section and the owner's Q9
and Q10 answers. Step 1 below is answered, and written into this section, before any task that
builds Q10's rows is written. Line numbers are from Part 2's branch on 2026-10-15; re-check them on
`main` first.

## Step 1 — can a dish's own discount be told apart from its share of a whole-bill discount?

**Open: what reading the code shows, not yet measured.**

- The answer does not come from the new column. Every comp and discount on a bill is a row in
  `adjustments`: one on a dish names its line, one on the whole bill names none, and each holds what
  it took off, with VAT (`reduction`; `readBillAdjustments`,
  `packages/adjustments/src/record.ts:187-212`). A whole-bill discount is not recorded per line: it
  lowers each line's price (`spreadBillDiscount`, `packages/adjustments/src/spread.ts:308`).
- The receipt reads those rows when it prints and puts each one on its row or on the bill
  (`apps/server/src/receipt-adjustments.ts:83-116`), but only when every row finds its line and the
  list totals less everything taken off equal what was charged (`:117-124`). Otherwise each dish
  gets one entry for everything it lost (`perDish`, `:147`).
- So, when every row is placed, a line's share of the whole-bill discount with VAT is its list
  total less its charged total less its own reductions; before VAT, its own discount is the base of
  its list total less the base of (list total − own reductions), and the bill's share is the rest
  down to the filed base. When the rows are not placed, the two cannot be told apart.

Step 1 measures this with a throwaway database test, as Part 2's "What a filed line holds" did: S1,
a dish discounted after a whole-bill discount, and a line split by one. It writes the result here.

Worked example, S1's burger: 12,00 € at 21%, 10% off the burger, then 10% off the whole bill; its
filed base is 8,03 (measured, Part 2). Worked by hand with Python's `Decimal`, rounding half up,
2026-10-15, assuming the burger's own discount took 1,20 (12,00 → 10,80); not run through the code:

- If they can be told apart: «1 Hamburguesa 9,92 9,92 21%», then under it «Descuento 10% -0,99
  21%» (9,92 − 8,93, since 10,80 ÷ 1,21 = 8,93); the remaining 0,90 (8,93 − 8,03) is part of the
  «Descuento 10% … 21%» row at the end of the table.
- If not: the burger's row holds both, «Descuento -1,89 21%» (plain «Descuento», Part 2's rule for
  two discounts on one dish), and the 21% row at the end holds only the other dishes' shares.

## Scope — Q9: each line's price before any discount

- A new nullable money column on `sale_lines`: the line's unit price with VAT before any comp or
  discount, in whole cents, converted at the row (CLAUDE.md §3; its name is chosen in the tasks).
  The value already exists on the order line: `working_order_lines.list_unit_price_gross`
  (`packages/db/src/schema/orders.ts:216-218`: "the unit price the line had when an adjustment first
  touched it … null on a line no adjustment has touched"), read as `OrderLineIdentity.listUnitGross`
  (`apps/server/src/working-order.ts:967-968`, `:1003-1004`). Today it reaches the sale only as a
  line total, `listGross` (`listGrossOf`, `apps/server/src/receipt-lines.ts:74-88`).
- **Where it is written.** Every till path hands its lines to filing through
  `withReceiptListPrices` (`receipt-lines.ts:66-71`; called at `till-sale.ts:919`, `:1522`, `:1684`,
  `bill-payments.ts:706`, `working-order.ts:6115`). `RecordSaleLine` gains the field beside
  `listGross` (`packages/core/src/sale-line.ts:51-52`), and `saleLineRows` writes it beside
  `listGross` (`packages/core/src/sale-line-rows.ts:46`), the one insert that `recordSale`
  (`record-sale.ts:351`), `recordSubstitution` (`record-substitution.ts:229`) and
  `recordCorrection` (`record-correction.ts:204`, `:308`) use. What a corrective line stores is
  decided in the tasks (a credit negates `listGross` today, `apps/server/src/cancel-credit.ts:106`).
- **Where it is read.** The full invoice's reader of filed lines
  (`receipt-adjustments.ts:46-80`, beside `listGross` at `:55` and `:68`), which paper and A4 share
  (A4 reaches it through `receiptLines`, `apps/server/src/invoice-document.ts:62-82`). Then
  `beforeVatFigures` (`apps/server/src/receipt-figures.ts:38-57`) takes the stored price instead of
  dividing the list total back, and loses the early return for less than one priced unit (`:45`).
- The owner's example: «0.123 kg Jamón ibérico 21,82 2,68 10%» and «Descuento 10% -0,26 10%»
  (24,00 ÷ 1,10 = 21,82; 2,95 ÷ 1,10 = 2,68; 2,68 − 2,42 = 0,26; Python `Decimal`, half up,
  2026-10-15). A comped weighed line prints its value and an «Invitación» row.
- A line filed before Part 2c has the column null and prints as Part 2 prints it. No backfill
  (pre-live, CLAUDE.md §3).

## Scope — Q10: the whole-bill discount once per rate

- `groupDiscounts` (`receipt-figures.ts:71-102`) and the table builder that calls it
  (`receipt-document.ts:290-313`) stop putting a whole-bill share under each dish. A dish's row
  carries its own discount only. After the last item, one row per VAT rate the whole-bill discount
  reached: «Descuento 10% -2,48 21%», «Descuento 10% -0,22 10%» (S5, the owner's example; the label
  rule is Part 2's). Each is the sum of that rate's lines' shares before VAT, so the table still
  comes to the record's base, rate by rate.
- «Base imponible» and «IVA» stay the record's own figures.
- How a dish with both discounts prints follows Step 1's measured answer.

## Migration

- One drizzle generation, for the column alone. It is expected to be an `ALTER TABLE … ADD`, not a
  rebuild. If drizzle-kit writes a rebuild, stop: list every foreign key that points at `sale_lines`
  first (CLAUDE.md §3). The column comes from `packages/db/src/schema/columns.ts` (`money()`).
- Run the checks CLAUDE.md §3 lists after a regeneration (`scripts/schema-constraints.test.ts`,
  `scripts/append-only-triggers.test.ts`, `scripts/behavioural-triggers.test.ts`,
  `scripts/migrations-match-schema.test.ts`, `packages/fiscal-verifactu/src/inmutabilidad.test.ts`)
  and the upgrade test from §2 (`scripts/migration-upgrade.test.ts`).

## The fiscal constraint

- No hashed field, no change to the alta writer, to invoice numbering, to `registros_facturacion`
  or to the QR text, and no golden or `inmutabilidad` test edited. The fiscal gate (Global
  Constraints) and the whole `@waitron/fiscal-verifactu` and `@waitron/core` suites run unedited
  and PASS.
- `git grep sale_lines` over `packages/fiscal-verifactu/src` outside tests, on 2026-10-15, finds
  only `privileges.expected.ts:96`. That grep is not the proof: the tasks follow the alta writer's
  call chain and say which inputs it reads. The comment at `sale-line-rows.ts:8-9` ("the fiscal
  breakdown is never built from these rows") is checked the same way.
- Backlog: take Part 2c out of the A663 entry's list of what is left.

---

# Part 3 — guests and the amount per person

Branch `feat/a663-3-guests`, from `main` after Parts 1a and 1b have merged **and A661 has merged** (A661 landed 2026-10-15, #1745)
(this part edits `receipt-print.ts`). Uses owner question Q2's default unless the owner has answered.

Guests are stored on the party, not the bill: `parties.guest_count`, null or at least 1
(`packages/db/src/schema/parties.ts:37, 62`), set when a table is seated
(`apps/server/src/till-api.ts:2675-2685`). A bill belongs to a party through
`working_orders.party_id` (`packages/db/src/schema/orders.ts:108`), and a party can hold several
bills when it is split (`parties.ts:22-31`). A sale names its bill in `sales.working_order_id`.

Merged parties. A guest count is written only when a party is created (`insertParty`,
`apps/server/src/parties.ts:247-256`; `git grep -n guestCount -- 'apps/server/src/*.ts'` on
2026-10-15 found no other writer, and the two other party openings, `move-bill.ts:123-127` and
`table-actions.ts:330-334`, pass `null`). When one party is merged into another, the absorbed party
closes pointing at the survivor (`merged_into_party_id`, `table-actions.ts:289-292`), its main
bill's items can be merged into the survivor's main bill (`mergeCheckedBills`,
`table-actions.ts:259-270`), and the code treats a party and every party merged into it as one
family (`partyFamily`, `parties.ts:431-437`). The survivor keeps only its own guest count, so after
"table 4 (2 guests) joins table 5 (3 guests)" the survivor's bill holds both tables' food but says
3 guests: dividing by it would be wrong.

> **2026-10-15, A713:** this describes the code before A713. A guest count now has more writers:
> the till's Guests sets or clears it at any time (`PUT /api/parties/:id/guests`); a Join, or a Move
> guests onto a seated table, leaves the surviving party with both counts added together, or none
> when either is unknown or the sum is over 999 (`combineParties`, `apps/server/src/table-actions.ts`);
> and Split a table asks each side's count. The owner chose to add joined counts
> ([till.md](../../backlog/till.md#decisions-and-deliberate-limits)), so a merged party's own count
> already holds the sum. A bill split by item still has no count of its own. So the Rule's "no other
> party was merged into it" condition and its "a merged party's bill print[s] neither" as it applies
> to the survivor, the reader's `partyFamily` check, and Step 1's expectation of undefined for the
> survivor's bill no longer match the owner's choice: a survivor's bill can print its own count.

Rule (Q2 default): print «4 comensales · por persona  101,75 €» when the sale's bill belongs to a
party with a guest count, that party holds no other bill that is not `abandoned`
(`workingOrderStatus`, `orders.ts:29-36`), no other party was merged into it (`partyFamily` returns
only itself), and it was not itself merged into another (`merged_into_party_id` is null — whether a
bill can still name a merged-away party when it is paid was not checked, so the reader refuses that
case too). A split bill and a merged party's bill print neither. The per-person amount is
`divideDecimal(total, guests, MONEY_SCALE)`, rounded half away from zero
(`packages/shared/src/money.ts:100-101`). It is read when the receipt is printed, like the order
label before issuance; nothing is stored.

### Task 3.1: Guests on the document

**Files:**
- Modify: `packages/country/src/country.ts`, `packages/country-es/src/receipt-labels.ts` — labels
  `guests` («{count} comensales» / ca «{count} comensals» / gl «{count} comensais» / eu
  «{count} mahaikide») and `perPerson` («por persona» / «per persona» / «por persoa» /
  «pertsonako»)
- Modify: `apps/server/src/receipt-document.ts` (`ReceiptDocumentInput.guests?: number`; a section
  after payment: `row(\`${guestsText} · ${label.perPerson}\`, formatMoney(perPerson))`)
- Test: `apps/server/src/receipt-document.test.ts`, `apps/server/src/receipt-ticket.test.ts`,
  `packages/country-es/src/spain.test.ts`

- [ ] **Step 1: Failing tests**

```ts
it("prints guests and the amount per person after the payment when guests were entered", () => {
  const rows = buildReceiptDocument({ ...FULL_INVOICE_DOCUMENT_FIXTURE, guests: 4 }).elements.flatMap((e) =>
    e.kind === "amount" ? [[e.caption, e.amount]] : [],
  );
  const at = rows.findIndex(([caption]) => caption === "4 comensales · por persona");
  expect(rows[at]).toEqual(["4 comensales · por persona", "4,92 €"]); // 19,69 ÷ 4 = 4,9225 → 4,92
  expect(at).toBeGreaterThan(rows.findIndex(([caption]) => caption === "Cambio"));
});

it("prints no guests line without guests", () => {
  const text = JSON.stringify(buildReceiptDocument(FULL_INVOICE_DOCUMENT_FIXTURE).elements);
  expect(text).not.toContain("comensales");
});

it("rounds a half cent away from zero", () => {
  const input = { ...FULL_INVOICE_DOCUMENT_FIXTURE, guests: 2, result: { ...FULL_INVOICE_DOCUMENT_FIXTURE.result, total: "0.05" } };
  expect(JSON.stringify(buildReceiptDocument(input).elements)).toContain("0,03 €");
});
```

Plus a 58 mm and 80 mm case in `receipt-ticket.test.ts` that the line reads back whole (on 58 mm
the amount moves to its own line).

- [ ] **Steps 2–5:** run (FAIL), implement, run (PASS) plus the receipt suites, commit.

### Task 3.2: Reading the guests, and passing them to paper and A4

**Files:**
- Create: `apps/server/src/receipt-guests.ts`
- Modify: `apps/server/src/receipt-print.ts:141-201` (`buildReceiptBytes`: read and pass `guests`)
- Modify: `apps/server/src/invoice-document.ts:120-156` (pass `guests`)
- Test: `apps/server/src/receipt-guests.test.ts` (`useVenueDb`), `apps/server/src/receipt-print.test.ts`

**Interfaces:**
- Produces: `readReceiptGuests(tx: Transaction, saleId: string): Promise<number | undefined>`.

```ts
export async function readReceiptGuests(tx: Transaction, saleId: string): Promise<number | undefined> {
  const [row] = await tx
    .select({ partyId: parties.id, guests: parties.guestCount, mergedInto: parties.mergedIntoPartyId })
    .from(sales)
    .innerJoin(workingOrders, eq(workingOrders.id, sales.workingOrderId))
    .innerJoin(parties, eq(parties.id, workingOrders.partyId))
    .where(eq(sales.id, saleId));
  if (row === undefined || row.guests === null || row.mergedInto !== null) return undefined;
  if ((await partyFamily(tx, row.partyId)).length > 1) return undefined;
  const bills = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(and(eq(workingOrders.partyId, row.partyId), ne(workingOrders.status, "abandoned")));
  return bills.length === 1 ? row.guests : undefined;
}
```

- [ ] **Step 1: Failing tests** (`receipt-guests.test.ts`, with `useVenueDb` and the server's own
  seat/sale helpers — find the fixtures `till-api.receipt.test.ts` uses to seat a table and pay):
  a seated party of 4 paying one bill → 4; a party seated with no guest count → undefined; a counter
  sale → undefined; a party split into two bills → undefined for each; a party whose second bill was
  abandoned → 4; a party of 3 that another party of 2 was merged into (`seatTable` both, then the
  merge `table-actions.ts` performs) → undefined for the survivor's bill, and undefined for any bill
  still on the absorbed party. Then a `receipt-print.test.ts` case: the printed receipt of a party-of-4 bill
  contains «4 comensales · por persona».
- [ ] **Steps 2–5:** run (FAIL), implement, run (PASS) plus the receipt suites, commit.

### Task 3.3: LOOK, gate, backlog

- [ ] Extend `receipt-look.ts` with `guests: 4` on the one-rate sample and the full invoice; run;
  open the pictures; the line sits after the payment, before the footer, in its own ruled section.
- [ ] Fiscal gate, unedited, PASS.
- [ ] Backlog: point 6 deleted; A663 entry deleted from `docs/backlog/printers.md` and its line removed
  from `docs/backlog.md` if no point is left open; if Q2 is still unanswered, leave a one-line entry "A663 Q2: split
  bills print no guests line — owner to confirm".
- [ ] Commit, then `/finish-branch`.

---

# Part 4 — the drink/food subtotal setting

Withdrawn by the owner on 2026-10-15: the drink and food subtotals are not built.

Branch `feat/a663-4-drink-food-subtotals`. **Waits for owner questions Q1, Q3 and Q6**, and for A661
to merge (this part edits `receipt-print.ts`, `apps/dashboard/src/api/client.ts` and
`apps/dashboard/src/i18n/strings.ts`, all three changed by A661). Q3's default (a department switch)
departs from the spec's "a venue setting"; build it only once the owner has answered Q3. The tasks below build the recommended defaults; if the owner
chooses differently, rewrite this part before dispatching it.

What exists to build on (read 2026-10-15):
- Every sale line records its reporting category and every category above it, root first, when the
  line is added (`sale_lines.classification`, `packages/db/src/schema/sales.ts:208`;
  `SaleLineClassification`, `packages/shared/src/sale-line-classification.ts:6-8`; the plan that
  built it, `docs/superpowers/plans/2026-09-25-sales-classification.md`, with the 2026-09-27 note
  that the snapshot moved to line-add time). Lines added before that existed carry null.
- Today's classification of a product can be read the same way (`currentClassifications`,
  `packages/catalogue/src/current-classifications.ts:11-18`).
- Categories have a per-category detail row with a parent and a colour (`category_details`,
  `packages/catalogue/src/schema/categories.ts:4-27`), edited through `createCategory` /
  `updateCategory` (`packages/catalogue/src/categories.ts:80-118`) and the routes at
  `apps/server/src/catalogue-api.ts:1298, 1348`.
- Nothing in the code knows "drink": `git grep -n -i "drink\|bebida"` over package and server
  sources found nothing on 2026-10-15. VAT classes are `general`, `reduced`, `super_reduced`, `zero`
  (`packages/catalogue/src/vat-rates.ts:4`) and cannot tell a drink from food: both are 10% on the
  premises (spec point 7, Ley 37/1992 art. 91.Uno.2.2º as quoted there).
- Receipt options a venue sets live in the department receipt's JSON (`department_receipts.receipt`,
  `packages/venue-service/src/schema/department-receipts.ts:6-21`), beside `printAddress`. That
  column is plain JSON text with no CHECK constraint or trigger (the only migration naming the table,
  `packages/venue-service/drizzle/0048_department_receipts.sql`, declares neither), so a new boolean
  there needs **no migration**.

**Migration (Q1 default):** marking a category as drink needs one new column,
`category_details.drink` (`flag(...)`, `packages/db/src/schema/columns.ts:146`, not null, default
false), in the catalogue migration set — one migration, generated with
`pnpm --filter @waitron/catalogue db:generate --name category_drink`. READ the generated SQL: it must
be one `ALTER TABLE \`category_details\` ADD \`drink\` integer DEFAULT false NOT NULL;` line, never a
table rebuild (a rebuild would run `DROP TABLE` with foreign keys on; CLAUDE.md §3). If drizzle emits
a rebuild, STOP. A product-level setting (Q1's alternative) would equally need a migration, on
`products`.

### Task 4.1: A category can be marked "drink"

**Files:** `packages/catalogue/src/schema/categories.ts`, `packages/catalogue/drizzle/*` (generated),
`packages/catalogue/src/categories.ts` (`Category.drink`, `CategoryInput.drink`),
`apps/server/src/catalogue-api.ts:152` (`categoryInput` accepts a boolean `drink`, refusing anything
else with `category.invalid`, `field: "drink"`), `packages/catalogue/src/configuration-transfer.ts`
(refuse a non-boolean `drink` on import, beside `checkColors` at `:86`), tests beside each.

- [ ] Failing tests: create with `drink: true` reads back `drink: true`; update flips it; a string
  `"yes"` is refused `category.invalid` with `field: "drink"` (assert the code, CLAUDE.md §4); an
  imported `category_details` row with `drink: "yes"` is refused; an export/import round trip keeps
  it. Run `pnpm --filter @waitron/catalogue exec vitest run src/categories.test.ts src/configuration-transfer.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts` — FAIL.
- [ ] Implement; generate and read the migration; run the migration guards named in CLAUDE.md §3:
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/classification-complete.test.ts`
  — PASS. Commit.

### Task 4.2: The dashboard marks a category as drink

**Files:** `apps/dashboard/src/widgets/catalogue-browser.ts` (a "Drinks" on/off item in a
category's row menu, saved with `PATCH /management-api/categories/:id` `{ drink }`, the way the
colour is saved from `category-color-form.ts`), `apps/dashboard/src/api/client.ts`
(`CategorySummary.drink`), the dashboard's English and Spanish strings
(`apps/dashboard/src/i18n/strings.ts`; this file and `client.ts` are both changed by A661), tests beside each, including
an axe check if a new control is added (CLAUDE.md §3).

- [ ] Failing browser test: toggling "Drinks" sends `{ drink: true }` and the row shows the state.
  Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/catalogue-browser.test.ts` —
  FAIL; implement; PASS; commit. Check free memory first: the dashboard runs in real Chromium.

### Task 4.3: The receipt switch "Print drink and food subtotals"

**Files:** `packages/shared/src/receipt-text.ts:4-12` (`DepartmentReceiptConfig.drinkFoodSubtotals?: boolean`),
`packages/layouts/src/validate.ts:134-152` (accept the field, boolean only, like `printAddress`),
`packages/venue-service/src/department-receipts.ts:71-115` (project and parse it as `printAddress`
is), `packages/venue-service/src/configuration-transfer.ts:615` (validate like `printAddress`),
`apps/dashboard/src/screens/department-receipt-dialog.ts` (a switch beside "Print address",
`:694`, with the draft-scope and unsaved-changes handling the dialog already has), tests beside
each, including the dialog's `*.unsaved.test.ts` and `*.a11y.test.ts`.

- [ ] Failing tests: the field saves and reads back; a non-boolean is refused with
  `receipt.invalid`, `reason: "not_boolean"`, `field: "drinkFoodSubtotals"`; absent reads as off;
  the dialog's switch changes the draft and the Save action. Implement; PASS; commit.

### Task 4.4: The subtotals (pure function)

**Files:** Create `apps/server/src/receipt-subtotals.ts` and its test.

**Interfaces:**
```ts
export function drinkFoodSubtotals(
  lines: readonly { gross: string; drink: boolean }[],
  total: string,
): { drink: string; food: string } | undefined;
```
Sum each group's line gross with `addDecimal`. When the two sums add to `total`, return them. When
they do not (a bill-wide discount taken off after the lines — Q6), share the difference between the
groups in proportion to their sums with `divideDecimal(…, MONEY_SCALE)`, give the food group the
cent left over, so `drink + food === total` exactly. Return `undefined` when there are no drink lines
or no food lines (a receipt with one group prints nothing extra).

- [ ] Failing tests: 63,00 + 344,00 = 407,00 → `{ drink: "63.00", food: "344.00" }`; a 10% bill
  discount (lines 63 + 344, total 366,30) → shares that add to exactly 366,30; all-drink →
  `undefined`; a total of 0.00 → `undefined`. Implement; PASS; commit.

### Task 4.5: Reading drink lines and printing the subtotals

**Files:** Create `apps/server/src/receipt-drink-food.ts` (reads, for a sale, each `sale_lines`
row's `line_gross` and `classification`, falls back to `currentClassifications` by `product_id`
when the classification is null, and marks a line drink when any category in its chain has
`drink` set today; returns `undefined` if any line has a null `line_gross`). Modify
`receipt-print.ts` `buildReceiptBytes` (call it when the department receipt's
`drinkFoodSubtotals` is true), `invoice-document.ts` (the same for A4),
`receipt-document.ts` (`ReceiptDocumentInput.subtotals?: { drink: string; food: string }`, printed
as `Bebida` / `Comida` rows in the guests section, after the guests line), labels `drink`
(Bebida / Beguda / Bebida / Edaria) and `food` (Comida / Menjar / Comida / Janaria).

- [ ] Failing tests (`useVenueDb`): a sale with a wine (category "Vinos" under a "Bebidas" marked
  drink) and a dish → both rows printed with the right sums; switch off → neither; no category
  marked → neither (all food: one group); a line whose category was moved under "Bebidas" after the
  sale still counts by the chain the sale recorded. Implement; PASS; run the receipt suites; commit.

### Task 4.6: LOOK, gate, backlog

- [ ] Extend `receipt-look.ts` with subtotals on both documents; run; open every picture.
- [ ] Fiscal gate, unedited, PASS. Migration guards from Task 4.1 PASS.
- [ ] Backlog: point 7 done; A663 entry deleted from `docs/backlog/printers.md` and its line removed
  from `docs/backlog.md` if no point is left open (each open owner question becomes its own short
  entry).
- [ ] Commit, then `/finish-branch`.

---

## Self-review (done while writing)

- Spec coverage: point 1 → Tasks 1.4 (Part 1a), 1.5 and 1.6 (Part 1b); point 2 → 2.3a–2.3c-2, 2.5,
  2.6 (operation date pinned); point 3 → 2.4; point 4 → 2.3b (the line it applies to is replaced;
  Q4); the owner's Q8 answer → 2.3a and 2.3d;
  point 5 → 1.3 (on paper and A4; the till's on-screen copy is a follow-up, Task 1.8); point 6 →
  Part 3; point 7 (drink/food subtotals) → withdrawn by the owner on 2026-10-15. The BOE re-check is done above; Task 2.6 records the one open legal question.
- The "VERI\*FACTU line may be printed in bold for margin" option in the spec is not taken: the
  roll font is already a bold face, and Orden HAC/1177/2024 art. 20.1.b asks only that the phrase be
  as visible as the rest; the caption keeps the other lines' size and weight.
- Names used across tasks: `ReceiptStyle`, `TextStyle`, `textBandHeight`, `formatVatRate`,
  `formatAmount`, `ReceiptTable`, `ReceiptTableRow`, `tableLines`, `baseFromGross`,
  `beforeVatFigures`, `groupDiscounts`, `GroupDiscount`, `quantityText`, `readReceiptGuests`,
  `drinkFoodSubtotals`, label keys as in Tasks 1.2, 2.1, 3.1 and 4.5.

---

## Owner questions

Answer by quoting the question number. Q4, Q5, Q7 and Q8 were answered on 2026-10-15 and Part 2
builds the answers; Q9, Q10 and Q11 were answered on 2026-10-15 with the alternatives, after Part 2
had built the defaults, and Parts 2b and 2c build the answers; Part 3 can be built on Q2's default;
Q1, Q3 and Q6 were for Part 4, which the owner withdrew on 2026-10-15. The Part 1b header order is
answered at the end.

**Q1 — How does the till know a product is a drink?** (Part 4 withdrawn 2026-10-15; no answer needed.)
Recommended: **mark categories.** In Products, a category's menu gets a "Drinks" switch; every
product in that category or any category under it counts as drink. Example: you switch it on for
"Bebidas"; "Vinos", "Cervezas" and "Refrescos" under it are drinks, and a new wine added to "Vinos"
next month is too, with nothing to remember. The receipt uses the category each line had when it
was sold. Alternative: a "Drink" switch on every product — finer (a dessert wine filed under
"Postres" could be a drink) but set product by product. Either needs one small database change.

**Q2 — Guests on a split bill, and on joined tables.** (Part 3 builds the default unless told
otherwise.)
Default: **a split bill prints no guests line.** Example: table 12 seats 4 and splits the bill in
two; each half would otherwise say «4 comensales · por persona» of a half-total, which is wrong. A
bill that is the table's only bill prints it. Alternative: print the guest count on every bill of
the table and the per-person amount only on an unsplit one.
**Joined tables print no guests line either.** Example: table 4 is seated with 2 guests and table 5
with 3; table 4 joins table 5 and they pay one bill of 150,00 €. The till keeps only table 5's
count, so the receipt would say «3 comensales · por persona 50,00 €» when 5 people ate. Guests are
entered only when a table is seated, so the till has no count for the joined party. Alternative: add
the joined tables' counts together («5 comensales · por persona 30,00 €») — right when each table's
count was entered, wrong when one was left blank.

> **2026-10-15, A713:** this describes the code before A713. A guest count now has more writers:
> the till's Guests sets or clears it at any time (`PUT /api/parties/:id/guests`); a Join, or a Move
> guests onto a seated table, leaves the surviving party with both counts added together, or none
> when either is unknown or the sum is over 999 (`combineParties`, `apps/server/src/table-actions.ts`);
> and Split a table asks each side's count. The owner chose to add joined counts
> ([till.md](../../backlog/till.md#decisions-and-deliberate-limits)), so a merged party's own count
> already holds the sum. A bill split by item still has no count of its own. Q2's joined-tables half is
> answered by that choice.

**Q3 — Where the drink/food switch lives.** (Part 4 withdrawn 2026-10-15; no answer needed.)
The spec says "a venue setting" (point 7, and the mockup's legend: «a venue setting, off by
default»); this plan's default departs from that, so it needs your yes.
Default: **in each department's receipt settings, beside "Print address"**, which is where a
printed receipt reads its options from today (`receipt-print.ts:166-182` reads the department's
receipt). Example: the bar's receipts show the subtotals and the deli's do not. Alternative, as the
spec says: **one switch for the whole venue.** That needs no database change either — the venue's
own receipt settings are a one-row table holding plain JSON (`tenant_receipts.receipt`,
`packages/db/src/schema/tenant-receipts.ts:18-25`) — but printing does not read those settings
today: both the paper and the A4 path hand an empty venue layer to `resolveReceiptTrim`
(`receipt-print.ts:182`, `invoice-document.ts:113`), so the venue switch would also teach printing
to read that row.

**Q4 — The "/ 4" on today's full invoice, and an extras portion's price.** ANSWERED 2026-10-15:
«just the price per portion, we don't need the portion size». Part 2 prints «1,24» in the price
column for an extra priced 1,24 € per 0.05 portion — no «/0.05», no unit, no conversion — and no
"/ N" after any price (Task 2.3a's `beforeVatFigures`, Task 2.3b). Decided with it (review,
2026-10-15): the till stores such an extra's quantity as portions × portion size (two 0.05 kg
portions are stored as 0.100), so its units cell prints the number of portions, «2», and the row
reads «2 Queso extra 1,24 2,48», which adds up; «0.100 kg» beside a price per 0.05 would not. When
the stored quantity is not a whole number of portions, the cell keeps the quantity and unit as
before (Task 2.3a's `quantityText`). The question as asked:
The spec asks for "17,50 € × 2" instead of "17,50 € / 2". The number after "/" is not how many were
sold: it is the quantity the price is FOR (`sale_lines.price_quantity`, printed at
`apps/server/src/receipt-document.ts:133`), so "× 2" would be wrong. On a real sale it is 1 for
every product line, because a product is priced per one of its unit (neither `priceBasket` nor
`grossBasketWithOptions` gives a dish any other quantity, `packages/catalogue/src/pricing.ts:208-226,
294-315`; the column defaults to one,
`packages/db/src/schema/sales.ts:184`): a real full invoice prints «13,64 € / 1 ud» or «… / 1 kg».
The mockup's «5,45 € / 4» came from the mockup's own sample data, not from a real sale. Part 2's
table removes that line (the count has its own «Uds» column and the price column shows «13,64»), so
spec point 4 is met without a "/" or "×".
The one case where the number is not 1 is an extras pick priced per portion
(`apps/server/src/modifier-selection.ts:121`), which today prints, for example, «Precio sin IVA
1,24 € / 0.05» (measured by the plan's reviewer). Default: **show the price per the portion, as
stored**, «1,24/0.05» in the price column (with the unit's name when it has one, and "." until
quantities follow the language, Task 1.8's follow-up). Alternative: convert it to a price per one
unit («24,80»), a figure the receipt works out rather than one it was given.

**Q5 — A discount on a full invoice: with or without VAT?** ANSWERED 2026-10-15: «on a full
invoice the amounts should be displayed ex vat. on a simplified invoice (a receipt) the amounts
should be inclusive of vat. So for a full invoice, where the menu del dia is 10€ and we give a 10%
discount, we would have: menu 9,09 / discount 10% 0.91 / base imponible: 8,18 / iva: 0.82. For a
simplified invoice, we would have: menu 10 / discount 10% 1.00 / base imponible: 8,18 / iva:
0.82».
What Part 2 builds: on the full invoice the item's amount and the discount row are before VAT,
with no «(IVA incluido)»; «Base imponible» and «IVA» per rate are the filed record's figures. The
simplified receipt already prints the item and the discount with VAT (`receipt-document.ts:117-118,
166-170, 245-251`; `receipt-adjustments.test.ts` "prints a paid bill's comp, percentage off a line
and discount on the bill, adding up" prints «Rioja crianza 30,00» then «Descuento 20% -6,00»,
passing 2026-10-15), and its one-rate «IVA 10% incluido» row from Part 1b stays (RD 1619/2012 art.
7.1.f; the approved mockup), so it does not print the base on a one-rate receipt — which differs
from your simplified example; see Q11 (answered 2026-10-15: Part 2b prints the base). Your example
works out exactly: the till files the 10,00 € menu less 10% as base 8,18 and VAT 0,82, and the
full invoice prints «1 Menú del día 9,09 9,09», «Descuento 10% -0,91», «Base imponible 10% 8,18 €»,
«IVA 10% 0,82 €» (measured, Part 2 "The table's figures").
**Note for the owner — where a cent can look wrong.** The discount row is always the item's amount
minus the base the till filed, so each item and the whole table add up to the base imponible
exactly. The rounding cent therefore shows in the discount row: a 12,50 € menu with 10% VAT and
10% off prints «Menú del día 11,36», «Descuento 10% -1,13», «Base imponible 10% 10,23 €», «IVA 10%
1,02 €». 10% of 11,36 is 1,14, but printing 1,14 would make the line come to 10,22 while the filed
base is 10,23 — and a filed figure is never recomputed. Similarly the VAT is the total minus the
base, so it can be a cent off rate × base (three 1,00 € drinks at 21%: base 2,49, VAT 0,51, though
21% of 2,49 is 0,52); that is how every invoice is filed today.
The question as asked:
Today a full invoice prints a discount with VAT, labelled: «Descuento 10% (IVA incluido) −1,21 €».
The new table's amounts are before VAT. Default: **keep the discount as today**, on its own line
under its item (art. 6.1.f only asks that it be shown). Example: «1 Menú del día 10,00 9,00» then
«Descuento 10% (IVA incluido) −1,21 €». Alternative: show it before VAT, «Descuento 10% −1,00», so
that 10,00 − 1,00 = 9,00 adds up on the line; that is a new figure the receipt works out rather than
one it was given.

**Q6 — Drink/food subtotals on a bill with a whole-bill discount.** (Part 4 withdrawn 2026-10-15; no answer needed.)
Default: **share the discount in proportion**, so Bebida + Comida always equals TOTAL. Example:
drinks 63,00, food 344,00, 10% off the whole bill (total 366,30) → Bebida 56,70, Comida 309,60.
Alternative: print the subtotals before the discount, which then do not add up to TOTAL.

**Q7 — Catalan, Galician and Basque wording.** ANSWERED 2026-10-15: ship the plan's wording as
written. The question as asked:
The new receipt words in ca-ES, gl-ES and eu-ES (Tasks 1.2, 2.1, 3.1, 4.5) are this plan's own
translations, written beside the existing words in `packages/country-es/src/receipt-labels.ts`; no
native speaker has checked them. Default: ship them and correct any you or your asesor flag. The
fixed Veri\*Factu texts («QR tributario:», «VERI\*FACTU») stay Spanish in every language, as today.

**Q8 — Does a count print as a bare number?** ANSWERED 2026-10-15: «BARE «ud» COUNT ON BOTH the
full invoice AND the simplified receipt». A count in «ud» prints as «4 Agua, pan y aceite» on the
full invoice's table and on the simplified receipt; any other unit keeps its name («0.35 kg Jamón
ibérico») on both. Part 2 builds both halves (Tasks 2.3a, 2.3b and 2.3d); the till's on-screen copy
is a backlog follow-up (Task 2.6). The question as asked:
Real receipts print the unit beside the count: «4 ud  Hamburguesa», «0.35 kg  Jamón ibérico»
(measured by the plan's reviewer; the code is `receipt-document.ts:207-211`). Both mockups draw a
bare «4». Default: **in the full invoice's table (Part 2), a count in units («ud») prints as a bare
«4», and any other unit keeps its name («0.35 kg»).** Example: «4 Agua, pan y aceite 5,45 21,82» but
«0.35 kg Jamón ibérico 109,09 38,18». On 58 mm paper a weighed line widens the «Uds» column so much
that every row of that invoice prints on two lines (name, then figures); with only bare counts each
row fits on one line. The simplified receipt (Part 1b) keeps «4 ud» as today; say so if you want it
bare there too, and it joins Part 2. Alternative: keep «4 ud» in the table as well.

**Q9 — The price of a weighed item that was discounted, when less than a kilo was sold.**
ANSWERED 2026-10-15: «The owner chose the alternative: when an invoice is issued, store each sale
line's price before any discount, so every line (including a weighed line under a kilo) prints its
real price and its own discount row («0.123 kg Jamón ibérico 21,82 2,68 10%» / «Descuento 10% -0,26
10%»), and a comped weighed line shows its value and an «Invitación» row. This is a database change
on sale lines: pre-live, no data migration (CLAUDE.md §3 "no backwards-compatibility code until
production"). Follow the drizzle rules (one generation per change; list foreign keys before any
table rebuild; a money column holds whole cents, converted at the row). It must not change any
fiscal record's hashed content, the alta writer, numbering or a golden/inmutabilidad test — say in
the plan where the new value is written and prove the fiscal suites unchanged. FULL review path.
Revise the plan's Part 2 (or a part of its own if cleaner — say which) before building.» Built by
**Part 2c**, a part of its own; Part 2 lands with the default below. The question as asked:
The till does not store a discounted line's price before the discount, only its total before the
discount. Dividing that total back gives the price exactly whenever at least one whole priced unit
was sold (every counted dish and extra, any weighed line of a kilo or more), but not below that.
Example, measured: 0.123 kg of jamón at 24,00 €/kg with VAT, 10% off the whole bill. Its total
before the discount, 2,95 €, divided by 0.123 gives 23,98 €/kg, not 24,00. Default: **such a line
prints the price and amount the till filed after the discount (19,69 and 2,42 before VAT) and no
discount row of its own** — every figure on it is one the till stored, and art. 6.1.f is met
because the discount is inside that price. Alternative: store each line's price before any
discount when the invoice is issued, so this line too prints «21,82 2,68» and «Descuento -0,26»;
that is a new stored fact on every sale line (a database change), so it is yours to approve.
The same default has one visible gap: such a weighed line that was **comped** (given free) prints
«0,00 0,00» and no «Invitación» row, because what it was worth before the invitation is only
recoverable from the stored total, which the default does not use below one kilo. It is in Task
2.6's LOOK so you can see it; storing the price before any discount would close it too.

**Q10 — A discount on the whole bill, on a full invoice.** ANSWERED 2026-10-15: «The owner chose
the alternative: the whole-bill discount prints once per VAT rate at the end of the table
(«Descuento 10% -2,48 21%», «Descuento 10% -0,22 10%»), before VAT, not under each dish. A dish's
OWN discount still prints under that dish. Your question said the two cannot be told apart in what
the till stores; with Q9's answer (each line now stores its price before any discount) check
whether they now can — if they can, keep them apart; if not, say exactly what a dish with both
discounts prints, with a worked example, in this file before building that case. The base
imponible and IVA lines stay the record's own figures.» Built by **Part 2c**, with Q9; whether the
two can be told apart is its Step 1, with a worked example for each outcome. Part 2 lands with the
default below. The question as asked:
The till files a whole-bill discount by lowering every dish's price, so each dish's filed base
already holds its share. Default: **each dish gets its own discount row with its share, before VAT,
at its rate.** Example, measured: a 30,00 € Rioja (21%) and a 2,50 € bread (10%), 10% off the bill:
«1 Rioja crianza 24,79 24,79 21%», «Descuento 10% -2,48 21%», «1 Pan de pueblo 2,27 2,27 10%»,
«Descuento 10% -0,22 10%», then «Base imponible 21% 22,31 €», «IVA 21% 4,69 €», «Base imponible 10%
2,05 €», «IVA 10% 0,20 €», TOTAL 29,25 €. Alternative: one discount row per VAT rate at the end of
the table («Descuento 10% -2,48 21%», «Descuento 10% -0,22 10%»), as the receipt prints the bill
discount once today. That reads more like the till, but when a dish also has its own discount the
two cannot be told apart in what the till stores, so that dish's row would then hold both.

**Q11 — The VAT lines on a one-rate simplified receipt.** ANSWERED 2026-10-15: «The owner chose
the alternative: a one-rate simplified receipt prints «Base imponible 10% 8,18 €» and «IVA 10% 0,82
€» under TOTAL, as a full invoice does — not the single «IVA 10% incluido» line. This changes what
Part 1b built (#1756): do it as a small change in Part 2 or its own PR (say which), with the receipt
tests and the .bin fixtures regenerated, and update the approved mockup `1-simplified-receipt.png`'s
note in the plan (record the owner's 2026-10-15 decision; the mockup itself is history). Base and
IVA are the record's own figures.» Built by **Part 2b**, its own pull request; nothing in Part 2
changes these lines. The question as asked:
Your Q5 answer wrote the simplified receipt as «menu 10 / discount 10% 1.00 / base imponible: 8,18
/ iva: 0.82». The receipt you approved on 2026-10-14 (`1-simplified-receipt.png`), built in Part
1b, prints one line instead when every item has the same VAT rate. Both are legal: RD 1619/2012
art. 7.1.f asks a simplified invoice for the rate and, optionally, «IVA incluido», and for the base
per rate only when it mixes rates. Default, as approved and built: **one line**.
```
1 Menú del día                 10,00
  Descuento 10%                -1,00
TOTAL                         9,00 €
IVA 10% incluido              0,82 €
```
Alternative, as your Q5 example reads: **the base and the VAT**, as a full invoice prints them.
```
1 Menú del día                 10,00
  Descuento 10%                -1,00
TOTAL                         9,00 €
Base imponible 10%            8,18 €
IVA 10%                       0,82 €
```
A receipt with two rates already prints the base and the VAT for each rate either way.

**Part 1b — the business block's order with a receipt subtitle but no trading name.** Asked after
Part 1b landed (#1756): with a subtitle but no trading name, the plain subtitle prints first and the
legal name, in bold, under it, as the order list in Task 1.5 says, while another sentence there said
"legal name first and bold". ANSWERED 2026-10-15: «KEEP IT AS BUILT — subtitle first, bold legal
name under it. No change.» Nothing is built; Task 1.5's sentence now matches the order list.
