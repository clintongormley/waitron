# A790: receipt printers in the payment form

These static boards accompany the dated revision at the start of the
[design](../../../../superpowers/specs/2026-10-19-a790-document-and-printer-choice-design.md).
The owner approved A's document meaning and the last-used receipt printer in a collapsible
part of the handheld payment form. B, the rest of C, D and storage remain proposals.

The three examples show the equipment section collapsed, the same payment form expanded,
and a receipt copy after payment. The final example proposes a document selector in the
same form; that layout still needs C. Neither opening a selector nor choosing a printer
sends a payment or prints. The Pay action confirms the staged receipt destination; a
later copy has its own named Print action. A796 owns the card reader shown for context.
The Spanish words are proposed copy.

| Width            | English light                                | English dark                                | Spanish light                                | Spanish dark                                |
| ---------------- | -------------------------------------------- | ------------------------------------------- | -------------------------------------------- | ------------------------------------------- |
| Phone, 390 px    | [PNG](payment-and-reprint-en-light-390.png)  | [PNG](payment-and-reprint-en-dark-390.png)  | [PNG](payment-and-reprint-es-light-390.png)  | [PNG](payment-and-reprint-es-dark-390.png)  |
| Desktop, 1280 px | [PNG](payment-and-reprint-en-light-1280.png) | [PNG](payment-and-reprint-en-dark-1280.png) | [PNG](payment-and-reprint-es-light-1280.png) | [PNG](payment-and-reprint-es-dark-1280.png) |

Each PNG has an SVG source beside it. Colours come from the product theme tokens.
Generation measured each text line against its column width. All eight rendered PNGs
were inspected; this does not exercise the product, accessibility, transitions or paper.

B is the next owner question. Its existing discussion boards remain applicable:
[English light, phone](../b-dashboard-printer-context-en-light-390.png) and
[Spanish dark, phone](../b-dashboard-printer-context-es-dark-390.png).
They illustrate the unapproved current-profile recommendation, with all local printers
or a dedicated dashboard profile as alternatives. A dashboard has no implied till-device
last-used preference. Ask B alone; the full design remains unapproved for build.
