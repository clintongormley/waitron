# A663 — receipts and full invoices that are easier to read — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Print the simplified receipt and the full invoice in the two layouts the owner approved on
2026-10-14 — ruled-off sections, a large TOTAL, one row per item on a full invoice, the registered
address once or labelled, VAT rates written "10%" and "17,5%", guests and the amount per person, and
an optional drink/food subtotal — on 58 mm and 80 mm paper and on the A4 page.

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

**Tech Stack:** TypeScript, Vitest (unit tests, plus `useVenueDb` for the readers in Parts 3–4), the
`@waitron/printing` raster builder, PDFKit and sharp for A4, Lit for the two dashboard switches in
Part 4.

**Spec:** `docs/backlog/printers.md`, section "A663 — receipts and full invoices that are easier to
read", with the approved mockups `docs/backlog/mockups/a663-receipt-layout/1-simplified-receipt.png`
and `2-full-invoice.png`. Read the section and look at both pictures before starting any task. The
mockups are "drawn, not rendered": where this plan departs from a drawing, it says so and why.

---

## How the work is cut

Four pull requests. Each leaves `main` green and correct on its own; none needs a later one.

| Part | What it delivers | Tasks | Can start |
| ---- | ---------------- | ----- | --------- |
| 1 | Bold and double-size lines on paper and A4; VAT rates as "10%"/"17,5%"; ruled sections and the one-fact-per-line business block on both documents; the simplified receipt's layout (heading lines, TOTAL double size straight after the items, «IVA 10% incluido»); the full invoice's TOTAL drawn double size where it already sits | 7 | Now |
| 2 | The full invoice's layout: "FACTURA" heading, a "Cliente" block, one table row per item, «Base imponible» per rate, the address once or labelled «Domicilio fiscal:», and the same on the A4 page | 6 | Now (after Part 1 lands) |
| 3 | Guests and the amount per person | 3 | After A661 lands (it edits `receipt-print.ts`); uses owner question Q2's default unless answered |
| 4 | The drink/food subtotal setting | 6 | After owner questions Q1, Q3 and Q6 are answered, and after A661 lands |

Point 4 of the spec ("17,50 € × 2", not "/ 2") is handled inside Part 2: the only place the code
prints a unit price beside a quantity is the full invoice's «Precio sin IVA» line
(`receipt-document.ts:129-140`, the `" / "` at line 133), and Part 2 replaces that line with the
table's price column. See owner question Q4 for why the "/" is not turned into "×".

Point 2's "Fecha de operación only when it differs from the issue date" is already how the code
behaves: both readers that feed a full invoice drop the operation date when it equals the issue day
(`apps/server/src/receipt-issuer.ts:29-35`, `apps/server/src/invoice-document.ts:146-148`; both
since 2026-10-06/08 per `git log -S"sale.operationDate !== issueDay"`, commits `2d9726855` and
`eb6403150`). Part 2 adds a test that pins it rather than new code.

---

## Global Constraints

- **Work in a worktree**: `python3 ~/workspace/tools/worktree.py new waitron <branch> --headless`.
  Branch names: `feat/a663-1-receipt-layout`, `feat/a663-2-full-invoice-layout`,
  `feat/a663-3-guests`, `feat/a663-4-drink-food-subtotals`. Every commit `git commit -s`.
- **Test first.** Every task writes its failing test, runs it and sees it fail for the stated
  reason, then writes the code.
- **Fiscal gate, every part, run UNEDITED and passing before the part's PR:**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
  If either needs an edit to pass, STOP: something printed is reaching a filed record or a hash,
  which this item must never do. Nothing in this plan writes to `sales`, `sale_lines`,
  `registros_facturacion`, the QR text or any input of `computeHuella`.
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
- **LOOK.** Part 1 Task 1.7 adds `apps/server/scripts/receipt-look.ts`, which writes PNG pictures of
  real tickets (58 mm at 203 dpi, 80 mm at 180 dpi) and the A4 page. Every part ends by running it
  and opening every picture. CLAUDE.md §4: a page asserted only as text has nothing checking that it
  renders.

## A661 overlap — files to leave alone until it lands

Lane A's branch `feat/a661-invoice-printer-on-device-profile` (worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a661-invoice-printer-on-device-profile`) is
open, with no pull request yet (`gh pr list --head feat/a661-invoice-printer-on-device-profile`
returned `[]` on 2026-10-15). `git diff --stat origin/main...HEAD` there, run 2026-10-15, lists 115
files. The ones this plan could touch:

- `apps/server/src/receipt-print.ts` and `apps/server/src/receipt-print.test.ts` (+66 and +106
  lines there). **Parts 3 and 4 must edit `receipt-print.ts`** (`buildReceiptBytes`,
  `receipt-print.ts:141-201`, is where the paper receipt gathers its inputs), so they start only
  after A661 has merged.
- `apps/server/src/till-api.ts`, `apps/server/src/working-order.ts`,
  `apps/server/src/management-api.ts`, `apps/server/src/orders-api.ts`,
  `apps/server/src/errors.ts`, `apps/server/src/invoice-delivery-*.ts`,
  `apps/server/src/invoice-choice-delivery.ts`, `apps/till/src/screens/till-ticket-view.ts`: no
  task here edits them.
- `docs/backlog.md` and `docs/backlog/printers.md`: each part's backlog edit is small; rebase over
  A661 if it lands first.
- A661 adds core migrations `0155`–`0157` in `packages/db/drizzle/`. Part 4's migration (if Q1 keeps
  its default) is in the catalogue set (`packages/catalogue/drizzle/`, last entry today
  `0032_content_suggestions.sql`), so the numbers cannot collide.

Parts 1 and 2 edit none of those files. Their layout changes can still break an assertion in
`receipt-print.test.ts`. I read its assertions (2026-10-15): they look for words in the decoded
ticket (`includes("TOTAL")`, `toContain("DUPLICADO")`, `"Ana · Mesa 4, 5 · Pedido"`, …), which this
plan keeps readable, so I expect them to pass. That is a reading, not a run: if a Part 1 or 2 run
shows `receipt-print.test.ts` failing and A661 has not merged, stop and wait for A661 rather than
editing that file.

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

The spec's own claim about art. 6.2.c — that the amount column, being each item's amount before VAT,
already gives each item's base — is consistent with the quoted words.

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
   already has a branch for it at `receipt-document.ts:213-222`). Expected: the item still prints,
   with its amount, in the simplified row form rather than a table row with empty cells. Test in
   Task 2.3.
5. **A venue address that matches the registered address except for case, commas or spacing.**
   Expected: printed once. And one that differs by a single real character (a different number):
   both printed, the registered one labelled. Test in Task 2.4.

---

# Part 1 — formatting, styles, ruled sections and the simplified receipt

Branch `feat/a663-1-receipt-layout`. One pull request.

### Task 1.1: Bold and double-size lines in `@waitron/printing`, readable back as text

Today every line is one 28-dot picture drawn from the glyph table
(`packages/printing/src/raster-text.ts:17-40`), and the decoder that tests and the dashboard's print
preview use (`readRasterText`, `raster-text.ts:72-108`) returns `undefined` for any picture that is
not exactly a regular line. The glyphs are already Iosevka Term **Bold**
(`packages/printing/src/glyphs.ts:1`), so "bold" here means one dot heavier: each glyph row ORed
with itself shifted one dot right, kept inside its 12-dot cell. Measured 2026-10-15 (a throwaway
script over `GLYPHS`, Node v26.11.1): of 339 glyphs, no emboldened glyph equals another glyph's
regular picture; three pairs share an emboldened picture (soft hyphen and hyphen, Đ and Ð, en dash
and hyphen), so the decoder takes the lowest code point among glyphs sharing a bold picture, the rule
it already applies to regular pictures (`raster-text.ts:42-53`). Double size draws each glyph 2×2,
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
point first, skipping a glyph whose emboldened picture equals its own regular one, which is only the
space). In `readRasterText`:
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

### Task 1.2: Receipt labels for the simplified receipt

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

### Task 1.3: VAT rates with significant digits only, and amounts without the € sign

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
`` `${…rate}%` ``. (`formatAmount` is used from Task 1.6 on.)

- [ ] **Step 4:** Run the two files again — PASS. The byte check ("keeps the captured F1 paper
  bytes", `receipt-document.test.ts:12-29`) should still pass, since the fixture's rates were already
  whole; if it fails, regenerate the two `.bin` files (write what
  `formatReceipt({ ...FULL_INVOICE_FIXTURE, printer: { paperWidth, resolution: "180dpi" } })` returns
  for each width, with a one-off `tsx` command) only after `printedLines` shows the sole difference
  is a rate's spelling.
- [ ] **Step 5:** Run the receipt suites (Global Constraints) — PASS after updating any expectation
  that spelled a rate with two decimals.
- [ ] **Step 6: Commit** — message lists the decoded before/after lines of the `.bin` files.

### Task 1.4: Styles on the document, drawn on paper and on A4

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
  amount, its position after the VAT lines on a full invoice).
- [ ] **Step 5: Commit** — `git commit -s -m "Receipts: TOTAL drawn double size on paper and A4 (A663 task 1.4)"`

### Task 1.5: Ruled sections and the business block, one fact per line

Both documents. Today the header joins name and NIF, and phone and email, with " · "
(`receipt-document.ts:169`, `:173-175`), and sections are separated by blank lines (`line()`). The
approved layout: a ruled line between every section; in the business block, one fact per line, the
first line in bold. The first line is the trading name when it prints (today's rule,
`receipt-document.ts:164-167`); otherwise the legal name is first and bold. Order: trading name (bold)
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
  `apps/server/src/invoice-pdf.test.ts`, `apps/server/src/receipt-preview-api.test.ts`

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
  thin line across the content width (`invoice-page.ts:117-127`); keep that. The thermal renderer's
  logo spacing reads "was the previous element a blank line" (`receipt-ticket.ts:58-64, 90-96`):
  treat a `rule` as that boundary too, so a logo after the rule gets no extra blank line above it.
- [ ] **Step 4:** Run the files — PASS. Run the receipt suites and update expectations that named
  the joined header ("Charcutería La Buena SL · NIF: B12345678" → two lines; `receipt-document.test.ts:39`),
  and the A4 test that counts exactly one rule (`invoice-pdf.test.ts:257-274`): it becomes "a rule
  directly above TOTAL" plus "rules between sections", keeping its position and same-page checks.
  `receipt-preview-api.test.ts`'s marks (phone, email) find the blocks a field adds; with phone and
  email on their own lines each mark is now one line — update the expected marks, keep that each
  field's mark is found.
- [ ] **Step 5:** Regenerate the two `.bin` files as in Task 1.3 Step 4. **Commit.**

### Task 1.6: The simplified receipt's own layout

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
1  Bloody Mary                   15,00        ← amounts without €
4  Agua, pan y aceite            24,00
   Descuento 10%                 -2,40
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
`Base 10%` / `IVA 10%` (art. 7.1.f). The date keeps `Intl`'s own format ("13 oct 2026, 16:53",
measured), not the mockup's comma-less drawing. A bill-wide discount
(`result.billAdjustments`) stays in the items section, after the items. The full invoice keeps its
heading rows, its per-item facts and its VAT-then-TOTAL order in this part (Part 2 replaces them);
only Tasks 1.3–1.5 change it.

**Files:**
- Modify: `apps/server/src/receipt-document.ts:181-266`
- Modify: `apps/server/src/sample-receipt.ts` only if its tests need the new words
- Test: `apps/server/src/receipt-ticket.test.ts`, `apps/server/src/receipt-document.test.ts`

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
    { descriptions: { "es-ES": "Bloody Mary" }, quantity: "1", gross: "15.00" },
    { descriptions: { "es-ES": "Agua, pan y aceite" }, quantity: "4", gross: "24.00" },
  ],
  tender: { method: "cash", change: "11.00" },
  qr: "https://example.invalid/qr",
};

it.each([PRINTER_58, PRINTER_80])("lays out a one-rate simplified receipt as approved ($paperWidth)", (printer) => {
  const lines = printedLines(formatReceipt({ result: ONE_RATE, issuer: ISSUER, receipt: {}, invoiceLocale: "es-ES", printer }))
    .map((line) => line.trim().replace(/\s+/g, " "));
  const at = (prefix: string) => lines.findIndex((line) => line.startsWith(prefix));
  expect(lines).toContain("Factura simplificada T-2026/000112");
  expect(lines.some((line) => /^Mesa 12 · Pedido 112( 13 oct 2026, \d+:53)?$/.test(line))).toBe(true);
  expect(lines).toContain("1 Bloody Mary 15,00");
  expect(lines).toContain("TOTAL 39,00 €");
  expect(lines).toContain("IVA 10% incluido 3,55 €");
  expect(lines.some((line) => line.startsWith("Base"))).toBe(false);
  expect(at("1 Bloody Mary")).toBeLessThan(at("TOTAL"));
  expect(at("TOTAL")).toBeLessThan(at("IVA 10% incluido"));
  expect(at("IVA 10% incluido")).toBeLessThan(at("Efectivo"));
  expect(at("VERI") === -1 || at("VERI") < at("Factura simplificada")).toBe(true);
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
above accepts both.)

- [ ] **Step 2:** Run the file — FAIL.
- [ ] **Step 3: Implement.** For a simplified receipt: heading rows
  `row(orderText, issueDate(…))` and `row(label.simplifiedInvoice, result.invoiceNumber)`; item rows
  use `formatAmount` for the line and option amounts and for adjustments (`-${formatAmount(…)}`);
  after the items a rule, then TOTAL (double), then either
  `row(label.vatIncludedAtRate.replace("{rate}", formatVatRate(v.rate, locale)), formatMoney(v.tax, locale))`
  when `result.vatBreakdown.length === 1`, or the Base/IVA pair per rate; then the payment section.
  When `result.vatBreakdown` is empty (a zero-total sale), print neither. The full invoice path is
  left as it is apart from Tasks 1.3–1.5.
- [ ] **Step 4:** Run the file — PASS. Run the receipt suites; the biggest updates will be in
  `receipt-ticket.test.ts`, `till-api.fiscal-sale-paths.test.ts`, `till-sale.test.ts`,
  `working-order.test.ts` and `receipt-language.test.ts`. For each failure, read what the test
  checks; keep that fact and change only the expected position or wording (for example `"Base 10%"`
  on a one-rate receipt becomes `"IVA 10% incluido"`; an item amount with "€" loses it).
  `receipt-ticket.test.ts`'s completeness test (the comment at `receipt-ticket.test.ts:30-31` says it
  pins every art. 7.1 element) must still pass with its list of elements intact.
- [ ] **Step 5: Commit** — `git commit -s -m "The simplified receipt: ruled sections, TOTAL first and large, one VAT line for one rate (A663 task 1.6)"`

### Task 1.7: LOOK, the fiscal gate and the backlog

**Files:**
- Create: `apps/server/scripts/receipt-look.ts` (not under coverage: `apps/server/vitest.config.ts:36`
  excludes `scripts/**`; the other demo scripts there follow the same pattern, e.g.
  `apps/server/scripts/daily-close-demo.ts`)
- Modify: `docs/backlog/printers.md` (A663 entry: what Part 1 delivered)

- [ ] **Step 1: Write the script**

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

const line = (quantity: string, name: string, gross: string) => ({
  descriptions: { "es-ES": name },
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

const SAMPLES: Record<string, ReceiptDocumentInput> = {
  "simplified-one-rate": MOCKUP,
  "simplified-two-rates": {
    ...MOCKUP,
    result: {
      ...MOCKUP.result,
      total: "41.10",
      vatBreakdown: [
        { rate: "10.00", base: "13.64", tax: "1.36" },
        { rate: "21.00", base: "21.57", tax: "4.53" },
      ],
      lines: [line("1", "Bloody Mary", "15.00"), line("2", "Refresco para llevar", "26.10")],
      tender: { method: "cash", change: "8.90" },
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
  "full-invoice": { ...FULL_INVOICE_DOCUMENT_FIXTURE, surface: "thermal" },
};

for (const [name, input] of Object.entries(SAMPLES))
  for (const [paper, printer] of Object.entries(PRINTERS))
    await ticketPng(formatReceipt({ ...input, printer }), `${name}-${paper}.png`);

const pages = await renderInvoiceRaster(FULL_INVOICE_DOCUMENT_FIXTURE, 300);
for (const [index, page] of pages.entries())
  await sharp(page.pixels, { raw: { width: page.width, height: page.height, channels: 1 } })
    .png()
    .toFile(join(out, `full-invoice-a4-page${index + 1}.png`));
writeFileSync(join(out, "full-invoice-a4.pdf"), await renderInvoicePdf(FULL_INVOICE_DOCUMENT_FIXTURE));
```

The samples are pictures for a person, not fiscal fixtures: their figures add up (each total is
the sum of its lines and of its bases and VAT) but no check reads them. The script must typecheck: `apps/server/tsconfig.json` includes `scripts`, so
`pnpm --filter @waitron/server typecheck` covers it (and the pre-push hook runs it).

- [ ] **Step 2: Run it and LOOK.** `pnpm --filter @waitron/server exec tsx scripts/receipt-look.ts /tmp/a663-look`,
  then open every PNG with the Read tool. Check against the mockups: rules between every section,
  the bold first line visibly heavier, TOTAL twice the size and right-aligned with the amounts above,
  the 58 mm big total split over two double lines, nothing cut at the right edge. Write what you saw
  in the commit message ("opened 58mm-203 one-rate: …").
- [ ] **Step 3: Fiscal gate** — `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`, unedited, PASS.
- [ ] **Step 4: Backlog** — in `docs/backlog/printers.md`'s A663 entry, mark points 1 and 5 done
  (delete their text, leave one line saying which pull request delivered them) per
  `docs/backlog.md` → _How to keep this file honest_.
- [ ] **Step 5: Commit, then `/finish-branch <worktree>`** (FULL review path, Codex run-it ×2).

---

# Part 2 — the full invoice

Branch `feat/a663-2-full-invoice-layout`, from `main` after Part 1 has merged. Target layout
(`2-full-invoice.png`):

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
    Descuento 10% (IVA incluido)   -1,21 €    ← owner question Q5
    Precios sin IVA
------------------------------------------
Base imponible 10%                370,00 €
IVA 10%                            37,00 €
------------------------------------------
TOTAL                             407,00 €    ← double size, already from Part 1
------------------------------------------
Efectivo / Cambio
------------------------------------------
¡Gracias por su visita!
```

With more than one VAT rate the table gains a rate column after the amount ("10%", "21%"), and the
base/VAT pair prints per rate.

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
- [ ] **Step 5: Commit.** Translations other than Spanish: owner question Q7.

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
  /** Spaces before the item text: 2 for an extras line under its dish. */
  itemIndent?: number;
}
export interface ReceiptTable {
  header: ReceiptTableRow;
  rows: readonly ReceiptTableRow[];
  withRate: boolean;
}
/** Each printed line, with `header: true` on the header row's lines so the caller can bold them. */
export function tableLines(table: ReceiptTable, columns: number): { text: string; header: boolean }[];
```

Rule: column widths are the widest cell in each of units, price, amount and rate (header
included); one space between columns; units, price, amount and rate are right-aligned; the item
column takes what is left and wraps inside itself (`wrapText`, continuation lines indented to the
item column). If the item column would be narrower than 10, each row prints in two lines instead:
units and item across the full width, then the figures right-aligned on the next line (Review
Focus 3).

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

  it("adds a rate column with several rates", () => {
    expect(tableLines(table(true), 42)[1]!.text).toBe("  1 Bloody Mary          13,64   13,64 10%");
  });

  it("wraps a long item inside its column", () => {
    const long = { ...table(false), rows: [{ units: "1", item: "Menú degustación con maridaje de la casa", price: "72,73", amount: "72,73" }] };
    for (const line of tableLines(long, 30)) expect(line.text.length).toBeLessThanOrEqual(30);
    expect(tableLines(long, 30).map((l) => l.text).join(" ")).toContain("maridaje");
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
without a rate, 19 with one; on 30 columns with a rate the item would be 7, so the two-line form.)

- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/receipt-table.test.ts` — FAIL (module missing).
- [ ] **Step 3:** Implement `tableLines` with `wrapText` from `@waitron/printing`.
- [ ] **Step 4:** Run — PASS. **Commit.**

### Task 2.3: The full invoice's heading, customer block, table and totals

Replace, for `invoiceType === "F1"`, today's lines: "Factura completa" above the header
(`receipt-document.ts:160`), the `Factura`/`Fecha` rows (`:181-190`), the per-item «Precio sin IVA» /
«Base x%» / «IVA x%» rows (`netFacts`, `:129-140`, used at `:213-216` and `:241-249`), and the
summary's «Base» wording (`:260-263`).

New document element: `{ kind: "table"; table: ReceiptTable }` (`ReceiptTable` from Task 2.2), so
the thermal renderer calls `tableLines` and the A4 page lays out real columns (Task 2.5).

- Heading section: `row(label.invoiceHeading, result.invoiceNumber, { bold: true })`, then
  `row(orderText, issueDate(…))`, then the operation-date row when present.
- Customer section: `text(label.customer)`, legal name, `NIF: …`, address (today's three lines,
  `:200-205`, with the heading added).
- Items section: one table. Each dish is a row: `units` = quantity plus unit name as today
  (`:207-211`), `item` = name, `price` = `formatAmount(net.unitPrice)` (with the price-quantity
  suffix per owner question Q4's default: nothing when `net.priceQuantity` is 1, otherwise
  `/${trimQuantityForDisplay(net.priceQuantity)}${unit}`), `amount` = `formatAmount(net.base)`,
  `rate` = `formatVatRate(net.rate)`. Options answers are rows with only `item` (indent 2). Extras
  child lines are rows with `itemIndent: 2`. The table's `withRate` is true when the rows carry more
  than one distinct rate. Under the table: each line's adjustments as today's `takenOff` rows
  (owner question Q5's default — keep the «(IVA incluido)» amount, as its own row directly under the
  table row it belongs to), then bill-wide adjustments, then `text(label.pricesExcludeVat, 4)`.
  **If any F1 line has no `net`** (Review Focus 4), print the items section exactly as a simplified
  receipt's (Task 1.6) instead of a table, so no row has empty cells.
- Totals section: per rate, `row(\`${label.taxableBase} ${formatVatRate(rate)}\`, base)` and
  `row(\`${label.vat} ${formatVatRate(rate)}\`, tax)`; then a rule; then TOTAL (double, from Part 1).

**Files:**
- Modify: `apps/server/src/receipt-document.ts`
- Modify: `apps/server/src/receipt-ticket.ts` (draw `table`: `tableLines(element.table, columns)`,
  header lines bold)
- Modify: `apps/server/src/invoice-page.ts` (temporary: draw a `table` element as its
  `tableLines(table, 90)` text lines in the body font, so A4 keeps working until Task 2.5)
- Test: `apps/server/src/receipt-document.test.ts`, `apps/server/src/receipt-ticket.test.ts`
- Regenerate: the two `.bin` files

- [ ] **Step 1: Failing tests** (`receipt-document.test.ts`)

```ts
it("heads a full invoice with FACTURA and its number, in bold", () => {
  const elements = buildReceiptDocument(FULL_INVOICE_DOCUMENT_FIXTURE).elements;
  expect(elements).toContainEqual({ kind: "amount", caption: "FACTURA", amount: "FF/1", indent: 0, style: { bold: true } });
  expect(elements.some((e) => e.kind === "text" && e.text === "Factura completa")).toBe(false);
});

it("lists a full invoice's items as one table row each, before VAT", () => {
  const table = buildReceiptDocument(FULL_INVOICE_DOCUMENT_FIXTURE).elements.find((e) => e.kind === "table");
  if (table?.kind !== "table") throw new Error("no table");
  expect(table.table.withRate).toBe(true); // the fixture has 21% and 10% lines
  expect(table.table.rows[0]).toMatchObject({ units: "1", price: "10,00", amount: "9,00", rate: "21%" });
  expect(table.table.rows.map((r) => r.item)).toContain("Menú del día con un nombre especialmente largo");
});

it("prints no «Precio sin IVA» line and no per-item Base or IVA line", () => {
  const rows = buildReceiptDocument(FULL_INVOICE_DOCUMENT_FIXTURE).elements.flatMap((e) =>
    e.kind === "amount" ? [e.caption] : [],
  );
  expect(rows).not.toContain("Precio sin IVA");
  expect(rows.filter((c) => c.startsWith("Base imponible"))).toEqual(["Base imponible 21%", "Base imponible 10%"]);
});

it("keeps the discount, with VAT, on its own line under its item (art. 6.1.f)", () => {
  const rows = buildReceiptDocument(FULL_INVOICE_DOCUMENT_FIXTURE).elements.flatMap((e) =>
    e.kind === "amount" ? [[e.caption.trim(), e.amount]] : [],
  );
  expect(rows).toContainEqual(["Descuento 10% (IVA incluido)", "-1,21 €"]);
});

it("falls back to simplified item rows when a full invoice line has no filed net figures", () => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  delete input.result.lines[0]!.net;
  const elements = buildReceiptDocument(input).elements;
  expect(elements.some((e) => e.kind === "table")).toBe(false);
  expect(elements.some((e) => e.kind === "amount" && e.caption.includes("Menú del día"))).toBe(true);
});
```

(The figures above are read from `full-invoice-fixture.ts` and today's expectations in
`receipt-document.test.ts:52-68`: line one, unit price 10,00 before VAT, base 9,00 at 21% after a
10% discount of 1,21 with VAT. Check them against the fixture before running.)

Rewrite `receipt-document.test.ts:30-79` ("exposes the saved invoice figures…") so its row list is
the new one; keep its checks that the filed issuer, domicile and customer print and the current
mutable ones do not.

- [ ] **Step 2:** Run the file — FAIL.
- [ ] **Step 3:** Implement as described. Add the `table` case to `receipt-ticket.ts`.
- [ ] **Step 4:** Run the file and `receipt-ticket.test.ts` — PASS. Regenerate the `.bin` files
  (decoded before/after in the commit message). Run the receipt suites; expect updates in
  `invoice-pdf.test.ts`, `invoice-language.test.ts`, `till-api.fiscal-sale-paths.test.ts`,
  `till-sale-integrated.db.test.ts`. Keep what each checks.
- [ ] **Step 5: Commit.**

### Task 2.4: The address once, or both with «Domicilio fiscal:»

Today a thermal full invoice prints the venue address lines (`receipt-document.ts:170-172`, only on
`surface === "thermal"`) and then the filed registered address (`:176`), unlabelled, so a venue
whose two addresses match prints the same address twice. The A4 page passes no venue address
(`invoice-document.ts:128`, `venueAddress: []`), so it already prints the registered address once.

Rule (spec point 3): compare the venue address lines joined with ", " to `issuer.domicile`, after
folding case (`toLocaleLowerCase`), replacing every run of characters that are not letters or digits
with one space, and trimming. Equal → print only the venue lines. Different → print the venue lines,
then `«Domicilio fiscal:» <domicile>` as one text line. Only the registered address present (venue
address switched off, or A4) → print it unlabelled, as today. Accents are not folded: "Icària" and
"Icaria" count as different, so both print — a repetition, never a missing address.

**Files:**
- Modify: `apps/server/src/receipt-document.ts:170-176`
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
(`invoice-page.ts:148-150`), so nothing lines up. After this task: an `amount` element draws its
caption at the left and its amount right-aligned to `INVOICE_PAGE_WIDTH - MARGIN`; a `table`
element draws columns — units right-aligned in a column as wide as its widest cell, the item column
from there, and price, amount and rate right-aligned at fixed right edges measured with the font
(`width()`), the header row bold, an item name wrapping inside its column. A row that needs more
than the remaining page height moves to the next page whole.

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

it("draws the item table's amounts in one column", () => {
  const texts = layoutInvoicePages(fixture)[0]!.elements.filter((e) => e.kind === "text");
  const amounts = ["9,00", "8,00"].map((value) => texts.find((e) => e.kind === "text" && e.text === value)!);
  const rights = amounts.map((e) => e.kind === "text" ? e.x + measuredWidth(e.text, e.size) : NaN);
  expect(rights[0]).toBeCloseTo(rights[1]!, 1);
});
```

(Use the fixture's real line amounts; `9,00` and `8,00` are its two bases, per
`receipt-document.test.ts:56-61` today.) Keep every existing A4 check: the QR first and 35 mm, the
logo, pagination without clipping (`invoice-pdf.test.ts:118`), the rule above TOTAL on TOTAL's page.

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
  addresses match, one whose addresses differ, and a two-rate full invoice; run it; open every
  58 mm, 80 mm and A4 picture and the PDF. Check the table columns line up, the 58 mm two-rate
  invoice uses the two-line rows, the A4 amounts sit on one right edge, «Domicilio fiscal:» appears
  only when the addresses differ.
- [ ] **Step 3: Fiscal gate**, unedited, PASS.
- [ ] **Step 4: Backlog.** In `docs/backlog/printers.md`, mark points 2, 3 and 4 done (point 4 by
  the table; see Q4 for the per-quantity price). Add a short entry under the fiscal area
  (`docs/backlog/fiscal.md`): "Check whether a simplified invoice can carry an operation date
  different from its issue date; art. 7.1.c then requires it on the receipt, and the document
  builder prints one only on a full invoice (`receipt-document.ts`)".
- [ ] **Step 5: Commit, then `/finish-branch`.**

---

# Part 3 — guests and the amount per person

Branch `feat/a663-3-guests`, from `main` after Part 1 has merged **and A661 has merged** (this part
edits `receipt-print.ts`). Uses owner question Q2's default unless the owner has answered.

Guests are stored on the party, not the bill: `parties.guest_count`, null or at least 1
(`packages/db/src/schema/parties.ts:37, 62`), set when a table is seated
(`apps/server/src/till-api.ts:2675-2685`). A bill belongs to a party through
`working_orders.party_id` (`packages/db/src/schema/orders.ts:108`), and a party can hold several
bills when it is split (`parties.ts:22-31`). A sale names its bill in `sales.working_order_id`.

Rule (Q2 default): print «4 comensales · por persona  101,75 €» when the sale's bill belongs to a
party with a guest count, and that party holds no other bill that is not `abandoned`
(`workingOrderStatus`, `orders.ts:29-36`). A split bill prints neither. The per-person amount is
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
    .select({ partyId: parties.id, guests: parties.guestCount })
    .from(sales)
    .innerJoin(workingOrders, eq(workingOrders.id, sales.workingOrderId))
    .innerJoin(parties, eq(parties.id, workingOrders.partyId))
    .where(eq(sales.id, saleId));
  if (row === undefined || row.guests === null) return undefined;
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
  abandoned → 4. Then a `receipt-print.test.ts` case: the printed receipt of a party-of-4 bill
  contains «4 comensales · por persona».
- [ ] **Steps 2–5:** run (FAIL), implement, run (PASS) plus the receipt suites, commit.

### Task 3.3: LOOK, gate, backlog

- [ ] Extend `receipt-look.ts` with `guests: 4` on the one-rate sample and the full invoice; run;
  open the pictures; the line sits after the payment, before the footer, in its own ruled section.
- [ ] Fiscal gate, unedited, PASS.
- [ ] Backlog: point 6 done; if Q2 is still unanswered, leave a one-line entry "A663 Q2: split
  bills print no guests line — owner to confirm".
- [ ] Commit, then `/finish-branch`.

---

# Part 4 — the drink/food subtotal setting

Branch `feat/a663-4-drink-food-subtotals`. **Waits for owner questions Q1, Q3 and Q6**, and for A661
to merge (edits `receipt-print.ts`). The tasks below build the recommended defaults; if the owner
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
(`CategorySummary.drink`), the dashboard's English and Spanish strings, tests beside each, including
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

- Spec coverage: point 1 → Tasks 1.4–1.6; point 2 → 2.3, 2.5, 2.6 (operation date pinned); point 3
  → 2.4; point 4 → 2.3 (the line it applies to is replaced; Q4); point 5 → 1.3; point 6 → Part 3;
  point 7 → Part 4. The BOE re-check is done above; Task 2.6 records the one open legal question.
- The "VERI\*FACTU line may be printed in bold for margin" option in the spec is not taken: the
  roll font is already a bold face, and Orden HAC/1177/2024 art. 20.1.b asks only that the phrase be
  as visible as the rest; the caption keeps the other lines' size and weight.
- Names used across tasks: `ReceiptStyle`, `TextStyle`, `textBandHeight`, `formatVatRate`,
  `formatAmount`, `ReceiptTable`, `ReceiptTableRow`, `tableLines`, `readReceiptGuests`,
  `drinkFoodSubtotals`, label keys as in Tasks 1.2, 2.1, 3.1 and 4.5.

---

## Owner questions

Answer by quoting the question number. Parts 1 and 2 need no answer; Part 3 can be built on Q2's
default; Part 4 waits for Q1, Q3 and Q6.

**Q1 — How does the till know a product is a drink?** (Blocks Part 4.)
Recommended: **mark categories.** In Products, a category's menu gets a "Drinks" switch; every
product in that category or any category under it counts as drink. Example: you switch it on for
"Bebidas"; "Vinos", "Cervezas" and "Refrescos" under it are drinks, and a new wine added to "Vinos"
next month is too, with nothing to remember. The receipt uses the category each line had when it
was sold. Alternative: a "Drink" switch on every product — finer (a dessert wine filed under
"Postres" could be a drink) but set product by product. Either needs one small database change.

**Q2 — Guests on a split bill.** (Part 3 builds the default unless told otherwise.)
Default: **a split bill prints no guests line.** Example: table 12 seats 4 and splits the bill in
two; each half would otherwise say «4 comensales · por persona» of a half-total, which is wrong. A
bill that is the table's only bill prints it. Alternative: print the guest count on every bill of
the table and the per-person amount only on an unsplit one.

**Q3 — Where the drink/food switch lives.** (Blocks Part 4.)
Default: **in each department's receipt settings, beside "Print address"**, where every other
receipt option already is; no database change. Example: the bar's receipts show the subtotals and
the deli's do not. Alternative: one switch for the whole venue (needs a database change).

**Q4 — A price set for a quantity other than one, on a full invoice.**
The spec asks for "17,50 € × 2" instead of "17,50 € / 2". In the code, the number after "/" is not
how many were sold: it is the quantity the price is for. A cheese priced 2,50 € per 100 g sold as
350 g prints today «2,50 € / 0.1 kg» — "2,50 € for each 0.1 kg"
(`apps/server/src/receipt-document.ts:133`; the fixture at
`apps/server/src/receipt-ticket.test.ts:396`). "2,50 € × 0.1 kg" would read as a multiplication and
be wrong. In the new table the count sold already has its own column («Uds»), so for an ordinary
price (per one) the price column shows just «13,64» and no "/" or "×" is printed at all. Default for
a price per another quantity: «2,50/0,1 kg» in the price column. Alternative: convert to a price per
one unit («25,00/kg»), which can need more than two decimals for some prices.

**Q5 — A discount on a full invoice: with or without VAT?**
Today a full invoice prints a discount with VAT, labelled: «Descuento 10% (IVA incluido) −1,21 €».
The new table's amounts are before VAT. Default: **keep the discount as today**, on its own line
under its item (art. 6.1.f only asks that it be shown). Example: «1 Menú del día 10,00 9,00» then
«Descuento 10% (IVA incluido) −1,21 €». Alternative: show it before VAT, «Descuento 10% −1,00», so
that 10,00 − 1,00 = 9,00 adds up on the line; that is a new figure the receipt works out rather than
one it was given.

**Q6 — Drink/food subtotals on a bill with a whole-bill discount.** (Blocks Part 4.)
Default: **share the discount in proportion**, so Bebida + Comida always equals TOTAL. Example:
drinks 63,00, food 344,00, 10% off the whole bill (total 366,30) → Bebida 56,70, Comida 309,60.
Alternative: print the subtotals before the discount, which then do not add up to TOTAL.

**Q7 — Catalan, Galician and Basque wording.**
The new receipt words in ca-ES, gl-ES and eu-ES (Tasks 1.2, 2.1, 3.1, 4.5) are this plan's own
translations, written beside the existing words in `packages/country-es/src/receipt-labels.ts`; no
native speaker has checked them. Default: ship them and correct any you or your asesor flag. The
fixed Veri\*Factu texts («QR tributario:», «VERI\*FACTU») stay Spanish in every language, as today.
