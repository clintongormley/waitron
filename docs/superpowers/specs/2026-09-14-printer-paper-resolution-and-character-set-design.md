# Printer paper width, resolution and character set

Owner decisions, 2026-09-14. Brainstormed and written on Opus 5.

## Why this exists

Everything Waitron prints is plain text plus a few printer commands, built by the command builder in
`packages/printing/src/escpos.ts`. A receipt printer does not scale that text to fit the paper: it prints each
character in its own fixed-width built-in font and starts a new row when the line runs out of room.
So the layout has to know the printer. Today it knows nothing about it, and that causes four problems:

1. **Every layout assumes 42 characters per line.** The receipt pads its label-and-amount rows to
   `RECEIPT_WIDTH = 42` (`apps/server/src/receipt-ticket.ts`), and the payment slip hard-codes the same
   42 (`apps/server/src/payment-slip.ts`). On a 58mm printer that fits 30 characters, each of those rows
   breaks in two, leaving the amounts stranded on the next row. A product name longer than the row also
   runs into its price with a single space, and the printer then breaks it wherever it hits the edge.
2. **The QR code's size is fixed in printer dots, and the code assumes the wrong dot density.** The
   receipt asks the printer for 6 dots per QR square, and the comment beside that setting assumes about
   203 dots per inch. The owner's Epson TM-T88III prints at 180 dpi. The law requires the QR to be
   between 30×30 and 40×40 mm (Orden HAC/1177/2024 art. 21.1, quoted in
   `docs/compliance/verifactu-findings.md`). At 180 dpi and 6 dots, a typical Waitron link would print
   at 41.5 mm (measurements below).
3. **The owner's printer probably cannot print the QR at all.** The receipt uses the printer's built-in
   QR command (`GS ( k`). The TM-T88II/III Technical Reference Guide lists that model's commands. It
   includes the neighbouring `GS ( A` (test print) and `GS v 0` (raster image), but not `GS ( k`. I
   believe this means the TM-T88III has no built-in QR. The backlog records that nothing physical has been
   verified since #327, and I found no record of a receipt QR printed on this printer, so nothing has
   confirmed or refuted this. The QR is required on every receipt.
4. **Accented letters and the € sign probably print as the wrong characters.** The builder converts text
   to bytes using the Latin-1 table and never tells the printer which character table to read them with.
   Star's manual for its printers' ESC/POS mode gives the starting table as `n=0`, PC437; I believe
   Epson printers start the same way unless their own settings were changed. Read through PC437, our bytes for "Café" print as
   "CafΘ", "jamón" prints as "jam≤n", and "12,50 €" prints as "12,50 ¼". The receipt code already
   records the € byte as a decision "deferred to the failover/hardware pass", but no backlog entry
   tracks it.

A printer cannot be asked for its paper width in a way that works across models: the model-ID command
(`GS I`) and the status command (`DLE EOT`) do not return it, and only some newer Epson models can
report their settings. So these facts are stored as printer settings that the owner picks.

## Decisions

- **Three new settings on every printer:** paper width (58mm or 80mm), print resolution (180 or 203
  dpi), and character set (Windows Latin, Multilingual with euro, or plain letters).
- **Paper width sets a fixed character count:** 30 characters on 58mm and 42 on 80mm. These are the
  smallest counts among the confirmed models (provenance below). A printer that fits more leaves unused
  space at the right; a count that is too high would break every amount row. A 203-dpi printer also gets
  30 or 42, because some of those models can be switched into a 42-column mode.
- **When a name is too long for one line**, it wraps. Its amount goes at the right-hand end of the name's
  last line, or on a line of its own if that line has no room. The owner chose this over keeping the
  amount on the first line.
- **The QR is always printed as an image that Waitron builds**, never with the printer's built-in QR
  command. Its dot size is chosen for each receipt, as explained under _The QR code_.
- **The owner picks the settings from a printed test page** that asks "which line fits?" and "which line
  reads correctly?", instead of looking up specification sheets.
- **The test page's captions and the dialog's text use the venue's default language** (the value
  `readVenueLocale` resolves at boot; Spanish or English today). The receipt's own fiscal labels stay in
  Spanish, as the receipt design already decided, because the receipt is a Spanish legal document.
- **All of this is one piece of work.** The owner chose to include the character set rather than design
  it separately, so the settings, the test page and the dialog are built once.

## The printer settings

Three new required columns on `printers` (`packages/db/src/schema/printers.ts`, core migration set), each
a PostgreSQL enum following the existing `ticket_scope` pattern:

| Column              | Enum                  | Values                        | Default   |
| ------------------- | --------------------- | ----------------------------- | --------- |
| `paper_width`       | `print_paper_width`   | `58mm`, `80mm`                | `80mm`    |
| `print_resolution`  | `print_resolution`    | `180dpi`, `203dpi`            | `180dpi`  |
| `character_set`     | `print_character_set` | `wpc1252`, `pc858`, `plain`   | `wpc1252` |

The defaults match the owner's TM-T88III: 80mm, 180 dpi, and a manual that lists "Page 16 (WPC1252)".
There is no data migration, because nothing is in production. The baseline migration grants
`SELECT, INSERT, UPDATE ON "printers"` to `app_user` for the whole table, so the new columns need no grant
of their own. The grant assertion tests still run over them.

- **API.** `POST /management-api/printers` accepts all three as optional fields (the defaults apply), and
  `PATCH /management-api/printers/:id` accepts each one on its own. Both routes check the values with
  `requireEnum`, which rejects an invalid value with the existing `management.request_invalid` code.
  `GET /management-api/printers` returns them. `packages/printing/src/printers.ts` carries them through
  `createPrinter`, `updatePrinter` and `listPrinters`.
- **Configuration export and import.** `packages/db/src/configuration-transfer.ts` copies every `printers`
  column except `poll_token_hash`, so the new columns travel without a code change. A test pins that they
  survive a round trip.
- **Jobs already in the queue keep the layout they were built with.** A changed setting affects only jobs
  built afterwards, and a resend still repeats the original bytes.

## Layout

A new file in `@waitron/printing`, next to the command builder, holds everything that turns settings into
layout. No other file contains these numbers.

- **The mapping from settings to layout.** `58mm` gives 30 columns and `80mm` gives 42. The resolution
  gives dots per millimetre for the QR calculation. The safe printable width in dots is the column count
  × 12: 360 dots for 30 columns and 504 for 42. Twelve dots per character is what the TM-T88III's
  figures give (512 dots and 42 columns on 80mm, 360 dots and 30 columns on 58mm), and it matches the
  research figures for the other models. Images are kept within that width.
- **Text is prepared before it is measured.** The text is normalised to composed characters (NFC) and
  converted to the character set (see _Character set_), so that one remaining character becomes exactly
  one byte on the wire. Every length is measured on the prepared text. This matters for plain letters,
  where "€" becomes "EUR" and grows from one character to three.
- **Wrapping.** A line breaks at spaces. A single word longer than the whole line is split. Continuation
  lines take an indent the caller chooses, so a receipt item's second line starts under the product name,
  not under the quantity.
- **A label with an amount.** The label wraps as above. The amount sits at the right-hand end of the
  label's last line when at least one space is left between them; otherwise it takes a line of its own,
  aligned right.

## The QR code

The server builds the QR itself and sends it as a raster image (`GS v 0`) with the builder's existing
`qrRaster`. The `qrcode` library is already a server dependency (`apps/server/src/print-job-preview.ts`).
The QR is encoded at error-correction level M, as the law requires.

**Dot size, chosen for each QR.** Let _n_ be the QR's width in squares, without the blank border, and _d_
the printer's resolution. The printed size is _n_ × _s_ × 25.4 / _d_ millimetres for _s_ dots per square.
The server picks the whole number _s_ that:

1. keeps the printed size between 30 and 40 mm at the configured resolution;
2. keeps the image, blank border included, within the safe printable width;
3. of those, lands closest to 35 mm; on a tie, the smaller _s_.

Aiming at 35 mm also protects against a wrong resolution setting. A QR sized for 180 dpi prints about 11%
smaller on a 203-dpi printer, and stays legal as long as it was at least 33.8 mm. A QR sized for 203 dpi
prints about 13% larger on a 180-dpi printer, and stays legal as long as it was at most 35.5 mm. So
whenever whole dots allow a size between 33.8 and 35.5 mm, the receipt is legal whichever resolution is
set.

A test enumerates every grid size that a link accepted by `packages/verifactu/src/validate.ts` can
produce, from the shortest link up to one with a 60-character invoice series made entirely of characters
that need escaping, and asserts that a valid _s_ exists at both resolutions and both paper widths. That
rule is therefore always met for real links, not just usually. If a future link format breaks it, that
test fails. The receipt path never throws over the QR: if no valid _s_ existed, it would print at the
size closest to 35 mm that fits and log a warning, because a thrown error in the sale path would roll
back a filed sale.

**Blank border.** The image carries the QR standard's blank border of four squares on every side.
`qrRaster` does not add one today; it gains an option to add it. **Assumption:** the law says "entre
30x30 y 40x40 milímetros" without saying whether the border counts. This design measures the code
without its border, which I believe is the usual reading of ISO/IEC 18004. The owner, or the compliance
adviser, should confirm this.

**The built-in QR command** (`EscBuilder.qr`) stays in the builder but no longer has a caller. The
receipt test that pinned its bytes moves to the raster path.

## Character set

| Setting   | Printer command sent after reset         | Text encoding                                   |
| --------- | ---------------------------------------- | ----------------------------------------------- |
| `wpc1252` | `ESC t 16` (select character table 16)   | Windows-1252: € is `0x80`                       |
| `pc858`   | `ESC t 19`                               | Code page 858: € is `0xD5`, é is `0x82`         |
| `plain`   | none (plain letters read the same in every table) | Accents removed, € becomes `EUR`       |

- **The builder takes the character set when it is created**, and `init()` sends the reset followed by
  the table selection. `text()` encodes with that set's table instead of Latin-1.
- **Tables.** Windows-1252 differs from Latin-1 in the 32 byte values from `0x80` to `0x9F`. Code page 858
  is code page 850 with `0xD5` changed from "ı" to "€". Both tables are built from the Unicode
  Consortium's published mapping files (`CP1252.TXT` and `CP850.TXT`), with the source named in the file.
  Tests pin known positions, checked with Python's codecs while writing this spec.
- **A character the chosen set does not have** first loses its accent (é becomes e). If that still
  leaves an unsupported character, it prints as `?`. No byte ever reaches the paper meaning a different
  character than the one intended.
- **Plain letters** removes accents, turns ñ and Ñ into n and N, ç into c, ¿ into ?, ¡ into !, and € into
  EUR. Any other character outside ASCII becomes `?`. It is the last resort, and it can change a word's
  meaning (año becomes ano), which is why the test page steers towards the first two sets.
- **The receipt's existing fix for the space between the amount and €** stays. It becomes shared with the
  payment slip, which does not have it today: `Intl.NumberFormat("es-ES", …)` places a non-breaking
  space (U+00A0) there, and the slip sends that as byte `0xA0` (checked in Node while writing this spec).

## What each document does

- **Customer receipt** (`apps/server/src/receipt-ticket.ts`). It takes the printer's three settings.
  - Item, option, VAT, total and payment rows use the label-with-amount layout.
  - The venue name, subtitle, order line, card reference and footer wrap.
  - Modifier lines wrap with their indent.
  - The QR is printed as an image, sized as above.

  Its content and element order do not change. Only the line breaks move, and no legally required element
  can be cut off. `buildReceiptBytes` reads the settings through `resolveReceiptPrinter`, which already
  selects the till's printer, so no extra read is added.
- **Payment slip** (`apps/server/src/payment-slip.ts`). The same layout replaces its hard-coded 42. It
  also gains the shared money formatting. `payment-slip-print.ts` already calls `resolveReceiptPrinter`.
- **Kitchen ticket and correction slip** (`apps/server/src/kitchen-ticket.ts`). Item names, doneness,
  modifiers and notes wrap with an indent. `lockActivePrinters` also returns each printer's paper width
  and character set. A station's ticket, the consolidated ticket and each correction slip are built once
  per distinct combination of those two settings among the printers they go to, instead of once for all.
  Resolution does not affect kitchen paper, because it carries no QR.
- **Drawer pulse.** Unchanged, and still a separate job with no text.
- **Test page.** Replaces today's two-line `TEST_PRINT_PAYLOAD` in `apps/server/src/print-api.ts`. It is
  described in the next section.

## The test page and the Edit printer dialog

The test page is the same for every printer, whatever its settings. It depends only on the venue's
language. Its captions are printed as plain letters (accents removed), so they read correctly before a
character set has been chosen. Its images all fit in 360 dots, the narrowest safe width.

**Section 1: "Which is the longest line whose | is on the same row?"** Four lines, each exactly as long as
its label says and ending in `|`:

| Line | Characters | Longest that fits means     | Confirmed examples                                    |
| ---- | ---------- | --------------------------- | ----------------------------------------------------- |
| A    | 30         | 58mm, 180 dpi               | TM-T88 family on 58mm paper                           |
| B    | 32         | 58mm, 203 dpi               | TM-P20 (32); TM-T20III on 58mm (35) also lands here  |
| C    | 42         | 80mm, 180 dpi               | TM-T88III, V, VI and VII; Bixolon SRP-350II          |
| D    | 48         | 80mm, 203 dpi               | TM-T20III, TM-m30                                     |

A line too long for the printer spills onto the next row, so its `|` moves down.

**Section 2: "Measure the QR code for your line. It must be between 30 and 40 mm."** Two sample codes.
Their content is fixed text, not a tax-agency link, so scanning them submits nothing.

- **"For A or C":** a 45-square code at 5 dots per square. That is 31.8 mm on a 180-dpi printer, but
  28.2 mm (too small) on a 203-dpi printer.
- **"For B or D":** a 53-square code at 6 dots per square. That is 39.8 mm on a 203-dpi printer, but
  44.9 mm (too big) on a 180-dpi printer. With its full border it would be 366 dots wide, so its left
  and right borders are trimmed to 21 dots each to fit in 360.

Each sample only measures within range on the resolution its letters stand for. The page therefore
catches the case the lines cannot: a printer switched out of its normal column count, such as a TM-T20III
in its 42-column mode, or a TM-T88VI or VII in its 48-column mode. Such a printer picks the wrong letter,
and its sample measures outside 30–40 mm.

**Section 3: "Choose the first line that reads correctly. Line 3 always does."**

- Line 1, sent with `ESC t 16` in Windows-1252: `1: Café jamón Ñ ¿¡ ç ü 5 €`
- Line 2, sent with `ESC t 19` in code page 858: `2: Café jamón Ñ ¿¡ ç ü 5 €`
- Line 3, plain letters: `3: Cafe jamon N ?! c u 5 EUR`

Each sample line is at most 30 characters, so none of them wraps on any printer.

**The Edit printer dialog** (`apps/dashboard/src/screens/printers-screen.ts`) shows the three settings,
with a **Print test page** button. Beneath the button it asks the page's two questions. Answering A–D sets
paper width and resolution; answering 1–3 sets the character set. The owner can also change the three
settings directly. The guidance text reads, in the venue's language: "Not sure? Print the test page and
answer the questions below." The **Test print** button on the printer's row prints the same page.
Printing the test page needs no unsaved settings, because the page does not depend on them.

A printer added from a scan still takes one click, with the defaults applied.

## Print preview

The preview dialog (`apps/dashboard/src/widgets/print-job-preview.ts`) loses its 58/80 switch. The preview
route (`GET /management-api/print-jobs/:id/preview`) reads the job's printer settings with the job. It
shows the job as it will actually print on that printer's **current** settings: a 42-column job sent to a
printer now set to 58mm wraps in the preview just as it will on paper.

- **Text width is set in character widths (`ch`)**, using the printer's column count, so the preview's
  line breaks land where the printer's do. Today's millimetre width only approximates them.
- **Images are drawn at the printer's resolution.** Today the widget assumes 8 dots per millimetre.
- **The decoder understands `ESC t`**, and decodes text with table 16, table 19 or the starting table.
  Today an unknown command stops the preview, so without this every new job would stop previewing. Any
  other table number still stops the preview.

## Not in scope

- Characters that none of the three sets can show (for example emoji in a product name) print as `?`.
- Centring text or the QR on the paper.
- Bold, double-height or other font effects.
- Using the full 48 or 32 columns on printers that have them.
- Printer models whose raster image command differs from `GS v 0`.

## Interaction with other work

`docs/superpowers/specs/2026-09-14-drop-tenant-id-design.md` removes `tenant_id` from every table and
query. Whichever lands second follows the other: if that work lands first, the new columns and the queries
this design changes carry no tenant clause.

## Testing

Each behaviour gets a failing test first.

- **Layout helper:**
  - a line of exactly the column count does not wrap;
  - a word longer than the line is split;
  - an amount moves to its own line when the last line has no room;
  - continuation lines keep their indent;
  - lengths are measured after the character-set conversion ("€" counts as three characters in plain
    letters).
- **Receipt at 30 and 42 columns:**
  - no decoded line is longer than the column count;
  - every legally required element is present (the existing completeness test, run at both widths);
  - the QR is a `GS v 0` image with no `GS ( k` command;
  - the image decodes back to the sale's link with the `qrcode` library;
  - its printed size at the configured resolution is between 30 and 40 mm.
- **QR dot size:**
  - for every grid size a valid link can produce, at both resolutions and both widths, a valid size
    exists and the chosen one is closest to 35 mm;
  - the grid sizes come from encoding the shortest and longest links `validate.ts` accepts.
- **Payment slip:** the byte before "€" is `0x20`, and no line is longer than the column count.
- **Kitchen tickets:**
  - two printers on one station with different paper widths receive different tickets;
  - two with the same settings receive identical bytes.
- **Test page:**
  - lines A–D decode to exactly 30, 32, 42 and 48 characters ending in `|`;
  - the two QR samples have 45 and 53 squares at 5 and 6 dots, and every image is at most 360 dots wide;
  - the character-set lines carry `ESC t 16` and `ESC t 19`, and decode correctly with those tables;
  - the captions appear in Spanish and in English, following the venue language.
- **Character set:**
  - known positions (€ at `0x80` and `0xD5`, é at `0x82` in code page 858);
  - the sample line survives a round trip through each set;
  - unsupported characters lose their accent or become `?`.
- **Database and API:**
  - the defaults apply;
  - each setting saves and comes back from `GET`;
  - an invalid value returns `management.request_invalid`;
  - the settings survive configuration export and import.
- **Preview:**
  - the decoder honours `ESC t`;
  - the route returns the printer's settings;
  - the widget sizes text in `ch` and images at the printer's resolution.
- **Dashboard, in the real browser:**
  - the dialog's questions set the stored settings;
  - Print test page queues a job;
  - axe accessibility checks pass in both themes;
  - the form follows the shared form rules in `docs/developers/design-system.md`.

## Verification on paper

On the owner's TM-T88III:

1. Print the test page. Line C should be the longest that fits.
2. The "For A or C" QR should measure about 31.8 mm.
3. Line 1 should read correctly. If it does not, record what printed.
4. Sell an item with an accented name, print its receipt, measure the QR, and scan it with a phone.
5. Compare the print preview with the paper.
6. Record whether the built-in QR command prints anything, to settle problem 3.

A 58mm printer can only be checked through the preview until one is available. The backlog entry says so.

## Documentation

- Add a backlog entry for this work.
- Correct the "~203 dpi" comment in `escpos.ts`.
- Remove the deferral note about the € byte from `receipt-ticket.ts`.
- Add a section to `docs/developers/conventions-ui.md`, pointing at this design: a printed document
  takes the printer's layout settings, and never hard-codes a width, a QR size or a text encoding.

## Measurements taken while writing this spec

The QR sizes come from `qrcode` 1.5's `QR.create(link, { errorCorrectionLevel: "M" })`, run in
`apps/server`:

| Link                                                              | Characters | Squares | 180 dpi, 5 dots | 180 dpi, 6 dots | 203 dpi, 5 dots | 203 dpi, 6 dots |
| ----------------------------------------------------------------- | ---------- | ------- | --------------- | --------------- | --------------- | --------------- |
| Test address, series "A", amount 0.00                             | 103        | 41      | 28.9            | 34.7            | 25.7            | 30.8            |
| Production, series "A-1", amount 1.80                             | 119        | 45      | 31.8            | 38.1            | 28.2            | 33.8            |
| Production, series "T1/1234", amount 12.50                        | 126        | 49      | 34.6            | 41.5            | 30.7            | 36.8            |
| Production, 60-character series, amount -123456789012.34          | 188        | 53      | 37.4            | 44.9            | 33.2            | 39.8            |
| Production, 60 characters that all need escaping, same amount     | 308        | 65      | 45.9            | 55.0            | 40.7            | 48.8            |

Forcing byte-only encoding gave the same square counts for the 119-character link above and for a
138-character production link (series "N01-2026-000123456", amount 12345.67, 49 squares). The
printer's own QR encoder was not measured.

The character decodings (PC437 "CafΘ", code page 858 € at `0xD5`, Windows-1252 € at `0x80`, 850 and 858
differing only at `0xD5`) come from Python 3's built-in `cp437`, `cp850`, `cp858` and `cp1252` codecs.

## Provenance

The research PDFs were downloaded and their text extracted. Each quote below was found in the extracted
text, except where marked.

| Claim                                                        | Source                                                                                                       | Words in the source                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| TM-T88III is 180 dpi                                         | Epson, TM-T88III series Specification Rev. E (jarltech.com/ger_new/new/support/cd/TM-T88III_spc_e.pdf)        | "Dot density: 180 dpi × 180 dpi"                                                                              |
| TM-T88III fits 42 characters on 80mm and 30 on 58mm          | same                                                                                                         | "For 80mm paper width mode; Font A: 42 … For 58mm paper width mode; Font A: 30"                              |
| TM-T88III 58mm needs a factory spacer                        | Epson, TM-T88II/T88III Technical Reference Guide                                                            | "This option is performed at the factory by installation of a spacer"                                        |
| TM-T88III has Windows-1252 and code page 858 tables          | same, Appendix C                                                                                              | "Page 16 (WPC1252) (TM-T88III only)"; "Page 19 (PC858: Euro)"                                                |
| TM-T88III lists no built-in QR command                       | same, command list                                                                                           | lists "GS ( A" and "GS v 0"; no "GS ( k" (an absence, so inferred)                                           |
| TM-T88V is 180 dpi, 42 characters on 80mm; has tables 16 and 19 | Epson, TM-T88V Technical Reference Guide                                                                  | "Dot density 180 × 180 dpi"; "Page 16 (WPC1252)"; "Page 19 (PC858: Euro)"                                   |
| TM-T88VI and VII are 180 dpi, 42/48/56 columns on 80mm, 30/36/40 on 58mm | Epson spec sheets                                                                                    | "Print Resolution 180 dpi"; "80 mm model: 42/48/56 columns" (research agent's quote, not re-checked by me)   |
| TM-T20III is 203 dpi, 48 columns on 80mm, 35 on 58mm, with a 42-column mode | Epson, TM-T20III Technical Reference Guide                                                        | "Dot density 203×203 dpi"; "42 column mode" (research agent's quote, not re-checked by me)                   |
| TM-P20 is 203 dpi, 32 columns                                | Epson, TM-P20 Technical Reference Guide                                                                      | "Characters per line Font A 32" (research agent's quote, not re-checked by me)                              |
| Bixolon SRP-350II is 180 dpi, 42 columns                     | Bixolon, SRP-350II manual                                                                                    | "Dot density 180 dpi (7dots/mm)"                                                                             |
| The table-selection command, its page numbers and its starting value | Star Micronics, ESC/POS command manual (starmicronics.com/support/Mannualfolder/escpos_cm_en.pdf)   | "ESC t n … Initial Value n=0 … 0 PC437 (USA: Standard Europe) … 16 WPC1252 … 19 PC858"                       |
| A line longer than the print area continues on the next row  | Epson ESC/POS Command Reference, glossary (via the Wayback Machine)                                         | "the image data already stored in the print buffer is printed, and a line feed is executed"                  |
| No status or ID command returns the paper width              | Epson ESC/POS Command Reference, `GS I` and `DLE EOT` pages (via the Wayback Machine)                       | research agent's reading; not re-checked by me                                                               |
| The QR must be 30–40 mm at error-correction level M          | Orden HAC/1177/2024 art. 21.1, quoted in `docs/compliance/verifactu-findings.md`                             | "deberá tener un tamaño entre 30x30 y 40x40 milímetros … se empleará el nivel M (medio)"                     |
| Unicode mapping files exist at the cited addresses           | unicode.org/Public/MAPPINGS/VENDORS/MICSFT/PC/CP850.TXT and …/WINDOWS/CP1252.TXT                             | both returned HTTP 200 on 2026-09-14                                                                         |
