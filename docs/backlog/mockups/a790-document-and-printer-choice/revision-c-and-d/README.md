# A790: Invoice inline, and the simplified-sale question

These static drawings accompany the [current design](../../../../superpowers/specs/2026-10-19-a790-document-and-printer-choice-design.md).
The owner approved C on 2026-10-19: Invoice uses a folded printer row in the same form
as its named final print action. D remains the sole next question. The complete design
is not approved for planning or build.

Each board compares three examples:

1. **C, approved:** Invoice for recorded full invoice `F/1042`, with Office · A4 in the
   folded row and Office/Terrace belt available when expanded. The final action names
   Office and says copy only when the server designates a copy. This assumes an eligible
   selection; invoice memory and first-use fallback remain unapproved.
2. **D, recommended:** `S/318`, €14.50, Spanish, one guest opens its Receipt form directly.
   Patio receipt is the phone's current Equipment choice, with Bar receipt also offered.
   The inline printer row and final named print action stay visible in the same form.
3. **D, alternative:** first show a document choice with only Receipt available and Invoice
   unavailable, then continue to that same receipt form. The extra step never prints.

D compares the document step only. Both proposals keep the recorded simplified invoice,
number, amount and guest count, and preserve the language choice where already offered.
Neither creates or converts a full invoice. These device examples use the receipt list and
single Equipment setting. A device-free dashboard follows approved B: every active printer
at the sale's venue, including A4 and portable equipment, with its browser preselection.
D does not introduce an A4 full-invoice document, email, a second receipt memory, or a
portable-printer takeover. General one/zero-printer details, fallback, browser storage,
Equipment save/concurrency and portable receipt-holder enforcement remain proposals.

| Language/theme | Phone, 390 px                                       | Wide, 1280 px                                        |
| -------------- | --------------------------------------------------- | ---------------------------------------------------- |
| English light  | [Open PNG](invoice-and-simplified-en-light-390.png) | [Open PNG](invoice-and-simplified-en-light-1280.png) |
| English dark   | [Open PNG](invoice-and-simplified-en-dark-390.png)  | [Open PNG](invoice-and-simplified-en-dark-1280.png)  |
| Spanish light  | [Open PNG](invoice-and-simplified-es-light-390.png) | [Open PNG](invoice-and-simplified-es-light-1280.png) |
| Spanish dark   | [Open PNG](invoice-and-simplified-es-dark-390.png)  | [Open PNG](invoice-and-simplified-es-dark-1280.png)  |

The corresponding SVGs sit beside the PNGs. All eight PNGs were rendered in headless
Chromium and visually inspected. Native SVG text boxes were measured within the drawings.
These checks concern static illustrations. They supply no product, accessibility,
transition, printer-transport or physical-paper evidence. Spanish wording is proposed.
Earlier boards remain history wherever the latest addendum supersedes them.
