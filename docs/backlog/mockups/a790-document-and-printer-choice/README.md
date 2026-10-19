# A790: document and printer choice

## Current revision, 2026-10-19

The [design addendum](../../../superpowers/specs/2026-10-19-a790-document-and-printer-choice-design.md)
controls the revised flow. **A is approved:** Receipt prints the same recorded `F/1042`
compact, with its customer details, through the receipt list; Invoice prints that same
invoice through the invoice list, on A4 or receipt paper. Neither issues another invoice.

A796 applies to receipt printing at and after payment: an inline, optionally collapsed
printer dropdown, preselected to the last eligible receipt destination, with no mandatory
second printer step. The same form/action names the printer and confirms the request;
row selection, loading and collapse never print. Exact memory scope and persistence remain
proposed. Device-free dashboard eligibility/memory awaits B; do not import till memory.
Invoice-role inline behavior is recommended but unapproved C because A796's wording names
receipt-role printers. Card-reader memory belongs to A796, outside A790.

**B is the sole current owner question:** for Harbour's sale on a device-free dashboard,
suggest Counter 1's current Counter profile with an eligible-profile change (recommended),
use all eligible Harbour printers, or configure a dedicated dashboard profile. The design
states the conditions and consequences. C/D, persistence and the complete build remain
unapproved; do not ask those questions alongside B.

The [revised receipt-flow boards](revision-2026-10-19/README.md) show collapsed and expanded
equipment in the payment form and a receipt copy after payment. Eight English/Spanish,
light/dark, 390/1280 px PNGs were inspected. These are static drawings, with no product,
accessibility or paper checks. The existing B phone boards below still illustrate the
unapproved dashboard context. The owner settled last use on this device for the handheld
form; finer storage keys and first-use/unavailable-equipment fallback remain proposals.

## Historical brief and original boards

The text below is retained from commit `87f19d4bc98d2fb7925e886228430cabfc490a9b`.
Its “A only” instruction, all-recommendations-unapproved status and any mandatory separate
receipt-printer step are superseded by the addendum. Original A's document alternatives
are historical after approval; B–D remain unapproved alternatives wherever not superseded.
The generation/inspection statements below are historical receipts, not checks rerun for
this revision. Original boards do not demonstrate the revised interaction.

These are static discussion boards for the [design proposal](../../../superpowers/specs/2026-10-19-a790-document-and-printer-choice-design.md). All recommendations await agreement. The source SVGs sit beside their PNGs. The paper samples compare the same recorded invoice number and customer, not the finished fiscal layout.

Start with **A only** when asking the first owner question. B–D are ready for later decisions, and E illustrates proposed status wording. The Spanish words other than the owner's recorded Q1 labels are proposed copy.

| Board                 | Phone, English light                                         | What you compare                                                                                                                                  |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: what Receipt means | [Open PNG](a-full-invoice-document-meaning-en-light-390.png) | Receipt and Invoice route the same full invoice through different lists; one Full invoice choice and a separate payment receipt are alternatives. |
| B: dashboard context  | [Open PNG](b-dashboard-printer-context-en-light-390.png)     | A visible current profile, Change profile, location filtering, and the alternatives of all local printers or a dedicated profile.                 |
| C: choices and skips  | [Open PNG](c-phone-flow-and-skips-en-light-390.png)          | Invoice printers can use A4 or receipt paper. Payment stages the choice; a reprint requires a final named press.                                  |
| D: simplified sale    | [Open PNG](d-simplified-copy-en-light-390.png)               | Receipt only keeps the stored sale, language and guests. One printer keeps a confirmation; zero printers cannot print.                            |
| E: changing state     | [Open PNG](e-changing-state-and-outcomes-en-light-390.png)   | Loading, failed read, removed printer, accepted request with unavailable status, and unknown paper outcome are separate examples.                 |

Each stem has eight PNG/SVG variants: `en` or `es`, `light` or `dark`, `390` or `1280`. For example, [A in Spanish dark](a-full-invoice-document-meaning-es-dark-390.png) and [A on a wide screen](a-full-invoice-document-meaning-en-light-1280.png). Boards use colours read from the product tokens. Their geometry and text wrapping were checked during generation. The eight rendered overview sheets were inspected, alongside standalone phone samples.

These drawings do not exercise the product, transitions, accessibility, printer transport or physical output. The complete design and future implementation must cover those separately. The document describes the two-to-one/zero-printer transitions and original/copy races; these static snapshots do not demonstrate them.
