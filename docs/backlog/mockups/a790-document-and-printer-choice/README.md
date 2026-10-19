# A790: document and printer choice

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
